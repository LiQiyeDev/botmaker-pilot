import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FakeSocket } from "./testSocket";
import { usePilot } from "./usePilot";
import type { Endpoint, TelemetryEvent } from "./types";

/**
 * The pilot half of the wire contract. `types.ts` is the only place either side of this protocol names
 * its fields, and the Studio end reaches the socket as concatenated strings — so what follows is not a
 * test of this repo's code so much as a test that the other repo still speaks the same language.
 *
 * Both halves read the *same* corpus: `wire-golden.json` here, `pilot/wire-golden.json` in
 * `botmaker-studio`, byte-identical. Neither test can see the other's repo, so both assert its SHA-256 —
 * change the wire on one side and the other side goes red until it is changed too.
 *
 * Every message goes through the real `usePilot`, not a hand-written parser, so what is asserted is what
 * a user's phone would actually have done with the bytes Studio sent.
 */

/** Read from disk rather than imported, so the digest below is over the bytes the Studio side hashes. */
const GOLDEN_PATH = join(process.cwd(), "src", "wire-golden.json");

/** Update together with `GOLDEN_SHA256` in the Studio repo's `TelemetryWireContractTest`. */
const GOLDEN_SHA256 = "823d631b3ebc58d2dcc6aaba6f3951552bacc829d081ff997235d959e8e954cc";

const CORPUS = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, Record<string, unknown>>;

const ENDPOINT: Endpoint = { host: "10.0.0.2", port: 8080, token: "t", secure: false };

/** The case names, minus the corpus' own `_comment`. */
const CASES = Object.keys(CORPUS).filter((k) => !k.startsWith("_"));

/** Every case this file decoded, so a case added to the corpus and never wired up fails the suite. */
const covered = new Set<string>();

/**
 * What `types.ts` declares for a `TelemetryEvent`, restated as data. This is the mirror the contract is
 * about: TypeScript erases at runtime, so nothing else in this repo would notice a field arriving that no
 * interface names, or an interface naming a field that stopped arriving.
 */
const DECLARED_KEYS = ["ts", "kind", "target", "found", "confidence", "region", "rect", "x", "y", "button"];

/** …and which of them each kind is expected to carry, exactly. */
const KEYS_BY_KIND: Record<TelemetryEvent["kind"], string[]> = {
  Match: ["ts", "target", "kind", "found", "confidence", "region", "rect"],
  Click: ["ts", "target", "kind", "x", "y", "button"],
  Region: ["ts", "target", "kind", "rect"],
};

const TARGET_KEYS = ["title", "x", "y", "w", "h"];
const RECT_KEYS = ["x", "y", "w", "h"];

type Api = ReturnType<typeof usePilot>;

interface Harness {
  api: () => Api;
  socket: () => FakeSocket;
  unmount: () => void;
}

function harness(): Harness {
  let latest: Api | null = null;
  function Probe() {
    latest = usePilot(ENDPOINT);
    return null;
  }
  let root: Root;
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(createElement(Probe));
  });
  return {
    api: () => latest!,
    socket: () => FakeSocket.instances[FakeSocket.instances.length - 1],
    unmount: () => act(() => root.unmount()),
  };
}

interface Decoded {
  runState: Api["runState"];
  backgroundInput: boolean;
  overlays: TelemetryEvent[];
}

/**
 * Sends a corpus case down the socket exactly as Javalin would — one JSON text frame — and snapshots what
 * the client is holding. Snapshotted before unmount, because teardown empties the overlay ref (B13's
 * neighbourhood, and `usePilot.test.ts` is where that is pinned).
 */
function deliver(caseName: string): Decoded {
  const message = CORPUS[caseName];
  expect(message, `no such case in wire-golden.json: ${caseName}`).toBeDefined();
  const h = harness();
  act(() => {
    h.socket().open();
    h.socket().deliver(JSON.stringify(message));
  });
  const api = h.api();
  const decoded: Decoded = {
    runState: api.runState,
    backgroundInput: api.backgroundInput,
    overlays: [...api.overlaysRef.current],
  };
  h.unmount();
  covered.add(caseName);
  return decoded;
}

/** The decoded event of a telemetry case, as it sat in the overlay ref. */
function overlay(caseName: string): TelemetryEvent {
  const { overlays } = deliver(caseName);
  expect(overlays, `${caseName} was dropped by the client instead of decoded`).toHaveLength(1);
  return overlays[0];
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the corpus", () => {
  test("is the one the Studio repo has", () => {
    const digest = createHash("sha256").update(readFileSync(GOLDEN_PATH)).digest("hex");
    expect(
      digest,
      "wire-golden.json changed. botmaker-studio has a byte-identical copy and asserts the same digest — "
        + "update both files and both constants, or the wire has silently forked.",
    ).toBe(GOLDEN_SHA256);
  });

  test("names no field that types.ts does not", () => {
    for (const name of CASES.filter((c) => c.startsWith("telemetry."))) {
      const event = CORPUS[name].event as Record<string, unknown>;
      for (const key of Object.keys(event)) {
        expect(DECLARED_KEYS, `${name} carries "${key}", which no interface in types.ts names`)
          .toContain(key);
      }
    }
  });

  test("carries every field the interfaces declare, per kind, and no more", () => {
    for (const name of CASES.filter((c) => c.startsWith("telemetry."))) {
      const event = CORPUS[name].event as Record<string, unknown>;
      const kind = event.kind as TelemetryEvent["kind"];
      expect(Object.keys(event).sort(), name).toEqual([...KEYS_BY_KIND[kind]].sort());
    }
  });

  test("shapes targets and rects the way types.ts shapes them", () => {
    for (const name of CASES.filter((c) => c.startsWith("telemetry."))) {
      const event = CORPUS[name].event as Record<string, unknown>;
      const target = event.target;
      if (target) expect(Object.keys(target).sort(), `${name} target`).toEqual([...TARGET_KEYS].sort());
      for (const key of ["region", "rect"] as const) {
        const r = event[key];
        if (r) expect(Object.keys(r).sort(), `${name} ${key}`).toEqual([...RECT_KEYS].sort());
      }
    }
  });

});

describe("what the client makes of a telemetry message", () => {
  test("a successful match keeps its search region, its found rect and the confidence", () => {
    const e = overlay("telemetry.match.found");
    expect(e.kind).toBe("Match");
    expect(e.found).toBe(true);
    expect(e.confidence).toBeCloseTo(0.9123, 4);
    // The renderer draws region and rect through the same transform; both are absolute screen px.
    expect(e.region).toEqual({ x: 110, y: 60, w: 200, h: 100 });
    expect(e.rect).toEqual({ x: 150, y: 80, w: 32, h: 24 });
    expect(e.target).toEqual({ title: "Nested Game", x: 100, y: 50, w: 640, h: 480 });
  });

  test("a failed match arrives with nulls the renderer skips, not with a rect at the origin", () => {
    const e = overlay("telemetry.match.miss");
    expect(e.found).toBe(false);
    expect(e.region).toBeNull();
    expect(e.rect).toBeNull();
  });

  test("a click carries the coordinates the renderer rings", () => {
    const e = overlay("telemetry.click");
    expect(e.kind).toBe("Click");
    expect([e.x, e.y]).toEqual([300, 220]);
    expect(e.button).toBe(3);
  });

  test("a region highlight carries a rect and no found flag, so it draws yellow", () => {
    const e = overlay("telemetry.region");
    expect(e.kind).toBe("Region");
    expect(e.rect).toEqual({ x: 0, y: 0, w: 640, h: 480 });
    expect(e.found).toBeUndefined();
  });

  test("a window title with quotes, a backslash and a non-ASCII character survives the round trip", () => {
    const e = overlay("telemetry.target.title.quoted");
    expect(e.target?.title).toBe("He said \"hi\" — C:\\Games\\x");
    // A monitor to the left of the primary one gives negative absolute coordinates; they must stay signed.
    expect(e.target?.x).toBe(-1920);
    expect(e.rect).toEqual({ x: -1920, y: 0, w: 100, h: 100 });
  });

  test("a null target is decoded, not dropped", () => {
    const e = overlay("telemetry.target.null");
    expect(e.target).toBeNull();
    expect([e.x, e.y]).toEqual([10, 20]);
  });

  test("the client stamps its own expiry, which is not on the wire", () => {
    const before = Date.now();
    const e = overlay("telemetry.click");
    expect(CORPUS["telemetry.click"].event).not.toHaveProperty("_exp");
    expect(e._exp).toBeGreaterThanOrEqual(before + 1200);
  });
});

describe("what the client makes of a state message", () => {
  test("a running bot with background input needs no cursor warning", () => {
    const api = deliver("state.running.background");
    expect(api.runState).toBe("running");
    expect(api.backgroundInput).toBe(true);
  });

  test("paused, on a host that will move the real cursor", () => {
    const api = deliver("state.paused.foreground");
    expect(api.runState).toBe("paused");
    // This false is the whole reason the field exists: it is what raises the "moves the computer's real
    // cursor" warning before a user's pointer visibly gets hijacked.
    expect(api.backgroundInput).toBe(false);
  });

  test("stopped", () => {
    const api = deliver("state.stopped.background");
    expect(api.runState).toBe("stopped");
  });
});

afterAll(() => {
  // A case that exists in the corpus but is never fed through the client would otherwise sit there
  // proving nothing — and the Studio side asserts the same completeness against the same file.
  expect([...covered].sort(), "corpus cases never decoded by the client").toEqual([...CASES].sort());
});
