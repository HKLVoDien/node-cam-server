const http = require('http')
const https = require('https')
const crypto = require('crypto')
// Chỉ dùng để mở trình duyệt lúc khởi động
const { spawn } = require('child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const express = require('express')
const { Server } = require('socket.io')
const QRCode = require('qrcode')
// Dùng chung với client để tên event chỉ có một nguồn duy nhất
const { ROLE, EV } = require('./public/shared.js')
const { ensureCert } = require('./certs.js')
const { listLocalIPs, getLocalIP } = require('./network.js')
// Bảng chuỗi dùng chung với client — trang 401 render ở server nên phải tra tay
const { STRINGS: I18N_STRINGS } = require('./public/i18n.js')

const app = express()

const HTTP_PORT = Number(process.env.PORT) || 7070
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 7443

// Nơi chứa dữ liệu chạy (config, token, cert) — tách khỏi nơi chứa code. Test cần
// trỏ sang thư mục tạm để không ghi đè config/token/cert thật của người dùng, và
// bản đóng gói exe sau này cũng phải ghi vào thư mục dữ liệu riêng chứ không phải
// cạnh file thực thi.
const DATA_DIR = process.env.FACECAM_DATA_DIR || __dirname

// ── Xác thực ────────────────────────────────────────────────────────────────
// Cả hai server listen trên 0.0.0.0 nên không có lớp này thì bất kỳ ai cùng LAN
// mở /viewer.html là xem được camera. Video đi P2P không qua server, nhưng không
// trao đổi được SDP/ICE thì không dựng được kết nối → gác signaling là đủ.
//
// Token lưu ra file để giữ nguyên qua các lần restart — nếu sinh mới mỗi lần chạy
// thì URL trong OBS Browser Source sẽ hỏng sau mỗi lần khởi động lại server.
const TOKEN_PATH = path.join(DATA_DIR, '.token')
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

// Trang này do server render nên không đọc được lựa chọn ngôn ngữ trong
// localStorage của trình duyệt — dùng Accept-Language, thứ duy nhất có ở đây.
// Người dùng chưa vào được trang nào thì cũng chưa kịp chọn ngôn ngữ.
function pickLang(header) {
  return /\bvi\b/i.test(header ?? '') ? 'vi' : 'en'
}

// Trả về trang có ô nhập thay vì một dòng chữ: người bị chặn thường đang cầm điện
// thoại, còn token thì nằm ở terminal trên máy khác — không có ô nhập thì họ chỉ
// còn cách tự gõ `?t=...` vào thanh địa chỉ, mà đa số không biết là làm được.
// Form GET submit về đúng URL hiện tại nên vào thẳng trang họ định mở.
function unauthorizedPage(lang) {
  const s = (key) => I18N_STRINGS[lang]?.[key] ?? I18N_STRINGS.en[key] ?? key
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s('401.title')}</title>
<style>
  :root { color-scheme: dark; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0f; color:#fff; min-height:100vh; display:flex;
    align-items:center; justify-content:center; padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  form { background:#141418; border:1px solid #222; border-radius:20px;
    padding:32px 28px; width:100%; max-width:380px; text-align:center; }
  .icon { font-size:40px; margin-bottom:14px; }
  h1 { font-size:19px; font-weight:700; margin-bottom:10px; }
  p { font-size:13px; color:#777; line-height:1.7; margin-bottom:20px; }
  input { width:100%; background:rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.12); color:#fff; padding:13px 14px;
    border-radius:12px; font-size:15px; font-family:ui-monospace,monospace;
    text-align:center; letter-spacing:1px; }
  input:focus { outline:none; border-color:#3b82f6; }
  button { width:100%; margin-top:12px; padding:14px; background:#3b82f6;
    color:#fff; border:none; border-radius:12px; font-size:15px;
    font-weight:600; cursor:pointer; }
  button:active { opacity:.85; }
</style></head><body>
<form method="get">
  <div class="icon">🔒</div>
  <h1>${s('401.heading')}</h1>
  <p>${s('401.desc')}<br>${s('401.desc2')}</p>
  <input name="t" placeholder="${s('401.placeholder')}" required autofocus
         pattern="\\s*[a-fA-F0-9]{32}\\s*" inputmode="latin" enterkeyhint="go"
         autocomplete="off" autocapitalize="none" spellcheck="false">
  <button type="submit">${s('401.submit')}</button>
</form>
</body></html>`
}

// Token gõ tay trên điện thoại hay dính chữ hoa (bàn phím di động tự viết hoa ký
// tự đầu, và không phải bàn phím nào cũng tôn trọng autocapitalize) hoặc khoảng
// trắng thừa khi dán. Token vốn là hex thường nên chuẩn hoá không làm yếu đi.
function normalizeToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

app.use((req, res, next) => {
  if (isLocalAddress(req.socket.remoteAddress)) return next()

  // Vào lần đầu bằng link kèm ?t= (từ QR) → set cookie để các request sau
  // (/socket.io/*, /api/config, ảnh...) không cần mang token trên URL nữa
  if (normalizeToken(req.query.t) === TOKEN) {
    res.setHeader('Set-Cookie', `fc_token=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax`)
    return next()
  }
  if (readCookie(req.headers.cookie, 'fc_token') === TOKEN) return next()

  console.warn(`[AUTH] Từ chối ${req.socket.remoteAddress} → ${req.method} ${req.path}`)

  // Phân biệt theo đường dẫn chứ không theo header Accept: fetch() mặc định gửi
  // `*/*`, mà `*/*` khớp cả html — dựa vào Accept sẽ nhét nguyên trang HTML vào
  // chỗ code đang chờ JSON.
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  res.status(401).type('html').send(unauthorizedPage(pickLang(req.headers['accept-language'])))
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

const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
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

// Miền giá trị hợp lệ cho từng filter. Tách ra thành bảng để panel hiệu ứng trên
// viewer và server không lệch nhau — client đọc luôn bảng này qua /api/filter-ranges.
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
// Cố tình KHÔNG clamp: width 0 (ô input bị xoá trắng trong panel config) là dữ
// liệu hỏng chứ không phải "hơi nhỏ" — clamp lên 160 vẫn là ghi đè rác lên giá trị tốt.
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

// Panel hiệu ứng trên viewer dựng slider từ đây thay vì hardcode min/max — một
// nguồn duy nhất cho miền giá trị, khỏi lệch với validate phía server
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
  // sau đó cookie lo phần còn lại (mọi request tiếp theo từ máy đó)
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

// Mỗi phòng chỉ phục vụ đúng một phone. Hai phone cùng vào sẽ cùng nhận
// VIEWER_REQUEST rồi cùng gửi offer tới một viewer — viewer thấy `from` khác nhau
// nên đóng peer connection cũ và dựng lại liên tục, hình nhấp nháy mà không bên
// nào biết vì sao. Map nằm ngoài setupSignaling vì phone có thể ở io HTTP còn
// viewer ở io HTTPS: hai instance tách biệt nhưng dùng chung một phòng.
const activePhones = new Map()   // room -> socket.id của phone đang giữ chỗ

// Socket.IO cấp id mới cho mỗi lần reconnect, và bản ghi cũ có thể chưa kịp xoá
// khi phone vào lại. Chỉ từ chối khi socket đang giữ chỗ thật sự còn sống.
function socketAlive(io, peer, id) {
  return Boolean(io.sockets.sockets.get(id) || peer?.sockets.sockets.get(id))
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

      // Chặn trước khi join: phone bị từ chối không được vào phòng, nếu không nó
      // vẫn nghe được VIEWER_REQUEST và vẫn kịp gửi offer
      if (role === ROLE.PHONE) {
        const holder = activePhones.get(room)
        if (holder && holder !== socket.id && socketAlive(io, peer, holder)) {
          console.warn(`[${label}] Từ chối phone thứ hai ${socket.id} — room="${room}" đã có ${holder}`)
          socket.emit(EV.PHONE_BUSY)
          return
        }
        activePhones.set(room, socket.id)
      }

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
      console.log(`[${label}] OFFER  ${socket.id} → ${data.to}${data.iceRestart ? ' (ICE restart)' : ''}`)
      // iceRestart phải đi kèm: viewer dùng nó để biết nên tái dùng peer
      // connection cũ hay dựng cái mới
      sendTo(socket, peer, data.to, EV.OFFER, { sdp: data.sdp, from: socket.id, iceRestart: !!data.iceRestart })
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
        // Nhả chỗ, nhưng chỉ khi đúng socket đang giữ — phone reconnect đã ghi đè
        // bản ghi bằng id mới, xoá vô điều kiện sẽ mở cửa cho phone lạ chen vào
        if (activePhones.get(room) === socket.id) activePhones.delete(room)
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

// Mở sẵn trang chủ cho đỡ phải tự gõ địa chỉ.
//
// Chỉ làm khi đang chạy trong terminal thật (`stdout.isTTY`): `npm test` spawn
// server với stdio pipe, không có điều kiện này thì mỗi lần chạy test sẽ bật thêm
// một loạt tab trình duyệt. Chạy `npm start > log.txt` cũng không mở, và đó là
// hành vi đúng.
function openBrowser(url) {
  if (process.env.FACECAM_OPEN === '0' || !process.stdout.isTTY) return

  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
    process.platform === 'darwin' ? ['open', [url]] :
    ['xdg-open', [url]]

  try {
    // detached + unref: trình duyệt sống độc lập với server — Ctrl+C không giết
    // nó, và server không phải chờ nó đóng mới thoát được
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // Máy Linux tối giản có thể không có xdg-open; không bắt lỗi thì thành
    // unhandled error làm chết cả server chỉ vì không mở nổi tab
    child.on('error', (err) => console.warn('[OPEN] Không mở được trình duyệt:', err.message))
    child.unref()
    console.log('[OPEN] Đang mở trang chủ trên trình duyệt mặc định')
  } catch (err) {
    console.warn('[OPEN] Không mở được trình duyệt:', err.message)
  }
}

httpServer.listen(HTTP_PORT, '0.0.0.0', async () => {
  const home = `http://localhost:${HTTP_PORT}`
  const usbURL = `${home}/phone.html`
  const qr = await QRCode.toString(usbURL, { type: 'terminal', small: true })
  console.log(`[HTTP]  ${home}  (USB mode)`)
  console.log('\nQR USB (phone cắm dây):')
  console.log(qr)
  openBrowser(home)
})

// HTTPS server (WiFi mode)
let httpsServerRef = null
try {
  // Cert gắn với IP, mà IP LAN đổi liên tục: DHCP cấp lại, đổi mạng, cắm thêm dây.
  // Trước đây cert sinh một lần rồi thôi nên đổi mạng là cảnh báo nặng thêm mà
  // không có gì báo cho biết. Giờ kiểm mỗi lần khởi động và ký lại khi cần.
  const { key, cert, regenerated, reason } = ensureCert(
    path.join(DATA_DIR, 'cert.pem'),
    path.join(DATA_DIR, 'key.pem'),
    listLocalIPs().map(i => i.address),
  )
  if (regenerated) console.log(`[CERT] Đã tạo cert mới — ${reason}`)

  const httpsServer = https.createServer({ key, cert }, app)
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
    console.log(`Xem trên thiết bị LAN khác: https://${ip}:${HTTPS_PORT}/viewer.html?t=${TOKEN}`)

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
  // Cert giờ được sinh tự động nên thiếu file không còn là lý do nữa — tới đây
  // nghĩa là sinh hoặc ghi thất bại thật (thư mục chỉ đọc, đĩa đầy, key hỏng).
  // USB mode qua HTTP vẫn chạy được nên không thoát, chỉ mất WiFi mode.
  console.error('[HTTPS] Không khởi tạo được:', err.message)
  console.error('[HTTPS] Bỏ qua WiFi mode — USB mode qua HTTP vẫn hoạt động.\n')
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
