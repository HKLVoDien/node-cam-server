# FaceCam Server

Biến điện thoại Android/iPhone thành webcam qua WebRTC, không cần cài app. Latency ~50-100ms trên LAN.

---

## Kiến trúc

```
Phone (Brave/Chrome)          PC (Windows/macOS/Linux)
┌─────────────────┐          ┌──────────────────────────┐
│  phone.html     │          │  Node.js Server          │
│  getUserMedia() │◄─────────│  - HTTP  :7070 (USB)     │
│  WebRTC sender  │  signal  │  - HTTPS :7443 (WiFi)    │
└────────┬────────┘          └──────────────────────────┘
         │ WebRTC P2P (video)          │
         ▼                             ▼
┌─────────────────┐          ┌──────────────────────────┐
│  viewer.html    │          │  OBS Studio              │
│  WebRTC receiver│          │  Browser Source          │
│  <video>        │─────────►│  Virtual Camera          │
└─────────────────┘          └──────────┬───────────────┘
                                        │
                                        ▼
                             Discord / Zoom / Meet
```

**Lưu ý quan trọng:** Node.js chỉ làm signaling (trao đổi SDP/ICE). Video truyền P2P trực tiếp giữa phone và PC — không đi qua server.

**Chỉ chạy trong cùng subnet.** `iceServers` để rỗng (không dùng STUN/TURN) nên WebRTC chỉ ghép được bằng host candidate. Phone và PC phải cùng một mạng LAN. Không hoạt động khi: mạng khách bật AP isolation, phone dùng 4G, hai bên khác subnet, hoặc firewall chặn UDP nội bộ. Đây là chủ ý — công cụ LAN không cần STUN, và không có STUN thì không rò rỉ IP ra ngoài.

**Nhiều viewer cùng lúc:** phone giữ một kết nối riêng cho mỗi viewer, nên mở song song viewer để canh chỉnh + OBS Browser Source đều chạy được. Đổi lại phone phải encode nhiều luồng → nóng máy và tốn pin hơn; đừng mở thừa tab viewer.

---

## Yêu cầu

- Node.js 16+
- OBS Studio (để tạo virtual camera)
- Android: Brave hoặc Chrome | iPhone: Safari
- Cùng mạng WiFi, hoặc cắm USB (khuyến nghị)

---

## Cài đặt (lần đầu)

### Cách nhanh nhất — `npm run init` (khuyến nghị, cả Windows lẫn macOS)

```bash
git clone https://github.com/nguyenkhang-gif/node-cam-server.git
cd node-cam-server
npm install
npm run init
```

`npm run init` ([init.js](init.js)) sẽ tự động:
- Cài npm packages nếu thiếu
- Tạo self-signed cert (`cert.pem` / `key.pem`) — tự nhận diện Windows và in hướng dẫn nếu thiếu `openssl`
- Tạo `config.json` mặc định nếu chưa có
- Kiểm tra ADB (cho USB mode)

Xong là chạy được: `npm start`.

> `cert.pem` và `key.pem` **không** commit vào git (có trong `.gitignore`) — mỗi máy clone về tự tạo. Cert chỉ cần cho **WiFi mode**; nếu chỉ dùng USB mode thì server vẫn chạy bình thường khi thiếu cert (HTTPS sẽ bị bỏ qua).

---

### Setup thủ công

Dùng khi `npm run init` báo lỗi (thường do thiếu `openssl` trên Windows).

**1. Cài dependencies** (cần Node.js 16+ từ https://nodejs.org):
```bash
npm install
```

**2. Tạo self-signed cert** (chỉ cần cho WiFi mode):

<details>
<summary><b>Windows</b></summary>

Cách đơn giản nhất — chạy trong **Git Bash** hoặc **WSL** (đã có sẵn `openssl`).
Thay `192.168.1.5` bằng IP LAN của máy bạn:
```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj '/CN=facecam' \
  -addext 'subjectAltName=IP:192.168.1.5,IP:127.0.0.1,DNS:facecam,DNS:localhost'
```

> **`MSYS_NO_PATHCONV=1` là bắt buộc trên Git Bash:** nếu không, Git Bash sẽ tưởng `/CN=facecam` là đường dẫn và đổi nó thành `C:/Program Files/Git/CN=facecam`, lệnh sẽ báo `subject name is expected to be in the format /type0=value0...`. WSL không cần biến này.

> **Bắt buộc có `-addext`:** Chrome bỏ qua trường `CN` từ bản 58, chỉ đọc `subjectAltName`. Cert thiếu SAN sẽ báo `ERR_CERT_COMMON_NAME_INVALID` và một số WebView không cho bỏ qua cảnh báo. `npm run init` tự điền IP giúp bạn.

Nếu chỉ có **PowerShell** (Win10/11) và không có `openssl`:
```powershell
$cert = New-SelfSignedCertificate -DnsName "facecam" -CertStoreLocation "cert:\LocalMachine\My" -NotAfter (Get-Date).AddDays(365)
$certPath = "Cert:\LocalMachine\My\$($cert.Thumbprint)"
$password = ConvertTo-SecureString -String "facecam" -Force -AsPlainText
Export-PfxCertificate -Cert $certPath -FilePath cert.pfx -Password $password
# Convert PFX → PEM (bước này vẫn cần openssl)
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem -passin pass:facecam
openssl pkcs12 -in cert.pfx -nokeys -out cert.pem -passin pass:facecam
```
</details>

<details>
<summary><b>macOS / Linux</b></summary>

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj '/CN=facecam' \
  -addext "subjectAltName=IP:$(ipconfig getifaddr en0),IP:127.0.0.1,DNS:facecam,DNS:localhost"
```
</details>

**3. (Tuỳ chọn) Cài ADB** — chỉ cần cho USB mode trên Android:

- **Windows:** tải [platform-tools](https://developer.android.com/studio/releases/platform-tools), giải nén → thêm thư mục vào **PATH** (hoặc gọi `adb.exe` bằng đường dẫn đầy đủ).
- **macOS:** `brew install android-platform-tools`

> Trên Windows lệnh ADB là `adb` / `adb.exe`, **không** dùng path macOS `~/Library/Android/sdk/platform-tools/adb`. Xem mục [Lệnh hữu ích (Windows)](#lệnh-hữu-ích-windows) ở cuối.

---

## Chạy server

```bash
npm start        # chạy bình thường
npm run dev      # tự restart khi sửa code (cần Node 18.11+)
```

Terminal sẽ hiện:
- QR code cho USB mode và WiFi mode
- URL viewer cho PC

Đổi port bằng biến môi trường nếu 7070/7443 đã bị chiếm:
```bash
PORT=8080 HTTPS_PORT=8443 npm start        # macOS/Linux/Git Bash
$env:PORT=8080; $env:HTTPS_PORT=8443; npm start   # PowerShell
```

---

## Kết nối phone

### USB mode (khuyến nghị — camera hoạt động ngay, không cần HTTPS)

1. Cắm USB phone vào PC
2. Bật **USB Debugging** trên Android: Settings → Developer Options → USB Debugging
3. Chạy ADB reverse:
   ```bash
   adb reverse tcp:7070 tcp:7070
   ```
4. Phone mở Brave/Chrome → gõ `http://localhost:7070/phone.html`
5. Bấm **▶ Bật Camera**

> USB mode đi qua `localhost` nên **không cần token**.

### WiFi mode (không cần dây)

1. Phone và PC cùng WiFi
2. Phone quét QR WiFi trong terminal — QR đã kèm sẵn token (xem mục dưới)
3. Bấm **Advanced → Proceed** để qua self-signed cert warning
4. Bấm **▶ Bật Camera**

> **Lý do cần HTTPS:** Browser chỉ cho phép `getUserMedia()` (camera) trên secure context. `localhost` được miễn trừ nên USB mode dùng HTTP bình thường.

---

## Xác thực (token)

Server listen trên `0.0.0.0`, nên nếu không có lớp này thì **bất kỳ ai cùng LAN mở `/viewer.html` là xem được camera của bạn**. Quy tắc:

| Truy cập từ | Cần token? |
|---|---|
| `localhost` — viewer trên PC, OBS, USB mode (`adb reverse`) | ❌ Không |
| Thiết bị khác trong LAN — phone qua WiFi, tablet | ✅ Có |

- Token sinh tự động ở lần chạy đầu, lưu vào `.token` (đã gitignore) và **giữ nguyên qua các lần restart** — nhờ vậy URL trong OBS Browser Source không bị hỏng mỗi lần khởi động lại server.
- QR WiFi trong terminal đã kèm sẵn `?t=<token>`. Vào lần đầu bằng link đó, server set cookie → các trang sau (`control.html`…) trên cùng máy đó không cần token nữa.
- Terminal cũng in sẵn link `control.html` kèm token để mở trên thiết bị LAN khác.
- **Đổi token:** xoá file `.token` rồi khởi động lại server. Nhớ quét lại QR trên phone.

---

## Setup OBS

1. Mở OBS Studio
2. **Nguồn → + → Trình duyệt**
   - URL: `http://localhost:7070/viewer.html`
   - Chiều rộng: `1280`
   - Chiều cao: `720`
   - Bỏ tick **"Tắt nguồn khi không hiển thị"**
3. Bấm **Bắt đầu máy quay ảo**
4. Discord/Zoom → Settings → Camera → chọn **OBS Virtual Camera**

---

## Cấu hình `config.json`

`config.json` **không nằm trong git** (đã gitignore vì server ghi vào nó lúc chạy) — server tự tạo với giá trị mặc định ở lần khởi động đầu tiên.

```json
{
  "flipH": false,
  "flipV": false,
  "rotation": 0,
  "hideControls": false,
  "phone": {
    "facingMode": "environment",
    "width": 1280,
    "height": 720,
    "frameRate": 30,
    "maxBitrate": 4000000
  }
}
```

**Viewer (PC)** — đồng bộ ngay lập tức:

| Option | Giá trị hợp lệ | Mô tả |
|---|---|---|
| `flipH` | `true/false` | Lật ngang |
| `flipV` | `true/false` | Lật dọc |
| `rotation` | `0/90/180/270` | Xoay video |
| `hideControls` | `true/false` | Ẩn thanh điều khiển |
| `fit` | `cover` / `contain` | Lấp đầy màn hình (cắt rìa) hay vừa khung (thấy hết) |
| `filters.*` | xem [Hiệu ứng hình ảnh](#hiệu-ứng-hình-ảnh) | Màu sắc, làm mịn, phóng to |

**Camera điện thoại** (`phone.*`) — chỉ áp dụng khi phone **tắt rồi bật lại camera**, vì độ phân giải được set lúc mở camera. Riêng `maxBitrate` áp dụng ngay:

| Option | Giá trị hợp lệ | Mô tả |
|---|---|---|
| `facingMode` | `environment` / `user` | Camera sau / trước |
| `width` | `160`–`4096` | Chiều rộng mong muốn (px) |
| `height` | `160`–`4096` | Chiều cao mong muốn (px) |
| `frameRate` | `1`–`120` | Khung hình/giây |
| `audio` | `true/false` | Gửi kèm mic của điện thoại. Mặc định tắt |
| `maxBitrate` | `100000`–`30000000` | Trần bitrate (bit/s). Cao = nét hơn, cần băng thông tốt |

Độ phân giải chọn từ dropdown dựng sẵn (VGA → 4K) hoặc **Tuỳ chỉnh…** để nhập kích thước riêng. Bitrate cũng vậy.

> Camera điện thoại luôn xuất theo chiều ngang của sensor rồi mới để phần mềm xoay, nên đặt số "dọc" (ví dụ `720×1080`) không có tác dụng như bạn nghĩ — máy vẫn trả về `1080×720`. Cứ đặt theo chiều ngang.

### Bitrate cần bao nhiêu

Chọn độ phân giải cao mà giữ nguyên bitrate thì hình **tệ hơn** lúc đầu — cùng ngần ấy bit phải trải cho nhiều pixel hơn. App tự cảnh báo khi phát hiện lệch:

> ⚠ 1920×1080 @30fps nên dùng từ 6 Mbps — đang đặt 4 Mbps, hình dễ bị bết.

| Độ phân giải @30fps | Bitrate nên dùng |
|---|---|
| 640 × 480 | 1 Mbps |
| 1280 × 720 | 3 Mbps |
| 1920 × 1080 | 6 Mbps |
| 2560 × 1440 | 11 Mbps |
| 3840 × 2160 | 25 Mbps |

Con số tính từ số pixel mỗi giây (~0.1 bit/pixel/frame) nên fps cũng được tính vào: 1080p ở 60fps cần 12.5 Mbps chứ không phải 6.

Giá trị ngoài dải sẽ bị server **từ chối** và giữ nguyên giá trị cũ.

Ba cách chỉnh, tất cả đều tự lưu và đồng bộ cho nhau:
- **`control.html`** — đầy đủ nhất, mở được trên điện thoại
- **Nút trên viewer** — flip/rotate nhanh. **Double click** lên màn hình để hiện lại controls khi đã ẩn
- **Quick bar trên phone** — flip cam, đèn, flip H/V, xoay, settings

---

## Điều khiển camera trên phone

Ngoài flip/xoay, trang phone còn chạm được vào **năng lực phần cứng thật** của camera — nhưng chỉ hiện nút khi máy báo là có hỗ trợ:

| Điều khiển | Hiện khi | Ghi chú |
|---|---|---|
| 🔦 **Đèn (torch)** | `getCapabilities().torch` | Android Chrome hầu hết có; camera trước thường không |
| 🔍 **Zoom** | `getCapabilities().zoom` | Thanh trượt hiện phía trên quick bar |

> **Không có "làm đẹp" / xoá phông.** Trình duyệt mở camera qua tầng hệ điều hành, không đi qua app Camera của hãng — nên các chế độ làm mịn da, chân dung, AI scene của Samsung/Xiaomi/OPPO đều không dùng được từ web. Muốn có thì phải tự xử lý ảnh (ở viewer bằng CSS filter / WebGL, hoặc dùng filter sẵn có của OBS).

---

## Hiệu ứng hình ảnh

Bấm **🎨 Hiệu ứng** trên thanh điều khiển của viewer → panel slider mở ra ngay cạnh khung hình. Kéo slider là hình đổi **tức thì từng frame**, mắt vẫn nhìn thẳng vào video mà chỉnh.

Cũng chỉnh được từ [control.html](public/control.html) (tiện khi cầm điện thoại chỉnh trong lúc ngồi trước camera) — hai nơi đồng bộ hai chiều.

| Slider | Dải | Dùng để |
|---|---|---|
| Độ sáng | 50–150% | Phòng tối, ngược sáng |
| Tương phản | 50–150% | Hình bị "đục", bệt |
| Bão hoà màu | 0–200% | Da nhợt nhạt, hoặc màu quá gắt |
| Tông màu | −30°…+30° | Ám vàng đèn tuýp (âm = ấm, dương = lạnh) |
| Làm mịn | 0–100% | Chồng một lớp mờ nhẹ lên bản sắc nét |
| Đen trắng / Ngả nâu | 0–100% | |
| Phóng to | 1.00–3.00× | Crop khung cho chặt hơn, không đụng tới camera |

**Preset một chạm:** Gốc · Ấm · Lạnh · Điện ảnh · Phòng tối · Mịn da · Đen trắng.
Preset chỉ đổi màu sắc, **giữ nguyên mức phóng to** — canh khung xong rồi đổi tông màu thì khung không nhảy.

### Khung hình: lấp đầy hay vừa khung

Nút **⛶ Lấp đầy / ⬒ Vừa khung** trên viewer:

| Chế độ | Kết quả | Dùng khi |
|---|---|---|
| **Lấp đầy** (`cover`) | Phủ kín màn hình, **cắt bớt rìa** | Thu vào OBS, không muốn viền đen |
| **Vừa khung** (`contain`) | Thấy **toàn bộ** khung camera, có viền đen | Canh khung, kiểm tra xem camera bắt được những gì |

Ở chế độ Lấp đầy, nguồn 1080×720 trên màn 1920×1080 bị phóng 1.78× và mất khoảng 25% chiều cao — nhìn kém nét hẳn. Nếu thấy hình "to quá" và mờ, thử chuyển sang Vừa khung.

**Xử lý ở viewer, không ở điện thoại.** Đây là chủ ý: PC khoẻ hơn, phone chỉ lo encode nên không nóng thêm, và OBS Browser Source render cả trang nên thấy kết quả miễn phí. Hệ quả: **preview trên điện thoại sẽ không hiện hiệu ứng** — chỉ viewer/OBS mới thấy.

> **Giới hạn của cách này:** CSS filter luôn áp cho **toàn khung hình**. "Làm mịn" ở đây là chồng lớp mờ (soft glow), không phải bilateral filter thật, và **không xoá được phông**. Muốn hai thứ đó cần xử lý bằng WebGL/canvas — xem R7 trong [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md).

---

## Thông số thực tế (viewer)

Thanh điều khiển của viewer hiện `độ phân giải · fps · bitrate` **đang thực sự nhận được**, cập nhật mỗi 2 giây. Con số này thường **thấp hơn** giá trị đặt trong config vì WebRTC tự bóp băng thông khi mạng yếu — dùng nó để biết có nên tăng/giảm bitrate hay không, thay vì chỉnh mò.

---

## Troubleshooting

### Phone báo "Permission denied"

- Android: Settings → Apps → Brave → Permissions → Camera → Allow
- Sau đó: Brave → 🔒 address bar → Site settings → Camera → Allow
- Nếu vẫn lỗi: bật flag `brave://flags/#unsafely-treat-insecure-origin-as-secure`

### Phone báo "Đóng mọi cửa sổ chú giải"

App overlay đang chặn camera. Tắt:
- Blue light filter / Eye comfort shield
- Accessibility overlay apps
- Chạy lệnh tìm overlay: `adb shell dumpsys window windows | grep mAlertWindowSurfaces`

### Viewer đen, status "Đang stream"

OBS Browser Source bị throttle. Trong Thuộc tính Browser Source:
- Bỏ tick **"Tắt nguồn khi không hiển thị"**
- Bấm **Làm mới**

### Không thấy OFFER trong log (không kết nối được)

Phone và viewer dùng 2 server khác nhau (HTTP vs HTTPS). Server đã có bridge tự động — chỉ cần restart server và kết nối lại.

### Phone quét QR WiFi nhưng không vào được trang

Thường do máy có nhiều card mạng (Docker, WSL, VirtualBox, VMware, VPN, hoặc cắm dây LAN song song WiFi) → server đoán nhầm IP và in QR trỏ vào card ảo mà phone không tới được.

- Terminal sẽ liệt kê **tất cả IP LAN** khi phát hiện nhiều hơn một (card ảo có ghi chú `(card ảo)`)
- Vào `http://localhost:7070` → chọn IP khác trong dropdown dưới QR WiFi → QR tự đổi theo

### Phone báo 401 Unauthorized

Thiết bị trong LAN cần token. Quét lại QR WiFi trong terminal (QR đã kèm token), hoặc copy URL đầy đủ mà terminal in ra. Xem mục [Xác thực (token)](#xác-thực-token).

### Hình không nét

Kiểm tra theo thứ tự tác động:

1. **Thu nhỏ cửa sổ viewer xuống nửa màn hình.** Nếu nét hẳn lên → nguyên nhân là ảnh bị phóng to, không phải chất lượng nguồn. Chuyển sang **⬒ Vừa khung** hoặc tăng độ phân giải.
2. **Đối chiếu bitrate với bảng ở trên.** Nếu app hiện cảnh báo vàng thì đó chính là vấn đề.
3. **Ánh sáng.** Thiếu sáng → camera đẩy ISO → nhiễu hạt → encoder tiêu bit cho nhiễu thay vì chi tiết. Thêm đèn thường hiệu quả hơn tăng bitrate.
4. **Khoảng lấy nét.** Camera điện thoại có khoảng tối thiểu; đặt vật quá gần là mờ đều dù thông số cao đến đâu. Lùi ra 30–40cm.
5. **OBS scale hai lần.** Đặt Browser Source đúng bằng kích thước canvas OBS, nếu không luồng bị phóng hai lần liên tiếp.

### Hình bị ngược trái–phải

Đây là hành vi **đúng**, không phải lỗi. Camera nhìn bạn như một người đứng đối diện, nên tay trái của bạn xuất hiện ở bên phải màn hình. `getUserMedia` không bao giờ tự lật ảnh.

Hiệu ứng gương (giơ tay trái thấy bên trái) là thứ Zoom/Meet thêm vào **preview của riêng bạn**, còn luồng gửi đi cho người khác thì vẫn không lật. FaceCam chỉ có một luồng nên mặc định để không lật — đúng cho người xem.

Muốn lật thì bấm **⇔ Flip H**, nhưng lưu ý mọi chữ trong khung hình sẽ bị ngược.

### Video lag

- Ưu tiên dùng WiFi 5GHz
- Tắt VPN
- Kiểm tra không có app nào khác đang dùng camera

---

## Lệnh hữu ích

### macOS / Linux

```bash
# Khởi động server
npm start

# Kill server
lsof -ti:7070,7443 | xargs kill -9

# ADB reverse (USB mode)
adb reverse tcp:7070 tcp:7070

# Xem camera đang được app nào giữ
adb shell dumpsys media.camera | grep -i "active\|connect"

# Tìm overlay app đang chặn camera
adb shell dumpsys window windows | grep mAlertWindowSurfaces
```

> Nếu `adb` chưa có trong PATH, dùng đường dẫn đầy đủ `~/Library/Android/sdk/platform-tools/adb`.

### Lệnh hữu ích (Windows)

```powershell
# Khởi động server
npm start

# Kill server (tìm PID rồi kill)
netstat -ano | findstr "7070 7443"
taskkill /PID <pid> /F

# ADB reverse (USB mode) — adb đã có trong PATH
adb reverse tcp:7070 tcp:7070

# Xem camera đang được app nào giữ
adb shell dumpsys media.camera | findstr /i "active connect"

# Tìm overlay app đang chặn camera
adb shell dumpsys window windows | findstr mAlertWindowSurfaces
```

---

## Changelog

### 2026-07-28
- **Panel hiệu ứng ngay trên viewer** (🎨) — kéo slider thấy đổi tức thì, không phải mở tab khác
- **Chọn khung hình** lấp đầy ↔ vừa khung, xử lý việc `cover` cắt mất ~25% khung và phóng to làm mất nét
- **Dropdown độ phân giải** dựng sẵn VGA → 4K, kèm mục Tuỳ chỉnh; bitrate cũng vậy
- **Cảnh báo bitrate** khi độ phân giải cao mà băng thông không đủ; trần nâng 20 → 30 Mbps để 4K đạt được mức đề xuất
- Sửa dropdown chữ trắng trên nền trắng (`color-scheme: dark`) — ảnh hưởng mọi `<select>` trong app
- Sửa thanh trạng thái viewer hiện thừa một chấm xanh
- Thông báo lỗi kết nối phân biệt ICE thất bại với "có luồng nhưng không phát được"

### 2026-07-27
**Sửa lỗi**
- Viewer tự phục hồi khi phone rớt rồi kết nối lại (trước đây phải F5 thủ công)
- `phone_disconnected` chỉ bắn khi đúng phone rớt — viewer đóng tab không còn làm viewer khác báo mất kết nối
- Dropdown chọn camera trên phone giờ hiện đúng tên (trước đây luôn rỗng do đọc trước khi được cấp quyền)
- ICE candidate được xếp hàng thay vì ném lỗi khi tới trước SDP
- Không dựng lại peer connection khi đang bắt tay → hết tình trạng không kết nối được trên mạng chậm
- Xoay 90°/270° trên viewer không còn méo/crop hình
- Ghi `config.json` atomic, giá trị sai kiểu hoặc ngoài dải bị từ chối thay vì ghi đè
- Port bận báo lỗi rõ ràng thay vì stack trace

**Bảo mật**
- Thiết bị trong LAN cần token để truy cập (localhost được miễn); token lưu `.token`, giữ nguyên qua các lần restart
- Cert tạo bởi `npm run init` có `subjectAltName` — cảnh báo nếu cert cũ thiếu SAN hoặc lệch IP

**Tính năng mới**
- **Nhiều viewer cùng lúc** — phone giữ một kết nối riêng cho mỗi viewer (trước đây viewer thứ 2 làm hỏng viewer thứ 1)
- **Mic** — tuỳ chọn gửi kèm tiếng từ điện thoại (mặc định tắt)
- **Đèn flash + zoom** trên phone, tự ẩn nếu camera không hỗ trợ
- **Thông số thực tế** trên viewer: độ phân giải · fps · bitrate đang nhận, cập nhật mỗi 2s
- **ICE restart** — thử phục hồi kết nối khi đổi mạng trước khi bỏ hẳn

**Khác**
- `config.json` bỏ khỏi git, server tự tạo khi thiếu
- Chọn IP LAN trên trang chủ khi máy có nhiều card mạng
- Đổi port bằng `PORT` / `HTTPS_PORT`; graceful shutdown khi Ctrl+C; thêm `npm run dev`
- Tên event signaling gom về `public/shared.js`, dùng chung server và client

### 2026-06-18
- Thêm quick bar ở phone: flip cam, flip H/V, xoay, settings
- Config viewer (flip/rotation/hideControls) có thể chỉnh từ phone
- `config_updated` event sync viewer realtime khi phone lưu config
- Auto-reconnect viewer nếu phone join muộn hơn
- Log disconnect reason + notify viewer khi phone mất kết nối

### 2026-06-17
- Khởi tạo project
- WebRTC P2P signaling qua Socket.io
- Dual server: HTTP :7070 (USB) + HTTPS :7443 (WiFi)
- ADB reverse cho USB mode (localhost = secure context)
- `config.json` cho flip/rotation/hideControls/phone camera settings
- QR code terminal + trang index với QR
- Viewer: flip H, flip V, rotate 90°, double click hiện controls
- OBS Browser Source integration
- keepAlive: WebGL loop + Wake Lock + silent audio

## Ports

| Port | Protocol | Dùng cho |
|---|---|---|
| 7070 | HTTP | USB mode, Viewer PC |
| 7443 | HTTPS | WiFi mode |

---

## Tài liệu kỹ thuật

| File | Nội dung |
|---|---|
| [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md) | Kiến trúc **hiện tại**: module, protocol signaling, use-case, rủi ro còn lại, sơ đồ luồng |
| [docs/FINDINGS-2026-07-27.md](docs/FINDINGS-2026-07-27.md) | Nhật ký rà soát 2026-07-27: từng lỗi đã sửa, nguyên nhân gốc, cách kiểm chứng |
