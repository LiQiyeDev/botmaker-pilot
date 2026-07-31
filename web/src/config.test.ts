import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  connectionLabel,
  initialEndpoint,
  loadConnections,
  parseUrl,
  removeConnection,
  touchConnection,
  upsertConnection,
} from "./config";
import type { Endpoint } from "./types";

/**
 * `config.ts` is the only module that writes to a real user's device and reads it back on the next
 * launch, so every behaviour here is one someone has already stored: a saved list, a legacy key from an
 * older build, a token that has been re-issued. The migration in particular can only ever be tested
 * before it is needed — once it has run on a device it never runs again.
 */

const STORAGE_KEY = "botpilot.connections";
const LEGACY_KEY = "botpilot.endpoint";

function ep(host: string, port: number, token = "t", secure = false): Endpoint {
  return { host, port, token, secure };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
});

describe("parseUrl", () => {
  test("a pairing URL becomes the endpoint it names", () => {
    expect(parseUrl("http://100.64.0.1:12345/?token=abc")).toEqual({
      host: "100.64.0.1",
      port: 12345,
      token: "abc",
      secure: false,
    });
  });

  test("a URL with no token parses, with an empty token", () => {
    // Not rejected: the connect screen wants to show the host it understood, and the server is what
    // refuses an empty token.
    expect(parseUrl("http://192.168.1.9:8080/")).toEqual({
      host: "192.168.1.9",
      port: 8080,
      token: "",
      secure: false,
    });
  });

  test("https with no explicit port is 443, http is 80", () => {
    expect(parseUrl("https://pilot.example.ts.net/?token=x")).toEqual({
      host: "pilot.example.ts.net",
      port: 443,
      token: "x",
      secure: true,
    });
    expect(parseUrl("http://pilot.example.com/?token=x")?.port).toBe(80);
  });

  test("surrounding whitespace is tolerated, because this is pasted by hand", () => {
    expect(parseUrl("  http://10.0.0.2:9000/?token=k  ")?.host).toBe("10.0.0.2");
  });

  test("anything that is not a URL is null rather than a throw", () => {
    expect(parseUrl("not a url")).toBeNull();
    expect(parseUrl("")).toBeNull();
    expect(parseUrl("100.64.0.1:12345")).toBeNull();
  });
});

describe("connectionLabel", () => {
  test("a secure endpoint is labelled by host alone, a LAN one by host:port", () => {
    expect(connectionLabel(ep("pilot.example.ts.net", 443, "t", true))).toBe("pilot.example.ts.net");
    expect(connectionLabel(ep("192.168.1.9", 8080))).toBe("192.168.1.9:8080");
  });
});

describe("upsertConnection", () => {
  test("a re-pair with a fresh token updates the existing entry rather than adding one", () => {
    upsertConnection(ep("192.168.1.9", 8080, "old"));
    const list = upsertConnection(ep("192.168.1.9", 8080, "new"));
    expect(list).toHaveLength(1);
    expect(list[0].endpoint.token).toBe("new");
    expect(loadConnections()[0].endpoint.token).toBe("new");
  });

  test("the newest connection is first", () => {
    upsertConnection(ep("a", 1));
    upsertConnection(ep("b", 2));
    expect(loadConnections().map((c) => c.endpoint.host)).toEqual(["b", "a"]);
  });

  test("an explicit label wins over the derived one", () => {
    expect(upsertConnection(ep("192.168.1.9", 8080), "Desk PC")[0].label).toBe("Desk PC");
    expect(upsertConnection(ep("10.0.0.4", 8080))[0].label).toBe("10.0.0.4:8080");
  });

  test("the same host and port over ws and wss are two entries, not one", () => {
    // The doc comment says the identity is host+port; the key it actually builds includes the scheme.
    // Pinning the real behaviour: re-pairing the same machine through a Funnel hostname keeps the LAN
    // entry alongside it, which is what a user wants — but it is not what the comment says.
    upsertConnection(ep("host.example", 443, "t", false));
    const list = upsertConnection(ep("host.example", 443, "t", true));
    expect(list).toHaveLength(2);
  });

  test("only eight connections are kept on the device", () => {
    for (let i = 0; i < 10; i++) upsertConnection(ep(`h${i}`, 1000 + i));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(8);
    expect(stored[0].endpoint.host).toBe("h9");
    expect(loadConnections().map((c) => c.endpoint.host)).not.toContain("h0");
  });

  test("the returned list is the pre-truncation one, so a caller that renders it shows nine", () => {
    for (let i = 0; i < 8; i++) upsertConnection(ep(`h${i}`, 1000 + i));
    // Characterisation, not endorsement: `persist` slices to eight, `upsertConnection` returns the list
    // it was handed. The stored and returned lists disagree for exactly one render.
    expect(upsertConnection(ep("h8", 1008))).toHaveLength(9);
    expect(loadConnections()).toHaveLength(8);
  });
});

describe("touchConnection", () => {
  // The ordering is by wall-clock stamp, so the test has to advance the clock the way a user does.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  test("connecting to an older entry moves it back to the front", () => {
    upsertConnection(ep("a", 1));
    vi.advanceTimersByTime(1000);
    upsertConnection(ep("b", 2));
    expect(loadConnections()[0].endpoint.host).toBe("b");
    vi.advanceTimersByTime(1000);
    touchConnection(ep("a", 1));
    expect(loadConnections()[0].endpoint.host).toBe("a");
  });

  test("two entries stamped in the same millisecond keep the order they were in", () => {
    // Characterisation: the reorder is a sort on `lastConnected`, so a touch that lands in the same
    // millisecond as the entry ahead of it is a no-op. Harmless in the field — a person cannot connect
    // twice inside a millisecond — but it is why this file runs on a fake clock.
    upsertConnection(ep("a", 1));
    upsertConnection(ep("b", 2));
    touchConnection(ep("a", 1));
    expect(loadConnections()[0].endpoint.host).toBe("b");
  });

  test("touching an endpoint that was never saved saves it", () => {
    touchConnection(ep("fresh", 7));
    expect(loadConnections().map((c) => c.endpoint.host)).toEqual(["fresh"]);
  });

  test("touching keeps the stored token, since the entry is the one that was paired", () => {
    upsertConnection(ep("a", 1, "paired"));
    touchConnection(ep("a", 1, "ignored"));
    expect(loadConnections()[0].endpoint.token).toBe("paired");
  });
});

describe("removeConnection", () => {
  test("forgetting one entry leaves the others", () => {
    upsertConnection(ep("a", 1));
    upsertConnection(ep("b", 2));
    expect(removeConnection(ep("a", 1)).map((c) => c.endpoint.host)).toEqual(["b"]);
    expect(loadConnections()).toHaveLength(1);
  });

  test("forgetting something that was never saved is harmless", () => {
    upsertConnection(ep("a", 1));
    expect(removeConnection(ep("z", 9))).toHaveLength(1);
  });
});

describe("loadConnections", () => {
  test("the legacy single-endpoint key is migrated once and then removed", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(ep("192.168.1.9", 8080, "legacy")));
    const migrated = loadConnections();
    expect(migrated).toHaveLength(1);
    expect(migrated[0].endpoint.token).toBe("legacy");
    expect(migrated[0].label).toBe("192.168.1.9:8080");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    // Second call reads the migrated store, not the legacy key that is now gone.
    expect(loadConnections()).toHaveLength(1);
  });

  test("a saved list wins over a legacy key that was never cleaned up", () => {
    upsertConnection(ep("current", 1));
    localStorage.setItem(LEGACY_KEY, JSON.stringify(ep("stale", 2)));
    expect(loadConnections().map((c) => c.endpoint.host)).toEqual(["current"]);
  });

  test("a corrupt store is an empty list, not a crash on launch", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadConnections()).toEqual([]);
  });

  test("a corrupt store falls through to the legacy migration", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(ep("rescued", 3)));
    expect(loadConnections().map((c) => c.endpoint.host)).toEqual(["rescued"]);
  });

  test("nothing stored is an empty list", () => {
    expect(loadConnections()).toEqual([]);
  });
});

describe("initialEndpoint", () => {
  test("served by Studio with a token, it connects to the origin that served it", () => {
    history.replaceState({}, "", "/?token=abc123");
    const found = initialEndpoint();
    expect(found).not.toBeNull();
    expect(found!.token).toBe("abc123");
    expect(found!.host).toBe(location.hostname);
    expect(found!.secure).toBe(location.protocol === "https:");
  });

  test("no token means the most recent saved connection", () => {
    upsertConnection(ep("a", 1));
    upsertConnection(ep("b", 2));
    expect(initialEndpoint()?.host).toBe("b");
  });

  test("no token and nothing saved means the connect screen", () => {
    expect(initialEndpoint()).toBeNull();
  });

  test("a token in the URL wins over a saved connection", () => {
    upsertConnection(ep("saved", 1));
    history.replaceState({}, "", "/?token=fromurl");
    expect(initialEndpoint()?.token).toBe("fromurl");
  });
});
