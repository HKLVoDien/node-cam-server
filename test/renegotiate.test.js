/**
 * Mission: Kiểm cờ iceRestart đi đúng đường. Đây là thứ phân biệt "ICE restart"
 *   (tái dùng peer connection cũ) với "phone dựng lại connection" (viewer phải
 *   dựng cái mới). Nhầm hai loại này làm viewer mất hình khi bật/tắt mic, và
 *   người dùng phải F5 — lỗi chỉ lộ ra khi thử trên máy thật.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { startServer, connect, settle, waitFor } = require('./helpers.js')
const { ROOM, ROLE, EV } = require('../public/shared.js')

let server
let clients = []

before(async () => { server = await startServer() })
after(async () => { await server.stop() })
afterEach(async () => {
  for (const c of clients) c.close()
  clients = []
  await settle(400)
})

async function join(role) {
  const c = connect(server.url)
  await c.ready
  clients.push(c)
  c.emit(EV.JOIN, { room: ROOM, role })
  await settle(150)
  return c
}

describe('cờ iceRestart trong offer', () => {
  test('offer thường tới viewer với iceRestart = false', async () => {
    const phone = await join(ROLE.PHONE)
    const viewer = await join(ROLE.VIEWER)

    viewer.reset()
    phone.emit(EV.OFFER, { to: viewer.id, sdp: { type: 'offer', sdp: 'SDP' } })
    assert.ok(await waitFor(viewer, EV.OFFER))
    assert.strictEqual(viewer.payload(EV.OFFER).iceRestart, false)
  })

  // Nếu server nuốt mất cờ này thì viewer luôn dựng lại connection, kể cả khi
  // chỉ cần đổi đường truyền — mất hình mỗi lần mạng chập chờn
  test('offer ICE restart giữ nguyên cờ khi qua server', async () => {
    const phone = await join(ROLE.PHONE)
    const viewer = await join(ROLE.VIEWER)

    viewer.reset()
    phone.emit(EV.OFFER, { to: viewer.id, sdp: { type: 'offer', sdp: 'SDP' }, iceRestart: true })
    assert.ok(await waitFor(viewer, EV.OFFER))
    assert.strictEqual(viewer.payload(EV.OFFER).iceRestart, true)
  })

  // Client không thể tự nhận mình là phone khác, nhưng vẫn phải chắc rằng `from`
  // do server đóng dấu chứ không lấy từ payload
  test('from vẫn do server đóng dấu, không phải client tự khai', async () => {
    const phone = await join(ROLE.PHONE)
    const viewer = await join(ROLE.VIEWER)

    viewer.reset()
    phone.emit(EV.OFFER, { to: viewer.id, from: 'kẻ-mạo-danh', sdp: { type: 'offer', sdp: 'S' }, iceRestart: true })
    assert.ok(await waitFor(viewer, EV.OFFER))
    assert.strictEqual(viewer.payload(EV.OFFER).from, phone.id)
  })
})

describe('viewer.html xử lý cờ đúng', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'viewer.html'), 'utf8')

  // Kiểm bằng nguồn vì logic này nằm trong một callback WebRTC không tách ra
  // được; hành vi đầu-cuối đã kiểm bằng tay trên thiết bị thật.
  test('chỉ tái dùng peer connection khi đúng là ICE restart', () => {
    assert.match(src, /const isRestart = iceRestart && pc &&/,
      'isRestart phải phụ thuộc cờ iceRestart, không chỉ so `from`')
  })

  test('nhận cờ từ payload offer', () => {
    assert.match(src, /socket\.on\(EV\.OFFER, async \(\{ from, sdp, iceRestart \}\)/)
  })
})
