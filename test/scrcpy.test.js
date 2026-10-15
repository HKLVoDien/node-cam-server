/**
 * Mission: Kiểm tính năng chiếu màn hình scrcpy. Phần unit (validate, parse, dựng args,
 *   phiên, pair/connect) dùng process giả được tiêm vào nên không bao giờ chạy adb/scrcpy
 *   thật; phần tích hợp dựng server.js thật với FACECAM_SCRCPY trỏ vào chỗ không tồn tại,
 *   chủ yếu để kiểm các lớp bảo vệ của server điều khiển (Host/Origin/Content-Type, chỉ
 *   bind loopback, port bận không làm chết server chính).
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

const { startServer } = require('./helpers.js')
const { listLocalIPs } = require('../network.js')
const {
  ServiceError, ValidationError, resolveBinaries,
  isValidSerial, isValidHostPort, isValidPairCode, isValidPackage,
  parseDevices, parseApps, buildArgs, createScreenService,
} = require('../scrcpy.js')

const BASE = {
  serial: '6619d0ed', source: 'display', audio: 'pc', control: true,
  quality: 'balanced', fullscreen: false, alwaysOnTop: false,
}
const HEAD = ['--serial=6619d0ed', '--window-title=FaceCam Screen']

describe('buildArgs', () => {
  test('mặc định: chỉ serial, tiêu đề và chất lượng', () => {
    assert.deepStrictEqual(buildArgs(BASE), [...HEAD, '--max-size=1920', '--video-bit-rate=8M'])
  })

  test('nguồn app / camera / display', () => {
    assert.deepStrictEqual(buildArgs({ ...BASE, source: 'app', pkg: 'com.example.app' }),
      [...HEAD, '--new-display', '--start-app=com.example.app', '--max-size=1920', '--video-bit-rate=8M'])
    assert.deepStrictEqual(buildArgs({ ...BASE, source: 'camera' }),
      [...HEAD, '--video-source=camera', '--max-size=1920', '--video-bit-rate=8M'])
  })

  test('nguồn app bắt buộc bật điều khiển', () => {
    assert.throws(() => buildArgs({ ...BASE, source: 'app', pkg: 'com.example.app', control: false }),
      (err) => err instanceof ValidationError && err.field === 'control')
  })

  test('xoay hình chỉ áp cho camera', () => {
    assert.ok(buildArgs({ ...BASE, source: 'camera', rotation: 90 }).includes('--orientation=90'))
    assert.ok(!buildArgs({ ...BASE, source: 'camera', rotation: 0 }).some(a => a.startsWith('--orientation')))
    // Màn hình tự xoay theo máy → bỏ qua
    assert.ok(!buildArgs({ ...BASE, rotation: 90 }).some(a => a.startsWith('--orientation')))
    for (const rotation of [45, '90', -90, 360, null]) {
      assert.throws(() => buildArgs({ ...BASE, source: 'camera', rotation }), ValidationError, `rotation ${rotation}`)
    }
  })

  test('âm thanh off / pc / both', () => {
    assert.ok(buildArgs({ ...BASE, audio: 'off' }).includes('--no-audio'))
    const pc = buildArgs({ ...BASE, audio: 'pc' })
    assert.ok(!pc.includes('--no-audio') && !pc.includes('--audio-dup'))
    const both = buildArgs({ ...BASE, audio: 'both' })
    assert.ok(both.includes('--audio-source=playback') && both.includes('--audio-dup'))
  })

  test('control=false thêm --no-control', () => {
    assert.ok(buildArgs({ ...BASE, control: false }).includes('--no-control'))
    assert.ok(!buildArgs({ ...BASE, control: true }).includes('--no-control'))
  })

  test('chất lượng smooth / balanced / sharp', () => {
    assert.deepStrictEqual(buildArgs({ ...BASE, quality: 'smooth' }).slice(2), ['--max-size=1280', '--video-bit-rate=4M'])
    assert.deepStrictEqual(buildArgs({ ...BASE, quality: 'balanced' }).slice(2), ['--max-size=1920', '--video-bit-rate=8M'])
    assert.deepStrictEqual(buildArgs({ ...BASE, quality: 'sharp' }).slice(2), ['--video-bit-rate=16M'])
  })

  test('fullscreen và always-on-top', () => {
    const args = buildArgs({ ...BASE, fullscreen: true, alwaysOnTop: true })
    assert.ok(args.includes('--fullscreen') && args.includes('--always-on-top'))
  })

  test('serial sai bị từ chối', () => {
    for (const serial of ['6619d0ed --foo', '', undefined, 123, 'a'.repeat(129), 'a;b']) {
      assert.throws(() => buildArgs({ ...BASE, serial }), ValidationError, `serial ${JSON.stringify(serial)}`)
    }
  })

  test('package sai hoặc thiếu bị từ chối', () => {
    for (const pkg of ['a.b; rm -rf', '--start-app', 'nodots', '', undefined, '.a.b']) {
      assert.throws(() => buildArgs({ ...BASE, source: 'app', pkg }), ValidationError, `pkg ${JSON.stringify(pkg)}`)
    }
  })

  test('camera + both bị từ chối', () => {
    assert.throws(() => buildArgs({ ...BASE, source: 'camera', audio: 'both' }), ValidationError)
  })

  test('giá trị enum lạ và kiểu sai bị từ chối', () => {
    assert.throws(() => buildArgs({ ...BASE, source: 'screen' }), ValidationError)
    assert.throws(() => buildArgs({ ...BASE, audio: 'loud' }), ValidationError)
    assert.throws(() => buildArgs({ ...BASE, quality: 'ultra' }), ValidationError)
    assert.throws(() => buildArgs({ ...BASE, quality: '__proto__' }), ValidationError)
    assert.throws(() => buildArgs({ ...BASE, control: 'yes' }), ValidationError)
    assert.throws(() => buildArgs(null), ValidationError)
  })

  test('ValidationError mang mã VALIDATION', () => {
    try {
      buildArgs({ ...BASE, serial: '' })
      assert.fail('phải ném lỗi')
    } catch (err) {
      assert.strictEqual(err.code, 'VALIDATION')
      assert.ok(err instanceof ServiceError)
    }
  })
})

describe('validators', () => {
  test('hostPort', () => {
    for (const ok of ['192.168.1.5:41234', '0.0.0.0:1', '255.255.255.255:65535']) assert.ok(isValidHostPort(ok), ok)
    for (const bad of ['256.1.1.1:5555', '1.1.1.1:0', '1.1.1.1:65536', '1.1.1.1', '1.1.1.1:', 'example.com:5555',
      '1.1.1:5555', '01.1.1.1:5555', '1.1.1.1:05555', '1.1.1.1:5555 --x', '', null, 5555]) {
      assert.ok(!isValidHostPort(bad), String(bad))
    }
  })

  test('mã ghép nối', () => {
    assert.ok(isValidPairCode('123456'))
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '', null]) assert.ok(!isValidPairCode(bad), String(bad))
  })

  test('serial và package hợp lệ', () => {
    for (const ok of ['6619d0ed', '192.168.1.5:41234', 'adb-6619d0ed-AbCdEf._adb-tls-connect._tcp']) assert.ok(isValidSerial(ok), ok)
    for (const ok of ['com.google.android.youtube', 'a.b', 'com.example.my_app2']) assert.ok(isValidPackage(ok), ok)
  })
})

describe('parseDevices', () => {
  const FIXTURE = [
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    '6619d0ed               device product:garnet_global model:2312DRA50G device:garnet transport_id:1',
    'ABC123                 unauthorized transport_id:2',
    'DEF456                 offline transport_id:3',
    '192.168.1.5:41234      device product:x model:Pixel_7 device:panther transport_id:4',
    'adb-6619d0ed-AbCdEf._adb-tls-connect._tcp device product:garnet_global model:2312DRA50G device:garnet transport_id:5',
    'GHI789                 no permissions (user in plugdev group; are your udev rules wrong?); see [http://developer.android.com/tools/device.html]',
    '',
  ].join('\r\n')

  test('đọc đủ trạng thái, model và kiểu kết nối', () => {
    const d = parseDevices(FIXTURE)
    assert.deepStrictEqual(d.map(x => [x.serial, x.state, x.model, x.transport]), [
      ['6619d0ed', 'device', '2312DRA50G', 'usb'],
      ['ABC123', 'unauthorized', null, 'usb'],
      ['DEF456', 'offline', null, 'usb'],
      ['192.168.1.5:41234', 'device', 'Pixel_7', 'wifi'],
      ['adb-6619d0ed-AbCdEf._adb-tls-connect._tcp', 'device', '2312DRA50G', 'wifi'],
      ['GHI789', 'no permissions', null, 'usb'],
    ])
  })

  test('không có thiết bị → mảng rỗng', () => {
    assert.deepStrictEqual(parseDevices('List of devices attached\n\n'), [])
    assert.deepStrictEqual(parseDevices(''), [])
  })
})

describe('parseApps', () => {
  // Dữ liệu giả — không phải danh sách app thật của ai
  const FIXTURE = [
    'scrcpy 4.1 <https://github.com/Genymobile/scrcpy>',
    'INFO: ADB device found:',
    'INFO:     -> (usb)  6619d0ed    device  garnet',
    '[server] INFO: Device: [Xiaomi] fake',
    '[server] INFO: List of apps:',
    ' * Cài đặt hệ thống              com.example.sys.settings',
    ' - Zalo Giả                      com.example.zalogia',
    ' - Ứng dụng của tôi              com.example.myapp',
    ' - Alpha                         com.example.alpha',
    ' * An toàn cá nhân               com.example.safety',
    '',
  ].join('\n')

  test('bỏ dòng log, giữ tên có dấu cách/tiếng Việt, phân biệt hệ thống', () => {
    const apps = parseApps(FIXTURE)
    assert.strictEqual(apps.length, 5)
    const mine = apps.find(a => a.pkg === 'com.example.myapp')
    assert.deepStrictEqual(mine, { name: 'Ứng dụng của tôi', pkg: 'com.example.myapp', system: false })
    assert.strictEqual(apps.find(a => a.pkg === 'com.example.safety').system, true)
    assert.strictEqual(apps.find(a => a.pkg === 'com.example.safety').name, 'An toàn cá nhân')
  })

  test('app người dùng xếp trước app hệ thống', () => {
    const apps = parseApps(FIXTURE)
    const firstSystem = apps.findIndex(a => a.system)
    assert.ok(apps.slice(0, firstSystem).every(a => !a.system))
    assert.ok(apps.slice(firstSystem).every(a => a.system))
    assert.strictEqual(apps[0].name, 'Alpha')
  })

  test('nhãn app toàn khoảng trắng dài không làm treo (không backtrack bậc hai)', () => {
    const evil = ['- A' + ' '.repeat(400000) + 'B', '- A' + ' '.repeat(500) + 'x'.repeat(10)].join('\n')
    const started = Date.now()
    assert.deepStrictEqual(parseApps(evil), [])
    assert.ok(Date.now() - started < 500, `mất ${Date.now() - started}ms`)
  })
})

describe('resolveBinaries', () => {
  const ext = process.platform === 'win32' ? '.exe' : ''
  let dir

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facecam-bin-'))
    fs.writeFileSync(path.join(dir, `scrcpy${ext}`), '')
    fs.writeFileSync(path.join(dir, `adb${ext}`), '')
  })
  after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  test('tìm scrcpy trên PATH và adb cùng thư mục', () => {
    const r = resolveBinaries({ PATH: dir })
    assert.strictEqual(r.scrcpy, path.join(dir, `scrcpy${ext}`))
    assert.strictEqual(r.adb, path.join(dir, `adb${ext}`))
  })

  test('FACECAM_SCRCPY trỏ sai thì không rơi về PATH', () => {
    const r = resolveBinaries({ PATH: dir, FACECAM_SCRCPY: path.join(dir, 'khong-co') })
    assert.strictEqual(r.scrcpy, null)
  })

  test('FACECAM_SCRCPY/FACECAM_ADB hợp lệ được ưu tiên', () => {
    const r = resolveBinaries({ PATH: '', FACECAM_SCRCPY: path.join(dir, `scrcpy${ext}`), FACECAM_ADB: path.join(dir, `adb${ext}`) })
    assert.strictEqual(r.scrcpy, path.join(dir, `scrcpy${ext}`))
    assert.strictEqual(r.adb, path.join(dir, `adb${ext}`))
  })

  test('không có gì → null cả hai', () => {
    assert.deepStrictEqual(resolveBinaries({ PATH: '' }), { scrcpy: null, adb: null })
  })
})

/** Child process giả: chỉ có những gì service dùng tới */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
    setImmediate(() => { child.emit('exit', null, 'SIGTERM'); child.emit('close', null) })
  }
  return child
}

const FAKE_BINS = { scrcpy: path.join(os.tmpdir(), 'fake-scrcpy'), adb: path.join(os.tmpdir(), 'fake-adb') }
const INJECT = '[server] ERROR: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.'

describe('phiên scrcpy', () => {
  function setup() {
    const calls = []
    const child = fakeChild()
    const service = createScreenService({
      resolve: () => FAKE_BINS,
      spawnFn: (file, args, opts) => { calls.push({ file, args, opts }); return child },
    })
    return { service, child, calls }
  }

  test('spawn đúng file, args, không qua shell, ADB trỏ về adb đã resolve', async () => {
    const { service, calls } = setup()
    const st = await service.start(BASE)
    assert.strictEqual(st.running, true)
    assert.strictEqual(st.serial, '6619d0ed')
    assert.strictEqual(calls[0].file, FAKE_BINS.scrcpy)
    assert.deepStrictEqual(calls[0].args, buildArgs(BASE))
    assert.strictEqual(calls[0].opts.shell, false)
    assert.strictEqual(calls[0].opts.windowsHide, true)
    assert.strictEqual(calls[0].opts.env.ADB, FAKE_BINS.adb)
    await service.stop()
  })

  test('dòng giống nhau liền kề được gộp kèm số lần, hint injectEvents', async () => {
    const { service, child } = setup()
    await service.start(BASE)
    child.stdout.emit('data', Buffer.from('INFO: Texture: 1080x2400\n'))
    // Cắt đôi một dòng giữa hai chunk để kiểm việc ghép dòng
    child.stderr.emit('data', Buffer.from(`${INJECT.slice(0, 60)}`))
    child.stderr.emit('data', Buffer.from(`${INJECT.slice(60)}\r\n${INJECT}\n${INJECT}\n`))
    child.stdout.emit('data', Buffer.from('INFO: done\n'))
    const st = service.status()
    assert.deepStrictEqual(st.log, [
      { text: 'INFO: Texture: 1080x2400', count: 1 },
      { text: INJECT, count: 3 },
      { text: 'INFO: done', count: 1 },
    ])
    assert.deepStrictEqual(st.hints, ['injectEvents'])
    await service.stop()
  })

  test('bộ đệm log giữ tối đa 200 dòng', async () => {
    const { service, child } = setup()
    await service.start(BASE)
    for (let i = 0; i < 300; i++) child.stdout.emit('data', Buffer.from(`line ${i}\n`))
    const { log } = service.status()
    assert.strictEqual(log.length, 200)
    assert.strictEqual(log[199].text, 'line 299')
    await service.stop()
  })

  test('hint unauthorized và deviceGone', async () => {
    const { service, child } = setup()
    await service.start(BASE)
    child.stderr.emit('data', Buffer.from("ERROR: Device is unauthorized\nERROR: Could not find any ADB device\n"))
    assert.deepStrictEqual(service.status().hints.sort(), ['deviceGone', 'unauthorized'])
    await service.stop()
  })

  test('phiên thứ hai khi đang chạy → BUSY', async () => {
    const { service } = setup()
    await service.start(BASE)
    await assert.rejects(service.start(BASE), { code: 'BUSY' })
    await service.stop()
  })

  test('stop dừng process; thoát tự nhiên ghi exitCode và cho start lại', async () => {
    const { service, child } = setup()
    await service.start(BASE)
    child.emit('exit', 3, null)
    child.emit('close', 3)
    const st = service.status()
    assert.strictEqual(st.running, false)
    assert.strictEqual(st.exitCode, 3)
    const next = await service.start(BASE)   // không còn BUSY
    assert.strictEqual(next.running, true)
    const stopped = await service.stop()
    assert.strictEqual(stopped.running, false)
  })

  test("event 'error' của child không làm sập, được ghi vào log", async () => {
    const { service, child } = setup()
    await service.start(BASE)
    child.emit('error', new Error('spawn ENOENT'))
    const st = service.status()
    assert.strictEqual(st.running, false)
    assert.ok(st.log.some(e => e.text.includes('spawn ENOENT')))
  })

  test('thiếu binary → SCRCPY_NOT_FOUND, options sai → VALIDATION', async () => {
    const missing = createScreenService({ resolve: () => ({ scrcpy: null, adb: null }) })
    await assert.rejects(missing.start(BASE), { code: 'SCRCPY_NOT_FOUND' })
    await assert.rejects(missing.listDevices(), { code: 'SCRCPY_NOT_FOUND' })
    const { service } = setup()
    await assert.rejects(service.start({ ...BASE, serial: 'x y' }), { code: 'VALIDATION' })
  })

  test('status khi chưa có phiên nào', () => {
    const { service } = setup()
    assert.deepStrictEqual(service.status(),
      { running: false, serial: null, startedAt: null, exitCode: null, hints: [], log: [] })
  })
})

describe('thiết bị và ứng dụng', () => {
  test('listDevices chạy adb devices -l với timeout 5s', async () => {
    const calls = []
    const service = createScreenService({
      resolve: () => FAKE_BINS,
      run: async (file, args, opts) => {
        calls.push({ file, args, opts })
        return { output: 'List of devices attached\n6619d0ed device model:X\n', code: 0 }
      },
    })
    const devices = await service.listDevices()
    assert.deepStrictEqual(calls[0].args, ['devices', '-l'])
    assert.strictEqual(calls[0].opts.timeout, 5000)
    assert.strictEqual(devices[0].serial, '6619d0ed')
  })

  test('listApps validate serial và chạy scrcpy --list-apps', async () => {
    const calls = []
    const service = createScreenService({
      resolve: () => FAKE_BINS,
      run: async (file, args, opts) => {
        calls.push({ file, args, opts })
        return { output: ' - Fake App    com.example.fake\n', code: 0 }
      },
    })
    await assert.rejects(service.listApps('a b'), { code: 'VALIDATION' })
    const apps = await service.listApps('6619d0ed')
    assert.deepStrictEqual(calls[0].args, ['--serial=6619d0ed', '--list-apps'])
    assert.strictEqual(calls[0].opts.timeout, 60000)
    assert.deepStrictEqual(apps, [{ name: 'Fake App', pkg: 'com.example.fake', system: false }])
  })

  test('request trùng dùng chung một process; khác thiết bị thì BUSY', async () => {
    let calls = 0
    let release
    const gate = new Promise(r => { release = r })
    const service = createScreenService({
      resolve: () => FAKE_BINS,
      run: async (file, args) => {
        calls++
        await gate
        return args[0] === 'devices'
          ? { output: 'List of devices attached\n6619d0ed device\n', code: 0 }
          : { output: ' - Fake App    com.example.fake\n', code: 0 }
      },
    })
    const devs = [service.listDevices(), service.listDevices()]
    const apps = [service.listApps('6619d0ed'), service.listApps('6619d0ed')]
    await assert.rejects(service.listApps('other'), { code: 'BUSY' })
    release()
    await Promise.all([...devs, ...apps])
    assert.strictEqual(calls, 2)
  })

  test('dòng log quá dài bị cắt', async () => {
    const child = fakeChild()
    const service = createScreenService({ resolve: () => FAKE_BINS, spawnFn: () => child })
    await service.start(BASE)
    child.stderr.emit('data', Buffer.from('x'.repeat(10000) + '\n'))
    child.stderr.emit('data', Buffer.from('y'.repeat(100 * 1024)))   // không bao giờ xuống dòng
    const { log } = service.status()
    assert.ok(log.every(e => e.text.length <= 2001), 'mỗi dòng ≤ 2000 ký tự + dấu …')
    assert.strictEqual(log.length, 2)
    await service.stop()
  })
})

describe('pair / connect', () => {
  function setup({ probeResult = 'open', output = '', timedOut = false } = {}) {
    const calls = { probe: [], run: [] }
    const service = createScreenService({
      resolve: () => FAKE_BINS,
      probe: async (host, port) => { calls.probe.push([host, port]); return probeResult },
      run: async (file, args, opts) => { calls.run.push({ file, args, opts }); return { output, code: 0, timedOut } },
    })
    return { service, calls }
  }

  test('probe timeout → NETWORK_BLOCKED, không gọi adb', async () => {
    const { service, calls } = setup({ probeResult: 'timeout' })
    await assert.rejects(service.pair('192.168.1.5:41234', '123456'), { code: 'NETWORK_BLOCKED' })
    await assert.rejects(service.connect('192.168.1.5:37000'), { code: 'NETWORK_BLOCKED' })
    assert.strictEqual(calls.run.length, 0)
    assert.deepStrictEqual(calls.probe[0], ['192.168.1.5', 41234])
  })

  test('probe refused → PORT_CLOSED', async () => {
    const { service, calls } = setup({ probeResult: 'refused' })
    await assert.rejects(service.pair('192.168.1.5:41234', '123456'), { code: 'PORT_CLOSED' })
    await assert.rejects(service.connect('192.168.1.5:37000'), { code: 'PORT_CLOSED' })
    assert.strictEqual(calls.run.length, 0)
  })

  test('pair thành công khi output có "Successfully paired"', async () => {
    const { service, calls } = setup({ output: 'Successfully paired to 192.168.1.5:41234 [guid=adb-x]\n' })
    const res = await service.pair('192.168.1.5:41234', '123456')
    assert.strictEqual(res.ok, true)
    assert.deepStrictEqual(calls.run[0].args, ['pair', '192.168.1.5:41234', '123456'])
    assert.strictEqual(calls.run[0].opts.timeout, 15000)
  })

  test('pair thất bại → ADB_FAILED kèm output thô', async () => {
    const { service } = setup({ output: 'error: protocol fault (couldn\'t read status message): No error\n' })
    await assert.rejects(service.pair('192.168.1.5:41234', '123456'),
      (err) => err.code === 'ADB_FAILED' && err.message.includes('protocol fault'))
  })

  test('connect: "connected to" thành công, "failed"/"cannot" thì lỗi', async () => {
    const ok = setup({ output: 'connected to 192.168.1.5:37000\n' })
    assert.strictEqual((await ok.service.connect('192.168.1.5:37000')).ok, true)
    const already = setup({ output: 'already connected to 192.168.1.5:37000\n' })
    assert.strictEqual((await already.service.connect('192.168.1.5:37000')).ok, true)
    const failed = setup({ output: 'failed to connect to 192.168.1.5:37000\n' })
    await assert.rejects(failed.service.connect('192.168.1.5:37000'), { code: 'ADB_FAILED' })
    const cannot = setup({ output: 'cannot connect to 192.168.1.5:37000: No connection could be made\n' })
    await assert.rejects(cannot.service.connect('192.168.1.5:37000'), { code: 'ADB_FAILED' })
  })

  test('adb quá thời gian → ADB_FAILED', async () => {
    const { service } = setup({ output: '', timedOut: true })
    await assert.rejects(service.connect('192.168.1.5:37000'), { code: 'ADB_FAILED' })
  })

  test('đầu vào sai bị chặn trước khi probe/chạy adb', async () => {
    const { service, calls } = setup()
    await assert.rejects(service.pair('999.1.1.1:5', '123456'), { code: 'VALIDATION' })
    await assert.rejects(service.pair('192.168.1.5:41234', '12345'), { code: 'VALIDATION' })
    await assert.rejects(service.connect('192.168.1.5'), { code: 'VALIDATION' })
    assert.strictEqual(calls.probe.length + calls.run.length, 0)
  })
})

// ── Tích hợp: server.js thật ────────────────────────────────────────────────
/**
 * Gọi HTTP thô để đặt được header Host tuỳ ý — fetch cấm đặt Host.
 * agent:false + Connection: close để socket không treo làm `node --test` không thoát.
 */
function rawRequest({ port, method = 'GET', urlPath = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, agent: false, headers: { Connection: 'close', ...headers } }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* không phải JSON (vd HTML) — test tự đọc text */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('server điều khiển (tích hợp)', () => {
  let server, origin
  const MISSING = path.join(os.tmpdir(), 'facecam-khong-ton-tai', 'scrcpy')
  const VALID_START = JSON.stringify({ options: BASE })

  before(async () => {
    // Cả scrcpy lẫn adb trỏ vào chỗ không tồn tại: không có đường nào chạm tới binary thật
    server = await startServer({ env: { FACECAM_SCRCPY: MISSING, FACECAM_ADB: MISSING } })
    origin = `http://127.0.0.1:${server.screenPort}`
    // startServer chờ server chính; server điều khiển listen gần như cùng lúc nhưng vẫn chờ cho chắc
    const deadline = Date.now() + 5000
    for (;;) {
      try { await rawRequest({ port: server.screenPort }); break } catch (err) {
        if (Date.now() > deadline) throw err
        await new Promise(r => setTimeout(r, 50))
      }
    }
  })
  after(async () => { await server.stop() })

  const post = (urlPath, { headers = {}, body = '{}' } = {}) =>
    rawRequest({ port: server.screenPort, method: 'POST', urlPath, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body })

  test('GET / trả screen.html kèm header an toàn', async () => {
    const res = await rawRequest({ port: server.screenPort })
    assert.strictEqual(res.status, 200)
    assert.match(res.text, /id="startBtn"/)
    assert.strictEqual(res.headers['cache-control'], 'no-store')
    assert.strictEqual(res.headers['x-frame-options'], 'DENY')
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff')
  })

  test('/i18n.js có; các file khác trong public/ thì 404', async () => {
    assert.strictEqual((await rawRequest({ port: server.screenPort, urlPath: '/i18n.js' })).status, 200)
    for (const p of ['/viewer.html', '/phone.html', '/index.html', '/shared.js', '/server.js', '/api/config']) {
      assert.strictEqual((await rawRequest({ port: server.screenPort, urlPath: p })).status, 404, p)
    }
  })

  test('Host sai → 403, kể cả với GET', async () => {
    for (const host of ['evil.example', `evil.example:${server.screenPort}`, '127.0.0.1', `127.0.0.1.evil.example:${server.screenPort}`]) {
      const res = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/status', headers: { Host: host } })
      assert.strictEqual(res.status, 403, host)
    }
    const page = await rawRequest({ port: server.screenPort, headers: { Host: 'evil.example' } })
    assert.strictEqual(page.status, 403)
  })

  test('Host localhost:<port> được chấp nhận', async () => {
    const res = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/status', headers: { Host: `localhost:${server.screenPort}` } })
    assert.strictEqual(res.status, 200)
  })

  test('POST thiếu Origin hoặc Origin lạ → 403', async () => {
    const noOrigin = await rawRequest({ port: server.screenPort, method: 'POST', urlPath: '/api/screen/stop',
      headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.strictEqual(noOrigin.status, 403)
    const evil = await post('/api/screen/stop', { headers: { Origin: 'http://evil.example' } })
    assert.strictEqual(evil.status, 403)
    const sameHostOtherPort = await post('/api/screen/stop', { headers: { Origin: 'http://127.0.0.1:1' } })
    assert.strictEqual(sameHostOtherPort.status, 403)
  })

  test('GET /api chéo site bị chặn (không cho trang lạ bắt PC spawn process)', async () => {
    const crossSite = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/devices',
      headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.strictEqual(crossSite.status, 403)
    const evilOrigin = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/apps?serial=x',
      headers: { Origin: 'http://evil.example' } })
    assert.strictEqual(evilOrigin.status, 403)
    // Từ chính trang điều khiển thì vẫn được
    const sameOrigin = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/status',
      headers: { 'Sec-Fetch-Site': 'same-origin' } })
    assert.strictEqual(sameOrigin.status, 200)
  })

  test('bấm thẻ từ trang chủ (điều hướng chéo site tới /) vẫn mở được trang', async () => {
    const res = await rawRequest({ port: server.screenPort, headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } })
    assert.strictEqual(res.status, 200)
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/)
  })

  test('Origin đúng nhưng không phải JSON → 415', async () => {
    const res = await post('/api/screen/stop', { headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    assert.strictEqual(res.status, 415)
    const form = await post('/api/screen/stop', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' })
    assert.strictEqual(form.status, 415)
  })

  test('Origin đúng + JSON qua được lớp bảo vệ → start trả 503 SCRCPY_NOT_FOUND', async () => {
    const res = await post('/api/screen/start', { body: VALID_START })
    assert.strictEqual(res.status, 503)
    assert.strictEqual(res.json.error, 'SCRCPY_NOT_FOUND')
  })

  test('JSON hỏng → 400 dạng JSON', async () => {
    const res = await post('/api/screen/start', { body: '{not json' })
    assert.strictEqual(res.status, 400)
    assert.ok(res.json?.error)
  })

  test('pair với dữ liệu sai → 400 VALIDATION (không đụng tới adb)', async () => {
    const res = await post('/api/screen/pair', { body: JSON.stringify({ hostPort: 'abc', code: '123456' }) })
    // Thiếu adb được kiểm sau validate, nên lỗi dữ liệu luôn được báo trước
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.json.error, 'VALIDATION')
  })

  test('GET /api/screen/status: scrcpy/adb không có, chưa có phiên', async () => {
    const res = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/status' })
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(res.json.available, { scrcpy: false, adb: false })
    assert.strictEqual(res.json.session.running, false)
  })

  test('GET /api/screen/devices khi thiếu adb → 503', async () => {
    const res = await rawRequest({ port: server.screenPort, urlPath: '/api/screen/devices' })
    assert.strictEqual(res.status, 503)
    assert.strictEqual(res.json.error, 'SCRCPY_NOT_FOUND')
  })

  test('/api/urls của server chính có screenPort', async () => {
    const data = await (await fetch(`${server.url}/api/urls`)).json()
    assert.strictEqual(data.screenPort, server.screenPort)
  })

  test('log khởi động có dòng [SCREEN] và server chính không dính tới scrcpy', () => {
    assert.match(server.logs(), /\[SCREEN\] http:\/\/127\.0\.0\.1:\d+/)
  })

  // Server chính listen 0.0.0.0 nhưng server điều khiển phải chỉ nghe loopback — nếu bind nhầm
  // 0.0.0.0 thì bất kỳ ai trong LAN cũng gọi được API spawn process trên PC này
  const lanIP = listLocalIPs()[0]?.address
  test('chỉ bind loopback: IP LAN không kết nối được', { skip: !lanIP && 'không có card mạng LAN' }, async () => {
    const outcome = await new Promise((resolve) => {
      const socket = net.connect({ host: lanIP, port: server.screenPort })
      const done = (r) => { socket.destroy(); resolve(r) }
      socket.setTimeout(3000)
      socket.once('connect', () => done('connected'))
      socket.once('error', () => done('failed'))
      socket.once('timeout', () => done('failed'))
    })
    assert.strictEqual(outcome, 'failed')
  })
})

describe('port điều khiển bị chiếm', () => {
  test('server chính vẫn khởi động và phục vụ bình thường', async () => {
    const blocker = net.createServer()
    await new Promise((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', resolve)
    })
    let server
    try {
      const busyPort = blocker.address().port
      server = await startServer({ env: { SCREEN_PORT: String(busyPort) } })
      assert.strictEqual(server.screenPort, busyPort)
      const res = await fetch(`${server.url}/api/config`)
      assert.strictEqual(res.status, 200)
      // Cảnh báo phải rõ ràng chứ không im lặng
      assert.match(server.logs(), /\[SCREEN\].*đang bị chiếm/)
      // Trang chủ không được trỏ thẻ "Màn hình điện thoại" vào port của process khác
      const urls = await (await fetch(`${server.url}/api/urls`)).json()
      assert.strictEqual(urls.screenPort, null)
    } finally {
      await server?.stop()
      await new Promise(resolve => blocker.close(resolve))
    }
  })
})
