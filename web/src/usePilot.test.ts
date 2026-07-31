import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FakeSocket } from "./testSocket";
import { usePilot } from "./usePilot";
import type { Endpoint, TelemetryEvent } from "./types";

/**
 * The socket the whole app hangs off: the 16-byte frame header, the bitmap lifecycle, and what happens
 * to a decode that is still in flight when the connection goes away. The last of those is B13, and it is
 * the reason this file exists before the fix rather than after it.
 *
 * Neither `WebSocket` nor `createImageBitmap` exists in jsdom, so both are stood up as real objects with a
 * controllable clock — a socket whose events the test raises by hand (`./testSocket`, shared with
 * `wire.test.ts`), and a decoder whose promises the test resolves in whatever order it wants. Nothing
 * about the hook is mocked.
 */

const ENDPOINT: Endpoint = { host: "192.168.1.9", port: 8080, token: "a b+c", secure: false };

/** A bitmap that records its own disposal, which is the whole subject of half these tests. */
class FakeBitmap {
  closed = false;
  constructor(readonly id: number) {}
  close() {
    this.closed = true;
  }
}

/** A `createImageBitmap` whose decodes are resolved by the test, one by one and in any order. */
class FakeDecoder {
  pending: { blob: Blob; resolve: (b: FakeBitmap) => void; reject: (e: unknown) => void }[] = [];
  private next = 1;

  install() {
    vi.stubGlobal("createImageBitmap", (blob: Blob) =>
      new Promise<FakeBitmap>((resolve, reject) => this.pending.push({ blob, resolve, reject })),
    );
  }

  /** Completes the i-th outstanding decode and returns the bitmap it produced. */
  finish(i = 0): FakeBitmap {
    const bitmap = new FakeBitmap(this.next++);
    this.pending[i].resolve(bitmap);
    return bitmap;
  }

  fail(i = 0) {
    this.pending[i].reject(new Error("corrupt jpeg"));
  }
}

/** A binary frame message: four big-endian int32s then the JPEG bytes. */
function frame(sx: number, sy: number, sw: number, sh: number, jpeg: number[] = [1, 2, 3]): ArrayBuffer {
  const buf = new ArrayBuffer(16 + jpeg.length);
  const dv = new DataView(buf);
  dv.setInt32(0, sx);
  dv.setInt32(4, sy);
  dv.setInt32(8, sw);
  dv.setInt32(12, sh);
  new Uint8Array(buf).set(jpeg, 16);
  return buf;
}

type Api = ReturnType<typeof usePilot>;

interface Harness {
  api: () => Api;
  socket: () => FakeSocket;
  unmount: () => void;
}

function harness(endpoint: Endpoint | null = ENDPOINT): Harness {
  let latest: Api | null = null;
  function Probe() {
    latest = usePilot(endpoint);
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

/** Lets queued promise callbacks (the decode `.then`) run. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const decoder = new FakeDecoder();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  FakeSocket.instances = [];
  decoder.pending = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  decoder.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connecting", () => {
  test("the URL carries the token, url-encoded, on the scheme the endpoint asked for", () => {
    const h = harness();
    expect(h.socket().url).toBe("ws://192.168.1.9:8080/ws?token=a%20b%2Bc");
    h.unmount();
  });

  test("a secure endpoint connects over wss", () => {
    const h = harness({ ...ENDPOINT, secure: true, port: 443 });
    expect(h.socket().url).toBe("wss://192.168.1.9:443/ws?token=a%20b%2Bc");
    h.unmount();
  });

  test("no endpoint opens no socket", () => {
    const h = harness(null);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(h.api().status).toBe("closed");
    h.unmount();
  });

  test("the socket is put in arraybuffer mode before anything can arrive on it", () => {
    const h = harness();
    expect(h.socket().binaryType).toBe("arraybuffer");
    h.unmount();
  });

  test("status follows the socket: connecting, connected, then reconnecting when it drops", () => {
    vi.useFakeTimers();
    const h = harness();
    expect(h.api().status).toBe("connecting");
    act(() => h.socket().open());
    expect(h.api().status).toBe("connected");
    act(() => h.socket().close());
    expect(h.api().status).toBe("reconnecting");
    h.unmount();
  });

  test("a dropped socket is retried with a doubling backoff", () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().close());
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => h.socket().close());
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.instances).toHaveLength(2); // 500 is no longer enough
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.instances).toHaveLength(3);
    h.unmount();
  });

  test("a reconnect that succeeds resets the backoff", () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().close());
    act(() => vi.advanceTimersByTime(500));
    act(() => h.socket().open());
    act(() => h.socket().close());
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.instances).toHaveLength(3);
    h.unmount();
  });

  test("closing the screen ourselves is not a reconnect", () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.socket().open());
    h.unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("sending", () => {
  test("commands go out as JSON once the socket is open", () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.api().send({ cmd: "start" }));
    expect(h.socket().sent).toEqual(['{"cmd":"start"}']);
    h.unmount();
  });

  test("a command sent before the socket opens is dropped, not queued", () => {
    const h = harness();
    act(() => h.api().send({ cmd: "start" }));
    expect(h.socket().sent).toEqual([]);
    h.unmount();
  });
});

describe("text messages", () => {
  test("a state message drives the run state and the background-input flag", () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(JSON.stringify({ type: "state", run: "running", backgroundInput: false })));
    expect(h.api().runState).toBe("running");
    expect(h.api().backgroundInput).toBe(false);
    h.unmount();
  });

  test("a state message that omits a field leaves that field alone", () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(JSON.stringify({ type: "state", run: "paused", backgroundInput: false })));
    act(() => h.socket().deliver(JSON.stringify({ type: "state" })));
    expect(h.api().runState).toBe("paused");
    expect(h.api().backgroundInput).toBe(false);
    h.unmount();
  });

  test("a telemetry event is stamped with an expiry and appended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const h = harness();
    act(() => h.socket().open());
    const event: TelemetryEvent = { ts: 1, kind: "Click", target: null, x: 5, y: 6 };
    act(() => h.socket().deliver(JSON.stringify({ type: "telemetry", event })));
    const [got] = h.api().overlaysRef.current;
    expect(got).toMatchObject({ kind: "Click", x: 5, y: 6 });
    expect(got._exp).toBe(1_700_000_000_000 + 1200);
    h.unmount();
  });

  test("overlays are capped at forty, keeping the newest", () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => {
      for (let i = 0; i < 45; i++) {
        const event: TelemetryEvent = { ts: i, kind: "Match", target: null };
        h.socket().deliver(JSON.stringify({ type: "telemetry", event }));
      }
    });
    const overlays = h.api().overlaysRef.current;
    expect(overlays).toHaveLength(40);
    expect(overlays[0].ts).toBe(5);
    expect(overlays[39].ts).toBe(44);
    h.unmount();
  });

  test("malformed or unknown text is ignored rather than throwing on the socket callback", () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver("{not json"));
    act(() => h.socket().deliver(JSON.stringify({ type: "something-new" })));
    act(() => h.socket().deliver(JSON.stringify({ type: "telemetry" })));
    expect(h.api().overlaysRef.current).toEqual([]);
    expect(h.api().runState).toBe("stopped");
    h.unmount();
  });
});

describe("binary frames", () => {
  test("the header is four big-endian int32s and the rest is the JPEG", async () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(frame(1920, -1080, 800, 600, [0xff, 0xd8, 0xff])));
    expect(decoder.pending).toHaveLength(1);
    expect(decoder.pending[0].blob.type).toBe("image/jpeg");
    expect(decoder.pending[0].blob.size).toBe(3); // the 16 header bytes are not in the payload
    decoder.finish();
    await settle();
    expect(h.api().frameRef.current).toMatchObject({ sx: 1920, sy: -1080, sw: 800, sh: 600 });
    h.unmount();
  });

  test("the previous bitmap is closed when the next frame replaces it", async () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(frame(0, 0, 10, 10)));
    const first = decoder.finish();
    await settle();
    act(() => h.socket().deliver(frame(0, 0, 10, 10)));
    const second = decoder.finish(1);
    await settle();
    // At 12 FPS a leaked bitmap per frame is tens of megabytes a minute on a phone.
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(h.api().frameRef.current!.bitmap).toBe(second as unknown as ImageBitmap);
    h.unmount();
  });

  test("a corrupt frame is dropped and the last good one stays on screen", async () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(frame(0, 0, 10, 10)));
    const good = decoder.finish();
    await settle();
    act(() => h.socket().deliver(frame(0, 0, 20, 20)));
    decoder.fail(1);
    await settle();
    expect(h.api().frameRef.current!.bitmap).toBe(good as unknown as ImageBitmap);
    expect(good.closed).toBe(false);
    h.unmount();
  });

  test("leaving the screen closes the bitmap that is on it and forgets the overlays", async () => {
    const h = harness();
    act(() => h.socket().open());
    act(() => h.socket().deliver(frame(0, 0, 10, 10)));
    const bitmap = decoder.finish();
    const event: TelemetryEvent = { ts: 1, kind: "Match", target: null };
    act(() => h.socket().deliver(JSON.stringify({ type: "telemetry", event })));
    await settle();
    const { frameRef, overlaysRef } = h.api();
    h.unmount();
    expect(bitmap.closed).toBe(true);
    expect(frameRef.current).toBeNull();
    expect(overlaysRef.current).toEqual([]);
  });

  test.skip(
    "B13 is unfixed: verified red on this commit — a decode that resolves after teardown publishes its "
      + "bitmap into the ref the cleanup just cleared, and nothing ever closes it. Delete the .skip in "
      + "Phase 4 with P5's fix.",
    async () => {
      const h = harness();
      act(() => h.socket().open());
      act(() => h.socket().deliver(frame(0, 0, 10, 10)));
      const { frameRef } = h.api();
      h.unmount(); // the user backed out while the decode was still running
      const late = decoder.finish();
      await settle();
      expect(frameRef.current).toBeNull();
      expect(late.closed).toBe(true);
    },
  );

  test.skip(
    "B13 is unfixed: verified red on this commit — decodes run concurrently, so a frame whose decode "
      + "finishes late overwrites a newer one and the video runs backwards. Delete the .skip in Phase 4 "
      + "with P5's fix.",
    async () => {
      const h = harness();
      act(() => h.socket().open());
      act(() => h.socket().deliver(frame(0, 0, 10, 10)));
      act(() => h.socket().deliver(frame(0, 0, 20, 20)));
      const second = decoder.finish(1); // the newer frame decodes first
      const first = decoder.finish(0);
      await settle();
      expect(h.api().frameRef.current!.bitmap).toBe(second as unknown as ImageBitmap);
      expect(first.closed).toBe(true);
      h.unmount();
    },
  );
});
