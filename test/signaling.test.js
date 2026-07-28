/**
 * Mission: Kiểm signaling — định tuyến đích danh theo socket id (nhiều viewer
 *   cùng xem), chống mạo danh, dọn dẹp khi ai đó rời phòng, và chặn phone thứ hai
 *   giành phòng. Đây là phần dễ hỏng nhất mà đọc code không thấy.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')

const { startServer, connect, settle, waitFor } = require('./helpers.js')
const { ROOM, ROLE, EV } = require('../public/shared.js')

let server
let clients = []

before(async () => { server = await startServer() })
after(async () => { await server.stop() })

// Mọi test dùng chung một server để khỏi tốn thời gian dựng lại, nên phải trả
// phòng về trạng thái trống sau mỗi test. Bỏ bước này thì phone của test trước
// vẫn giữ chỗ và test sau bị chính phone_busy từ chối — đúng cái bẫy đã làm cả
// loạt test đỏ khi mới viết file này.
afterEach(async () => {
  for (const c of clients) c.close()
  clients = []
  await settle(400)   // chờ server xử lý disconnect và nhả chỗ phone
})

/** Nối một client đã vào phòng; afterEach lo phần đóng */
async function join(role) {
  const c = connect(server.url)
  await c.ready
  clients.push(c)
  c.emit(EV.JOIN, { room: ROOM, role })
  await settle(150)
  return c
}

/** Khẳng định client nhận được event, chờ có điều kiện thay vì sleep cố định */
async function assertGot(client, event, msg, count = 1) {
  assert.ok(await waitFor(client, event, { count }), msg ?? `không nhận được ${event}`)
}

describe('định tuyến nhiều viewer', () => {
  let phone, v1, v2

  beforeEach(async () => {
    phone = await join(ROLE.PHONE)
    v1 = await join(ROLE.VIEWER)
    v2 = await join(ROLE.VIEWER)
  })

  test('mỗi viewer vào phòng làm phone nhận một yêu cầu riêng, kèm đúng id', async () => {
    phone.reset()
    const v3 = await join(ROLE.VIEWER)
    await assertGot(phone, EV.VIEWER_REQUEST)
    assert.strictEqual(phone.count(EV.VIEWER_REQUEST), 1)
    assert.strictEqual(phone.payload(EV.VIEWER_REQUEST).from, v3.id)
  })

  // Trước đây broadcast cả phòng, nên viewer thứ hai vào là hai answer cùng đổ về
  // một peer connection và hỏng luôn viewer đầu
  test('OFFER chỉ tới đúng viewer được chỉ định', async () => {
    v1.reset(); v2.reset()
    phone.emit(EV.OFFER, { to: v1.id, sdp: { type: 'offer', sdp: 'SDP_V1' } })
    await assertGot(v1, EV.OFFER)
    await settle()   // để chắc chắn v2 không nhận muộn
    assert.strictEqual(v2.count(EV.OFFER), 0, 'viewer2 không được nhận offer của viewer1')
  })

  test('OFFER kèm from = id của phone để viewer biết trả lời cho ai', async () => {
    v1.reset()
    phone.emit(EV.OFFER, { to: v1.id, sdp: { type: 'offer', sdp: 'SDP' } })
    await assertGot(v1, EV.OFFER)
    assert.strictEqual(v1.payload(EV.OFFER).from, phone.id)
  })

  test('ANSWER và ICE về đúng phone, kèm id viewer để map vào peer tương ứng', async () => {
    phone.reset()
    v1.emit(EV.ANSWER, { to: phone.id, sdp: { type: 'answer', sdp: 'ANS' } })
    v1.emit(EV.ICE, { to: phone.id, candidate: { candidate: 'ICE' } })
    await assertGot(phone, EV.ANSWER)
    await assertGot(phone, EV.ICE)
    assert.strictEqual(phone.payload(EV.ANSWER).from, v1.id)
    assert.strictEqual(phone.payload(EV.ICE).from, v1.id)
  })

  // Không có cái này thì một client bất kỳ có thể tự khai là viewer khác và cướp
  // luồng hình của họ
  test('server dùng socket.id thật, bỏ qua from do client tự khai', async () => {
    phone.reset()
    v2.emit(EV.VIEWER_REQUEST, { from: 'tôi-là-viewer-khác' })
    await assertGot(phone, EV.VIEWER_REQUEST)
    assert.strictEqual(phone.payload(EV.VIEWER_REQUEST).from, v2.id)
  })
})

describe('rời phòng', () => {
  let phone, v1, v2

  beforeEach(async () => {
    phone = await join(ROLE.PHONE)
    v1 = await join(ROLE.VIEWER)
    v2 = await join(ROLE.VIEWER)
  })

  test('viewer đóng tab thì phone nhận VIEWER_LEFT kèm đúng id', async () => {
    phone.reset()
    const goneId = v1.id
    v1.close()
    await assertGot(phone, EV.VIEWER_LEFT)
    assert.strictEqual(phone.payload(EV.VIEWER_LEFT).id, goneId)
  })

  // Trước đây mọi disconnect đều bắn phone_disconnected, nên một viewer đóng tab
  // làm các viewer còn lại tưởng mất phone và xoá hình
  test('viewer đóng tab KHÔNG làm viewer khác tưởng mất phone', async () => {
    v2.reset()
    v1.close()
    await settle(600)
    assert.strictEqual(v2.count(EV.PHONE_DISCONNECTED), 0)
  })

  test('phone rớt thì viewer được báo', async () => {
    v2.reset()
    phone.close()
    await assertGot(v2, EV.PHONE_DISCONNECTED)
  })

  test('phone vào lại thì viewer tự hỏi lại, không cần F5', async () => {
    phone.close()
    await settle(400)
    v2.reset()
    await join(ROLE.PHONE)
    await assertGot(v2, EV.PHONE_READY)
  })
})

describe('một phòng chỉ một phone', () => {
  let phone1, viewer

  beforeEach(async () => {
    phone1 = await join(ROLE.PHONE)
    viewer = await join(ROLE.VIEWER)
  })

  test('phone đầu tiên vào bình thường', async () => {
    await settle()
    assert.strictEqual(phone1.count(EV.PHONE_BUSY), 0)
  })

  test('phone thứ hai bị từ chối', async () => {
    const phone2 = await join(ROLE.PHONE)
    await assertGot(phone2, EV.PHONE_BUSY)
  })

  // Điểm mấu chốt: bị từ chối thì phải ở NGOÀI phòng. Vào phòng rồi mới từ chối
  // thì nó vẫn nghe được viewer_request và vẫn kịp gửi offer — chặn thành vô nghĩa
  test('phone bị từ chối không nghe được yêu cầu từ viewer', async () => {
    const phone2 = await join(ROLE.PHONE)
    await assertGot(phone2, EV.PHONE_BUSY)
    phone2.reset(); phone1.reset()

    viewer.emit(EV.VIEWER_REQUEST)
    await assertGot(phone1, EV.VIEWER_REQUEST, 'phone hợp lệ phải nhận được yêu cầu')
    assert.strictEqual(phone2.count(EV.VIEWER_REQUEST), 0, 'phone bị chặn vẫn nhận được yêu cầu')
  })

  test('phone bị từ chối đóng tab không làm viewer mất hình', async () => {
    const phone2 = await join(ROLE.PHONE)
    await assertGot(phone2, EV.PHONE_BUSY)
    viewer.reset()
    phone2.close()
    await settle(600)
    assert.strictEqual(viewer.count(EV.PHONE_DISCONNECTED), 0)
  })

  // Ca dễ hỏng nhất: Socket.IO cấp id mới mỗi lần kết nối lại, nên so id một cách
  // ngây thơ sẽ khoá luôn chính cái phone vừa mất sóng vào lại
  test('phone mất sóng vào lại KHÔNG bị chặn nhầm', async () => {
    phone1.close()
    await settle(400)
    const back = await join(ROLE.PHONE)
    await settle()
    assert.strictEqual(back.count(EV.PHONE_BUSY), 0, 'phone vào lại bị chặn nhầm')

    back.reset()
    viewer.emit(EV.VIEWER_REQUEST)
    await assertGot(back, EV.VIEWER_REQUEST, 'phone vào lại phải phục vụ được')
  })

  test('phone rời hẳn thì nhường chỗ cho máy khác', async () => {
    phone1.close()
    await settle(400)
    const other = await join(ROLE.PHONE)
    await settle()
    assert.strictEqual(other.count(EV.PHONE_BUSY), 0)
  })
})

describe('config_updated', () => {
  test('một trang lưu config thì trang khác được báo để nạp lại', async () => {
    const phone = await join(ROLE.PHONE)
    const viewer = await join(ROLE.VIEWER)
    viewer.reset()
    phone.emit(EV.CONFIG_UPDATED)
    await assertGot(viewer, EV.CONFIG_UPDATED)
  })

  // Người gửi không nhận lại chính event mình vừa bắn — nếu nhận, viewer sẽ tự
  // nạp lại config ngay sau khi mình vừa lưu, ghi đè giá trị đang kéo dở trên slider
  test('người gửi không nhận lại event của chính mình', async () => {
    const phone = await join(ROLE.PHONE)
    const viewer = await join(ROLE.VIEWER)
    phone.reset()
    phone.emit(EV.CONFIG_UPDATED)
    await assertGot(viewer, EV.CONFIG_UPDATED)   // đợi tới khi vòng lặp chắc chắn xong
    assert.strictEqual(phone.count(EV.CONFIG_UPDATED), 0)
  })
})
