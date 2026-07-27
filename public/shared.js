/**
 * Mission: Hằng số signaling + helper config dùng chung cho server.js và cả 3 trang
 *   client. Trước đây tên event là magic string rải rác 4 file — gõ sai một chữ là
 *   fail im lặng, không có lỗi nào báo ra.
 * Author: DienJVo
 * Version: 1.0.0
 */
;(function (root, factory) {
  // UMD tối giản: server require được, browser thì gắn vào window.FaceCam
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.FaceCam = factory()
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const ROOM = 'facecam'

  const ROLE = { PHONE: 'phone', VIEWER: 'viewer', CONTROL: 'control' }

  const EV = {
    JOIN: 'join',
    // Viewer hỏi stream. Kèm from = socket.id của viewer để phone offer đích danh
    VIEWER_REQUEST: 'viewer_request',
    // Phone vừa vào phòng / vừa bật camera → viewer nghe được thì hỏi lại
    PHONE_READY: 'phone_ready',
    // SDP/ICE đều đi đích danh qua field `to`, không broadcast cả phòng nữa
    OFFER: 'offer',
    ANSWER: 'answer',
    ICE: 'ice',
    // Dọn dẹp: phone giữ một peer connection cho mỗi viewer nên cần biết ai rời đi
    VIEWER_LEFT: 'viewer_left',
    PHONE_DISCONNECTED: 'phone_disconnected',
    CONFIG_UPDATED: 'config_updated',
  }

  const RTC_CONFIG = { iceServers: [] }

  // Dưới đây chỉ client dùng (server không gọi) — fetch không tồn tại phía Node
  async function fetchConfig() {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`GET /api/config thất bại: ${res.status}`)
    return res.json()
  }

  async function saveConfig(patch) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(`POST /api/config thất bại: ${res.status}`)
    return res.json()
  }

  return { ROOM, ROLE, EV, RTC_CONFIG, fetchConfig, saveConfig }
})
