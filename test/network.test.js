/**
 * Mission: Kiểm listLocalIPs() xếp đúng thứ tự khi máy có nhiều card mạng. Giả lập
 *   os.networkInterfaces() vì máy chạy test thường chỉ có một card — mà đúng cái
 *   máy nhiều card mới là chỗ chọn sai IP.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')

const { listLocalIPs, getLocalIP, rankInterface } = require('../network.js')

// Cấu hình hay gặp trên máy dev Windows: WSL + Docker + VirtualBox + VPN đứng
// TRƯỚC card thật theo thứ tự os trả về — nên lấy "cái đầu tiên" là sai ngay.
const MESSY = {
  'vEthernet (WSL)':              [{ family: 'IPv4', internal: false, address: '172.28.176.1' }],
  'VirtualBox Host-Only Network': [{ family: 'IPv4', internal: false, address: '192.168.56.1' }],
  'Ethernet 2 (Docker)':          [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
  'Tailscale':                    [{ family: 'IPv4', internal: false, address: '100.64.0.5' }],
  'Ethernet':                     [{ family: 'IPv4', internal: false, address: '192.168.88.10' }],
  'Wi-Fi':                        [{ family: 'IPv4', internal: false, address: '192.168.88.36' }],
  'Wi-Fi 2':                      [{ family: 'IPv4', internal: false, address: '169.254.10.2' }],
  'Loopback Pseudo-Interface 1':  [{ family: 'IPv4', internal: true,  address: '127.0.0.1' }],
}

describe('listLocalIPs', () => {
  const ips = listLocalIPs(MESSY)

  test('chọn Wi-Fi thật, không phải WSL/Docker đứng trước nó', () => {
    assert.strictEqual(ips[0].address, '192.168.88.36')
    assert.strictEqual(getLocalIP(MESSY), '192.168.88.36')
  })

  test('Ethernet thật xếp ngay sau Wi-Fi', () => {
    assert.strictEqual(ips[1].address, '192.168.88.10')
  })

  // 169.254.x nghĩa là chưa xin được DHCP — in ra QR thì phone không bao giờ vào được
  test('loại địa chỉ APIPA', () => {
    assert.ok(!ips.some(i => i.address.startsWith('169.254.')))
  })

  test('loại loopback', () => {
    assert.ok(!ips.some(i => i.address === '127.0.0.1'))
  })

  test('mọi card thật đứng trước mọi card ảo', () => {
    assert.strictEqual(ips.findIndex(i => i.virtual), 2)
  })

  // Vẫn liệt kê card ảo để người dùng tự chọn khi đoán sai — bỏ hẳn thì máy chỉ
  // có card ảo sẽ không có gì để chọn
  test('vẫn giữ card ảo trong danh sách', () => {
    assert.strictEqual(ips.filter(i => i.virtual).length, 4)
  })

  test('không có card nào thì trả localhost thay vì undefined', () => {
    assert.deepStrictEqual(listLocalIPs({}), [])
    assert.strictEqual(getLocalIP({}), 'localhost')
  })

  test('bỏ qua IPv6', () => {
    const only6 = { 'Wi-Fi': [{ family: 'IPv6', internal: false, address: 'fe80::1' }] }
    assert.deepStrictEqual(listLocalIPs(only6), [])
  })
})

describe('rankInterface', () => {
  test('Wi-Fi hơn Ethernet, Ethernet hơn tên lạ', () => {
    assert.ok(rankInterface('Wi-Fi') > rankInterface('Ethernet'))
    assert.ok(rankInterface('Ethernet') > rankInterface('Thunderbolt Bridge'))
  })

  test('nhận các cách viết khác nhau của cùng một loại', () => {
    for (const n of ['Wi-Fi', 'WiFi', 'wlan0', 'Wireless LAN']) {
      assert.strictEqual(rankInterface(n), 2, `${n} phải được xếp hạng Wi-Fi`)
    }
    for (const n of ['Ethernet', 'eth0', 'en0']) {
      assert.strictEqual(rankInterface(n), 1, `${n} phải được xếp hạng Ethernet`)
    }
  })
})
