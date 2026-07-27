const { execSync, exec } = require('child_process')
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
const certPath = path.join(ROOT, 'cert.pem')
const keyPath  = path.join(ROOT, 'key.pem')

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

// Chrome bỏ qua hoàn toàn trường CN từ bản 58 — chỉ đọc subjectAltName. Cert không
// có SAN sẽ báo ERR_CERT_COMMON_NAME_INVALID và một số WebView không cho bypass.
const localIP = getLocalIP()
const SAN = `subjectAltName=IP:${localIP},IP:127.0.0.1,DNS:facecam,DNS:localhost`

log('Kiểm tra SSL cert...')
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  log(`Tạo self-signed cert (SAN: ${localIP})...`)
  const base = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=facecam"`
  try {
    execSync(`${base} -addext "${SAN}"`, { stdio: 'pipe' })
    ok(`Đã tạo cert.pem và key.pem (SAN: ${localIP})`)
  } catch (errWithExt) {
    // -addext cần OpenSSL >= 1.1.1. Bản cũ hơn thì tạo cert không SAN còn hơn
    // không có cert, nhưng phải nói rõ hệ quả thay vì im lặng.
    try {
      execSync(base, { stdio: 'pipe' })
      warn('OpenSSL quá cũ, không hỗ trợ -addext → cert tạo ra KHÔNG có SAN.')
      console.log('  Trình duyệt sẽ cảnh báo nặng hơn. Nâng cấp OpenSSL >= 1.1.1 rồi xoá cert.pem/key.pem và chạy lại.')
    } catch {
      warn(`openssl không tìm thấy (lỗi gốc: ${errWithExt.message.split('\n')[0]}).`)
      if (isWin) {
        console.log(`
Trên Windows, chạy lệnh sau trong Git Bash hoặc WSL:
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \\
    -subj "/CN=facecam" -addext "${SAN}"

Hoặc trong PowerShell:
  $cert = New-SelfSignedCertificate -DnsName "facecam","localhost" -CertStoreLocation "cert:\\LocalMachine\\My" -NotAfter (Get-Date).AddDays(365)
  # Sau đó export ra PEM — xem README.md để biết thêm chi tiết
`)
      } else {
        console.log('Hãy cài openssl: brew install openssl')
      }
    }
  }
} else {
  ok('cert.pem và key.pem đã có')
  // Cert cũ có thể thiếu SAN, hoặc SAN trỏ IP cũ sau khi đổi mạng (DHCP) —
  // cả hai đều làm trình duyệt cảnh báo mà nhìn cert thì không thấy ngay
  try {
    // openssl vẫn exit 0 khi cert không có extension nào, chỉ khác nội dung in ra
    const ext = execSync(`openssl x509 -in "${certPath}" -noout -ext subjectAltName`, { stdio: 'pipe' }).toString()
    if (!ext.includes('subjectAltName')) {
      warn('Cert hiện tại KHÔNG có subjectAltName (SAN) — trình duyệt hiện đại sẽ cảnh báo.')
      console.log('  Xoá cert.pem + key.pem rồi chạy lại "npm run init" để tạo cert mới có SAN.')
    } else if (!ext.includes(localIP)) {
      warn(`SAN của cert không chứa IP hiện tại (${localIP}) — trình duyệt sẽ cảnh báo.`)
      console.log('  Thường do đổi mạng/đổi IP. Xoá cert.pem + key.pem rồi chạy lại "npm run init".')
    }
  } catch {
    warn('Không kiểm tra được SAN của cert (thiếu openssl?) — bỏ qua bước này.')
  }
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
