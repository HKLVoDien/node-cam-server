/**
 * Mission: Bảng chuỗi giao diện (vi/en) và hàm dịch cho cả ba trang client.
 *   Tách khỏi shared.js vì shared.js còn được server require, mà bảng chuỗi thì
 *   chỉ trình duyệt cần.
 *
 *   Ngôn ngữ lưu ở localStorage chứ KHÔNG lưu vào config.json: config dùng chung
 *   cho mọi thiết bị, nhét ngôn ngữ vào đó thì người cầm phone chọn tiếng Việt sẽ
 *   đổi luôn ngôn ngữ viewer của người khác.
 *
 *   Chuỗi trong console.warn/error cố ý giữ nguyên tiếng Việt — đó là log cho
 *   người phát triển, không phải giao diện người dùng.
 * Author: DienJVo
 * Version: 1.0.0
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.FaceCamI18N = factory()
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const LANGS = { vi: 'Tiếng Việt', en: 'English' }

  const STRINGS = {
    vi: {
      // ── Chung ──
      'app.name': 'FaceCam Server',
      'app.tagline': 'Biến điện thoại thành webcam qua WebRTC',
      'lang.label': 'Ngôn ngữ',

      // ── Trang chủ ──
      'home.running': 'Server đang chạy',
      'home.usb': 'Chế độ USB',
      'home.usb.badge': '✦ Khuyến nghị · Ổn định',
      'home.usb.hint': 'Cắm USB + ADB reverse',
      'home.wifi': 'Chế độ WiFi',
      'home.wifi.badge': 'Cùng mạng WiFi',
      'home.wifi.hint': 'Chấp nhận cảnh báo cert lần đầu',
      'home.openViewer': 'Mở Viewer (PC)',
      'home.openPhone': 'Mở trang điện thoại',
      'home.note.usb': 'USB:',
      'home.note.usbText': 'phone vào qua localhost nên camera chạy ngay, không cần HTTPS.',
      'home.note.wifi': 'WiFi:',
      'home.note.wifiText': 'không cần dây, đổi lại phải chấp nhận cert tự ký ở lần mở đầu tiên.',

      // ── Viewer ──
      'viewer.waiting': 'Chờ phone...',
      'viewer.streaming': 'Đang stream',
      'viewer.flipH': 'Lật ngang',
      'viewer.flipV': 'Lật dọc',
      'viewer.rotate': 'Xoay 90°',
      'viewer.fill': 'Lấp đầy',
      'viewer.fit': 'Vừa khung',
      'viewer.fitTitle': 'Lấp đầy màn hình (cắt rìa) ↔ vừa khung (thấy toàn bộ)',
      'viewer.effects': 'Hiệu ứng',
      'viewer.effectsTitle': 'Màu sắc, làm mịn, phóng to',
      'viewer.sound': 'Tiếng',
      'viewer.soundTitle': 'Nghe tiếng từ mic điện thoại',
      'viewer.hide': 'Ẩn thanh điều khiển (nhấp đúp để hiện lại)',
      'viewer.close': 'Đóng',
      'viewer.phoneLost': 'Phone mất kết nối — đang chờ',
      'viewer.handshakeError': 'Lỗi bắt tay — đang thử lại',
      'viewer.playbackStuck': 'Có luồng nhưng không phát được — thử bấm vào màn hình',
      'viewer.iceFailed': 'Không ghép được đường truyền (ICE failed) — hai máy có cùng mạng WiFi không?',
      'viewer.iceDisconnected': 'Đường truyền gián đoạn — đang chờ nối lại',
      'viewer.disconnected': 'Mất kết nối',

      // ── Bộ lọc hình ảnh ──
      'filter.brightness': 'Độ sáng',
      'filter.contrast': 'Tương phản',
      'filter.saturate': 'Bão hoà màu',
      'filter.hue': 'Tông màu',
      'filter.softness': 'Làm mịn',
      'filter.grayscale': 'Đen trắng',
      'filter.sepia': 'Ngả nâu',
      'filter.zoom': 'Phóng to',
      'preset.none': 'Gốc',
      'preset.warm': 'Ấm',
      'preset.cool': 'Lạnh',
      'preset.cinema': 'Điện ảnh',
      'preset.lowlight': 'Phòng tối',
      'preset.smooth': 'Mịn da',
      'preset.bw': 'Đen trắng',

      // ── Phone ──
      'phone.tagline': 'Dùng điện thoại làm webcam',
      'phone.start': 'Bật Camera',
      'phone.starting': 'Đang mở...',
      'phone.connecting': 'Đang kết nối...',
      'phone.pressToStart': 'Nhấn nút để bật camera',
      'phone.waitViewer': 'Chờ viewer kết nối...',
      'phone.streaming': 'Đang stream',
      'phone.streamingN': 'Đang stream ({n} viewer)',
      'phone.busy': 'Đã có điện thoại khác đang stream — đóng trang bên đó rồi tải lại trang này',
      'phone.busyBtn': 'Máy khác đang dùng',
      'phone.flipCam': 'Đổi cam',
      'phone.torch': 'Đèn',
      'phone.torchFailed': 'Không bật được đèn trên camera này',
      'phone.micSilent': 'Mic không thu được gì — app khác đang giữ mic?',
      'phone.settings': 'Cài đặt',
      'phone.applying': 'Đang áp dụng...',
      'phone.saved': 'Đã lưu',
      'phone.savedStart': 'Đã lưu — nhấn nút để bật camera',
      'phone.saveFailed': 'Lưu cấu hình thất bại: {msg}',
      'phone.reopenFailed': 'Đã lưu nhưng không mở lại được camera: {msg}',
      'phone.configLoadFailed': 'Không tải được cấu hình: {msg}',
      'phone.handshakeFailed': 'Bắt tay lỗi — thử bật lại camera',

      // ── Panel cấu hình ──
      'cfg.title': 'Cài đặt',
      'cfg.section.camera': 'Camera',
      'cfg.section.viewer': 'Viewer (PC)',
      'cfg.facing': 'Mặt camera',
      'cfg.facing.back': '📷 Sau',
      'cfg.facing.front': '🤳 Trước',
      'cfg.resolution': 'Độ phân giải',
      'cfg.resolution.hint': 'cao hơn thì cần bitrate cao hơn',
      'cfg.actualRes': 'Camera đang gửi:',
      'cfg.rotated': 'muốn khung ngang thì bật Tự động xoay rồi cầm ngang máy.',
      'cfg.resFallback': 'camera không có mức bạn chọn ({want}) nên đã dùng mức gần nhất.',
      'cfg.customSize': 'Kích thước riêng',
      'cfg.customSize.hint': 'rộng × cao, 160–4096',
      'cfg.frameRate': 'Tốc độ khung hình',
      'cfg.mic': 'Mic',
      'cfg.mic.hint': 'gửi kèm tiếng từ điện thoại',
      'cfg.bitrate': 'Bitrate',
      'cfg.bitrate.hint': 'cao thì nét hơn nhưng cần băng thông tốt',
      'cfg.customBitrate': 'Bitrate riêng',
      'cfg.customBitrate.hint': '0.5–30 Mbps',
      'cfg.flipH': 'Lật ngang',
      'cfg.flipV': 'Lật dọc',
      'cfg.rotation': 'Xoay',
      'cfg.hideControls': 'Ẩn thanh điều khiển',
      'cfg.hideControls.hint': 'trên viewer PC',
      'phone.hideOverlay': 'Ẩn',
      'phone.overlayHint': 'Chạm đúp vào màn hình để hiện lại',
      'cfg.save': 'Lưu & Áp dụng',
      'cfg.custom': 'Tuỳ chỉnh…',
      'cfg.on': 'Bật',
      'cfg.off': 'Tắt',
      'cfg.show': 'Hiện',
      'cfg.hide': 'Ẩn',

      // ── Trang 401 (server render, chọn theo Accept-Language) ──
      '401.title': 'FaceCam — Cần token',
      '401.heading': 'Cần token để vào',
      '401.desc': 'Token được in ở terminal nơi chạy server.',
      '401.desc2': 'Quét QR từ terminal thì vào thẳng, khỏi nhập.',
      '401.placeholder': '32 ký tự',
      '401.submit': 'Vào',

      // ── Bitrate ──
      // Chỉ những mức có chú thích mới cần khoá; 12/16/20/25 Mbps là con số thuần
      // nên để nguyên trong HTML
      'bitrate.tier.2': '2 Mbps (thấp)',
      'bitrate.tier.4': '4 Mbps (vừa)',
      'bitrate.tier.6': '6 Mbps (cao)',
      'bitrate.tier.8': '8 Mbps (rất cao)',
      'bitrate.low': '{w}×{h} @{fps}fps nên dùng từ {need} — đang đặt {now}, hình dễ bị bết.',
    },

    en: {
      'app.name': 'FaceCam Server',
      'app.tagline': 'Turn your phone into a webcam over WebRTC',
      'lang.label': 'Language',

      'home.running': 'Server running',
      'home.usb': 'USB mode',
      'home.usb.badge': '✦ Recommended · Stable',
      'home.usb.hint': 'USB cable + ADB reverse',
      'home.wifi': 'WiFi mode',
      'home.wifi.badge': 'Same WiFi network',
      'home.wifi.hint': 'Accept the certificate warning once',
      'home.openViewer': 'Open viewer (PC)',
      'home.openPhone': 'Open phone page',
      'home.note.usb': 'USB:',
      'home.note.usbText': 'the phone connects through localhost, so the camera works right away — no HTTPS needed.',
      'home.note.wifi': 'WiFi:',
      'home.note.wifiText': 'no cable, but you must accept the self-signed certificate the first time.',

      'viewer.waiting': 'Waiting for phone...',
      'viewer.streaming': 'Streaming',
      'viewer.flipH': 'Flip H',
      'viewer.flipV': 'Flip V',
      'viewer.rotate': 'Rotate 90°',
      'viewer.fill': 'Fill',
      'viewer.fit': 'Fit',
      'viewer.fitTitle': 'Fill the screen (crops edges) ↔ fit the frame (shows everything)',
      'viewer.effects': 'Effects',
      'viewer.effectsTitle': 'Colour, smoothing, zoom',
      'viewer.sound': 'Sound',
      'viewer.soundTitle': 'Listen to the phone microphone',
      'viewer.hide': 'Hide controls (double-click to bring them back)',
      'viewer.close': 'Close',
      'viewer.phoneLost': 'Phone disconnected — waiting',
      'viewer.handshakeError': 'Handshake failed — retrying',
      'viewer.playbackStuck': 'Stream received but not playing — try clicking the screen',
      'viewer.iceFailed': 'Could not establish a route (ICE failed) — are both devices on the same WiFi?',
      'viewer.iceDisconnected': 'Connection interrupted — reconnecting',
      'viewer.disconnected': 'Disconnected',

      'filter.brightness': 'Brightness',
      'filter.contrast': 'Contrast',
      'filter.saturate': 'Saturation',
      'filter.hue': 'Hue',
      'filter.softness': 'Smoothing',
      'filter.grayscale': 'Grayscale',
      'filter.sepia': 'Sepia',
      'filter.zoom': 'Zoom',
      'preset.none': 'Original',
      'preset.warm': 'Warm',
      'preset.cool': 'Cool',
      'preset.cinema': 'Cinematic',
      'preset.lowlight': 'Low light',
      'preset.smooth': 'Smooth skin',
      'preset.bw': 'Black & white',

      'phone.tagline': 'Use your phone as a webcam',
      'phone.start': 'Start camera',
      'phone.starting': 'Starting...',
      'phone.connecting': 'Connecting...',
      'phone.pressToStart': 'Tap the button to start the camera',
      'phone.waitViewer': 'Waiting for a viewer...',
      'phone.streaming': 'Streaming',
      'phone.streamingN': 'Streaming ({n} viewers)',
      'phone.busy': 'Another phone is already streaming — close that page, then reload this one',
      'phone.busyBtn': 'Another phone in use',
      'phone.flipCam': 'Switch cam',
      'phone.torch': 'Torch',
      'phone.torchFailed': 'This camera would not turn the torch on',
      'phone.micSilent': 'Microphone is picking up nothing — is another app using it?',
      'phone.settings': 'Settings',
      'phone.applying': 'Applying...',
      'phone.saved': 'Saved',
      'phone.savedStart': 'Saved — tap the button to start the camera',
      'phone.saveFailed': 'Could not save settings: {msg}',
      'phone.reopenFailed': 'Saved, but the camera would not restart: {msg}',
      'phone.configLoadFailed': 'Could not load settings: {msg}',
      'phone.handshakeFailed': 'Handshake failed — try restarting the camera',

      'cfg.title': 'Settings',
      'cfg.section.camera': 'Camera',
      'cfg.section.viewer': 'Viewer (PC)',
      'cfg.facing': 'Camera facing',
      'cfg.facing.back': '📷 Back',
      'cfg.facing.front': '🤳 Front',
      'cfg.resolution': 'Resolution',
      'cfg.resolution.hint': 'higher needs more bitrate',
      'cfg.actualRes': 'Camera is sending:',
      'cfg.rotated': 'for a landscape frame, turn on auto-rotate and hold the phone sideways.',
      'cfg.resFallback': 'the camera has no {want} mode, so it picked the closest one.',
      'cfg.customSize': 'Custom size',
      'cfg.customSize.hint': 'width × height, 160–4096',
      'cfg.frameRate': 'Frame rate',
      'cfg.mic': 'Microphone',
      'cfg.mic.hint': 'send audio from the phone',
      'cfg.bitrate': 'Bitrate',
      'cfg.bitrate.hint': 'higher is sharper but needs a good connection',
      'cfg.customBitrate': 'Custom bitrate',
      'cfg.customBitrate.hint': '0.5–30 Mbps',
      'cfg.flipH': 'Flip horizontally',
      'cfg.flipV': 'Flip vertically',
      'cfg.rotation': 'Rotation',
      'cfg.hideControls': 'Hide controls',
      'cfg.hideControls.hint': 'on the PC viewer',
      'phone.hideOverlay': 'Hide',
      'phone.overlayHint': 'Double-tap the screen to bring it back',
      'cfg.save': 'Save & apply',
      'cfg.custom': 'Custom…',
      'cfg.on': 'On',
      'cfg.off': 'Off',
      'cfg.show': 'Show',
      'cfg.hide': 'Hide',

      '401.title': 'FaceCam — Token required',
      '401.heading': 'A token is required',
      '401.desc': 'The token is printed in the terminal running the server.',
      '401.desc2': 'Scanning the QR code from the terminal gets you in without typing it.',
      '401.placeholder': '32 characters',
      '401.submit': 'Enter',

      'bitrate.tier.2': '2 Mbps (low)',
      'bitrate.tier.4': '4 Mbps (medium)',
      'bitrate.tier.6': '6 Mbps (high)',
      'bitrate.tier.8': '8 Mbps (very high)',
      'bitrate.low': '{w}×{h} @{fps}fps needs at least {need} — currently {now}, the image will look mushy.',
    },
  }

  const STORAGE_KEY = 'fc_lang'

  /**
   * Ngôn ngữ đang dùng: lựa chọn đã lưu → tiếng của trình duyệt → tiếng Anh.
   *
   * Đọc localStorage có thể ném lỗi khi cookie bị chặn hoàn toàn (Safari private
   * mode), nên phải bọc — hỏng chỗ này thì cả trang trắng.
   */
  function currentLang() {
    try {
      const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
      if (saved && STRINGS[saved]) return saved
    } catch { /* localStorage bị chặn — rơi về dò trình duyệt */ }
    const nav = globalThis.navigator?.language ?? 'en'
    return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en'
  }

  function setLang(lang) {
    if (!STRINGS[lang]) return
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang)
    } catch { /* không lưu được thì vẫn đổi cho phiên này */ }
    applyI18n()
  }

  /**
   * Dịch một khoá. Thiếu ở ngôn ngữ đang dùng thì lấy bản tiếng Anh, thiếu nốt
   * thì trả về chính khoá — hiện "phone.busy" trên màn hình vẫn hơn là chuỗi rỗng
   * không ai biết đang thiếu gì.
   *
   * @param {object} [params] thay {tên} trong chuỗi
   */
  function t(key, params) {
    const dict = STRINGS[currentLang()] ?? STRINGS.en
    let s = dict[key] ?? STRINGS.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
    }
    return s
  }

  /** Dịch mọi phần tử đánh dấu data-i18n trong DOM */
  function applyI18n(root) {
    const scope = root ?? globalThis.document
    if (!scope) return
    for (const el of scope.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
    for (const el of scope.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
    for (const el of scope.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder)
    if (globalThis.document) globalThis.document.documentElement.lang = currentLang()
    // Đồng bộ bộ chọn ngôn ngữ: setLang có thể được gọi từ nơi khác chứ không chỉ
    // từ chính dropdown, lúc đó dropdown sẽ hiện sai thứ đang dùng
    const picker = scope.querySelector?.('#langSelect')
    if (picker && picker.value !== currentLang()) picker.value = currentLang()
    // Cho phần JS dựng UI động (nút preset, nhãn slider, dòng trạng thái) biết mà vẽ lại
    globalThis.dispatchEvent?.(new Event('fc:langchange'))
  }

  return { LANGS, STRINGS, t, currentLang, setLang, applyI18n }
})
