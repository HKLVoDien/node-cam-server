<!--
  Mission: Development roadmap for FaceCam Server — from a personal tool to an
           open-source project other people can install, with the reasoning behind
           each foundational decision.
  Author: DienJVo
  Version: 1.1.0
-->

# Roadmap

> Vietnamese version: [ROADMAP.md](ROADMAP.md)

Updated: 2026-07-28

---

## 1. Direction

**FaceCam is a free open-source project. It is not being commercialised.**

The alternative — building it into a product to sell — was considered and rejected. Recording why, so it doesn't have to be argued again:

- The good competitors are **free**: EpocCam (Elgato) and Iriun both cost nothing. The floor price for "connect a phone to a PC as a webcam" is already zero.
- Competing head-on requires a **virtual camera driver** — native code per operating system, plus recurring code-signing costs (~$250–500/year on Windows, $99/year for Apple). That is a different product, not a feature.
- The people who would use this tool are the people who can **run `npm start` themselves** — precisely the group that won't pay to avoid running `npm start`.
- The code is JavaScript running in a browser: it can't be hidden and a licence can't be enforced. Open-core is not technically viable here.

The project aims at a different kind of value instead: a demonstration of engineering work (hand-written WebRTC signalling, real network handling, authentication, and `docs/FINDINGS-*` recording bugs with their root causes), and a tool that genuinely works for people who need it.

## 2. Architectural decision: media never passes through the server

Keep the current model — **everything runs on the user's own machine**.

| Level | What the server does | Where media goes | Cost |
|---|---|---|---|
| Today (`iceServers: []`) | Signalling only (a few KB of SDP/ICE) | Straight P2P, same LAN | 0 |
| + STUN | Tells each side its own public IP | Still direct, traverses NAT | ~0 |
| + TURN | **Relays the entire video** | Through the server | High: 4 Mbps × 2 directions × hours |

The natural use case is a phone and a PC **on the same LAN**, so host candidates are enough — no STUN needed, and certainly no TURN.

Pushing media through the cloud would burn bandwidth (⇒ forcing us to charge money, contradicting §1), add latency, and destroy the actual selling point: the image never leaves your network.

## 3. Barriers for non-technical users

Three things stand between the project and someone who isn't comfortable with a terminal, hardest last:

1. **Having to install Node and type commands** — solvable by shipping an executable (Phase 1).
2. **The HTTPS certificate warning in WiFi mode** — *not* solvable by shipping an executable. The warning appears on the **phone**, not on the PC; an app running on the PC installing a certificate into the PC's trust store achieves nothing. Installing a CA by hand on Android or iOS is far too fiddly for a general audience.
3. **USB mode needs USB debugging enabled** — one-time friction, and it can be documented with screenshots.

The workable path is to **favour USB mode**. `adb reverse` lets the phone reach `http://localhost`, and localhost is a secure context, so the browser grants camera access **without any HTTPS at all**. WiFi mode stays as it is, documented as the option for technical users.

## 4. Phases

### Phase 0 — Housekeeping and going public

Independent of every decision above; nothing here is wasted work.

Status: **done** (2026-07-28), apart from the demo image and a real-device smoke test.

| Task | Notes |
|---|---|
| ~~Remove `control.html` and its viewer button~~ ✅ | Duplicated the viewer's effects panel and the phone's config panel. Three interfaces for one config file, and that duplication had already produced real bugs |
| ~~**Bug: silent microphone**~~ ✅ | `phone.html` sent an audio track but `viewer.html` was hard-muted → enabling the mic cost bandwidth and nobody could hear it. Needs a button (autoplay policy blocks unmuted autoplay); only unmute the `video` layer, keep `videoSoft` muted or you hear it twice |
| ~~**Bug: two phones fighting over the room**~~ ✅ | The server relayed `VIEWER_REQUEST` to the whole room → both phones offered to the same viewer → the viewer tore down and rebuilt its connection repeatedly, with no error anywhere. The second phone must be rejected with a reason |
| ~~**Bug: a message telling users to do something with no way to do it**~~ ✅ | "Saved — restart the camera to apply" but the panel had no such button. `startStream()` already calls `replaceTrack` for every viewer, so calling it directly applies the change without dropping anyone |
| ~~Token field on the 401 page~~ ✅ | It was a dead end: black text on white, while the token sits in a terminal on another machine |
| ~~`LICENSE`~~ ✅ (MIT) | `package.json` declared ISC but no file existed. Without one the repository is *all rights reserved* — legally nobody may use it. **The single most valuable two minutes here** |
| ~~Tests into `test/` + `npm test`~~ ✅ (72 tests) | They were living in a temp directory and would vanish with the next disk cleanup |
| ~~CI running `node --test`~~ ✅ (Ubuntu/Windows × Node 22/24) | A green badge is what makes a stranger trust the repo |
| ~~`npm run init` works on a fresh machine~~ ✅ | See §4.1 |
| ~~**Interface i18n**~~ ✅ · bilingual docs | See §5 |
| Demo image/GIF at the top of the README ⬜ | Without one, nobody reads past the first line |

### 4.1 Certificates: done (2026-07-28)

`openssl` was replaced by **`node-forge`** in `certs.js`. Three reasons, most important first:

1. **No external binary.** Windows doesn't ship `openssl`, and a packaged executable in Phase 1 certainly cannot ask users to install it. This is a prerequisite for Phase 1, not just tidying up.
2. **Certificates re-sign themselves when the IP changes.** Previously generated once and forgotten, so switching networks left it pointing at a stale address with nothing to indicate why. Now every server start compares the current addresses against the certificate's SAN, re-signs when they differ (~100 ms), and prints the reason.
3. **The SAN lists every LAN address.** A machine with both Ethernet and WiFi has two, and there's no way to know which one the phone will use.

The key pair comes from `crypto.generateKeyPairSync` (native) rather than node-forge's pure-JS RSA — roughly an order of magnitude faster; forge only builds and signs the X.509 structure.

Re-signing also triggers when the certificate is unreadable, or has fewer than 30 days left (waiting for the actual expiry means the browser blocks outright rather than merely warning).

**Deliberately not building a private CA.** It was considered: a per-machine CA signing leaf certificates is the only way to eliminate the warning screen entirely. But it requires installing the CA on the phone — five steps buried in Android's Settings plus a mandatory screen lock PIN, or on iOS installing a profile *and then* flipping a separate switch in a completely different place (`General → About → Certificate Trust Settings`), a step that is very easily missed. Too much friction for the payoff, and it still wouldn't make WiFi mode usable for a general audience — USB mode is that path. Should this ever be built, the CA **must** be generated per machine: shipping a shared CA in a release is a serious vulnerability (Lenovo Superfish, Dell eDellRoot).

### Off-roadmap — Phone screen mirroring via scrcpy (2026-10-15)

Done: a control page at `127.0.0.1:7071` (`scrcpy.js`, `screen-control.js`, `public/screen.html`), Android only.

- **Why scrcpy rather than a custom Android app:** mobile browsers have no reliable `getDisplayMedia`, so `phone.html` cannot capture the screen. scrcpy is open source, runs locally over adb and never touches the cloud — consistent with section 2.
- **Later:** auto-connect via mDNS plus QR pairing (needs testing on a network without client isolation); direct recording with `--record` (original resolution, no re-encode). When Phase 1 embeds adb, consider shipping scrcpy (Apache 2.0) too so both features share one adb.
- **Not doing:** auto-rotating scrcpy's camera (scrcpy sends raw sensor frames — use webcam mode for automatic rotation); rendering scrcpy inside the browser (would mean speaking scrcpy-server's protocol ourselves, which breaks across versions).

### Phase 1 — A single executable

The step that makes this usable by ordinary people.

- Package with **Node SEA** (an official feature since Node 20) or `bun build --compile`. *Not `vercel/pkg` — it is no longer maintained.*
- Bundle `adb` (Apache 2.0, redistributable), detect a plugged-in phone, run `adb reverse` automatically.
- ~~Open the browser automatically~~ ✅ (landed early, in Phase 0); still to do: pick a free port if the default is taken.
- Document clearly that the executable is unsigned, so Windows will show SmartScreen. Signing properly costs $250–500/year — for a free project, accept it and explain how to click through.

Target experience: download one file → run it → plug in the cable → scan the QR code → done.

### Phase 2 — Reducing friction

Only worth doing if Phase 1 attracts real users.

- Tray icon, background operation, start with the system.
- iOS over USB (`libimobiledevice`) — considerably harder than Android, since there's no `adb`.

### Phase 3 — Only once demand is proven

Don't start any of this without real usage data.

- A virtual camera driver (Media Foundation on Windows 11, DirectShow for Windows 10, CoreMediaIO Camera Extension on macOS).
- Or real domains in the style of Plex: `192-168-1-3.example.com` resolving to a LAN address, with a genuine Let's Encrypt certificate — this eliminates the HTTPS warning completely, at the cost of running infrastructure and paying for it indefinitely.

## 5. Internationalisation

### Interface

**English and Vietnamese** across all three pages (`index`, `phone`, `viewer`).

**The language lives in `localStorage`, NOT in `config.json`.** That file is shared by every device — putting the language in it means whoever picks Vietnamese on the phone also changes someone else's viewer. Language is a per-device choice.

How it works:
- The string table and `t()` live in `public/i18n.js`. It uses the same UMD wrapper as `shared.js`, so the server can read it too — needed for rendering the 401 page.
- HTML is marked with `data-i18n`; one function walks the DOM and substitutes on load.
- The default follows `navigator.language`, can be overridden by hand, and is remembered in `localStorage`.
- Strings inside `console.warn`/`console.error` **stay in Vietnamese** — those are developer logs, not interface text.

Two things that only surfaced while building it:

- `applyI18n()` can only translate markup carrying `data-i18n`. Anything JavaScript writes — the status line, the fill/fit button label, the "Custom…" dropdown entry — has to redraw itself on the `fc:langchange` event.
- `setStatus()` takes a **key**, not a sentence, and remembers which key is showing. Otherwise switching language mid-session leaves a stale line in the previous language.

### Documentation

| Document | English | Vietnamese |
|---|---|---|
| README | `README.md` | `README.vi.md` |
| Roadmap | `ROADMAP.en.md` | `ROADMAP.md` |
| Architecture audit | — | `ARCHITECTURE_AUDIT.md` |
| Review log | — | `FINDINGS-2026-07-27.md` |

`README.md` is English because it's the front door of a public repository.

The audit and the review log stay Vietnamese-only. The review log in particular is append-only by nature — a translation would drift out of date and nobody would notice. The audit may get an English version if anyone actually asks.

## 6. Deliberately not doing

| Item | Reason |
|---|---|
| TURN / cloud relay | Burns bandwidth, forces monetisation, destroys the privacy story. See §2 |
| Open-core with a paid tier | A licence can't be enforced on JavaScript running in a browser. See §1 |
| A virtual camera driver right now | Months of native code plus signing costs, before knowing whether anyone uses this |
| Signing the executable | $250–500/year for a free project |
| Multiple simultaneous rooms | A single room is hardcoded. No real demand yet |
| Translating the review log | Append-only document; the translation would silently drift |
