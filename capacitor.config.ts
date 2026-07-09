import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BotPilot Android shell. The web client (web/dist) is bundled into the APK and loaded from the
 * local `https://localhost` WebView origin; the app then connects out to BotMaker Studio's
 * PilotServer over a plain WebSocket across the Tailscale tunnel.
 *
 * `androidScheme: "https"` keeps the bundled app on a secure origin (so localStorage etc. behave),
 * while `cleartext: true` permits the outbound ws:// connection — the Tailscale tunnel, not TLS,
 * provides the transport encryption on the LAN-like tailnet.
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
