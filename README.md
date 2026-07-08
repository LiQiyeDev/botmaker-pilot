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

## Protocol (WebSocket `/ws?token=…`)

| Direction | Type | Payload |
|-----------|------|---------|
| server → client | binary | `[16-byte header: sx,sy,sw,sh as int32 BE][JPEG bytes]` |
| server → client | text | `{"type":"telemetry", …}` / `{"type":"state","run":"running\|stopped\|paused"}` |
| client → server | text | `{"cmd":"start\|stop\|pause\|resume"}` |

## Status

Early development. See the umbrella repo `botmaker/` and its plan for the build-out.
