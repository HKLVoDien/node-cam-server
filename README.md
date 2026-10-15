# FaceCam Server

Turn an Android phone or iPhone into a webcam over WebRTC — **nothing to install on the phone**, just open a browser. Around 50–100 ms latency on a LAN.

[Tiếng Việt](README.vi.md)

---

## Architecture

```
Phone (Brave/Chrome)          PC (Windows/macOS/Linux)
┌─────────────────┐          ┌──────────────────────────┐
│  phone.html     │          │  Node.js server          │
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

**The Node server only does signalling** (exchanging SDP/ICE). Video travels peer-to-peer between the phone and the PC — it never passes through the server.

**Same subnet only.** `iceServers` is empty (no STUN/TURN), so WebRTC can only pair using host candidates. The phone and the PC must be on the same LAN. It will not work when: the network has AP isolation enabled, the phone is on mobile data, the two devices are on different subnets, or a firewall blocks local UDP. This is deliberate — a LAN tool does not need STUN, and without STUN nothing leaks your IP to a third party.

**Multiple viewers at once:** the phone keeps a separate connection per viewer, so you can run a viewer window for framing *and* an OBS Browser Source at the same time. The cost is that the phone encodes several streams — it runs hotter and drains faster, so don't leave spare viewer tabs open.

---

## Requirements

- **Node.js 18+** to run the server (Node 22+ if you want to run `npm test`)
- OBS Studio (to expose a virtual camera)
- Android: Brave or Chrome | iPhone: Safari
- Same WiFi network, or a USB cable (recommended)

Nothing needs to be installed on the phone.

---

## Setup

```bash
git clone https://github.com/nguyenkhang-gif/node-cam-server.git
cd node-cam-server
npm install
npm run init
```

`npm run init` ([init.js](init.js)) will:
- install npm packages if they are missing
- generate a self-signed certificate (`cert.pem` / `key.pem`) covering every LAN address of the machine
- check for ADB (used by USB mode)

Then `npm start` and you are running.

> `config.json` is created by the server on first run — you don't need to write one.

**No `openssl` required.** Certificates are generated with [node-forge](https://www.npmjs.com/package/node-forge) inside Node, so this step behaves identically on Windows, macOS and Linux.

> `cert.pem` and `key.pem` are **not** committed (they're in `.gitignore`) — every clone generates its own. The certificate is only needed for **WiFi mode**; without it the server still runs fine and simply skips HTTPS.

### Certificates follow your IP

LAN addresses change constantly: DHCP hands out a new one after a few days, you move between networks, you plug in Ethernet alongside WiFi. A certificate is bound to specific addresses, so one generated once and never revisited will silently point at the wrong place.

On every start the server compares your current addresses against the ones in the certificate. If they differ it re-signs (~100 ms) and says why:

```
[CERT] Generated a new certificate — missing current IP 192.168.1.7 (certificate covers: 192.168.88.151)
```

It also re-signs when the certificate is unreadable, or has fewer than 30 days left. When nothing changed it leaves the certificate **alone** — re-signing for no reason would force you to accept a fresh warning on the phone every single time you start the server.

The certificate lists **all** of your LAN addresses at once, so a machine with both Ethernet and WiFi doesn't have to guess which one the phone will use.

### Installing ADB (optional)

Only needed for USB mode on Android:

- **Windows:** download [platform-tools](https://developer.android.com/studio/releases/platform-tools), extract it, and add the folder to your **PATH** (or call `adb.exe` by full path).
- **macOS:** `brew install android-platform-tools`

---

## Running

```bash
npm start        # normal
npm run dev      # restart on file changes
```

The home page at `http://localhost:7070` **opens automatically** in your default browser. The terminal also prints two QR codes — one for USB mode, one for WiFi mode (with the token already embedded).

Set `FACECAM_OPEN=0` if you'd rather it didn't. The server also skips this whenever its output isn't a terminal — running under CI, or `npm start > log.txt`.

Change ports with environment variables:

```bash
PORT=8080 HTTPS_PORT=8443 npm start
```

---

## Connecting the phone

### USB mode (recommended — works immediately, no HTTPS)

1. Enable **USB debugging** on the phone
2. Plug it in and accept the debugging prompt
3. On the PC:
   ```bash
   adb reverse tcp:7070 tcp:7070
   ```
4. On the phone open `http://localhost:7070/phone.html`
5. Tap **Start camera**

> USB mode goes through `localhost`, so **no token is required**.

### WiFi mode (no cable)

1. Phone and PC on the same WiFi
2. Scan the WiFi QR code from the terminal — the token is already in it
3. Tap **Advanced → Proceed** to get past the self-signed certificate warning
4. Tap **Start camera**

> **Why HTTPS is needed:** browsers only allow `getUserMedia()` (camera access) in a secure context. `localhost` is exempt, which is exactly why USB mode can use plain HTTP.

---

## Authentication

Both servers listen on `0.0.0.0`, so without this layer **anyone on your LAN could open `/viewer.html` and watch your camera**.

| Connecting from | Token needed? |
|---|---|
| `localhost` — viewer on the PC, OBS, USB mode (`adb reverse`) | ❌ No |
| Any other device on the LAN — phone over WiFi, tablet | ✅ Yes |

- The token is generated on first run, stored in `.token` (gitignored), and **survives restarts** — so the URL in your OBS Browser Source doesn't break every time you restart the server.
- The WiFi QR code already contains `?t=<token>`. Opening that link once sets a cookie, and every later page from that device is allowed through without a token.
- The terminal also prints a `viewer.html` link with the token, for opening on another LAN device.
- Arriving without a token is **not a dead end**: the 401 page has a token field, and submitting it takes you straight to the page you wanted. It picks English or Vietnamese from your browser's `Accept-Language`.
- **Rotating the token:** delete `.token` and restart. Remember to re-scan the QR code on the phone.
- The localhost exemption also requires a loopback `Host` header (`localhost`, `127.0.0.1` or `[::1]`). This stops a malicious website from reaching the server through DNS rebinding — such requests are treated like any other LAN device and need the token.

---

## OBS setup

1. Open OBS Studio
2. **Sources → + → Browser**
   - URL: `http://localhost:7070/viewer.html`
   - Width: `1280`
   - Height: `720`
   - Untick **"Shutdown source when not visible"**
3. Click **Start Virtual Camera**
4. Discord/Zoom → Settings → Camera → pick **OBS Virtual Camera**

---

## Configuration

`config.json` is **not in git** (the server writes to it at runtime) — it's created with defaults on first start.

**Viewer (PC)** — applies instantly:

| Option | Valid values | Description |
|---|---|---|
| `flipH` | `true/false` | Mirror horizontally |
| `flipV` | `true/false` | Mirror vertically |
| `rotation` | `0/90/180/270` | Rotate the video |
| `hideControls` | `true/false` | Hide the control bar |
| `fit` | `cover` / `contain` | Fill the screen (crops edges) or fit the frame (shows everything) |
| `filters.*` | see [Image effects](#image-effects) | Colour, smoothing, zoom |

**Phone camera** (`phone.*`) — resolution and frame rate are fixed when the camera opens, so changing them restarts the camera; `maxBitrate` applies immediately:

| Option | Valid values | Description |
|---|---|---|
| `facingMode` | `environment` / `user` | Rear / front camera |
| `width` | `160`–`4096` | Desired width in pixels |
| `height` | `160`–`4096` | Desired height in pixels |
| `frameRate` | `1`–`120` | Frames per second |
| `audio` | `true/false` | Also send the phone's microphone. Off by default |
| `maxBitrate` | `100000`–`30000000` | Bitrate ceiling in bits/s |

Pick a resolution from the preset dropdown (VGA → 4K) or choose **Custom…** to type your own. Same for bitrate.

> **Whether you get a portrait or landscape frame depends on how you hold the phone**, not on the numbers in the config. Ask for `1280×720` while holding the phone upright and you'll still get `720×1280` — the browser rotates with the device and treats those numbers as a hint. For a landscape frame, **turn the phone sideways before starting the camera**. If you have to hold it upright, use the **↻ 90°** button on the viewer to rotate the picture back.

### How much bitrate

Raising the resolution while keeping the same bitrate makes the picture **worse**, not better — the same bits now have to cover far more pixels. The app warns you when the two don't match:

> ⚠ 1920×1080 @30fps needs at least 6 Mbps — currently 4 Mbps, the image will look mushy.

| Resolution @30fps | Suggested bitrate |
|---|---|
| 640 × 480 | 1 Mbps |
| 1280 × 720 | 3 Mbps |
| 1920 × 1080 | 6 Mbps |
| 2560 × 1440 | 11 Mbps |
| 3840 × 2160 | 25 Mbps |

The figure comes from pixels per second (~0.1 bit/pixel/frame), so frame rate counts too: 1080p at 60fps needs 12.5 Mbps, not 6.

Out-of-range values are **rejected** by the server, which keeps the previous value rather than writing garbage.

Two places to change things, kept in sync automatically:
- **On the viewer** — flip/rotate/framing, plus the 🎨 Effects panel. **Double-click** the screen to bring the control bar back after hiding it
- **On the phone** — the quick bar (switch camera, torch, flip, rotate) and the ⚙️ Settings panel (resolution, frame rate, mic, bitrate)

Changing resolution or bitrate in Settings takes effect as soon as you tap **Save & apply** — you don't have to restart the camera yourself, and viewers already watching don't lose the picture.

---

## Camera controls on the phone

Beyond flip and rotate, the phone page can reach **real camera hardware features** — but each button only appears if the device reports support for it:

| Control | Shown when | Notes |
|---|---|---|
| 🔦 **Torch** | `getCapabilities().torch` | Most Android Chrome devices; front cameras usually not |
| 🔍 **Zoom** | `getCapabilities().zoom` | Slider appears above the quick bar |

> **No "beauty mode" or background replacement.** Browsers open the camera through the operating system, not through the manufacturer's Camera app — so the skin-smoothing, portrait and AI scene modes from Samsung/Xiaomi/OPPO are simply not reachable from the web. If you want them you have to process the image yourself (on the viewer via CSS filters or WebGL, or with OBS's own filters).

---

## Image effects

Click **🎨 Effects** on the viewer's control bar and a slider panel opens beside the video. Dragging a slider changes the picture **instantly, frame by frame**, so you can keep your eyes on the video while adjusting.

| Slider | Range | Use for |
|---|---|---|
| Brightness | 50–150% | Dark rooms, backlighting |
| Contrast | 50–150% | Flat, washed-out picture |
| Saturation | 0–200% | Pale skin, or oversaturated colour |
| Hue | −30°…+30° | Fluorescent colour cast (negative = warmer, positive = cooler) |
| Smoothing | 0–100% | Lays a soft blurred layer over the sharp one |
| Grayscale / Sepia | 0–100% | |
| Zoom | 1.00–3.00× | Crop tighter without touching the camera |

**One-tap presets:** Original · Warm · Cool · Cinematic · Low light · Smooth skin · Black & white.
Presets only change colour and **leave zoom alone** — once you've framed the shot, changing the look shouldn't move the frame.

Everything runs as CSS filters on the viewer, on the GPU. The phone keeps sending a clean stream, so:
- the phone doesn't get any hotter
- effects apply to every viewer and to the OBS Browser Source
- turning an effect off costs nothing — the original stream was never touched

> **What this approach can't do:** CSS filters always apply to the whole frame. "Smoothing" here is a soft glow, not a real bilateral filter, and it **cannot remove the background**. Both of those need per-frame WebGL/canvas processing — see R7 in [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md).

### Fill or fit

The **⛶ Fill / ⬒ Fit** button on the viewer:

| Mode | Result | Use when |
|---|---|---|
| **Fill** | Fills the whole screen, crops the edges | Feeding OBS, where you want no black bars |
| **Fit** | Shows the entire camera frame, adds black bars | Framing the shot, or when the aspect ratios don't match |

A 1280×720 source on a 1920×1080 screen gets scaled up 1.5× in Fill mode and loses about 25% of its height. If the picture looks soft, try Fit before reaching for a higher resolution.

---

## Live statistics

The viewer's control bar shows the `resolution · fps · bitrate` **actually being received**, updated every 2 seconds. These numbers are usually **lower** than what you configured, because WebRTC throttles itself when the network struggles — use them to decide whether to raise or lower the bitrate instead of guessing.

---

## Language

The interface is available in **English and Vietnamese**. It follows your browser by default; change it from the picker in the corner of the home page, on the viewer's control bar, or in the phone's Settings panel.

The choice lives in each device's `localStorage`, **not** in `config.json`. That way you can hold the phone in Vietnamese while a colleague's viewer stays in English — putting it in the shared config would make the two overwrite each other.

To add a language: copy one block of `STRINGS` in [public/i18n.js](public/i18n.js) and translate it. The picker builds itself from that list, so no HTML file needs touching. A test guards against the tables drifting apart.

---

## Development

```bash
npm test         # 72 tests, via node --test (Node 22+)
npm run dev      # restart on file changes
```

Tests spin up their own server on a free port and write data to a temporary directory — they **never touch** your real `config.json`, `.token` or `cert.pem`. Four groups: signalling (multi-viewer routing, spoofing, one-phone-per-room), certificates (SAN, re-signing), auth (tokens, the 401 page) and i18n (string tables), plus the LAN address selection logic.

CI runs on Ubuntu and Windows across Node 22 and 24.

| File | Role |
|---|---|
| [server.js](server.js) | HTTP/HTTPS, auth, config API, signalling |
| [certs.js](certs.js) | Certificate generation and upkeep |
| [network.js](network.js) | Picking a LAN address among several interfaces |
| [public/shared.js](public/shared.js) | Constants and helpers shared by server and clients |
| [public/i18n.js](public/i18n.js) | Interface string tables |

---

## Troubleshooting

### The phone says "Permission denied"

- Android: Settings → Apps → Brave → Permissions → Camera → Allow
- Then: Brave → 🔒 in the address bar → Site settings → Camera → Allow

### The phone says an overlay is blocking the camera

Some app is drawing over the screen. Turn off blue-light filters, Eye Comfort Shield, and accessibility overlays. To find the culprit:

```bash
adb shell dumpsys window windows | grep mAlertWindowSurfaces
```

### Viewer is black but says "Streaming"

The OBS Browser Source is being throttled. In its properties, untick **"Shutdown source when not visible"** and hit **Refresh**.

If it happens outside OBS, the status line now distinguishes two very different failures:

- *"Could not establish a route (ICE failed)"* — the two devices have no direct path. Different subnets, AP isolation, or you opened the viewer on the same phone that is sending.
- *"Stream received but not playing"* — the connection worked but playback didn't start. Usually autoplay policy; click the screen.

### The phone scans the WiFi QR code but can't reach the page

The QR code may carry the wrong address if the machine has several network interfaces (Docker, WSL, VirtualBox, VPN). Open `http://localhost:7070` on the PC — when more than one address exists, a dropdown appears under the WiFi QR code so you can pick the right one and regenerate it.

### The phone gets 401 Unauthorized

It reached the server without a token. Either scan the QR code from the terminal, or type the token into the field on the 401 page. The token is in `.token` and is printed at startup.

### The picture is portrait with black bars either side

The phone is being held upright. The browser rotates the frame with the device, so even with `1280×720` in the config the camera returns `720×1280` — swapping the numbers won't force it either.

Two options, best first:

1. **Unlock screen rotation, then turn the phone sideways and restart the camera.** The only way to get a genuine landscape frame at full resolution.
2. **Press ↻ 90° on the viewer** if you must hold it upright. The picture ends up the right way round, but the frame is still portrait, so OBS sees a sideways image inside a tall frame.

> **Do not lock screen rotation.** The browser has no idea which way the phone is physically held — it only reads `screen.orientation`. With rotation locked to portrait and the phone turned sideways, the sensor has rotated 90° but the browser still believes the device is upright, so it never compensates: the frame stays portrait **and everything in it lies on its side**. The stock camera app avoids this because it asks the accelerometer, not the screen.
>
> How to spot it: film something standing upright, such as a bottle. Held upright it stands; turned sideways it lies down. That is the moment to unlock rotation, or fall back to ↻ 90°.

### The picture looks soft

In order of impact:

1. **The viewer is upscaling.** A 1280×720 source on a 1080p screen is stretched 1.5×. Quick test: shrink the browser window — if it sharpens up, this is your answer. Switch to **⬒ Fit**, or raise the resolution.
2. **Bitrate too low for the resolution.** Watch the live statistics: if the received bitrate sits well below what you set, the network is the limit, not the setting.
3. **`cover` is cropping.** Fill mode throws away about 25% of the frame and enlarges the rest.
4. **The phone is picking a low sensor mode.** Some devices only offer high resolutions on the rear camera.
5. **Lighting.** In dim light the camera raises ISO, and noise eats the detail long before bitrate does.

### The picture is mirrored left–right

That is correct behaviour, not a bug. Your phone's front camera preview is mirrored — that's what makes it feel natural, like a mirror. The stream that gets *sent* is not mirrored, so the viewer shows what a person facing you would see: your raised left hand appears on the right.

Zoom and Meet do exactly the same thing — they mirror your self-view but send an unmirrored image to everyone else. If you want the viewer mirrored too, turn on **Flip H**.

### Video lags

- Lower the resolution or frame rate in the phone's Settings panel
- Prefer USB mode over WiFi
- Close spare viewer tabs — each one is another stream the phone has to encode

---

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 7070 | HTTP | USB mode, viewer on the PC, OBS |
| 7443 | HTTPS | WiFi mode (needs the certificate) |

Override with `PORT` and `HTTPS_PORT`.

---

## Documentation

- [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md) — current architecture, use cases, remaining risks *(Vietnamese)*
- [docs/ROADMAP.md](docs/ROADMAP.md) — direction and phases · [English](docs/ROADMAP.en.md)
- [docs/FINDINGS-2026-07-27.md](docs/FINDINGS-2026-07-27.md) — review log: what was found, why it was wrong, how it was fixed *(Vietnamese)*

---

## License

[MIT](LICENSE) © DienJVo
