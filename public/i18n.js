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
 * Version: 1.3.0
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

      // ── Màn hình điện thoại (scrcpy) ──
      'home.screen': 'Màn hình điện thoại',
      'home.screen.badge': 'Chỉ PC này',
      'home.screen.desc': 'Chiếu và điều khiển màn hình điện thoại bằng scrcpy.',
      'home.screen.hint': 'Cần cáp USB hoặc ADB không dây',
      'home.screen.open': 'Mở bảng điều khiển',
      'screen.title': 'Màn hình điện thoại',
      'screen.tagline': 'Chiếu màn hình điện thoại lên PC bằng scrcpy',
      'screen.missing.title': 'Chưa tìm thấy scrcpy hoặc adb',
      'screen.missing.desc': 'Cài scrcpy bằng lệnh dưới đây, rồi khởi động lại FaceCam Server (PATH chỉ được đọc lúc chương trình mở).',
      'screen.devices': 'Thiết bị',
      'screen.devices.refresh': 'Làm mới',
      'screen.devices.empty': 'Chưa thấy thiết bị nào.',
      'screen.devices.help.title': 'Chưa thấy máy?',
      'screen.devices.help.usb': 'Bật Gỡ lỗi USB trong Tuỳ chọn nhà phát triển.',
      'screen.devices.help.cable': 'Cắm cáp có truyền dữ liệu (không phải cáp chỉ sạc).',
      'screen.devices.help.allow': 'Bấm "Cho phép" trên điện thoại khi hộp thoại hiện ra.',
      'screen.devices.failed': 'Không đọc được danh sách thiết bị: {msg}',
      'screen.usb': 'USB',
      'screen.wifi': 'WiFi',
      'screen.state.device': 'Sẵn sàng',
      'screen.state.unauthorized': 'Chưa cấp quyền',
      'screen.state.offline': 'Ngoại tuyến',
      'screen.state.other': 'Trạng thái: {state}',
      'screen.stateHint.unauthorized': 'Bấm "Cho phép" trên điện thoại (nên tích "Luôn cho phép").',
      'screen.stateHint.offline': 'Rút cáp cắm lại, hoặc tắt rồi bật lại Gỡ lỗi USB.',
      'screen.info': 'Xem giải thích',
      'screen.wireless': '＋ Kết nối không dây',
      'screen.wireless.help': '1. Trên điện thoại: Tuỳ chọn nhà phát triển, Gỡ lỗi không dây, rồi chọn "Ghép nối thiết bị bằng mã ghép nối".\n2. Nhập IP:cổng ghép nối (vd 192.168.1.5:41234) và mã 6 số vào dòng Ghép nối. Chỉ cần làm một lần cho mỗi điện thoại.\n3. Nhập IP:cổng hiện ở màn hình Gỡ lỗi không dây (vd 192.168.1.5:37000) vào dòng Kết nối.\nWiFi công cộng thường chặn kiểu kết nối này — khi đó hãy dùng cáp USB.',
      'screen.pair.title': 'Ghép nối (một lần)',
      'screen.pair.hostPort': 'IP:cổng ghép nối',
      'screen.pair.code': 'Mã 6 số',
      'screen.pair.button': 'Ghép nối',
      'screen.pair.ok': 'Ghép nối thành công. Giờ nhập IP:cổng kết nối ở dưới rồi bấm Kết nối.',
      'screen.connect.title': 'Kết nối',
      'screen.connect.hostPort': 'IP:cổng kết nối',
      'screen.connect.button': 'Kết nối',
      'screen.connect.ok': 'Đã kết nối.',
      'screen.working': 'Đang xử lý...',
      'screen.err.NETWORK_BLOCKED': 'Mạng đang chặn các thiết bị kết nối với nhau, thường gặp ở WiFi công cộng. Hãy dùng cáp USB.',
      'screen.err.PORT_CLOSED': 'Sai cổng, hoặc đã đóng hộp thoại ghép nối trên điện thoại.',
      'screen.err.ADB_FAILED': 'adb báo lỗi: {msg}',
      'screen.err.VALIDATION': 'Dữ liệu không hợp lệ: {msg}',
      'screen.err.BUSY': 'Đang có một phiên chạy. Hãy dừng nó trước.',
      'screen.err.SCRCPY_NOT_FOUND': 'Chưa cài scrcpy hoặc adb.',
      'screen.err.network': 'Không gọi được server: {msg}',
      'screen.err.other': 'Lỗi: {msg}',
      'screen.mirror': 'Chiếu gì',
      'screen.source': 'Nguồn hình',
      'screen.source.display': 'Toàn màn hình',
      'screen.source.display.desc': 'Chiếu toàn bộ màn hình điện thoại.',
      'screen.source.app': 'Một ứng dụng',
      'screen.source.app.desc': 'Chạy ứng dụng trên màn hình ảo, điều khiển từ PC.',
      'screen.source.camera': 'Camera',
      'screen.source.camera.desc': 'Camera không tự xoay — dùng chế độ webcam ở trang chủ nếu cần tự xoay.',
      'screen.app': 'Ứng dụng',
      'screen.app.filter': 'Lọc theo tên...',
      'screen.app.loading': 'Đang tải danh sách ứng dụng (có thể mất vài giây)...',
      'screen.app.empty': 'Không có ứng dụng nào khớp.',
      'screen.app.failed': 'Không tải được danh sách ứng dụng: {msg}',
      'screen.app.system': 'hệ thống',
      'screen.app.chosen': 'Đã chọn: {name}',
      'screen.app.needDevice': 'Chọn một thiết bị trước.',
      'screen.audio': 'Âm thanh',
      'screen.audio.off': 'Tắt tiếng',
      'screen.audio.pc': 'Chỉ PC',
      'screen.audio.both': 'Cả PC và điện thoại',
      'screen.tip.audio': 'Chỉ PC: tiếng phát trên PC, điện thoại im lặng. Cả PC và điện thoại: cần Android 13 trở lên; một số ứng dụng chặn ghi âm nên có thể không có tiếng.',
      'screen.control': 'Điều khiển bằng chuột/phím',
      'screen.control.hint': 'Mặc định chỉ xem. Nếu bật mà máy từ chối, lỗi sẽ hiện ở dưới. Máy Xiaomi cần bật "Gỡ lỗi USB (Cài đặt bảo mật)" rồi khởi động lại.',
      'screen.control.appRequired': 'Chế độ một ứng dụng luôn bật điều khiển: ứng dụng chạy trên màn hình ảo, không hiện trên điện thoại nên chỉ thao tác được từ PC. Máy Xiaomi cần bật "Gỡ lỗi USB (Cài đặt bảo mật)" rồi khởi động lại.',
      'screen.rotation': 'Xoay hình',
      'screen.rotation.hint': 'Camera không tự xoay theo cách cầm máy — chọn góc cho đúng chiều. Muốn tự xoay, dùng chế độ webcam ở trang chủ.',
      'screen.quality': 'Chất lượng',
      'screen.quality.smooth': 'Mượt (1280, 4 Mbps)',
      'screen.quality.balanced': 'Cân bằng (1920, 8 Mbps)',
      'screen.quality.sharp': 'Nét (gốc, 16 Mbps)',
      'screen.tip.quality': 'Càng nét thì càng cần kết nối tốt. Nếu hình bị giật, hãy chọn mức thấp hơn.',
      'screen.fullscreen': 'Toàn màn hình',
      'screen.alwaysOnTop': 'Luôn nằm trên cùng',
      'screen.start': 'Bắt đầu chiếu',
      'screen.stop': 'Dừng',
      'screen.pickDevice': 'Chọn một thiết bị Sẵn sàng để bắt đầu.',
      'screen.shortcuts': '⌨ Phím tắt',
      'screen.shortcuts.intro': 'Bấm vào cửa sổ scrcpy trước, rồi dùng:',
      'screen.sc.rotate': 'Xoay 90°',
      'screen.sc.fullscreen': 'Bật/tắt toàn màn hình',
      'screen.sc.actual': 'Kích thước gốc 1:1',
      'screen.sc.borders': 'Bỏ viền đen',
      'screen.sc.screenOff': 'Tắt màn hình điện thoại (vẫn chiếu)',
      'screen.session.idle': 'Chưa chạy',
      'screen.session.running': 'Đang chiếu {serial}',
      'screen.session.exited': 'Đã dừng (mã thoát {code})',
      'screen.session.stopped': 'Đã dừng',
      'screen.hint.injectEvents': 'Muốn điều khiển: bật Gỡ lỗi USB (Cài đặt bảo mật) trong Tuỳ chọn nhà phát triển rồi khởi động lại điện thoại; hoặc tắt điều khiển.',
      'screen.hint.unauthorized': 'Điện thoại chưa cho phép máy này: bấm "Cho phép" trên màn hình điện thoại.',
      'screen.hint.deviceGone': 'Không tìm thấy thiết bị: kiểm tra cáp hoặc kết nối WiFi rồi thử lại.',
      'screen.log': 'Nhật ký scrcpy',
      'screen.log.empty': 'Chưa có dòng nào.',
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

      'home.screen': 'Phone screen',
      'home.screen.badge': 'This PC only',
      'home.screen.desc': 'Mirror and control your phone screen with scrcpy.',
      'home.screen.hint': 'Needs a USB cable or wireless ADB',
      'home.screen.open': 'Open control panel',
      'screen.title': 'Phone screen',
      'screen.tagline': 'Mirror your phone screen to this PC with scrcpy',
      'screen.missing.title': 'scrcpy or adb was not found',
      'screen.missing.desc': 'Install scrcpy with the command below, then restart FaceCam Server (PATH is only read when the program starts).',
      'screen.devices': 'Devices',
      'screen.devices.refresh': 'Refresh',
      'screen.devices.empty': 'No device found.',
      'screen.devices.help.title': "Can't see your phone?",
      'screen.devices.help.usb': 'Turn on USB debugging in Developer options.',
      'screen.devices.help.cable': 'Use a data cable (not a charge-only one).',
      'screen.devices.help.allow': 'Tap "Allow" on the phone when the prompt appears.',
      'screen.devices.failed': 'Could not read the device list: {msg}',
      'screen.usb': 'USB',
      'screen.wifi': 'WiFi',
      'screen.state.device': 'Ready',
      'screen.state.unauthorized': 'Not authorized',
      'screen.state.offline': 'Offline',
      'screen.state.other': 'State: {state}',
      'screen.stateHint.unauthorized': 'Tap "Allow" on the phone (tick "Always allow").',
      'screen.stateHint.offline': 'Unplug and replug the cable, or toggle USB debugging off and on.',
      'screen.info': 'Show explanation',
      'screen.wireless': '＋ Wireless connection',
      'screen.wireless.help': '1. On the phone: Developer options, Wireless debugging, then "Pair device with pairing code".\n2. Enter the pairing IP:port (e.g. 192.168.1.5:41234) and the 6-digit code in the Pair row. You only do this once per phone.\n3. Enter the IP:port shown on the Wireless debugging screen (e.g. 192.168.1.5:37000) in the Connect row.\nPublic WiFi often blocks this kind of connection — use a USB cable then.',
      'screen.pair.title': 'Pair (one time)',
      'screen.pair.hostPort': 'Pairing IP:port',
      'screen.pair.code': '6-digit code',
      'screen.pair.button': 'Pair',
      'screen.pair.ok': 'Paired. Now enter the connection IP:port below and press Connect.',
      'screen.connect.title': 'Connect',
      'screen.connect.hostPort': 'Connection IP:port',
      'screen.connect.button': 'Connect',
      'screen.connect.ok': 'Connected.',
      'screen.working': 'Working...',
      'screen.err.NETWORK_BLOCKED': 'The network is blocking devices from reaching each other, which is common on public WiFi. Use a USB cable instead.',
      'screen.err.PORT_CLOSED': 'Wrong port, or the pairing dialog on the phone was closed.',
      'screen.err.ADB_FAILED': 'adb reported an error: {msg}',
      'screen.err.VALIDATION': 'Invalid input: {msg}',
      'screen.err.BUSY': 'A session is already running. Stop it first.',
      'screen.err.SCRCPY_NOT_FOUND': 'scrcpy or adb is not installed.',
      'screen.err.network': 'Could not reach the server: {msg}',
      'screen.err.other': 'Error: {msg}',
      'screen.mirror': 'What to mirror',
      'screen.source': 'Video source',
      'screen.source.display': 'Whole screen',
      'screen.source.display.desc': 'Mirror the entire phone screen.',
      'screen.source.app': 'One app',
      'screen.source.app.desc': 'Runs the app on a virtual display, controlled from the PC.',
      'screen.source.camera': 'Camera',
      'screen.source.camera.desc': 'The camera does not auto-rotate — use webcam mode on the home page if you need that.',
      'screen.app': 'App',
      'screen.app.filter': 'Filter by name...',
      'screen.app.loading': 'Loading the app list (may take a few seconds)...',
      'screen.app.empty': 'No app matches.',
      'screen.app.failed': 'Could not load the app list: {msg}',
      'screen.app.system': 'system',
      'screen.app.chosen': 'Selected: {name}',
      'screen.app.needDevice': 'Select a device first.',
      'screen.audio': 'Audio',
      'screen.audio.off': 'Muted',
      'screen.audio.pc': 'PC only',
      'screen.audio.both': 'PC and phone',
      'screen.tip.audio': 'PC only: sound plays on the PC and the phone stays silent. PC and phone: needs Android 13 or newer; some apps block audio capture, so there may be no sound.',
      'screen.control': 'Mouse/keyboard control',
      'screen.control.hint': 'View-only by default. If you enable it and the phone refuses, an error appears below. Xiaomi phones need "USB debugging (Security settings)" and a reboot.',
      'screen.control.appRequired': 'Single-app mode always enables control: the app runs on a virtual display that is not shown on the phone, so you can only operate it from the PC. Xiaomi phones need "USB debugging (Security settings)" and a reboot.',
      'screen.rotation': 'Rotation',
      'screen.rotation.hint': 'The camera does not follow how you hold the phone — pick the angle that looks upright. For automatic rotation, use webcam mode on the home page.',
      'screen.quality': 'Quality',
      'screen.quality.smooth': 'Smooth (1280, 4 Mbps)',
      'screen.quality.balanced': 'Balanced (1920, 8 Mbps)',
      'screen.quality.sharp': 'Sharp (native, 16 Mbps)',
      'screen.tip.quality': 'Sharper needs a better connection. If the picture stutters, pick a lower level.',
      'screen.fullscreen': 'Fullscreen',
      'screen.alwaysOnTop': 'Always on top',
      'screen.start': 'Start mirroring',
      'screen.stop': 'Stop',
      'screen.pickDevice': 'Select a Ready device to start.',
      'screen.shortcuts': '⌨ Shortcuts',
      'screen.shortcuts.intro': 'Click the scrcpy window first, then use:',
      'screen.sc.rotate': 'Rotate 90°',
      'screen.sc.fullscreen': 'Toggle fullscreen',
      'screen.sc.actual': 'Actual size 1:1',
      'screen.sc.borders': 'Remove black borders',
      'screen.sc.screenOff': 'Turn off the phone screen (keeps mirroring)',
      'screen.session.idle': 'Not running',
      'screen.session.running': 'Mirroring {serial}',
      'screen.session.exited': 'Stopped (exit code {code})',
      'screen.session.stopped': 'Stopped',
      'screen.hint.injectEvents': 'To control the phone: turn on USB debugging (Security settings) in Developer options and restart the phone; or turn control off.',
      'screen.hint.unauthorized': 'The phone has not authorized this PC: tap "Allow" on the phone screen.',
      'screen.hint.deviceGone': 'Device not found: check the cable or WiFi connection and try again.',
      'screen.log': 'scrcpy log',
      'screen.log.empty': 'Nothing logged yet.',
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
    for (const el of scope.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel))
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
