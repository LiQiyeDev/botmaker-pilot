import { useEffect, useState } from "react";

/** Build-time app version (from web/package.json), injected by Vite's `define`. */
declare const __APP_VERSION__: string;

const RELEASES_API = "https://api.github.com/repos/LiQiyeDev/botmaker-pilot/releases/latest";
/** Stable permalink to the latest APK — the same URL Studio's install QR points at. */
export const LATEST_APK_URL =
  "https://github.com/LiQiyeDev/botmaker-pilot/releases/latest/download/botpilot.apk";

const CHECK_KEY = "botpilot.updateCheckedAt";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // throttle: at most once every 6h

/** Parses "v1.2.3" / "1.2.3" into a numeric tuple; missing parts default to 0. */
function parseVersion(v: string): number[] {
  return v.replace(/^[^\d]*/, "").split(/[.\-+]/).map((n) => Number(n) || 0);
}

/** True if `latest` is a strictly newer version than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Best-effort GitHub-release update check. Returns the newer release's tag once (or null). Throttled via
 * localStorage so we don't hit the API on every launch. Any failure (offline, rate-limit) resolves silently.
 */
export function useAppUpdate(): { available: boolean; latest: string | null } {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const last = Number(localStorage.getItem(CHECK_KEY) ?? 0);
    if (Date.now() - last < CHECK_INTERVAL_MS) return;

    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(RELEASES_API, {
          signal: ctrl.signal,
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const tag = (await res.json())?.tag_name as string | undefined;
        localStorage.setItem(CHECK_KEY, String(Date.now()));
        if (tag && isNewer(tag, __APP_VERSION__)) setLatest(tag);
      } catch {
        /* offline / rate-limited — stay silent */
      }
    })();

    return () => ctrl.abort();
  }, []);

  return { available: latest !== null, latest };
}
