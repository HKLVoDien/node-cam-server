/**
 * Mission: Chọn IP LAN để in ra QR/URL. Tách khỏi server.js để test kiểm được
 *   đúng đoạn code đang chạy — require('./server.js') sẽ khởi động server thật,
 *   nên trước đây test phải chép lại logic, và bản chép có thể lệch lúc nào không
 *   biết.
 * Author: DienJVo
 * Version: 1.0.0
 */
const os = require('os')

// Card ảo (Docker, WSL, VirtualBox, VMware, Hyper-V, VPN) cũng là IPv4 non-internal,
// nên kiểu "lấy cái đầu tiên" hay trả về IP mà phone không hề kết nối tới được —
// QR WiFi in ra sẽ vô dụng mà nhìn thì không biết vì sao.
const VIRTUAL_IFACE = /virtual|vmware|virtualbox|vethernet|hyper-?v|docker|tailscale|zerotier|tap-|tun\d|loopback/i

function rankInterface(name) {
  if (/wi-?fi|wlan|wireless/i.test(name)) return 2
  if (/ethernet|^eth\d|^en\d/i.test(name)) return 1
  return 0
}

/**
 * Mọi IPv4 LAN của máy: card thật xếp trước card ảo, Wi-Fi/Ethernet lên đầu.
 * Vẫn giữ card ảo trong danh sách để người dùng tự chọn khi đoán sai.
 *
 * @param {object} [interfaces] os.networkInterfaces() — truyền vào để test giả lập
 */
function listLocalIPs(interfaces = os.networkInterfaces()) {
  const found = []
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const iface of addrs || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      if (iface.address.startsWith('169.254.')) continue   // APIPA — chưa lấy được DHCP
      found.push({ name, address: iface.address, virtual: VIRTUAL_IFACE.test(name) })
    }
  }
  return found.sort((a, b) => (a.virtual - b.virtual) || (rankInterface(b.name) - rankInterface(a.name)))
}

function getLocalIP(interfaces) {
  return listLocalIPs(interfaces)[0]?.address ?? 'localhost'
}

module.exports = { VIRTUAL_IFACE, rankInterface, listLocalIPs, getLocalIP }
