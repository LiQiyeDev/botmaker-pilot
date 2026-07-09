import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BotPilot Android shell. The web client (web/dist) is bundled into the APK and loaded from the
 * local `https://localhost` WebView origin.
 *
 * Primary path: the app connects to Studio's Tailscale Funnel URL over `wss://` (real TLS on a
 * public `*.ts.net` host) — no cleartext needed there.
 *
 * `androidScheme: "https"` keeps the bundled app on a secure origin (so localStorage etc. behave).
 * `cleartext: true` / `allowMixedContent` are kept ONLY so the same APK can still reach a plain
 * `ws://` PilotServer on a LAN/tailnet IP for local development; they are not used by the Funnel path.
 */
const config: CapacitorConfig = {
  appId: "dev.liqiye.botpilot",
  appName: "BotPilot",
  webDir: "web/dist",
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
    cleartext: true,
  },
};

export default config;
