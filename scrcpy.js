/**
 * Mission: Tầng tiến trình cho tính năng chiếu màn hình điện thoại — tìm scrcpy/adb,
 *   validate mọi đầu vào trước khi đưa vào dòng lệnh, parse output của adb/scrcpy,
 *   và quản lý đúng một phiên scrcpy đang chạy. Mọi thứ chạm tới process (run, spawnFn,
 *   probe) đều tiêm được từ ngoài để test không bao giờ chạy adb/scrcpy thật.
 * Author: DienJVo
 * Version: 1.1.0
 */
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { StringDecoder } = require('string_decoder')

// Tiêu đề cửa sổ cố định: người dùng nhìn taskbar là biết cửa sổ nào của FaceCam
const WINDOW_TITLE = 'FaceCam Screen'
const LOG_LIMIT = 200
// Giới hạn kích thước: log và output đến từ thiết bị, không tin được độ dài
const LINE_LIMIT = 2000
const PENDING_LIMIT = 64 * 1024
const OUTPUT_LIMIT = 2000

// ── Lỗi ─────────────────────────────────────────────────────────────────────
// `code` là hợp đồng với screen-control.js (map ra HTTP status) và với giao diện
// (map ra thông báo đã dịch) — message chỉ để người đọc log.
class ServiceError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    Object.assign(this, extra)
  }
}

class ValidationError extends ServiceError {
  constructor(field, message) {
    super('VALIDATION', message, { field })
    this.name = 'ValidationError'
  }
}

// ── Tìm file thực thi ───────────────────────────────────────────────────────
function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    // Không tồn tại / không đọc được đều có nghĩa "không dùng được" — không cần phân biệt
    return false
  }
}

function findOnPath(file, env) {
  // Windows có thể đặt tên biến là Path khi env được copy ra object thường
  const pathVar = env.PATH ?? env.Path ?? ''
  for (const raw of pathVar.split(path.delimiter)) {
    // PATH đôi khi có dấu nháy bao quanh thư mục có dấu cách
    const dir = raw.trim().replace(/^"|"$/g, '')
    // Bỏ thư mục tương đối (vd ".") — spawn đường dẫn tương đối trên Windows sẽ tìm
    // ở thư mục hiện tại trước, thành chỗ cài file giả mạo
    if (!dir || !path.isAbsolute(dir)) continue
    const candidate = path.join(dir, file)
    if (isFile(candidate)) return candidate
  }
  return null
}

/**
 * Tìm scrcpy và adb. Gọi lười (khi cần), không gọi lúc khởi động server — người dùng
 * không dùng tính năng này thì không đáng phải quét PATH.
 *
 * Biến môi trường được chỉ định tường minh mà trỏ sai thì trả về null luôn, KHÔNG rơi
 * về PATH: im lặng chạy bản khác với bản người dùng đã chọn còn khó gỡ lỗi hơn.
 *
 * @returns {{ scrcpy: string|null, adb: string|null }}
 */
function resolveBinaries(env = process.env) {
  const ext = process.platform === 'win32' ? '.exe' : ''

  let scrcpy
  if (env.FACECAM_SCRCPY) scrcpy = isFile(env.FACECAM_SCRCPY) ? path.resolve(env.FACECAM_SCRCPY) : null
  else scrcpy = findOnPath(`scrcpy${ext}`, env)

  let adb
  if (env.FACECAM_ADB) {
    adb = isFile(env.FACECAM_ADB) ? path.resolve(env.FACECAM_ADB) : null
  } else {
    // Bản scrcpy đóng gói kèm adb cùng thư mục → ưu tiên để hai công cụ khớp phiên bản
    const sibling = scrcpy ? path.join(path.dirname(scrcpy), `adb${ext}`) : null
    adb = sibling && isFile(sibling) ? sibling : findOnPath(`adb${ext}`, env)
  }
  return { scrcpy, adb }
}

// ── Validate ────────────────────────────────────────────────────────────────
// Mọi giá trị dưới đây đi vào mảng args của child process (không qua shell) nên không
// có chuyện injection lệnh, nhưng vẫn khoá chặt ký tự: khoảng trắng hay ký tự lạ là dữ
// liệu hỏng. Giá trị luôn được gắn liền vào cờ (`--serial=...`) nên kể cả bắt đầu bằng
// dấu gạch cũng không thể bị hiểu thành một cờ riêng.
const SERIAL_RE = /^[\w.:-]{1,128}$/
const PAIR_CODE_RE = /^\d{6}$/
const PACKAGE_RE = /^[A-Za-z]\w*(\.[A-Za-z_]\w*)+$/
const HOST_PORT_RE = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2}):([1-9]\d{0,4})$/

function isValidSerial(v) { return typeof v === 'string' && SERIAL_RE.test(v) }
function isValidPairCode(v) { return typeof v === 'string' && PAIR_CODE_RE.test(v) }
function isValidPackage(v) { return typeof v === 'string' && v.length <= 255 && PACKAGE_RE.test(v) }

/** @returns {{ host: string, port: number }|null} */
function parseHostPort(v) {
  if (typeof v !== 'string') return null
  const m = HOST_PORT_RE.exec(v)
  if (!m) return null
  const octets = m.slice(1, 5).map(Number)
  const port = Number(m[5])
  if (octets.some(o => o > 255) || port > 65535) return null
  return { host: octets.join('.'), port }
}
function isValidHostPort(v) { return parseHostPort(v) !== null }

// ── Parse output ────────────────────────────────────────────────────────────
/**
 * Parse `adb devices -l`. Dòng tiêu đề, dòng "* daemon..." và dòng trống bị bỏ qua.
 * @returns {{ serial: string, state: string, model: string|null, transport: 'usb'|'wifi' }[]}
 */
function parseDevices(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const header = lines.findIndex(l => l.startsWith('List of devices'))
  const devices = []
  for (const line of lines.slice(header + 1)) {
    if (!line.trim() || line.startsWith('*')) continue
    const parts = line.trim().split(/\s+/)
    const serial = parts[0]
    // "no permissions (...)" có dấu cách trong trạng thái nên không thể chỉ lấy token thứ hai
    const rest = line.trim().slice(serial.length).trim()
    const state = rest.startsWith('no permissions') ? 'no permissions' : (rest.split(/\s+/)[0] || 'unknown')
    const model = /\bmodel:(\S+)/.exec(rest)?.[1] ?? null
    const wifi = serial.includes(':') || serial.includes('._adb-tls-connect')
    devices.push({ serial, state, model, transport: wifi ? 'wifi' : 'usb' })
  }
  return devices
}

/**
 * Parse `scrcpy --list-apps`. Output trộn log và danh sách nên không dựa vào vị trí
 * dòng tiêu đề (stdout/stderr ghép lại có thể sai thứ tự) mà dựa vào hình dạng dòng:
 * `*`/`-`, tên (có thể có dấu cách và tiếng Việt), package ở token cuối.
 * @returns {{ name: string, pkg: string, system: boolean }[]}
 */
function parseApps(text) {
  const apps = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    // Tách bằng split thay vì một regex `(.+?)\s+(pkg)`: regex đó backtrack bậc hai trên
    // chuỗi khoảng trắng dài, mà nhãn app do thiết bị cung cấp — một nhãn cố tình dài
    // sẽ treo cả event loop (kéo theo signaling camera). Dòng quá dài thì bỏ hẳn.
    const trimmed = line.trim()
    if (trimmed.length > 1000) continue
    const marker = trimmed[0]
    if ((marker !== '*' && marker !== '-') || !/\s/.test(trimmed[1] ?? '')) continue
    const body = trimmed.slice(1).trim()
    const tokens = body.split(/\s+/)
    if (tokens.length < 2) continue
    const pkg = tokens[tokens.length - 1]
    if (!PACKAGE_RE.test(pkg)) continue
    apps.push({ name: body.slice(0, body.length - pkg.length).trim(), pkg, system: marker === '*' })
  }
  // App người dùng cài lên đầu — đó là thứ người ta muốn chiếu; app hệ thống thì hàng trăm
  return apps.sort((a, b) => (a.system - b.system) || a.name.localeCompare(b.name))
}

// ── Dựng dòng lệnh ──────────────────────────────────────────────────────────
const SOURCES = new Set(['display', 'app', 'camera'])
const AUDIOS = new Set(['off', 'pc', 'both'])
const ROTATIONS = new Set([0, 90, 180, 270])
const QUALITIES = {
  smooth: ['--max-size=1280', '--video-bit-rate=4M'],
  balanced: ['--max-size=1920', '--video-bit-rate=8M'],
  sharp: ['--video-bit-rate=16M'],
}

function fail(field, message) {
  throw new ValidationError(field, message)
}

/**
 * Hàm thuần: options từ giao diện → mảng args cho scrcpy. Giá trị lạ bị từ chối chứ
 * không đoán — đoán sai ở đây nghĩa là chạy scrcpy với cờ người dùng không hề chọn.
 */
function buildArgs(opts) {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) fail('options', 'options must be an object')
  const { serial, source, pkg, audio, control, quality, fullscreen, alwaysOnTop, rotation = 0 } = opts

  if (!isValidSerial(serial)) fail('serial', 'invalid device serial')
  if (!SOURCES.has(source)) fail('source', 'unknown source')
  if (!AUDIOS.has(audio)) fail('audio', 'unknown audio mode')
  if (!Object.hasOwn(QUALITIES, quality)) fail('quality', 'unknown quality')
  for (const [key, val] of Object.entries({ control, fullscreen, alwaysOnTop })) {
    if (typeof val !== 'boolean') fail(key, `${key} must be a boolean`)
  }
  // Camera không có luồng playback để nhân đôi
  if (source === 'camera' && audio === 'both') fail('audio', 'audio "both" is not available for camera source')
  // scrcpy mở app qua kênh điều khiển, và app trên màn hình ảo không hiện trên điện
  // thoại nên chỉ thao tác được từ PC — tắt điều khiển thì scrcpy báo lỗi và thoát
  if (source === 'app' && !control) fail('control', 'app source requires control to be enabled')
  if (!ROTATIONS.has(rotation)) fail('rotation', 'rotation must be 0, 90, 180 or 270')

  const args = [`--serial=${serial}`, `--window-title=${WINDOW_TITLE}`]

  if (source === 'app') {
    if (!isValidPackage(pkg)) fail('pkg', 'invalid or missing package name')
    args.push('--new-display', `--start-app=${pkg}`)
  } else if (source === 'camera') {
    args.push('--video-source=camera')
    // Ảnh camera là khung gốc của cảm biến (nằm ngang), scrcpy không xoay theo cách
    // cầm máy — người dùng tự chọn góc. Màn hình/app thì scrcpy tự xoay nên bỏ qua.
    if (rotation) args.push(`--orientation=${rotation}`)
  }

  if (audio === 'off') args.push('--no-audio')
  // --audio-dup chỉ hợp lệ cùng --audio-source=playback
  else if (audio === 'both') args.push('--audio-source=playback', '--audio-dup')

  if (!control) args.push('--no-control')
  args.push(...QUALITIES[quality])
  if (fullscreen) args.push('--fullscreen')
  if (alwaysOnTop) args.push('--always-on-top')
  return args
}

// ── Thực thi mặc định ───────────────────────────────────────────────────────
/**
 * Chạy một lệnh ngắn rồi trả output. KHÔNG bao giờ reject: lỗi chạy (ENOENT, timeout,
 * exit khác 0) được báo qua `code`/`timedOut` để chỗ gọi tự quyết đó là lỗi hay không.
 * Luôn là execFile với mảng args, không qua shell.
 */
function defaultRun(file, args, { timeout, env } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          let output = `${stdout ?? ''}${stderr ?? ''}`
          // Không chạy được (ENOENT...) thì stdout/stderr rỗng — giữ lại message để còn biết vì sao
          if (err && !output) output = err.message
          resolve({ output, code: err ? (err.code ?? 1) : 0, timedOut: Boolean(err?.killed) })
        })
    } catch (err) {
      // execFile ném đồng bộ khi file không chạy được theo cách này (vd .bat/.cmd mà không
      // có shell — Node chặn từ bản vá CVE-2024-27980). Giữ đúng hợp đồng "không reject".
      console.warn('[SCREEN] Không chạy được', file, '-', err.message)
      resolve({ output: '', code: 'SPAWN', timedOut: false })
    }
  })
}

/**
 * Thử mở kết nối TCP tới host:port. adb pair/connect khi mạng chặn chỉ in
 * "protocol fault ... No error", nguyên nhân thật (timeout 10060) chỉ nằm trong log của
 * adb — nên tự thăm dò trước để báo được lý do cụ thể.
 * @returns {Promise<'open'|'timeout'|'refused'|'error'>}
 */
function probeTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done('open'))
    socket.once('timeout', () => done('timeout'))
    socket.once('error', (err) => {
      // Không tới được máy đích (rớt gói, không có route) cùng nghĩa với timeout: mạng chặn
      if (err.code === 'ECONNREFUSED') return done('refused')
      if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.code)) return done('timeout')
      done('error')
    })
  })
}

// ── Service ─────────────────────────────────────────────────────────────────
const HINT_RULES = [
  // Xiaomi: bật điều khiển mà thiếu quyền → lặp lại mỗi lần di chuột
  ['injectEvents', /INJECT_EVENTS/],
  ['unauthorized', /unauthorized/i],
  ['deviceGone', /could not find any adb device|no devices\/emulators found|device '[^']*' not found|device not found|device offline|device disconnected/i],
]

// Output trả về giao diện chỉ cần đủ để đọc lỗi — output đầy đủ có thể tới 16MB
function clip(text) {
  const s = String(text ?? '').trim()
  return s.length > OUTPUT_LIMIT ? `${s.slice(0, OUTPUT_LIMIT)}…` : s
}

function createScreenService({ resolve = resolveBinaries, run = defaultRun, spawnFn = spawn, probe = probeTcp } = {}) {
  let session = null
  // Request trùng đang chạy thì dùng chung kết quả: trang poll 3s/lần, còn --list-apps
  // mất cả chục giây — không gộp thì process chồng chất
  let devicesInFlight = null
  let appsInFlight = null   // { serial, promise }

  function requireBinary(which) {
    const bins = resolve()
    if (!bins[which]) {
      throw new ServiceError('SCRCPY_NOT_FOUND', `${which} not found (install scrcpy, or set FACECAM_SCRCPY / FACECAM_ADB)`)
    }
    return bins
  }

  function childEnv(bins) {
    // Bắt scrcpy dùng đúng adb đã resolve, tránh hai bản adb khác phiên bản đá nhau
    // (adb server bị kill/restart liên tục làm mất kết nối thiết bị)
    const env = { ...process.env }
    if (bins.adb) env.ADB = bins.adb
    return env
  }

  // Dùng chung cho pair/connect: thăm dò TCP trước (xem probeTcp) rồi mới gọi adb
  async function wireless(hostPort, verb, extraArgs, isSuccess) {
    const target = parseHostPort(hostPort)
    const { adb } = requireBinary('adb')
    const probed = await probe(target.host, target.port, 3000)
    if (probed === 'timeout') throw new ServiceError('NETWORK_BLOCKED', `${hostPort} did not answer (timeout)`)
    if (probed === 'refused') throw new ServiceError('PORT_CLOSED', `${hostPort} refused the connection`)
    // 'error' (lỗi lạ) → cứ để adb thử, output của adb sẽ nói rõ hơn
    const res = await run(adb, [verb, hostPort, ...extraArgs], { timeout: 15000 })
    const output = clip(res.output)
    if (!res.timedOut && isSuccess(output)) return { ok: true, output }
    throw new ServiceError('ADB_FAILED', res.timedOut ? `adb ${verb} timed out` : (output || `adb ${verb} failed`), { output })
  }

  // ── Phiên scrcpy ──
  function addLine(s, raw) {
    let text = raw.replace(/\r$/, '')
    if (!text.trim()) return
    if (text.length > LINE_LIMIT) text = `${text.slice(0, LINE_LIMIT)}…`
    for (const [hint, re] of HINT_RULES) if (re.test(text)) s.hints.add(hint)
    // Gộp dòng giống hệt liền kề: lỗi INJECT_EVENTS lặp theo từng sự kiện chuột sẽ
    // đẩy hết log hữu ích ra khỏi bộ đệm 200 dòng nếu không gộp
    const last = s.log[s.log.length - 1]
    if (last && last.text === text) {
      last.count++
      return
    }
    s.log.push({ text, count: 1 })
    if (s.log.length > LOG_LIMIT) s.log.shift()
  }

  // Cắt chunk thành dòng; StringDecoder để ký tự UTF-8 bị cắt đôi giữa hai chunk không hỏng
  function pipeLines(s, stream) {
    if (!stream) return () => {}
    const decoder = new StringDecoder('utf8')
    let rest = ''
    stream.on('data', (chunk) => {
      rest += decoder.write(chunk)
      const parts = rest.split('\n')
      rest = parts.pop()
      for (const line of parts) addLine(s, line)
      // Một "dòng" không bao giờ xuống dòng sẽ phình bộ nhớ vô hạn → xả ra sớm
      if (rest.length > PENDING_LIMIT) {
        addLine(s, rest)
        rest = ''
      }
    })
    // Lỗi đọc pipe không được làm sập server; log đã thu được tới đó vẫn giữ nguyên
    stream.on('error', (err) => addLine(s, `[stream] ${err.message}`))
    return () => {
      rest += decoder.end()
      if (rest) addLine(s, rest)
      rest = ''
    }
  }

  function finish(s) {
    if (!s.running) return
    s.running = false
    s.resolveDone()
  }

  function status() {
    if (!session) return { running: false, serial: null, startedAt: null, exitCode: null, hints: [], log: [] }
    return {
      running: session.running,
      serial: session.serial,
      startedAt: session.startedAt,
      exitCode: session.exitCode,
      hints: [...session.hints],
      log: session.log.map(e => ({ ...e })),
    }
  }

  return {
    available: () => resolve(),

    async listDevices() {
      if (devicesInFlight) return devicesInFlight
      const { adb } = requireBinary('adb')
      devicesInFlight = (async () => {
        const res = await run(adb, ['devices', '-l'], { timeout: 5000 })
        if (res.timedOut) throw new ServiceError('ADB_FAILED', 'adb devices timed out')
        if (res.code) throw new ServiceError('ADB_FAILED', clip(res.output) || 'adb devices failed')
        return parseDevices(res.output)
      })().finally(() => { devicesInFlight = null })
      return devicesInFlight
    },

    async listApps(serial) {
      if (!isValidSerial(serial)) fail('serial', 'invalid device serial')
      // Mỗi lúc chỉ một --list-apps: cùng thiết bị thì dùng chung, khác thiết bị thì báo bận
      if (appsInFlight) {
        if (appsInFlight.serial === serial) return appsInFlight.promise
        throw new ServiceError('BUSY', 'already listing apps of another device')
      }
      const bins = requireBinary('scrcpy')
      const promise = (async () => {
        const res = await run(bins.scrcpy, [`--serial=${serial}`, '--list-apps'], { timeout: 60000, env: childEnv(bins) })
        const apps = parseApps(res.output)
        if (!apps.length && (res.timedOut || res.code)) {
          throw new ServiceError('ADB_FAILED', res.timedOut ? 'scrcpy --list-apps timed out' : clip(res.output), { output: clip(res.output) })
        }
        return apps
      })().finally(() => { appsInFlight = null })
      appsInFlight = { serial, promise }
      return promise
    },

    async pair(hostPort, code) {
      if (!isValidHostPort(hostPort)) fail('hostPort', 'host:port must be an IPv4 address and a port, e.g. 192.168.1.5:41234')
      if (!isValidPairCode(code)) fail('code', 'pairing code must be 6 digits')
      return wireless(hostPort, 'pair', [code], out => /Successfully paired/i.test(out))
    },

    async connect(hostPort) {
      if (!isValidHostPort(hostPort)) fail('hostPort', 'host:port must be an IPv4 address and a port, e.g. 192.168.1.5:41234')
      return wireless(hostPort, 'connect', [], out => /connected to/i.test(out) && !/cannot|failed/i.test(out))
    },

    // Kiểm BUSY và binary trước khi validate: không có await nào giữa kiểm và gán
    // `session` nên hai request start đồng thời không thể cùng lọt qua
    async start(opts) {
      if (session?.running) throw new ServiceError('BUSY', 'a screen session is already running')
      const bins = requireBinary('scrcpy')
      const args = buildArgs(opts)

      let child
      try {
        child = spawnFn(bins.scrcpy, args, {
          shell: false, windowsHide: true, env: childEnv(bins), stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (err) {
        // spawn ném đồng bộ khi tham số không hợp lệ (khác với ENOENT, báo qua event 'error')
        throw new ServiceError('SPAWN_FAILED', `could not start scrcpy: ${err.message}`)
      }

      const s = {
        child, serial: opts.serial, startedAt: Date.now(), running: true, exitCode: null,
        hints: new Set(), log: [], resolveDone: null, done: null,
      }
      s.done = new Promise(r => { s.resolveDone = r })
      session = s

      const flushers = [pipeLines(s, child.stdout), pipeLines(s, child.stderr)]
      const flush = () => flushers.forEach(f => f())

      // 'error' = không spawn được (ENOENT/EACCES) hoặc kill thất bại. Ghi vào log để
      // giao diện hiện lý do, và KHÔNG ném tiếp — event không có listener sẽ làm sập server.
      child.once('error', (err) => {
        addLine(s, `[spawn] ${err.message}`)
        flush()
        finish(s)
      })
      child.once('exit', (code) => {
        s.exitCode = code ?? null
        finish(s)
      })
      // 'close' mới là lúc pipe đã đọc hết — flush ở đây để không mất dòng cuối
      child.once('close', flush)

      return status()
    },

    async stop() {
      const s = session
      if (!s?.running) return status()
      try {
        s.child.kill()
      } catch (err) {
        // kill thất bại (process đã chết giữa chừng) → ghi lại, vẫn chờ đủ thời gian rồi báo trạng thái thật
        addLine(s, `[kill] ${err.message}`)
      }
      let timer
      // Chờ tối đa 3s để trạng thái trả về phản ánh đúng việc đã dừng
      await Promise.race([s.done, new Promise(r => { timer = setTimeout(r, 3000) })])
      clearTimeout(timer)
      return status()
    },

    // Dùng lúc tắt server: đồng bộ, không chờ — process sắp thoát rồi
    stopAll() {
      if (!session?.running) return
      try {
        session.child.kill()
      } catch (err) {
        console.warn('[SCREEN] Không dừng được scrcpy khi tắt server:', err.message)
      }
    },

    status,
  }
}

module.exports = {
  ServiceError, ValidationError,
  resolveBinaries,
  isValidSerial, isValidHostPort, isValidPairCode, isValidPackage, parseHostPort,
  parseDevices, parseApps, buildArgs,
  createScreenService,
}
