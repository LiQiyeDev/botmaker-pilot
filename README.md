# BotPilot

Remote companion client for **BotMaker Studio**. It shows a live preview of the running bot and can
start / stop / pause / resume it, from a browser or an installable Android app, over a private
[Tailscale](https://tailscale.com) tunnel.

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

## Building

```bash
# Web UI (browser + PWA)
cd web && npm ci && npm run build      # → web/dist
#   dev loop: npm run dev

# Android APK (from the pilot root)
npm ci                                 # Capacitor CLI + native deps
npm run build:web                      # produces web/dist
npx cap sync android                   # copy dist into the native project
cd android && ./gradlew assembleDebug  # → android/app/build/outputs/apk/debug/app-debug.apk
```

Studio serves the web UI itself: a prebuilt `dist` is committed under
`botmaker-studio/src/main/resources/pilot/`, and `mvn -Ppilot package` in Studio rebuilds it from this
`web/` source (downloading a project-local Node — nothing installed system-wide).

The APK bundles `web/dist` locally and loads it from the `https://localhost` WebView origin, then connects
out to Studio's `PilotServer` over a plain `ws://` across the Tailscale tunnel (the tunnel, not TLS,
encrypts the transport — hence `server.cleartext` in `capacitor.config.ts`).

## Protocol (WebSocket `/ws?token=…`)

| Direction | Type | Payload |
|-----------|------|---------|
| server → client | binary | `[16-byte header: sx,sy,sw,sh as int32 BE][JPEG bytes]` |
| server → client | text | `{"type":"telemetry", …}` / `{"type":"state","run":"running\|stopped\|paused"}` |
| client → server | text | `{"cmd":"start\|stop\|pause\|resume"}` |

## Status

Web client (browser + PWA) and Android APK build end-to-end against Studio's `PilotServer`. See the
umbrella repo `botmaker/` for the server side.
