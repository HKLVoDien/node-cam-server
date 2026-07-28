/**
 * Mission: Sinh và bảo trì self-signed cert cho HTTPS (WiFi mode). Thay openssl
 *   bằng node-forge để không phụ thuộc binary ngoài — Windows không có sẵn
 *   openssl, và bản đóng gói thành exe thì càng không thể yêu cầu người dùng cài.
 *   Cert chứa mọi IP LAN của máy và được ký lại khi IP đổi.
 * Author: DienJVo
 * Version: 1.0.0
 */
const crypto = require('crypto')
const fs = require('fs')
const forge = require('node-forge')

// Ký lại trước khi hết hạn một khoảng, thay vì đợi tới đúng ngày — cert hết hạn
// giữa buổi dùng thì trình duyệt chặn hẳn chứ không chỉ cảnh báo
const RENEW_BEFORE_DAYS = 30
const VALID_DAYS = 825   // trần Chrome/Safari chấp nhận cho cert mới (~27 tháng)

/**
 * Sinh cặp key + self-signed cert phủ toàn bộ địa chỉ truyền vào.
 *
 * Key sinh bằng crypto của Node (native, ~100ms) thay vì RSA thuần JS của forge
 * (vài giây) — forge chỉ dùng cho phần dựng và ký X.509.
 *
 * @param {string[]} ips  IP LAN cần đưa vào SAN
 * @returns {{key: string, cert: string}} cặp PEM
 */
function generateCert(ips) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    // pkcs1 + spki là hai định dạng forge đọc trực tiếp, khỏi convert thêm bước
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })

  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey)
  // Serial phải là số dương; ký tự đầu >= 8 sẽ bị đọc thành số âm theo DER
  cert.serialNumber = '00' + crypto.randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + VALID_DAYS * 86400000)

  // Self-signed: người cấp chính là chủ thể
  const attrs = [{ name: 'commonName', value: 'FaceCam Server' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)

  // Chrome bỏ qua hoàn toàn commonName từ bản 58 — chỉ đọc subjectAltName.
  // type 2 = DNS, type 7 = IP.
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 2, value: 'facecam' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map(ip => ({ type: 7, ip })),
  ]
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ])

  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create())
  return { key: privateKey, cert: forge.pki.certificateToPem(cert) }
}

/** Danh sách IP nằm trong SAN của một cert PEM. Cert hỏng/không SAN → mảng rỗng. */
function certIPs(certPem) {
  try {
    const ext = forge.pki.certificateFromPem(certPem).getExtension('subjectAltName')
    if (!ext) return []
    return ext.altNames.filter(a => a.type === 7).map(a => a.ip ?? a.value)
  } catch {
    // Cert không đọc được thì coi như không phủ IP nào → phía trên sẽ sinh lại
    return []
  }
}

/**
 * Vì sao cert hiện có không dùng được nữa, hoặc null nếu vẫn tốt.
 * Trả về lý do dạng chữ để log nói rõ chứ không chỉ "đang tạo cert mới".
 */
function whyRegenerate(certPem, ips) {
  let cert
  try {
    cert = forge.pki.certificateFromPem(certPem)
  } catch (e) {
    return `cert.pem không đọc được (${e.message})`
  }

  const renewAt = new Date(cert.validity.notAfter.getTime() - RENEW_BEFORE_DAYS * 86400000)
  if (new Date() >= renewAt) {
    return `sắp hết hạn (${cert.validity.notAfter.toISOString().slice(0, 10)})`
  }

  const covered = certIPs(certPem)
  const missing = ips.filter(ip => !covered.includes(ip))
  if (missing.length) {
    return `thiếu IP hiện tại ${missing.join(', ')} (cert đang phủ: ${covered.join(', ') || 'không IP nào'})`
  }
  return null
}

/**
 * Đảm bảo cert/key trên đĩa phủ đúng các IP đang có. Sinh mới hoặc ký lại khi cần.
 *
 * @returns {{key: string, cert: string, regenerated: boolean, reason: string|null}}
 */
function ensureCert(certPath, keyPath, ips) {
  let existing = null
  try {
    existing = { cert: fs.readFileSync(certPath, 'utf8'), key: fs.readFileSync(keyPath, 'utf8') }
  } catch (err) {
    // Thiếu file là đường đi bình thường (lần chạy đầu). Lỗi khác — sai quyền,
    // file hỏng — thì phải nói ra, không nuốt chung một rọ với ENOENT.
    if (err.code !== 'ENOENT') console.warn(`[CERT] Không đọc được cert cũ: ${err.message}`)
  }

  const reason = existing ? whyRegenerate(existing.cert, ips) : 'chưa có cert'
  if (existing && !reason) return { ...existing, regenerated: false, reason: null }

  const fresh = generateCert(ips)
  fs.writeFileSync(keyPath, fresh.key, { mode: 0o600 })   // key chỉ chủ máy đọc được
  fs.writeFileSync(certPath, fresh.cert)
  return { ...fresh, regenerated: true, reason }
}

module.exports = { generateCert, certIPs, whyRegenerate, ensureCert, VALID_DAYS }
