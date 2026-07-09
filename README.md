# BotPilot

Remote companion client for **BotMaker Studio**. It shows a live preview of the running bot and can
start / stop / pause / resume it, from a browser or an installable Android app. The **default** path is over
your [Tailscale](https://tailscale.com) tailnet — the phone runs Tailscale signed into the same account (zero
computer-side setup, nothing exposed publicly). Reaching the bot from **anywhere with no VPN on the phone** is
an optional "Advanced" step in Studio that turns on Tailscale **Funnel** (public HTTPS); a plain-`ws://` LAN
bind is the last-resort fallback.

BotPilot is the client half; the server half lives in **BotMaker Studio** (`services/pilot/PilotServer`),
which serves this UI over HTTP and speaks a WebSocket protocol carrying:

- **binary** frames — JPEG bytes of the bot's target surface (loss-tolerant, ~10–30 FPS)
- **text** messages — telemetry events (JSON) server→client, and control commands (JSON) client→server

## Layout

```
botmaker-pilot/
├── web/       Vite + React + TypeScript — the single-source-of-truth UI (browser + PWA)
├── android/   Capacitor Android project — wraps web/dist into an installable APK
└── capacitor.config.ts
```

The same `web/` build is served two ways: directly by Studio for browsers, and bundled into the APK by
Capacitor for a native mobile app.

### Pairing & updates

- **Pairing by QR scan.** The connect screen has a **📷 Scan QR** button (`web/src/QrScanner.tsx`): it opens
  the rear camera via **ZXing** (`@zxing/browser`, `BrowserQRCodeReader.decodeFromConstraints` with continuous
  autofocus) — a robust continuous-decode loop that stays smooth while the camera moves toward the code — and
  decodes Studio's **left** pairing QR straight into `parseUrl` → connect. No URL typing, no registration. Pasting a URL still works as a fallback. The APK
  declares `CAMERA` (see `AndroidManifest.xml`) and requests it on launch (`MainActivity`) so the WebView
  camera is grantable. The scanner **re-initializes on resume** (`visibilitychange`/focus): backgrounding the
  app (e.g. opening the native camera) suspends the camera track, so it re-acquires a fresh one on return
  instead of showing a frozen/black frame.
- **Connection history & reconnect.** Endpoints are remembered as a list (`web/src/config.ts`,
  `botpilot.connections`, migrated from the old single-endpoint key). The connect screen shows a **Recent
  connections** list — tap to reconnect without rescanning (Studio now keeps a **stable pairing token**, so a
  saved connection stays valid across Studio restarts). When a socket is stuck reconnecting, a **Switch
  connection** overlay returns to the list without dropping the saved entry.
- **In-app auto-update.** On launch the app best-effort checks the latest GitHub release
  (`web/src/useAppUpdate.ts`, throttled) and, if newer than the built-in `__APP_VERSION__` (injected from
  `web/package.json`), shows an **Update available** banner linking to the stable
  `releases/latest/download/botpilot.apk`. The connect-screen footer also shows the current version and a
  **Check for updates** button (force-checks, ignoring the throttle). Keep `web/package.json`'s `version` in
  step with the release tags.

## Building

```bash
# Web UI (browser + PWA)
cd web && npm ci && npm run build      # → web/dist
#   dev loop: npm run dev

# Android APK (from the pilot root)
npm ci                                 # Capacitor CLI + native deps
npm run dist                           # web build → cap sync → assembleDebug, in one step
#   → android/app/build/outputs/apk/debug/app-debug.apk
#   (granular steps: npm run build:web / npx cap sync android / npm run apk)
```

Studio serves the web UI itself: a prebuilt `dist` is committed under
`botmaker-studio/src/main/resources/pilot/`, and `mvn -Ppilot package` in Studio rebuilds it from this
`web/` source (downloading a project-local Node — nothing installed system-wide).

The APK bundles `web/dist` locally and loads it from the `https://localhost` WebView origin. On the default
(tailnet) path it connects out to Studio over plain `ws://` to the Tailscale `100.x` IP (the tailnet itself is
the encryption), which is why `server.cleartext` is enabled in `capacitor.config.ts`. On the optional Funnel
path it instead connects over `wss://` — real TLS on a public `*.ts.net` host.

## Remote access over HTTPS (Tailscale Funnel)

To reach the bot from anywhere over **real, browser-trusted HTTPS**, Studio (**View ▸ Enable Remote Pilot…**)
asks the local `tailscale` daemon to expose its loopback pilot port publicly as
`https://<machine>.<tailnet>.ts.net`. The phone then just opens that URL in **any browser — no Tailscale, no
VPN** — or installs the APK and pairs with it. The dialog shows a QR to scan.

One-time machine/admin setup (the phone needs nothing):

1. Install Tailscale on the Studio machine and log in.
2. Enable **HTTPS certificates** for the tailnet (Tailscale admin ▸ DNS).
3. Grant the **`funnel`** node-attribute in the tailnet ACL policy, e.g.:
   ```jsonc
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
   ```
4. Let your user manage Funnel without root (Studio runs as you, not root) — once:
   ```bash
   sudo tailscale set --operator=$USER
   ```

If Funnel isn't available/enabled, Studio surfaces the reason (including Tailscale's own "run `sudo tailscale
set --operator=$USER`" hint when that's the cause) and falls back to a direct bind — the Tailscale `100.x` IP
if the tunnel is up, else all interfaces with a warning — over plain `http://`/`ws://`.

## Releasing the APK (fast phone install)

Pushing a version tag builds the APK in CI and attaches it to a GitHub Release as `botpilot.apk`
(`.github/workflows/release-apk.yml`):

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Studio's Remote Pilot dialog shows an "install app" QR pointing at the stable permalink
`https://github.com/LiQiyeDev/botmaker-pilot/releases/latest/download/botpilot.apk`, which always resolves to
the newest release — scan it on the phone to download and install the latest build.

## Protocol (WebSocket `/ws?token=…`)

| Direction | Type | Payload |
|-----------|------|---------|
| server → client | binary | `[16-byte header: sx,sy,sw,sh as int32 BE][JPEG bytes]` |
| server → client | text | `{"type":"telemetry", …}` / `{"type":"state","run":"running\|stopped\|paused"}` |
| client → server | text | `{"cmd":"start\|stop\|pause\|resume"}` |

## Status

Web client (browser + PWA) and Android APK build end-to-end against Studio's `PilotServer`. See the
umbrella repo `botmaker/` for the server side.
