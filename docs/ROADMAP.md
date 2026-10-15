<!--
  Mission: Lộ trình phát triển FaceCam Server — từ công cụ cá nhân thành project
           open-source người khác cài được, kèm các quyết định nền tảng và lý do.
  Author: DienJVo
  Version: 1.1.0
-->

# Lộ trình phát triển

> Bản tiếng Anh: [ROADMAP.en.md](ROADMAP.en.md)

Cập nhật: 2026-07-28

---

## 1. Định hướng

**FaceCam là project open-source miễn phí, không thương mại hoá.**

Quyết định này đã cân nhắc và loại bỏ hướng bán sản phẩm. Ghi lại lý do để sau
này không phải tranh luận lại:

- Đối thủ tốt đang **cho không**: EpocCam (Elgato) và Iriun đều miễn phí. Đáy giá
  của thị trường "kết nối phone vào PC làm webcam" đã về 0.
- Cạnh tranh trực diện đòi **virtual camera driver** — code native cho từng OS,
  cộng chi phí ký số định kỳ (~$250–500/năm Windows, $99/năm Apple). Đó là một
  sản phẩm khác, không phải một tính năng.
- Đối tượng dùng tool này là người **tự chạy được `npm start`** — đúng nhóm không
  trả tiền để khỏi phải chạy `npm start`.
- Code là JS chạy trong trình duyệt: không giấu được, không cưỡng chế license
  được. Mô hình open-core không khả thi về mặt kỹ thuật.

Đổi lại, project nhắm vào giá trị khác: làm hồ sơ năng lực kỹ thuật (WebRTC
signaling tự viết, xử lý mạng thật, auth, và `docs/FINDINGS-*` ghi lại lỗi kèm
nguyên nhân gốc), và làm công cụ dùng được cho người có nhu cầu thật.

## 2. Quyết định kiến trúc: media không đi qua server

Giữ nguyên mô hình hiện tại — **chạy hoàn toàn dưới máy người dùng**.

| Mức | Server làm gì | Media đi đâu | Chi phí |
|---|---|---|---|
| Hiện tại (`iceServers: []`) | Chỉ signaling (vài KB SDP/ICE) | Thẳng P2P, cùng LAN | 0 |
| + STUN | Cho mỗi bên biết IP public của mình | Vẫn thẳng, xuyên NAT | ~0 |
| + TURN | **Relay toàn bộ video** | Qua server | Cao: 4 Mbps × 2 chiều × giờ |

Use case tự nhiên là điện thoại và PC **cùng một mạng LAN**, nên host candidate
là đủ — không cần STUN, càng không cần TURN.

Đẩy media lên cloud sẽ: tốn băng thông (⇒ buộc phải thu tiền, mâu thuẫn mục 1),
tăng độ trễ, và mất đúng điểm mạnh "hình không rời khỏi mạng nội bộ".

## 3. Rào cản với người dùng phổ thông

Ba thứ chặn người không rành máy, xếp theo mức độ khó:

1. **Phải cài Node và gõ lệnh** — giải quyết được bằng đóng gói exe (G1).
2. **Cảnh báo cert HTTPS ở WiFi mode** — *không* giải quyết được bằng exe.
   Cảnh báo hiện trên **điện thoại**, không phải PC; app chạy trên PC có cài cert
   vào trust store của PC cũng vô nghĩa. Cài CA thủ công vào Android/iOS quá phức
   tạp cho người phổ thông.
3. **USB mode cần bật USB debugging** — ma sát một lần, hướng dẫn bằng ảnh được.

Đường đi khả thi: **ưu tiên USB mode**. `adb reverse` cho phone truy cập
`http://localhost`, mà localhost là secure context nên trình duyệt cho dùng
camera **không cần HTTPS**. WiFi mode giữ nguyên, ghi rõ là dành cho người rành máy.

## 4. Các giai đoạn

### Giai đoạn 0 — Dọn nhà và public repo

Không phụ thuộc quyết định nào ở trên; làm ngay cũng không phí.

Trạng thái: **xong** (2026-07-28), trừ ảnh demo và smoke test trên máy thật.

| Việc | Ghi chú |
|---|---|
| ~~Bỏ `control.html` + nút 🎛️ ở viewer~~ ✅ | Trùng lặp với panel hiệu ứng (viewer) và panel config (phone). Ba UI cho một config đã đẻ ra bug thật |
| ~~**Bug: mic câm**~~ ✅ | `phone.html` gửi audio track nhưng `viewer.html` để `<video muted>` cứng → bật mic tốn băng thông mà không ai nghe. Cần nút bật tiếng (autoplay policy chặn tự phát có tiếng); chỉ unmute lớp `video`, giữ `videoSoft` muted kẻo nghe đúp |
| ~~**Bug: hai phone tranh nhau**~~ ✅ | Server relay `VIEWER_REQUEST` cả phòng → hai phone cùng offer tới một viewer → viewer đóng/dựng lại pc liên tục, không báo lỗi. Cần từ chối phone thứ hai kèm lý do |
| ~~**Bug: thông báo không có công cụ đi kèm**~~ ✅ | "Đã lưu — bật lại camera để áp dụng" nhưng panel không có nút đó. `startStream()` đã tự `replaceTrack` cho mọi viewer → gọi thẳng là áp dụng được ngay, xoá luôn câu thông báo |
| ~~Trang 401 có ô nhập token~~ ✅ | Hiện là ngõ cụt: chữ đen nền trắng, token nằm ở terminal máy khác |
| ~~`LICENSE`~~ ✅ (MIT) | `package.json` khai ISC nhưng không có file. Repo không LICENSE = *all rights reserved*, không ai dùng hợp pháp được. **Việc quan trọng nhất, tốn 2 phút** |
| ~~Test vào `test/` + `npm test`~~ ✅ (72 test) | 30 test đang nằm trong thư mục temp, sẽ mất khi dọn máy |
| ~~CI chạy `node --test`~~ ✅ (Ubuntu/Windows × Node 22/24) | Badge xanh để người lạ dám tin |
| ~~`npm run init` chạy sạch trên máy lạ~~ ✅ | Xong — xem mục 4.1 |
| ~~**i18n UI**~~ ✅ · docs song ngữ | Xem mục 5 |
| Ảnh/GIF demo đầu README ⬜ | Không có thì không ai đọc tới dòng thứ hai |

Xong G0 là repo public được và người rành máy dùng được.

#### 4.1 Cert: đã làm (2026-07-28)

Thay `openssl` bằng **`node-forge`** trong `certs.js`. Ba lý do, xếp theo mức
quan trọng:

1. **Bỏ phụ thuộc binary ngoài.** Windows không có sẵn `openssl`; bản đóng gói
   exe ở G1 lại càng không thể yêu cầu người dùng tự cài. Đây là điều kiện cần
   cho G1 chứ không chỉ là dọn dẹp.
2. **Cert tự ký lại khi IP đổi.** Trước đây sinh một lần rồi thôi, nên đổi mạng
   là cert trỏ IP cũ mà không có gì báo. Giờ mỗi lần khởi động server so IP hiện
   tại với SAN, lệch thì ký lại (~100ms) và in rõ lý do.
3. **SAN chứa mọi IP LAN.** Máy cắm dây song song WiFi có hai địa chỉ và không
   đoán được phone tới bằng đường nào.

Key sinh bằng `crypto.generateKeyPairSync` (native) thay vì RSA thuần JS của
forge — nhanh hơn khoảng một bậc; forge chỉ dùng để dựng và ký X.509.

Ký lại cũng kích hoạt khi cert hỏng, hoặc còn dưới 30 ngày là hết hạn (đợi tới
đúng ngày thì trình duyệt chặn hẳn chứ không chỉ cảnh báo).

**Cố ý không làm mô hình CA riêng.** Đã cân nhắc: CA riêng cho từng máy + leaf
cert ký lại là cách duy nhất bỏ hẳn màn hình đỏ, nhưng đổi lại người dùng phải
cài CA vào điện thoại — Android cần 5 bước trong Settings và bắt đặt PIN khoá
màn hình, iOS cần cài profile *rồi* bật thêm một công tắc ở chỗ hoàn toàn khác
(`General → About → Certificate Trust Settings`), bước này rất hay bị bỏ sót.
Quá phiền so với giá trị, và vẫn không biến WiFi mode thành thứ dùng được cho
người phổ thông — USB mode mới là đường đó. Nếu sau này làm, bắt buộc sinh CA
riêng trên từng máy: nhúng CA dùng chung vào bản phát hành là lỗ hổng nghiêm
trọng (Lenovo Superfish, Dell eDellRoot).

### Ngoài lộ trình — Chiếu màn hình điện thoại qua scrcpy (2026-10-15)

Đã làm: trang điều khiển ở `127.0.0.1:7071` (`scrcpy.js`, `screen-control.js`,
`public/screen.html`), chỉ Android.

- **Vì sao scrcpy chứ không tự viết app Android:** trình duyệt trên điện thoại
  không có `getDisplayMedia` ổn định nên `phone.html` không chụp được màn hình.
  scrcpy là OSS, chạy cục bộ qua adb, không qua cloud — khớp mục 2.
- **Để sau:** tự kết nối qua mDNS + ghép đôi bằng QR (cần thử trên mạng không cách
  ly thiết bị); ghi file trực tiếp bằng `--record` (giữ độ phân giải gốc, không nén
  lại). Khi làm G1 "nhúng adb" thì cân nhắc nhúng luôn bản scrcpy (Apache 2.0) để
  hai tính năng dùng chung một adb.
- **Không làm:** tự xoay camera của scrcpy (scrcpy gửi khung gốc của cảm biến, muốn
  tự xoay thì dùng chế độ webcam); hiển thị scrcpy ngay trong trình duyệt (phải tự
  nói giao thức của scrcpy-server, dễ vỡ mỗi lần nâng phiên bản).

### Giai đoạn 1 — Một file exe

Bước biến nó thành thứ người thường xài được.

- Đóng gói bằng **Node SEA** (tính năng chính thức từ Node 20+) hoặc
  `bun build --compile`. *Không dùng `vercel/pkg` — đã ngừng phát triển.*
- Nhúng `adb` (Apache 2.0, phát hành lại được), tự dò phone cắm USB, tự chạy
  `adb reverse`.
- ~~Tự mở trình duyệt~~ ✅ (làm sớm ở G0); còn tự chọn port trống nếu bị chiếm.
- README ghi rõ: exe không ký nên Windows hiện SmartScreen. Ký sạch tốn
  $250–500/năm — với OSS free thì chấp nhận và hướng dẫn bấm "Run anyway".

Kết quả mong muốn: tải 1 file → chạy → cắm dây → quét QR → xong.

### Giai đoạn 2 — Bớt ma sát

Chỉ làm nếu G1 có người dùng thật.

- Tray icon, chạy nền, khởi động cùng máy.
- iOS qua USB (`libimobiledevice`) — khó hơn Android nhiều, không có `adb`.

### Giai đoạn 3 — Chỉ khi chứng minh được nhu cầu

Đừng đụng vào trước khi có số liệu người dùng thật.

- Virtual camera driver (Media Foundation trên Win11, DirectShow cho Win10,
  CoreMediaIO Camera Extension trên macOS).
- Hoặc domain thật kiểu Plex: `192-168-1-3.tenmien.com` trỏ về IP LAN + cert
  Let's Encrypt — giải quyết triệt để cảnh báo HTTPS, đổi lại cần hạ tầng và
  chi phí định kỳ.

## 5. Đa ngôn ngữ (i18n)

### UI

Hỗ trợ **tiếng Việt và tiếng Anh** cho cả ba trang (`index`, `phone`, `viewer`).

**Ngôn ngữ lưu ở `localStorage`, KHÔNG lưu vào `config.json`.**
`config.json` dùng chung cho mọi thiết bị — nhét ngôn ngữ vào đó thì người cầm
phone chọn tiếng Việt sẽ đổi luôn ngôn ngữ viewer của người khác. Ngôn ngữ là
lựa chọn của **từng máy**.

Cách làm:
- Bảng chuỗi + hàm `t(key)` đặt trong `public/shared.js` — đã là nguồn dùng chung
  cho cả server lẫn mọi trang client.
- Đánh dấu bằng `data-i18n` trên HTML, một hàm quét và thay khi tải trang.
- Mặc định dò `navigator.language`, cho đổi tay, ghi nhớ vào `localStorage`.
- Chuỗi trong `console.warn`/`console.error` **giữ nguyên tiếng Việt** — đó là
  log cho người phát triển, không phải giao diện người dùng.

### Docs

| Tài liệu | Tiếng Anh | Tiếng Việt |
|---|---|---|
| README | `README.md` | `README.vi.md` |
| Lộ trình | `ROADMAP.en.md` | `ROADMAP.md` |
| Rà soát kiến trúc | — | `ARCHITECTURE_AUDIT.md` |
| Nhật ký sửa lỗi | — | `FINDINGS-2026-07-27.md` |

`README.md` để **tiếng Anh** vì là cửa vào của repo public.

Bản rà soát kiến trúc và nhật ký sửa lỗi **chỉ có tiếng Việt**. Nhật ký sửa lỗi
vốn là loại tài liệu chỉ ghi thêm chứ không sửa lại, nên bản dịch sẽ lệch dần mà
không ai buồn đồng bộ. Bản rà soát có thể dịch sau nếu thật sự có người cần.

Dịch **cả loạt một lần** ở cuối G0, sau khi code đã chốt — dịch trước rồi sửa
code sẽ phải dịch lại.

## 6. Cố ý không làm

| Việc | Lý do |
|---|---|
| TURN / relay qua cloud | Đốt băng thông, buộc phải thu tiền, mất tính riêng tư. Xem mục 2 |
| Open-core, bản Pro có phí | Không cưỡng chế được license trên JS chạy ở trình duyệt. Xem mục 1 |
| Virtual camera driver ngay bây giờ | Nhiều tháng code native + chi phí ký số, trước khi biết có ai dùng không |
| Ký số exe | $250–500/năm cho một project miễn phí |
| Hỗ trợ nhiều phòng (room) cùng lúc | Hiện cố định một room. Chưa có nhu cầu thật |
