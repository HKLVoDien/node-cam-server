/**
 * Mission: Kiểm bảng chuỗi và cơ chế dịch — hai ngôn ngữ không được lệch khoá,
 *   mọi khoá dùng trong HTML/JS phải tồn tại, và trang 401 phải theo
 *   Accept-Language. Lệch khoá là lỗi im lặng: người dùng chỉ thấy một chữ lạ
 *   nằm giữa giao diện chứ không có lỗi nào báo ra.
 * Author: DienJVo
 * Version: 1.0.0
 */
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { startServer } = require('./helpers.js')
const { STRINGS, t, currentLang } = require('../public/i18n.js')
const { FILTER_KEYS, FILTER_PRESETS } = require('../public/shared.js')

const PUBLIC = path.join(__dirname, '..', 'public')
const PAGES = ['index', 'viewer', 'phone']

/** Mọi khoá i18n xuất hiện trong một trang, bỏ qua khoá dựng động */
function keysUsedIn(html) {
  const keys = new Set()
  for (const m of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"${]+)"/g)) keys.add(m[1])
  for (const m of html.matchAll(/\bt\('([a-z][\w.]*)'/gi)) keys.add(m[1])
  // setStatus nhận thẳng khoá chứ không qua t()
  for (const m of html.matchAll(/setStatus\('([a-z][\w.]*)'/gi)) keys.add(m[1])
  for (const m of html.matchAll(/return '(viewer\.[\w.]+)'/g)) keys.add(m[1])
  return [...keys]
}

describe('bảng chuỗi', () => {
  test('hai ngôn ngữ có đúng cùng bộ khoá', () => {
    const vi = Object.keys(STRINGS.vi).sort()
    const en = Object.keys(STRINGS.en).sort()
    assert.deepStrictEqual(
      vi.filter(k => !en.includes(k)), [], 'có khoá chỉ tồn tại ở tiếng Việt')
    assert.deepStrictEqual(
      en.filter(k => !vi.includes(k)), [], 'có khoá chỉ tồn tại ở tiếng Anh')
  })

  test('không có chuỗi rỗng', () => {
    for (const [lang, dict] of Object.entries(STRINGS)) {
      for (const [key, val] of Object.entries(dict)) {
        assert.ok(String(val).trim().length, `${lang}.${key} rỗng`)
      }
    }
  })

  // Chuỗi có {tham số} mà hai bên khai khác nhau thì một bên sẽ hiện nguyên
  // dấu ngoặc trên màn hình
  test('cùng bộ tham số ở cả hai ngôn ngữ', () => {
    const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const key of Object.keys(STRINGS.vi)) {
      assert.deepStrictEqual(params(STRINGS.vi[key]), params(STRINGS.en[key]),
        `tham số của "${key}" lệch giữa hai ngôn ngữ`)
    }
  })
})

describe('khoá dùng trong giao diện', () => {
  for (const page of PAGES) {
    test(`${page}.html — mọi khoá đều có trong cả hai ngôn ngữ`, () => {
      const html = fs.readFileSync(path.join(PUBLIC, `${page}.html`), 'utf8')
      for (const key of keysUsedIn(html)) {
        assert.ok(key in STRINGS.vi, `${page}.html dùng "${key}" nhưng thiếu ở tiếng Việt`)
        assert.ok(key in STRINGS.en, `${page}.html dùng "${key}" nhưng thiếu ở tiếng Anh`)
      }
    })
  }

  // Nhãn slider và tên preset tra theo tiền tố + id, không viết cứng ở HTML nên
  // dễ quên khi thêm filter/preset mới
  test('mỗi filter và preset đều có nhãn', () => {
    for (const k of FILTER_KEYS) {
      assert.ok(`filter.${k}` in STRINGS.vi, `thiếu filter.${k} (vi)`)
      assert.ok(`filter.${k}` in STRINGS.en, `thiếu filter.${k} (en)`)
    }
    for (const p of Object.keys(FILTER_PRESETS)) {
      assert.ok(`preset.${p}` in STRINGS.vi, `thiếu preset.${p} (vi)`)
      assert.ok(`preset.${p}` in STRINGS.en, `thiếu preset.${p} (en)`)
    }
  })

  // Dùng tên tiếng Việt làm khoá preset thì đổi ngôn ngữ là mất preset
  test('khoá preset là định danh trung tính, không phải tên hiển thị', () => {
    for (const p of Object.keys(FILTER_PRESETS)) {
      assert.match(p, /^[a-z][a-z0-9]*$/, `khoá preset "${p}" phải là định danh ASCII`)
    }
  })

  test('không còn chuỗi tiếng Việt nào lọt trong nhãn giao diện', () => {
    const VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(PUBLIC, `${page}.html`), 'utf8')
      // Chỉ soát <option> vì đó là chỗ dễ quên nhất — nhãn nằm ngay trong thẻ,
      // không có gì nhắc là phải dịch
      for (const m of html.matchAll(/<option\b([^>]*)>([^<]+)<\/option>/g)) {
        const [, attrs, label] = m
        if (VIET.test(label) && !attrs.includes('data-i18n')) {
          assert.fail(`${page}.html: <option>${label}</option> chưa đánh dấu data-i18n`)
        }
      }
    }
  })
})

describe('t()', () => {
  test('thay tham số trong chuỗi', () => {
    const s = t('phone.streamingN', { n: 3 })
    assert.match(s, /3/)
    assert.ok(!s.includes('{n}'), 'còn sót dấu ngoặc tham số')
  })

  // Hiện đúng khoá vẫn hơn chuỗi rỗng: nhìn màn hình là biết ngay đang thiếu gì
  test('khoá không tồn tại thì trả về chính khoá', () => {
    assert.strictEqual(t('khong.ton.tai'), 'khong.ton.tai')
  })

  test('ở Node (không có localStorage/navigator) thì mặc định tiếng Anh', () => {
    assert.strictEqual(currentLang(), 'en')
  })
})

describe('trang 401 theo Accept-Language', () => {
  let server, lanIP

  before(async () => {
    server = await startServer()
    const { listLocalIPs } = require('../network.js')
    lanIP = listLocalIPs()[0]?.address
  })
  after(async () => { await server.stop() })

  const skipIfNoLan = { skip: !require('../network.js').listLocalIPs().length && 'không có card mạng LAN' }

  test('Accept-Language: vi → trang tiếng Việt', skipIfNoLan, async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html`, {
      headers: { 'Accept-Language': 'vi-VN,vi;q=0.9' },
    })
    const body = await res.text()
    assert.strictEqual(res.status, 401)
    assert.match(body, /<html lang="vi"/)
    assert.ok(body.includes(STRINGS.vi['401.heading']))
  })

  test('Accept-Language: en → trang tiếng Anh', skipIfNoLan, async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html`, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    })
    const body = await res.text()
    assert.match(body, /<html lang="en"/)
    assert.ok(body.includes(STRINGS.en['401.heading']))
  })

  // Không có header thì phải ra tiếng Anh chứ không được vỡ
  test('không có Accept-Language → tiếng Anh', skipIfNoLan, async () => {
    const res = await fetch(`http://${lanIP}:${server.port}/viewer.html`)
    const body = await res.text()
    assert.match(body, /<html lang="en"/)
  })
})
