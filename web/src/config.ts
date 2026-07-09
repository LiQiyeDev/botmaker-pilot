import type { Endpoint } from "./types";

const STORAGE_KEY = "botpilot.connections";
const LEGACY_KEY = "botpilot.endpoint"; // pre-history single-endpoint store, migrated on first load
const MAX_CONNECTIONS = 8;

/** A remembered endpoint plus display metadata, so the user can reconnect without rescanning. */
export interface SavedConnection {
  endpoint: Endpoint;
  label: string;
  lastConnected: number;
}

/**
 * The endpoint to connect to on load, or {@code null} to show the connect screen.
 *
 * When the app is served by Studio (http/https origin) with a {@code ?token=} query param, connect to that
 * same origin automatically. Otherwise (e.g. the Capacitor APK loading from https://localhost) fall back to
 * the most-recent saved connection from a previous manual connect.
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
  return loadConnections()[0]?.endpoint ?? null;
}

/** A human-friendly name for an endpoint: the DNS host for HTTPS/Funnel, else host:port for LAN/direct. */
export function connectionLabel(ep: Endpoint): string {
  return ep.secure ? ep.host : `${ep.host}:${ep.port}`;
}

/** Stable identity of an endpoint (host+port) — a re-pair with a fresh token updates the same entry. */
function endpointKey(ep: Endpoint): string {
  return `${ep.secure ? "wss" : "ws"}://${ep.host}:${ep.port}`;
}

/** All saved connections, most-recently-connected first. Migrates the legacy single-endpoint key once. */
export function loadConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedConnection[];
  } catch {
    /* fall through to migration / empty */
  }
  // One-time migration from the old single-endpoint store.
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const ep = JSON.parse(legacy) as Endpoint;
      const migrated: SavedConnection[] = [
        { endpoint: ep, label: connectionLabel(ep), lastConnected: Date.now() },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function persist(list: SavedConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CONNECTIONS)));
  } catch {
    /* ignore */
  }
}

/** Adds or refreshes a connection (dedup by host+port), moving it to the front. Returns the new list. */
export function upsertConnection(ep: Endpoint, label?: string): SavedConnection[] {
  const key = endpointKey(ep);
  const rest = loadConnections().filter((c) => endpointKey(c.endpoint) !== key);
  const list: SavedConnection[] = [
    { endpoint: ep, label: label ?? connectionLabel(ep), lastConnected: Date.now() },
    ...rest,
  ];
  persist(list);
  return list;
}

/** Bumps the lastConnected time of an existing entry (called once a socket actually opens). */
export function touchConnection(ep: Endpoint): void {
  const key = endpointKey(ep);
  const list = loadConnections();
  const found = list.find((c) => endpointKey(c.endpoint) === key);
  if (found) {
    found.lastConnected = Date.now();
    list.sort((a, b) => b.lastConnected - a.lastConnected);
    persist(list);
  } else {
    upsertConnection(ep);
  }
}

/** Removes a saved connection by its host+port identity. Returns the new list. */
export function removeConnection(ep: Endpoint): SavedConnection[] {
  const key = endpointKey(ep);
  const list = loadConnections().filter((c) => endpointKey(c.endpoint) !== key);
  persist(list);
  return list;
}

/** Parses a pasted/scanned URL like {@code http://100.64.0.1:12345/?token=abc} into an Endpoint, if valid. */
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
