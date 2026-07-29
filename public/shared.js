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

  const ROLE = { PHONE: 'phone', VIEWER: 'viewer' }

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
    // Phòng đã có phone khác giữ chỗ → phone vừa vào bị từ chối. Không có event
    // này thì hai phone cùng offer tới một viewer và âm thầm đá nhau.
    PHONE_BUSY: 'phone_busy',
    CONFIG_UPDATED: 'config_updated',
  }

  const RTC_CONFIG = { iceServers: [] }

  // Thứ tự hiển thị các slider trong panel hiệu ứng. Nhãn nằm ở i18n.js theo khoá
  // `filter.<tên>` — trước đây nhãn tiếng Việt nhúng cứng ở đây nên không dịch được.
  const FILTER_KEYS = ['brightness', 'contrast', 'saturate', 'hue', 'softness', 'grayscale', 'sepia', 'zoom']

  // Khoá đặt bằng tiếng Anh để làm định danh; tên hiển thị tra ở i18n theo
  // `preset.<khoá>`. Dùng tên tiếng Việt làm khoá thì đổi ngôn ngữ là mất preset.
  //
  // Preset cố ý KHÔNG đụng zoom (trừ 'none'): canh khung xong rồi đổi tông màu
  // thì không muốn khung nhảy lại.
  const FILTER_PRESETS = {
    none:     { brightness: 1, contrast: 1, saturate: 1, hue: 0, grayscale: 0, sepia: 0, softness: 0, zoom: 1 },
    warm:     { brightness: 1.05, contrast: 1.05, saturate: 1.15, hue: -8, grayscale: 0, sepia: 0.12, softness: 0 },
    cool:     { brightness: 1.02, contrast: 1.08, saturate: 0.95, hue: 10, grayscale: 0, sepia: 0, softness: 0 },
    cinema:   { brightness: 0.98, contrast: 1.25, saturate: 0.85, hue: -5, grayscale: 0, sepia: 0.08, softness: 0 },
    lowlight: { brightness: 1.3, contrast: 0.95, saturate: 1.1, hue: 0, grayscale: 0, sepia: 0, softness: 0.15 },
    smooth:   { brightness: 1.08, contrast: 0.97, saturate: 1.05, hue: -4, grayscale: 0, sepia: 0, softness: 0.45 },
    bw:       { brightness: 1.05, contrast: 1.15, saturate: 0, hue: 0, grayscale: 1, sepia: 0, softness: 0 },
  }

  // Độ phân giải dựng sẵn cho dropdown, liệt kê theo chiều ngang.
  //
  // Hai số này chỉ là gợi ý: khung hình ra dọc hay ngang phụ thuộc người dùng
  // cầm điện thoại thế nào, vì trình duyệt xoay theo hướng thiết bị. Cầm dọc mà
  // đặt 1280×720 thì vẫn nhận 720×1280 — không phải lỗi, và cũng không ép được
  // bằng cách đảo hai số. Muốn khung ngang thì xoay ngang máy, hoặc xoay hình
  // bằng nút 90° trên viewer.
  const RESOLUTIONS = [
    { w: 640,  h: 480,  label: '640 × 480 (VGA)' },
    { w: 854,  h: 480,  label: '854 × 480 (480p)' },
    { w: 1280, h: 720,  label: '1280 × 720 (HD 720p)' },
    { w: 1920, h: 1080, label: '1920 × 1080 (Full HD 1080p)' },
    { w: 2560, h: 1440, label: '2560 × 1440 (2K)' },
    { w: 3840, h: 2160, label: '3840 × 2160 (4K)' },
  ]

  // Trả về index trong RESOLUTIONS, hoặc -1 nếu là kích thước tự đặt
  function matchResolution(w, h) {
    return RESOLUTIONS.findIndex(r => r.w === Number(w) && r.h === Number(h))
  }

  // Bitrate cần cho một cấu hình, tính từ số pixel mỗi giây thay vì tra bảng —
  // như vậy kích thước tuỳ chỉnh và fps bất kỳ đều ra con số hợp lý.
  // ~0.1 bit/pixel/frame là mức H.264 cần để giữ chi tiết với nội dung camera
  // thường; làm tròn lên bội số 0.5 Mbps cho dễ đọc.
  function recommendedBitrate(width, height, frameRate) {
    const raw = Number(width) * Number(height) * Number(frameRate) * 0.1
    if (!Number.isFinite(raw) || raw <= 0) return 0
    // Làm tròn tới bội số 0.5 Mbps *gần nhất* chứ không làm tròn lên: 1080p ra
    // 6.22 Mbps, ép lên 6.5 thì con số không khớp mức nào trong dropdown và
    // người dùng phải nhảy hẳn lên 8. Chênh 3% so với ước lượng gốc là không
    // đáng kể — bản thân hệ số 0.1 bit/pixel vốn đã là con số kinh nghiệm.
    return Math.max(500000, Math.round(raw / 500000) * 500000)
  }

  function formatBitrate(bps) {
    const mbps = bps / 1000000
    return `${Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps`
  }

  // Trả về các con số cần cho câu cảnh báo bitrate, hoặc null nếu đang đủ.
  // Cố tình KHÔNG ghép sẵn thành câu: câu chữ nằm ở i18n (khoá `bitrate.low`),
  // còn phần tính toán thì server cũng dùng được vì không dính ngôn ngữ nào.
  function bitrateWarning(phone) {
    const need = recommendedBitrate(phone.width, phone.height, phone.frameRate)
    if (!need || Number(phone.maxBitrate) >= need) return null
    return {
      w: phone.width, h: phone.height, fps: phone.frameRate,
      need: formatBitrate(need),
      now: formatBitrate(Number(phone.maxBitrate)),
    }
  }

  // hue là độ, zoom là hệ số, còn lại quy về phần trăm cho dễ đọc
  function formatFilterValue(key, v) {
    if (key === 'hue') return `${v > 0 ? '+' : ''}${v}°`
    if (key === 'zoom') return `${Number(v).toFixed(2)}×`
    return `${Math.round(v * 100)}%`
  }

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

  return {
    ROOM, ROLE, EV, RTC_CONFIG,
    FILTER_KEYS, FILTER_PRESETS, formatFilterValue,
    RESOLUTIONS, matchResolution,
    recommendedBitrate, formatBitrate, bitrateWarning,
    fetchConfig, saveConfig,
  }
})
