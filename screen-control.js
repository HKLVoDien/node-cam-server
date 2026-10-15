/**
 * Mission: Server HTTP riêng (chỉ 127.0.0.1) cho giao diện điều khiển scrcpy. Tách khỏi
 *   server chính vì server chính listen 0.0.0.0 cho điện thoại/LAN, còn việc spawn
 *   process trên PC thì tuyệt đối không được với tới từ mạng.
 * Author: DienJVo
 * Version: 1.0.1
 */
const http = require('http')
const express = require('express')
const { ServiceError, ValidationError } = require('./scrcpy.js')

// Lỗi service → HTTP status. Mã lạ rơi về 500.
const STATUS_BY_CODE = {
  SCRCPY_NOT_FOUND: 503,
  BUSY: 409,
  NETWORK_BLOCKED: 502,
  PORT_CLOSED: 502,
  ADB_FAILED: 502,
}

function sendError(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field })
  }
  if (err instanceof ServiceError) {
    return res.status(STATUS_BY_CODE[err.code] ?? 500).json({ error: err.code, message: err.message })
  }
  // Lỗi không lường trước: log đủ stack ở server; client chỉ nhận thông báo chung vì
  // message gốc có thể chứa đường dẫn tuyệt đối trên máy
  console.error('[SCREEN] Lỗi không mong đợi:', err)
  res.status(500).json({ error: 'INTERNAL', message: 'Internal error' })
}

/**
 * Dựng và mở server điều khiển scrcpy.
 *
 * Lỗi listen (port bận...) được phát ra qua `server.on('error')` — hàm này không tự
 * process.exit, vì đây là tính năng phụ: camera vẫn phải chạy dù port này bận.
 *
 * @param {{ port: number, service: object, publicDir: string }} options
 * @returns {{ server: import('http').Server, close: () => Promise<void> }}
 */
function startScreenControl({ port, service, publicDir }) {
  const app = express()
  const server = http.createServer(app)

  // Đọc port thực tế (port=0 khi test) thay vì tin tham số
  const actualPort = () => server.address()?.port ?? port
  const allowedHosts = () => [`127.0.0.1:${actualPort()}`, `localhost:${actualPort()}`]

  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.set({
      // Trạng thái thiết bị/phiên đổi liên tục, và danh sách app là dữ liệu riêng tư
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      // Lớp phòng thủ thêm: trang chỉ dùng script/style inline và /i18n.js cùng origin
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    })
    next()
  })

  // Chống DNS rebinding: trang của kẻ tấn công trỏ tên miền của họ về 127.0.0.1 sẽ vẫn
  // gửi Host là tên miền đó. Áp cho cả GET, nếu không nó đọc được danh sách thiết bị/app.
  app.use((req, res, next) => {
    if (!allowedHosts().includes(req.headers.host)) {
      return res.status(403).json({ error: 'FORBIDDEN_HOST', message: 'Host header not allowed' })
    }
    next()
  })

  // Chống CSRF: trình duyệt luôn gửi Origin cho POST, nên thiếu Origin hoặc Origin lạ
  // là request không đến từ trang của chính mình. Bắt buộc JSON để loại luôn các
  // "simple request" (form, text/plain) mà trình duyệt gửi chéo site không cần preflight.
  app.use((req, res, next) => {
    const allowedOrigins = allowedHosts().map(h => `http://${h}`)

    // GET /api/* cũng spawn adb/scrcpy (danh sách thiết bị, app). Trang lạ không đọc
    // được kết quả (không có CORS) nhưng vẫn bắt PC chạy process được bằng <img src>
    // hay fetch no-cors — nên chặn mọi request chéo site vào API, kể cả GET. Trang "/"
    // thì không chặn: bấm thẻ từ trang chủ (localhost:7070 → 127.0.0.1:7071) chính là
    // một lần điều hướng chéo site hợp lệ, và tải trang không chạy process nào.
    if (req.path.startsWith('/api/')) {
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin' && site !== 'none') {
        return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'Cross-site request not allowed' })
      }
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
        return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed' })
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') return next()
    if (!allowedOrigins.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed' })
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' })
    }
    next()
  })

  // Chỉ phục vụ đúng các file cần thiết, KHÔNG express.static cả public/ — viewer.html
  // và phone.html thuộc server chính, có lớp xác thực riêng.
  const sendPublic = (file) => (req, res) => res.sendFile(file, { root: publicDir })
  app.get('/', sendPublic('screen.html'))
  app.get('/i18n.js', sendPublic('i18n.js'))

  // Giới hạn nhỏ: body hợp lệ chỉ vài trăm byte
  app.use(express.json({ limit: '8kb' }))

  const route = (handler) => async (req, res) => {
    try {
      res.json(await handler(req))
    } catch (err) {
      sendError(res, err)
    }
  }
  const body = (req) => req.body ?? {}

  app.get('/api/screen/status', route(async () => {
    const bins = service.available()
    // Chỉ báo có/không — đường dẫn tuyệt đối trên máy người dùng không cần lộ ra trình duyệt
    return { available: { scrcpy: Boolean(bins.scrcpy), adb: Boolean(bins.adb) }, session: service.status() }
  }))
  app.get('/api/screen/devices', route(async () => ({ devices: await service.listDevices() })))
  app.get('/api/screen/apps', route(async (req) => ({ apps: await service.listApps(String(req.query.serial ?? '')) })))
  app.post('/api/screen/pair', route(async (req) => service.pair(body(req).hostPort, body(req).code)))
  app.post('/api/screen/connect', route(async (req) => service.connect(body(req).hostPort)))
  app.post('/api/screen/start', route(async (req) => ({ session: await service.start(body(req).options) })))
  app.post('/api/screen/stop', route(async () => ({ session: await service.stop() })))

  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' })
  })

  // Lỗi từ middleware (JSON hỏng, body quá lớn): trả JSON thay vì trang HTML mặc định
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const status = err.status >= 400 && err.status < 500 ? err.status : 500
    res.status(status).json({ error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', message: err.message })
  })

  server.listen(port, '127.0.0.1')

  return {
    server,
    close() {
      return new Promise((resolve) => {
        // Callback nhận lỗi nếu server chưa từng listen được — lúc tắt máy không có gì
        // để làm với lỗi đó nên vẫn resolve
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
  }
}

module.exports = { startScreenControl }
