const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = __dirname
const isWin = os.platform() === 'win32'

function log(msg) { console.log(`\n→ ${msg}`) }
function ok(msg)  { console.log(`✓ ${msg}`) }
function warn(msg){ console.log(`⚠ ${msg}`) }

// 1. Kiểm tra node_modules
log('Kiểm tra dependencies...')
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  log('Cài đặt npm packages...')
  execSync('npm install', { stdio: 'inherit', cwd: ROOT })
  ok('npm install xong')
} else {
  ok('node_modules đã có')
}

// 2. Tạo cert nếu chưa có
// Sinh bằng node-forge thay vì gọi openssl: Windows không có sẵn openssl, phiên
// bản cũ lại không hỗ trợ -addext (thiếu SAN thì Chrome từ chối), và bản đóng gói
// thành exe sau này càng không thể yêu cầu người dùng tự cài.
const { ensureCert, certIPs } = require('./certs.js')

const certPath = path.join(ROOT, 'cert.pem')
const keyPath  = path.join(ROOT, 'key.pem')

// Đưa mọi IP LAN vào SAN, không chỉ cái đầu tiên: máy cắm dây song song WiFi có
// hai địa chỉ, và không đoán được phone sẽ tới bằng đường nào.
function listLocalIPs() {
  const found = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const iface of addrs || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      if (iface.address.startsWith('169.254.')) continue   // APIPA — chưa lấy được DHCP
      found.push(iface.address)
    }
  }
  return found
}

log('Kiểm tra SSL cert...')
const ips = listLocalIPs()
try {
  const { regenerated, reason } = ensureCert(certPath, keyPath, ips)
  if (regenerated) ok(`Đã tạo cert.pem + key.pem — ${reason}`)
  else ok('cert.pem và key.pem còn dùng tốt')
  console.log(`  Địa chỉ trong cert: ${certIPs(fs.readFileSync(certPath, 'utf8')).join(', ')}`)
  console.log('  Server tự ký lại khi IP đổi, không cần chạy lại lệnh này.')
} catch (e) {
  // Không có cert thì WiFi mode tắt, nhưng USB mode vẫn chạy → cảnh báo rồi đi tiếp
  warn(`Không tạo được cert: ${e.message}`)
  console.log('  WiFi mode sẽ không hoạt động. USB mode qua HTTP vẫn dùng được.')
}

// 3. Kiểm tra config.json
// Không tự tạo file ở đây nữa: server.js đã dựng config.json từ DEFAULT_CONFIG khi
// thiếu. Giữ bản default thứ hai ở đây từng làm hai bên lệch nhau (init.js thiếu
// maxBitrate) → chỉ báo trạng thái, để server.js là nguồn duy nhất.
const configPath = path.join(ROOT, 'config.json')
log('Kiểm tra config.json...')
if (fs.existsSync(configPath)) {
  ok('config.json đã có')
} else {
  ok('config.json sẽ được server tạo tự động ở lần chạy đầu')
}

// 4. Kiểm tra ADB (tuỳ chọn)
log('Kiểm tra ADB (dùng cho USB mode)...')
// Chỉ dò path mặc định của đúng OS đang chạy — trước đây dò cả path macOS trên
// Windows nên log rối mà chẳng bao giờ trúng
const adbPaths = ['adb']
if (isWin) adbPaths.push(path.join(os.homedir(), 'AppData/Local/Android/Sdk/platform-tools/adb.exe'))
else adbPaths.push(path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'))

let adbFound = false
for (const p of adbPaths) {
  // Từng path không tìm thấy là chuyện bình thường (đang dò) → nuốt lỗi ở đây là
  // đúng, kết quả chung được báo bằng adbFound bên dưới
  try {
    execSync(`"${p}" version`, { stdio: 'pipe' })
    adbFound = true
    ok(`ADB tìm thấy: ${p}`)
    break
  } catch { /* path này không có adb, thử path kế tiếp */ }
}
if (!adbFound) {
  warn('ADB không tìm thấy — USB mode sẽ không hoạt động (WiFi mode vẫn dùng được).')
  if (isWin) {
    console.log('  Tải platform-tools: https://developer.android.com/studio/releases/platform-tools')
    console.log('  Giải nén rồi thêm thư mục đó vào PATH.')
  } else {
    console.log('  Cài: brew install android-platform-tools')
  }
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Setup hoàn tất!

Chạy server:
  npm start

USB mode (Android):
  adb reverse tcp:7070 tcp:7070
  → Phone mở: http://localhost:7070/phone.html

WiFi mode:
  → Phone quét QR trong terminal (QR đã kèm sẵn token)
  → Accept cert warning lần đầu

Lưu ý: thiết bị trong LAN cần token để vào; localhost (viewer trên PC,
OBS, USB mode) được miễn. Token nằm ở file .token.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
