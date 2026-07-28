/**
 * Mission: Hạ tầng dùng chung cho test — dựng server con trên port trống với thư
 *   mục dữ liệu tạm, và một client Socket.IO tối giản nói protocol v4 thẳng qua
 *   WebSocket. Không thêm dependency nào (socket.io-client, supertest…).
 * Author: DienJVo
 * Version: 1.0.0
 */
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')

/**
 * Xin OS một port đang trống.
 *
 * Không dùng PORT=0 được: server.js đọc `Number(process.env.PORT) || 7070`, mà
 * Number('0') là 0 — giá trị falsy — nên sẽ rơi về 7070 và đâm vào server thật
 * của người dùng nếu họ đang chạy.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Dựng một server FaceCam riêng cho test.
 *
 * Dữ liệu (config.json, .token, cert.pem) trỏ vào thư mục tạm qua
 * FACECAM_DATA_DIR — chạy test không được đụng tới file thật của người dùng.
 *
 * @returns {Promise<{port, httpsPort, url, token, dataDir, stop}>}
 */
async function startServer({ dataDir, env = {} } = {}) {
  const port = await freePort()
  const httpsPort = await freePort()
  // Dùng lại thư mục có sẵn khi test cần khởi động lại trên đúng dữ liệu cũ;
  // thư mục đó thuộc về người gọi nên stop() không được xoá.
  const reused = Boolean(dataDir)
  const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'facecam-test-'))

  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HTTPS_PORT: String(httpsPort), FACECAM_DATA_DIR: dir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logs = []
  proc.stdout.on('data', d => logs.push(String(d)))
  proc.stderr.on('data', d => logs.push(String(d)))

  const kill = async () => {
    proc.kill()
    // Chờ hẳn process chết rồi mới đụng vào thư mục, nếu không Windows báo EBUSY
    // vì server vẫn đang giữ file config
    if (proc.exitCode === null) await new Promise(r => proc.once('exit', r))
  }

  // Mọi lối thoát lỗi từ đây trở đi đều phải kill process con — sót một cái là
  // `node --test` không bao giờ thoát, và triệu chứng chỉ là "test treo".
  try {
    // Chờ tới khi server thật sự nhận request. Bám vào dòng log thì dễ vỡ khi đổi
    // chữ, còn sleep cố định thì lúc nhanh lúc chậm — poll là chắc nhất.
    const deadline = Date.now() + 15000
    for (;;) {
      if (proc.exitCode !== null) {
        throw new Error(`server chết khi khởi động (exit ${proc.exitCode}):\n${logs.join('')}`)
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/config`)
        if (res.ok) break
      } catch { /* chưa lên, thử lại */ }
      if (Date.now() > deadline) throw new Error(`server không lên sau 15s:\n${logs.join('')}`)
      await new Promise(r => setTimeout(r, 100))
    }

    const token = fs.readFileSync(path.join(dir, '.token'), 'utf8').trim()

    return {
      port, httpsPort, token, dataDir: dir,
      url: `http://127.0.0.1:${port}`,
      logs: () => logs.join(''),
      async stop() {
        await kill()
        if (!reused) fs.rmSync(dir, { recursive: true, force: true })
      },
    }
  } catch (err) {
    await kill()
    if (!reused) fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

/**
 * Client Socket.IO tối giản, nói protocol Engine.IO v4 thẳng qua WebSocket.
 *
 * Viết tay thay vì cài socket.io-client vì chỉ cần join/emit/nghe event — thêm
 * một dependency chỉ để dùng chỗ này thì không đáng.
 *
 * Khung protocol: '0{...}' = engine mở, '40' = vào namespace, '42[...]' = event,
 * '2' = ping (phải đáp '3', không thì server ngắt sau timeout).
 */
function connect(baseURL, { cookie, auth } = {}) {
  const wsURL = baseURL.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket'
  const ws = new WebSocket(wsURL, { headers: cookie ? { Cookie: cookie } : {} })
  const events = []
  let id = null

  const ready = new Promise((resolve, reject) => {
    // Bị guardSocket từ chối thì server đóng kết nối — phải bắt cả hai đường,
    // nếu không test auth sẽ treo tới hết timeout thay vì đỏ ngay
    ws.onerror = () => reject(new Error('rejected'))
    ws.onclose = () => reject(new Error('rejected'))
    ws.onmessage = (e) => {
      const data = String(e.data)
      if (data === '2') return ws.send('3')
      if (data.startsWith('0{')) {
        return ws.send(auth ? '40' + JSON.stringify({ token: auth }) : '40')
      }
      if (data.startsWith('40')) {
        // '40{"sid":"..."}' — sid ở đây chính là socket.id mà server dùng để
        // định tuyến đích danh, nên test cần nó để kiểm OFFER/ANSWER đi đúng chỗ
        if (data.length > 2) id = JSON.parse(data.slice(2)).sid
        return resolve()
      }
      if (data.startsWith('44')) return reject(new Error('rejected'))   // lỗi khi vào namespace
      if (data.startsWith('42')) events.push(JSON.parse(data.slice(2)))
    }
  })

  return {
    ws, events, ready,
    get id() { return id },
    emit(event, arg) { ws.send('42' + JSON.stringify(arg === undefined ? [event] : [event, arg])) },
    close() { ws.close() },
    /** Đã nhận event này chưa */
    got(name) { return this.events.some(([e]) => e === name) },
    /** Payload của lần nhận event này gần nhất */
    payload(name) { return this.events.filter(([e]) => e === name).pop()?.[1] },
    /** Số lần nhận được event này — cần để phân biệt "có nhận" với "nhận đúng một lần" */
    count(name) { return this.events.filter(([e]) => e === name).length },
    reset() { this.events.length = 0 },
  }
}

/**
 * Chờ cho signaling kịp đi hết một vòng qua server.
 *
 * Chỉ dùng khi cần khẳng định điều gì đó KHÔNG xảy ra — lúc đó buộc phải đợi đủ
 * lâu rồi mới kết luận. Chờ một event có tới thì dùng waitFor, đừng dùng cái này.
 */
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

/**
 * Đợi tới khi client nhận đủ số event mong muốn, tối đa `timeout`.
 *
 * Thay cho sleep cố định: `node --test` chạy các file song song, mỗi file lại
 * dựng một server riêng, nên lúc máy bận thì 300ms không đủ và test đỏ ngẫu
 * nhiên. Poll thì vừa nhanh hơn lúc rảnh, vừa chịu được lúc bận.
 *
 * @returns {Promise<boolean>} true nếu đủ số lượng trước hạn
 */
async function waitFor(client, event, { count = 1, timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (client.count(event) >= count) return true
    if (Date.now() > deadline) return false
    await new Promise(r => setTimeout(r, 25))
  }
}

module.exports = { startServer, connect, settle, waitFor, freePort, ROOT }
