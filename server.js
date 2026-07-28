const http = require('http')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const express = require('express')
const { Server } = require('socket.io')
const os = require('os')
const QRCode = require('qrcode')
// Dùng chung với client để tên event chỉ có một nguồn duy nhất
const { ROLE, EV } = require('./public/shared.js')

const app = express()

const HTTP_PORT = Number(process.env.PORT) || 7070
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 7443

// Card ảo (Docker, WSL, VirtualBox, VMware, Hyper-V, VPN) cũng là IPv4 non-internal,
// nên kiểu "lấy cái đầu tiên" hay trả về IP mà phone không hề kết nối tới được —
// QR WiFi in ra sẽ vô dụng mà nhìn thì không biết vì sao.
const VIRTUAL_IFACE = /virtual|vmware|virtualbox|vethernet|hyper-?v|docker|tailscale|zerotier|tap-|tun\d|loopback/i

function rankInterface(name) {
  if (/wi-?fi|wlan|wireless/i.test(name)) return 2
  if (/ethernet|^eth\d|^en\d/i.test(name)) return 1
  return 0
}

// Trả về mọi IPv4 LAN, card thật xếp trước card ảo, Wi-Fi/Ethernet lên đầu
function listLocalIPs() {
  const found = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const iface of addrs || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      if (iface.address.startsWith('169.254.')) continue   // APIPA — chưa lấy được DHCP
      found.push({ name, address: iface.address, virtual: VIRTUAL_IFACE.test(name) })
    }
  }
  return found.sort((a, b) => (a.virtual - b.virtual) || (rankInterface(b.name) - rankInterface(a.name)))
}

function getLocalIP() {
  return listLocalIPs()[0]?.address ?? 'localhost'
}

// ── Xác thực ────────────────────────────────────────────────────────────────
// Cả hai server listen trên 0.0.0.0 nên không có lớp này thì bất kỳ ai cùng LAN
// mở /viewer.html là xem được camera. Video đi P2P không qua server, nhưng không
// trao đổi được SDP/ICE thì không dựng được kết nối → gác signaling là đủ.
//
// Token lưu ra file để giữ nguyên qua các lần restart — nếu sinh mới mỗi lần chạy
// thì URL trong OBS Browser Source sẽ hỏng sau mỗi lần khởi động lại server.
const TOKEN_PATH = path.join(__dirname, '.token')
let TOKEN
try {
  TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
  if (!/^[a-f0-9]{32}$/.test(TOKEN)) throw Object.assign(new Error('token sai định dạng'), { code: 'EBADTOKEN' })
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[AUTH] .token không dùng được, sinh token mới:', err.message)
  TOKEN = crypto.randomBytes(16).toString('hex')
  fs.writeFileSync(TOKEN_PATH, TOKEN)
}

// USB mode (adb reverse) cũng đi qua localhost nên được miễn token luôn — cắm được
// dây vào máy thì đã có quyền vật lý rồi.
function isLocalAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

app.use((req, res, next) => {
  if (isLocalAddress(req.socket.remoteAddress)) return next()

  // Vào lần đầu bằng link kèm ?t= (từ QR) → set cookie để các request sau
  // (/socket.io/*, /api/config, ảnh...) không cần mang token trên URL nữa
  if (req.query.t === TOKEN) {
    res.setHeader('Set-Cookie', `fc_token=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax`)
    return next()
  }
  if (readCookie(req.headers.cookie, 'fc_token') === TOKEN) return next()

  console.warn(`[AUTH] Từ chối ${req.socket.remoteAddress} → ${req.method} ${req.path}`)
  res.status(401).send('Unauthorized — mở lại bằng link QR trên terminal.')
})

// Chặn HTTP mà không chặn socket thì vô nghĩa: client có thể nối thẳng vào
// signaling. Cookie được browser gửi kèm handshake vì cùng origin.
function guardSocket(io) {
  io.use((socket, next) => {
    if (isLocalAddress(socket.handshake.address)) return next()
    if (readCookie(socket.handshake.headers.cookie, 'fc_token') === TOKEN) return next()
    if (socket.handshake.auth?.token === TOKEN) return next()
    console.warn(`[AUTH] Từ chối socket từ ${socket.handshake.address}`)
    next(new Error('unauthorized'))
  })
}

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())

const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULT_CONFIG = {
  flipH: false, flipV: false, rotation: 0, hideControls: false,
  // 'cover' lấp đầy màn hình nhưng cắt rìa (hợp với OBS), 'contain' thấy toàn bộ
  // khung camera nhưng có viền đen (hợp lúc canh khung)
  fit: 'cover',
  // Hiệu ứng hình ảnh — áp ở viewer bằng CSS filter, không đụng tới stream phone
  // gửi đi. Đặt ở viewer vì PC khoẻ hơn và OBS render cả trang nên thấy ngay.
  filters: {
    brightness: 1, contrast: 1, saturate: 1, hue: 0,
    grayscale: 0, sepia: 0, softness: 0, zoom: 1
  },
  phone: { facingMode: 'environment', width: 1280, height: 720, frameRate: 30, maxBitrate: 4000000, audio: false }
}

// Miền giá trị hợp lệ cho từng filter. Tách ra thành bảng để control.html và
// server không lệch nhau — client đọc luôn bảng này qua /api/config-schema.
const FILTER_RANGES = {
  brightness: [0.5, 1.5],
  contrast: [0.5, 1.5],
  saturate: [0, 2],
  hue: [-30, 30],
  grayscale: [0, 1],
  sepia: [0, 1],
  softness: [0, 1],
  zoom: [1, 3],
}
const VALID_ROTATIONS = new Set([0, 90, 180, 270])

// Nhận số nguyên trong dải cho phép, ngược lại giữ nguyên giá trị đang dùng.
// Cố tình KHÔNG clamp: width 0 (ô input bị xoá trắng ở control.html) là dữ liệu
// hỏng chứ không phải "hơi nhỏ" — clamp lên 160 vẫn là ghi đè rác lên giá trị tốt.
function intInRange(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) return fallback
  return n
}

// Như intInRange nhưng cho số thực (filter dùng bước 0.01). Làm tròn 2 chữ số để
// config.json không đầy những 1.0000000000000002 do lỗi dấu phẩy động.
function numInRange(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return Math.round(n * 100) / 100
}

// Lọc key lạ + validate kiểu và miền giá trị. Field sai kiểu bị bỏ qua (giữ giá
// trị hiện tại) thay vì ghi đè config bằng dữ liệu rác.
function sanitizeConfig(body, current) {
  const out = {}
  if (typeof body.flipH === 'boolean') out.flipH = body.flipH
  if (typeof body.flipV === 'boolean') out.flipV = body.flipV
  if (typeof body.hideControls === 'boolean') out.hideControls = body.hideControls
  if (body.fit === 'cover' || body.fit === 'contain') out.fit = body.fit
  if (VALID_ROTATIONS.has(Number(body.rotation))) out.rotation = Number(body.rotation)

  const f = body.filters
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const cur = current.filters
    const filters = {}
    for (const [key, [min, max]] of Object.entries(FILTER_RANGES)) {
      if (f[key] !== undefined) filters[key] = numInRange(f[key], min, max, cur[key])
    }
    out.filters = { ...cur, ...filters }
  }

  const p = body.phone
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const cur = current.phone
    const phone = {}
    if (p.facingMode === 'user' || p.facingMode === 'environment') phone.facingMode = p.facingMode
    if (typeof p.audio === 'boolean') phone.audio = p.audio
    if (p.width !== undefined) phone.width = intInRange(p.width, 160, 4096, cur.width)
    if (p.height !== undefined) phone.height = intInRange(p.height, 160, 4096, cur.height)
    if (p.frameRate !== undefined) phone.frameRate = intInRange(p.frameRate, 1, 120, cur.frameRate)
    // Trần 30 Mbps chứ không phải 20: 4K@30 cần ~25 Mbps, chặn ở 20 thì cảnh báo
    // bitrate không bao giờ tắt được dù người dùng đã chọn mức cao nhất
    if (p.maxBitrate !== undefined) phone.maxBitrate = intInRange(p.maxBitrate, 100000, 30000000, cur.maxBitrate)
    // Merge sâu: client có thể chỉ gửi một phần object phone — shallow merge sẽ
    // xoá mất các key còn lại
    out.phone = { ...cur, ...phone }
  }
  return out
}

let configCache = { ...DEFAULT_CONFIG }
try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  // Merge sâu 1 cấp cho từng object lồng: nếu config.json thiếu key (file cũ
  // chưa có maxBitrate hay chưa có filters), shallow merge sẽ nuốt mất default
  configCache = {
    ...DEFAULT_CONFIG,
    ...saved,
    filters: { ...DEFAULT_CONFIG.filters, ...(saved.filters || {}) },
    phone: { ...DEFAULT_CONFIG.phone, ...(saved.phone || {}) },
  }
} catch (err) {
  // File thiếu (lần chạy đầu) hoặc JSON hỏng → dựng lại từ default để server luôn
  // khởi động được. Chỉ cảnh báo khi file có tồn tại mà parse lỗi.
  if (err.code !== 'ENOENT') console.warn('[CONFIG] config.json không đọc được, dùng mặc định:', err.message)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configCache, null, 2))
}

let writeChain = Promise.resolve()

// Ghi atomic (file tạm → rename) và tuần tự hoá các lần ghi: hai POST gần nhau
// ghi đè lẫn nhau giữa chừng sẽ để lại config.json hỏng JSON.
function persistConfig() {
  const snapshot = JSON.stringify(configCache, null, 2)
  const tmpPath = `${CONFIG_PATH}.tmp`
  writeChain = writeChain
    .then(async () => {
      await fsp.writeFile(tmpPath, snapshot)
      await fsp.rename(tmpPath, CONFIG_PATH)
    })
    .catch(err => {
      // Không throw tiếp: config trong RAM vẫn đúng, chỉ mất tính bền vững sau
      // restart. Nuốt im lặng thì sẽ không bao giờ biết ổ đĩa/quyền ghi có vấn đề.
      console.error('[CONFIG] Ghi config.json thất bại:', err.message)
    })
}

app.get('/api/config', (req, res) => {
  res.json(configCache)
})

// control.html dựng slider từ đây thay vì hardcode min/max — một nguồn duy nhất
// cho miền giá trị, khỏi lệch với validate phía server
app.get('/api/filter-ranges', (req, res) => {
  res.json(FILTER_RANGES)
})

app.post('/api/config', (req, res) => {
  const body = req.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid body' })
  }
  configCache = { ...configCache, ...sanitizeConfig(body, configCache) }
  persistConfig()
  res.json(configCache)
})

// serve QR data as JSON for the index page
app.get('/api/urls', async (req, res) => {
  const ips = listLocalIPs()
  // Máy nhiều card mạng thì đoán tự động có thể sai → cho phép chỉ định IP, nhưng
  // chỉ nhận IP thật sự có trên máy để endpoint không thành công cụ sinh QR tuỳ ý
  const requested = req.query.ip
  const ip = ips.some(i => i.address === requested) ? requested : getLocalIP()

  // USB đi qua localhost → miễn token. WiFi từ LAN → phải mang token lần đầu,
  // sau đó cookie lo phần còn lại (kể cả khi phone tự mở control.html)
  const usbURL = `http://localhost:${HTTP_PORT}/phone.html`
  const wifiURL = `https://${ip}:${HTTPS_PORT}/phone.html?t=${TOKEN}`

  const [usbQR, wifiQR] = await Promise.all([
    QRCode.toDataURL(usbURL),
    QRCode.toDataURL(wifiURL),
  ])

  res.json({ usbURL, wifiURL, usbQR, wifiQR, ip, ips })
})

// Bridge: mỗi event phải gửi sang cả io kia, vì phone có thể ở HTTPS còn viewer ở
// HTTP (hai Socket.IO instance tách biệt). Hai dòng này trước đây lặp lại 6 lần.
function relay(socket, peer, room, event, data) {
  socket.to(room).emit(event, data)
  peer?.to(room).emit(event, data)
}

// Gửi đích danh tới một socket. Socket.IO cho mỗi socket tự join một room trùng id
// của nó, nên định tuyến 1-1 dùng chung cơ chế `to()` và vẫn qua được bridge.
function sendTo(socket, peer, targetId, event, data) {
  if (!targetId) return
  socket.to(targetId).emit(event, data)
  peer?.to(targetId).emit(event, data)
}

function setupSignaling(io, peer, label) {
  io.on('connection', (socket) => {
    console.log(`[${label}] CONNECT   ${socket.id}`)

    // payload: { room, role } — role ('phone' | 'viewer' | 'control') để biết
    // chính xác ai rớt lúc disconnect. Vẫn nhận string cho tab cũ chưa reload.
    socket.on(EV.JOIN, (payload) => {
      const room = typeof payload === 'string' ? payload : payload?.room
      if (!room) return
      const role = (payload && typeof payload === 'object' && payload.role) || 'unknown'
      socket.data.room = room
      socket.data.role = role
      socket.join(room)
      const members = io.sockets.adapter.rooms.get(room)?.size ?? 0
      console.log(`[${label}] JOIN room="${room}" role=${role} total=${members}`)

      if (role === ROLE.PHONE) {
        // Phone vừa vào (kể cả reconnect) → viewer nghe PHONE_READY sẽ hỏi lại.
        // Phone không tự offer được vì chưa biết trong phòng có viewer nào.
        relay(socket, peer, room, EV.PHONE_READY)
      } else if (role === ROLE.VIEWER) {
        // Viewer vào thì hỏi luôn; phone đáp nếu camera đã bật
        relay(socket, peer, room, EV.VIEWER_REQUEST, { from: socket.id })
      }
    })

    // Viewer hỏi stream — luôn gắn socket.id thật ở server, không tin field client
    // gửi lên, để một client không thể mạo danh viewer khác
    socket.on(EV.VIEWER_REQUEST, () => {
      const room = socket.data.room
      if (!room) return
      console.log(`[${label}] VIEWER_REQUEST từ ${socket.id}`)
      relay(socket, peer, room, EV.VIEWER_REQUEST, { from: socket.id })
    })

    socket.on(EV.PHONE_READY, () => {
      const room = socket.data.room
      if (!room) return
      console.log(`[${label}] PHONE_READY → báo viewer hỏi lại`)
      relay(socket, peer, room, EV.PHONE_READY)
    })

    // SDP/ICE đi đích danh: phone giữ một peer connection riêng cho mỗi viewer nên
    // broadcast cả phòng như trước sẽ khiến các viewer nhận nhầm của nhau
    socket.on(EV.OFFER, (data) => {
      console.log(`[${label}] OFFER  ${socket.id} → ${data.to}`)
      sendTo(socket, peer, data.to, EV.OFFER, { sdp: data.sdp, from: socket.id })
    })

    socket.on(EV.ANSWER, (data) => {
      console.log(`[${label}] ANSWER ${socket.id} → ${data.to}`)
      sendTo(socket, peer, data.to, EV.ANSWER, { sdp: data.sdp, from: socket.id })
    })

    socket.on(EV.ICE, (data) => {
      sendTo(socket, peer, data.to, EV.ICE, { candidate: data.candidate, from: socket.id })
    })

    socket.on(EV.CONFIG_UPDATED, () => {
      const room = socket.data.room
      if (!room) return
      console.log(`[${label}] CONFIG_UPDATED → notify viewer`)
      relay(socket, peer, room, EV.CONFIG_UPDATED)
    })

    socket.on('disconnect', (reason) => {
      // socket.rooms đã bị Socket.IO clear ở thời điểm này → đọc room lưu lúc join
      const { room, role } = socket.data
      console.log(`[${label}] DISCONNECT ${socket.id} | reason: ${reason} | role: ${role ?? 'unknown'} | room: ${room ?? 'none'}`)
      if (!room) return

      // Chỉ báo khi đúng phone rớt. Trước đây mọi disconnect đều bắn event này
      // → viewer đóng tab làm các viewer còn lại tưởng mất phone.
      if (role === ROLE.PHONE) {
        io.to(room).emit(EV.PHONE_DISCONNECTED)
        peer?.to(room).emit(EV.PHONE_DISCONNECTED)
      } else if (role === ROLE.VIEWER) {
        // Phone giữ một peer connection cho mỗi viewer → không báo thì các
        // connection chết cứ tích lại cho tới khi đóng trang
        io.to(room).emit(EV.VIEWER_LEFT, { id: socket.id })
        peer?.to(room).emit(EV.VIEWER_LEFT, { id: socket.id })
      }
    })
  })
}

// HTTP server (USB mode - localhost is secure context)
const httpServer = http.createServer(app)
const httpIO = new Server(httpServer)
guardSocket(httpIO)
let httpsIO = null

// listen() báo lỗi bất đồng bộ nên try/catch không bắt được — thiếu handler này
// thì port bận sẽ làm process chết kèm stack trace thô, không rõ nguyên nhân.
function describeListenError(err, port, label) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[${label}] Port ${port} đang bị chiếm bởi process khác. Tìm và kill:`)
    console.error(`  Windows : netstat -ano | findstr ${port}  →  taskkill /PID <pid> /F`)
    console.error(`  macOS   : lsof -ti:${port} | xargs kill -9\n`)
  } else {
    console.error(`[${label}] Không mở được port ${port}:`, err.message)
  }
}

httpServer.on('error', (err) => {
  describeListenError(err, HTTP_PORT, 'HTTP')
  process.exit(1)   // HTTP là bắt buộc (viewer + USB mode) → không chạy tiếp được
})

httpServer.listen(HTTP_PORT, '0.0.0.0', async () => {
  const usbURL = `http://localhost:${HTTP_PORT}/phone.html`
  const qr = await QRCode.toString(usbURL, { type: 'terminal', small: true })
  console.log(`[HTTP]  http://localhost:${HTTP_PORT}  (USB mode)`)
  console.log('\nQR USB (phone cắm dây):')
  console.log(qr)
})

// HTTPS server (WiFi mode)
let httpsServerRef = null
try {
  const httpsServer = https.createServer({
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
  }, app)
  httpsServerRef = httpsServer
  httpsIO = new Server(httpsServer)
  guardSocket(httpsIO)
  setupSignaling(httpsIO, httpIO, 'HTTPS')
  setupSignaling(httpIO, httpsIO, 'HTTP')

  // HTTPS là tuỳ chọn (chỉ cần cho WiFi mode) → lỗi thì cảnh báo và chạy tiếp
  httpsServer.on('error', (err) => {
    describeListenError(err, HTTPS_PORT, 'HTTPS')
    console.error('[HTTPS] Bỏ qua WiFi mode — USB mode qua HTTP vẫn hoạt động.\n')
  })

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', async () => {
    const ip = getLocalIP()
    const wifiURL = `https://${ip}:${HTTPS_PORT}/phone.html?t=${TOKEN}`
    const qr = await QRCode.toString(wifiURL, { type: 'terminal', small: true })
    console.log(`[HTTPS] https://${ip}:${HTTPS_PORT}  (WiFi mode)`)
    console.log('\nQR WiFi (phone không dây):')
    console.log(qr)
    console.log(`URL WiFi (kèm token): ${wifiURL}`)
    console.log(`Mở control trên thiết bị LAN khác: https://${ip}:${HTTPS_PORT}/control.html?t=${TOKEN}`)

    // Máy nhiều card mạng thì IP đoán tự động có thể sai — in hết để còn đối chiếu
    const ips = listLocalIPs()
    if (ips.length > 1) {
      console.log('\nMáy có nhiều IP LAN. Nếu phone không vào được, thử IP khác:')
      for (const i of ips) console.log(`  ${i.address.padEnd(16)} ${i.name}${i.virtual ? '  (card ảo)' : ''}`)
      console.log('  → Đổi IP ngay trên trang chủ http://localhost:' + HTTP_PORT)
    }
    console.log('')
  })
} catch (err) {
  // Thiếu cert là trường hợp bình thường (chỉ dùng USB mode) nhưng lỗi khác —
  // key hỏng, sai quyền đọc — thì phải nói rõ, không nuốt chung một rọ
  if (err.code === 'ENOENT') console.log('[HTTPS] Bỏ qua — không tìm thấy cert.pem/key.pem')
  else console.error('[HTTPS] Không khởi tạo được:', err.message)
  setupSignaling(httpIO, null, 'HTTP')
}

// Ctrl+C khi không đóng socket sẽ để client treo chờ timeout thay vì biết ngay
// là server đã tắt
let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[${signal}] Đang dừng server...`)
  httpIO.close()
  httpsIO?.close()
  httpServer.close()
  httpsServerRef?.close()
  // Chốt chặn: nếu còn kết nối nào không chịu đóng thì vẫn thoát sau 2s
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log(`\nMở trên PC: http://localhost:${HTTP_PORT}\n`)
