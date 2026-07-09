import type { Endpoint } from "./types";

const STORAGE_KEY = "botpilot.endpoint";

/**
 * The endpoint to connect to on load, or {@code null} to show the connect screen.
 *
 * When the app is served by Studio (http/https origin) with a {@code ?token=} query param, connect to that
 * same origin automatically. Otherwise (e.g. the Capacitor APK loading from file://) fall back to a stored
 * endpoint from a previous manual connect.
 */
export function initialEndpoint(): Endpoint | null {
  const loc = window.location;
  const token = new URLSearchParams(loc.search).get("token");
  const servedByStudio = loc.protocol === "http:" || loc.protocol === "https:";
  if (servedByStudio && token) {
    return {
      host: loc.hostname,
      port: Number(loc.port) || (loc.protocol === "https:" ? 443 : 80),
      token,
      secure: loc.protocol === "https:",
    };
  }
  return loadEndpoint();
}

export function loadEndpoint(): Endpoint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Endpoint) : null;
  } catch {
    return null;
  }
}

export function saveEndpoint(ep: Endpoint): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ep));
  } catch {
    /* ignore */
  }
}

/** Parses a pasted URL like {@code http://100.64.0.1:12345/?token=abc} into an Endpoint, if valid. */
export function parseUrl(input: string): Endpoint | null {
  try {
    const u = new URL(input.trim());
    const token = u.searchParams.get("token") ?? "";
    return {
      host: u.hostname,
      port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
      token,
      secure: u.protocol === "https:",
    };
  } catch {
    return null;
  }
}
