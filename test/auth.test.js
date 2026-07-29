/**
 * Mission: Kiểm lớp token — localhost được miễn, máy trong LAN phải có token, và
 *   trang 401 trả đúng định dạng theo đường dẫn. IP LAN tự dò chứ không hardcode:
 *   bản cũ ghi cứng địa chỉ nên đỏ mỗi lần máy đổi mạng, và mất thời gian mới
 *   nhận ra là test sai chứ không phải code sai.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')

const { startServer, connect } = require('./helpers.js')
const { listLocalIPs } = require('../network.js')

let server, lanIP

before(async () => {
  server = await startServer()
  lanIP = listLocalIPs()[0]?.address ?? null
})
after(async () => { await server.stop() })

/** Thử nối socket, trả 'connected' hoặc 'rejected' */
async function tryConnect(host, opts) {
  try {
    const c = connect(`http://${host}:${server.port}`, opts)
    await c.ready
    c.close()
    return 'connected'
  } catch {
    return 'rejected'
  }
}

describe('miễn trừ localhost', () => {
  // Cắm được dây USB vào máy thì đã có quyền vật lý rồi, và adb reverse cũng đi
  // qua localhost — bắt token ở đây chỉ làm phiền chứ không thêm an toàn
  test('localhost vào được không cần token', async () => {
    assert.strictEqual(await tryConnect('127.0.0.1'), 'connected')
  })

  test('localhost đọc được config không cần token', async () => {
    const res = await fetch(`${server.url}/api/config`)
    assert.strictEqual(res.status, 200)
  })
})

describe('máy trong LAN', { skip: !listLocalIPs().length && 'máy không có card mạng LAN' }, () => {
  test('không token thì bị chặn', async () => {
    assert.strictEqual(await tryConnect(lanIP), 'rejected')
  })

  test('token sai thì bị chặn', async () => {
    assert.strictEqual(await tryConnect(lanIP, { auth: 'deadbeefdeadbeefdeadbeefdeadbeef' }), 'rejected')
  })

  test('cookie đúng thì vào được', async () => {
    assert.strictEqual(await tryConnect(lanIP, { cookie: `fc_token=${server.token}` }), 'connected')
  })

  // Client không phải trình duyệt (không có cookie) vẫn phải vào được
  test('auth.token đúng thì vào được', async () => {
    assert.strictEqual(await tryConnect(lanIP, { auth: server.token }), 'connected')
  })

  // Chặn HTTP mà không chặn socket là vô nghĩa: client nối thẳng vào signaling
  // là xem được hình mà không cần qua trang nào
  test('chặn cả HTTP lẫn socket, không chỉ một bên', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/api/config`)
    assert.strictEqual(res.status, 401)
    assert.strictEqual(await tryConnect(lanIP), 'rejected')
  })
})

describe('trang 401', { skip: !listLocalIPs().length && 'máy không có card mạng LAN' }, () => {
  test('trang HTML có ô nhập token thay vì một dòng chữ cụt', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html`)
    assert.strictEqual(res.status, 401)
    assert.match(res.headers.get('content-type'), /text\/html/)

    const body = await res.text()
    assert.match(body, /<form method="get">/)
    assert.match(body, /name="t"/)
  })

  // fetch() mặc định gửi Accept: */*, mà */* khớp cả html — dựa vào Accept sẽ nhét
  // nguyên trang HTML vào chỗ code đang chờ JSON. Nên phải phân biệt theo đường dẫn.
  test('/api/ trả JSON chứ không trả HTML', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/api/config`)
    assert.strictEqual(res.status, 401)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.deepStrictEqual(await res.json(), { error: 'unauthorized' })
  })

  // Gõ tay trên điện thoại rất hay dính chữ hoa: bàn phím di động tự viết hoa ký
  // tự đầu và không phải bàn phím nào cũng tôn trọng autocapitalize. Trước đây
  // token hoa bị từ chối, nên trang 401 "không hoạt động trên điện thoại" trong
  // khi trên PC vẫn tốt.
  test('chấp nhận token viết hoa', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html?t=${server.token.toUpperCase()}`)
    assert.strictEqual(res.status, 200)
  })

  test('chấp nhận token có khoảng trắng thừa (dán từ clipboard)', async () => {
    const padded = encodeURIComponent(`  ${server.token}  `)
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html?t=${padded}`)
    assert.strictEqual(res.status, 200)
  })

  test('token sai vẫn bị chặn sau khi chuẩn hoá', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html?t=DEADBEEFDEADBEEFDEADBEEFDEADBEEF`)
    assert.strictEqual(res.status, 401)
  })

  // Ô nhập không được ràng buộc chỉ chữ thường, nếu không bàn phím viết hoa là
  // form từ chối submit với một tooltip rất mờ nhạt
  test('ô nhập token chấp nhận cả chữ hoa', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html`)
    const body = await res.text()
    assert.match(body, /pattern="[^"]*a-fA-F0-9/)
  })

  test('token đúng trên URL thì vào được và được set cookie', async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html?t=${server.token}`, {
      redirect: 'manual',
    })
    assert.strictEqual(res.status, 200)
    assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`fc_token=${server.token}`))
  })
})

describe('mở trình duyệt lúc khởi động', () => {
  // Test spawn server với stdio pipe → không phải TTY → không được mở gì. Thiếu
  // điều kiện này thì mỗi lần `npm test` sẽ bật thêm một loạt tab.
  test('không mở trình duyệt khi chạy không có terminal', () => {
    assert.ok(!server.logs().includes('[OPEN]'),
      'server đã mở trình duyệt trong lúc chạy test')
  })

  test('FACECAM_OPEN=0 cũng chặn được', async () => {
    const quiet = await startServer({ env: { FACECAM_OPEN: '0' } })
    try {
      assert.ok(!quiet.logs().includes('[OPEN]'))
    } finally {
      await quiet.stop()
    }
  })
})

describe('token trên đĩa', () => {
  test('giữ nguyên qua các lần khởi động', async () => {
    // Sinh token mới mỗi lần chạy sẽ làm URL trong OBS Browser Source hỏng sau
    // mỗi lần restart server
    const again = await startServer({ dataDir: server.dataDir })
    try {
      assert.strictEqual(again.token, server.token)
    } finally {
      await again.stop()   // dataDir dùng chung nên stop() chỉ tắt process
    }
  })

  test('token đúng định dạng 32 ký tự hex', () => {
    assert.match(server.token, /^[a-f0-9]{32}$/)
  })
})
