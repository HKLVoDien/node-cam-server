/**
 * Mission: Kiểm module certs.js — SAN đúng địa chỉ, giữ nguyên cert khi IP không
 *   đổi, ký lại khi IP đổi / cert hỏng / sắp hết hạn. Chạy trên thư mục tạm nên
 *   không đụng cert thật.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const forge = require('node-forge')

const { generateCert, certIPs, whyRegenerate, ensureCert } = require('../certs.js')

let dir, certPath, keyPath

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facecam-cert-'))
  certPath = path.join(dir, 'cert.pem')
  keyPath = path.join(dir, 'key.pem')
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('generateCert', () => {
  const { key, cert } = generateCert(['192.168.1.5', '10.0.0.9'])
  const parsed = forge.pki.certificateFromPem(cert)

  test('trả về cặp PEM hợp lệ', () => {
    assert.match(key, /BEGIN RSA PRIVATE KEY/)
    assert.match(cert, /BEGIN CERTIFICATE/)
  })

  test('SAN chứa mọi IP được yêu cầu', () => {
    const ips = certIPs(cert)
    assert.ok(ips.includes('192.168.1.5'), 'thiếu 192.168.1.5')
    assert.ok(ips.includes('10.0.0.9'), 'thiếu 10.0.0.9')
  })

  test('SAN luôn có loopback và localhost', () => {
    assert.ok(certIPs(cert).includes('127.0.0.1'))
    const dns = parsed.getExtension('subjectAltName').altNames
      .filter(a => a.type === 2).map(a => a.value)
    assert.ok(dns.includes('localhost'))
  })

  // DER đọc byte đầu >= 0x80 là số âm, và serial âm bị một số client từ chối
  test('serial number không âm', () => {
    assert.ok(parseInt(parsed.serialNumber.slice(0, 2), 16) < 0x80)
  })

  test('đánh dấu dùng cho server, không phải CA', () => {
    assert.ok(parsed.getExtension('extKeyUsage').serverAuth)
    assert.strictEqual(parsed.getExtension('basicConstraints').cA, false)
  })

  // Lệch cặp thì https.createServer ném lỗi lúc khởi động, rất khó truy
  test('public key trong cert khớp private key', () => {
    const priv = forge.pki.privateKeyFromPem(key)
    const derived = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(priv.n, priv.e))
    assert.strictEqual(derived, forge.pki.publicKeyToPem(parsed.publicKey))
  })

  test('https.createServer nhận được cặp key/cert', () => {
    const fresh = generateCert(['127.0.0.1'])
    const srv = https.createServer({ key: fresh.key, cert: fresh.cert })
    srv.listen(0)
    assert.ok(srv.listening)
    srv.close()
  })
})

describe('whyRegenerate', () => {
  const { cert } = generateCert(['192.168.1.5', '10.0.0.9'])

  test('đủ IP thì không cần ký lại', () => {
    assert.strictEqual(whyRegenerate(cert, ['192.168.1.5']), null)
    assert.strictEqual(whyRegenerate(cert, ['192.168.1.5', '10.0.0.9']), null)
  })

  test('thiếu IP thì phải ký lại, và nói rõ thiếu cái nào', () => {
    const why = whyRegenerate(cert, ['192.168.99.99'])
    assert.match(why, /192\.168\.99\.99/)
  })

  test('cert không đọc được thì phải ký lại', () => {
    assert.match(whyRegenerate('không phải cert', ['1.2.3.4']), /không đọc được/)
  })

  test('certIPs trên dữ liệu rác trả mảng rỗng thay vì ném lỗi', () => {
    assert.deepStrictEqual(certIPs('rác'), [])
  })

  // forge cache tbsCertificate khi parse từ PEM, nên sửa validity rồi serialize
  // lại sẽ ghi ra ĐÚNG BẢN CŨ. Phải xoá cache để nó dựng lại từ field hiện tại.
  function certExpiringIn(days) {
    const c = forge.pki.certificateFromPem(generateCert(['192.168.1.5']).cert)
    c.validity.notAfter = new Date(Date.now() + days * 86400000)
    c.tbsCertificate = null
    return forge.pki.certificateToPem(c)
  }

  test('helper trên thật sự đổi được hạn (không dính cache của forge)', () => {
    const want = Date.now() + 5 * 86400000
    const got = forge.pki.certificateFromPem(certExpiringIn(5)).validity.notAfter.getTime()
    // X.509 lưu thời gian chính xác tới giây — bỏ mili-giây khi so sánh
    assert.strictEqual(Math.floor(got / 1000), Math.floor(want / 1000))
  })

  test('còn dưới ngưỡng 30 ngày thì ký lại', () => {
    assert.match(whyRegenerate(certExpiringIn(5), ['192.168.1.5']), /hết hạn/)
  })

  // Ngưỡng phải có tác dụng hai chiều, không thì thành ký lại mỗi lần khởi động
  test('còn nhiều ngày thì KHÔNG ký lại', () => {
    assert.strictEqual(whyRegenerate(certExpiringIn(100), ['192.168.1.5']), null)
  })
})

describe('ensureCert', () => {
  test('lần đầu thì sinh mới và ghi ra đĩa', () => {
    const r = ensureCert(certPath, keyPath, ['192.168.1.5'])
    assert.strictEqual(r.regenerated, true)
    assert.strictEqual(r.reason, 'chưa có cert')
    assert.ok(fs.existsSync(certPath))
    assert.ok(fs.existsSync(keyPath))
  })

  // Ký lại vô cớ bắt người dùng chấp nhận cảnh báo mới mỗi lần mở server
  test('IP không đổi thì giữ nguyên, không ghi lại file', () => {
    const before = fs.readFileSync(certPath, 'utf8')
    const r = ensureCert(certPath, keyPath, ['192.168.1.5'])
    assert.strictEqual(r.regenerated, false)
    assert.strictEqual(fs.readFileSync(certPath, 'utf8'), before)
  })

  // Đây là lý do tồn tại của cả module: DHCP đổi IP thì cert phải theo kịp
  test('IP đổi thì ký lại và phủ IP mới', () => {
    const before = fs.readFileSync(certPath, 'utf8')
    const r = ensureCert(certPath, keyPath, ['192.168.88.151'])
    assert.strictEqual(r.regenerated, true)
    assert.match(r.reason, /192\.168\.88\.151/)
    assert.ok(certIPs(fs.readFileSync(certPath, 'utf8')).includes('192.168.88.151'))
    assert.notStrictEqual(fs.readFileSync(certPath, 'utf8'), before)
  })

  test('cert hỏng trên đĩa thì sinh lại thay vì để server chết', () => {
    fs.writeFileSync(certPath, 'đây không phải cert')
    const r = ensureCert(certPath, keyPath, ['192.168.1.5'])
    assert.strictEqual(r.regenerated, true)
    assert.match(r.reason, /không đọc được/)
    assert.match(fs.readFileSync(certPath, 'utf8'), /BEGIN CERTIFICATE/)
  })
})
