import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useInteract } from "./useInteract";
import type { ControlCmd, InputCmd, ViewTransform } from "./types";

/**
 * The code that decides *where on someone's game a tap lands*. Four rules, each of them one line away
 * from a silent regression and three of them already bug fixes: the tap goes to the pointerdown
 * position, drift under the slop stays a tap, the wheel sign is inverted from `deltaY`, and a drag whose
 * transform vanished still releases rather than leaving the host's button held down.
 *
 * The hook is rendered for real — React's own `act` over a root in jsdom, no mock of React and no
 * testing library. Its handlers only write refs and call `send`, so they can be invoked directly with
 * pointer events shaped the way the DOM shapes them.
 */

/** A transform that is not the identity in any axis, so a dropped term cannot pass unnoticed. */
const TRANSFORM: ViewTransform = { ox: 40, oy: 20, s: 2, sx: 1000, sy: 500 };

/** The canvas' position in the page, likewise non-zero. */
const RECT = { left: 10, top: 5 };

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type Handlers = ReturnType<typeof useInteract>;

interface Harness {
  handlers: Handlers;
  sent: ControlCmd[];
  transformRef: { current: ViewTransform | null };
  canvas: HTMLCanvasElement;
  captured: number[];
}

function harness(enabled = true, transform: ViewTransform | null = TRANSFORM): Harness {
  const sent: ControlCmd[] = [];
  const transformRef = { current: transform };
  const captured: number[] = [];

  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ ...RECT, right: 0, bottom: 0, width: 0, height: 0, x: RECT.left, y: RECT.top, toJSON: () => ({}) }) as DOMRect;
  // jsdom has no pointer capture; record the call so the "capture is taken" behaviour is still asserted.
  (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) => captured.push(id);

  let handlers: Handlers | null = null;
  function Probe() {
    handlers = useInteract((cmd) => sent.push(cmd), transformRef as never, enabled);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { handlers: handlers!, sent, transformRef, canvas, captured };
}

/** A pointer event with only the fields the hook reads. */
function pointer(h: Harness, x: number, y: number) {
  return { clientX: x, clientY: y, pointerId: 7, currentTarget: h.canvas } as never;
}

function wheel(h: Harness, x: number, y: number, deltaY: number) {
  return { clientX: x, clientY: y, deltaY, currentTarget: h.canvas } as never;
}

/** The mapping the hook performs, spelled out independently so the assertions are not the code again. */
function expectedScreen(clientX: number, clientY: number, dpr: number, t = TRANSFORM) {
  return {
    x: Math.round(t.sx + ((clientX - RECT.left) * dpr - t.ox) / t.s),
    y: Math.round(t.sy + ((clientY - RECT.top) * dpr - t.oy) / t.s),
  };
}

function inputs(h: Harness): InputCmd[] {
  return h.sent.filter((c): c is InputCmd => c.cmd === "input");
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.devicePixelRatio = 2;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("coordinate mapping", () => {
  test("a tap maps through the live transform, the canvas rect and the device pixel ratio", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    const [tap] = inputs(h);
    expect(tap).toMatchObject({ kind: "tap", ...expectedScreen(110, 105, 2), button: 1 });
    // And concretely, so a wrong-but-self-consistent formula above cannot hide: (110-10)*2 = 200 canvas
    // px, minus ox 40, over scale 2 = 80 surface px, from screen origin 1000.
    expect(tap).toMatchObject({ x: 1080, y: 590 });
  });

  test("a device with no ratio scaling maps one CSS px to one canvas px", () => {
    window.devicePixelRatio = 1;
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    expect(inputs(h)[0]).toMatchObject(expectedScreen(110, 105, 1));
  });

  test("a zero devicePixelRatio falls back to 1 instead of collapsing every touch onto the origin", () => {
    (window as { devicePixelRatio: number }).devicePixelRatio = 0;
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    expect(inputs(h)[0]).toMatchObject(expectedScreen(110, 105, 1));
  });

  test("nothing is sent while there is no frame to map through", () => {
    const h = harness(true, null);
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    expect(h.sent).toEqual([]);
    expect(h.captured).toEqual([]);
  });
});

describe("tap versus drag", () => {
  test("a press and release is a tap, and it takes the pointer capture", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["tap"]);
    expect(h.captured).toEqual([7]);
  });

  test("drift under the slop stays a tap, and lands where the finger came down", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 114, 108)); // hypot(4,3) = 5 < 6
    h.handlers.onPointerUp(pointer(h, 114, 108));
    const [tap] = inputs(h);
    expect(tap.kind).toBe("tap");
    // The regression this guards: sending at the up position turns thumb roll into aim error, magnified
    // by the frame-to-screen scale — here 5 CSS px of roll would have become 5 screen px.
    expect(tap).toMatchObject(expectedScreen(110, 105, 2));
    expect(tap).not.toMatchObject(expectedScreen(114, 108, 2));
  });

  test("drift at exactly the slop is a drag, not a tap", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 116, 105)); // exactly 6 — the guard is `moved < 6`
    h.handlers.onPointerUp(pointer(h, 116, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["down", "move", "up"]);
  });

  test("a drag presses at the point the finger landed and releases where it lifted", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 200, 105));
    h.handlers.onPointerUp(pointer(h, 300, 105));
    const [down, , up] = inputs(h);
    expect(down).toMatchObject({ kind: "down", ...expectedScreen(110, 105, 2) });
    expect(up).toMatchObject({ kind: "up", ...expectedScreen(300, 105, 2) });
  });

  test("a second gesture after a drag is a tap again", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 300, 105));
    h.handlers.onPointerUp(pointer(h, 300, 105));
    h.sent.length = 0;
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerUp(pointer(h, 110, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["tap"]);
  });

  test("a move with no press behind it sends nothing", () => {
    const h = harness();
    h.handlers.onPointerMove(pointer(h, 300, 105));
    expect(h.sent).toEqual([]);
  });

  test("a release with no press behind it sends nothing", () => {
    const h = harness();
    h.handlers.onPointerUp(pointer(h, 300, 105));
    expect(h.sent).toEqual([]);
  });

  test("moves are throttled to the frame cadence, but the promoting move is never dropped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 200, 105));
    h.handlers.onPointerMove(pointer(h, 210, 105));
    h.handlers.onPointerMove(pointer(h, 220, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["down", "move"]);
    vi.setSystemTime(1_000_000 + 100); // > 1000/12 ms
    h.handlers.onPointerMove(pointer(h, 230, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["down", "move", "move"]);
  });
});

describe("a drag that loses its frame", () => {
  test("the release still goes out, at the press point, rather than being swallowed", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 300, 105));
    h.transformRef.current = null; // the stream dropped mid-drag
    h.handlers.onPointerUp(pointer(h, 300, 105));
    const sentInputs = inputs(h);
    const up = sentInputs[sentInputs.length - 1];
    // A swallowed `up` leaves the button held down on the host — worse than a release a few px off.
    expect(up).toMatchObject({ kind: "up", ...expectedScreen(110, 105, 2) });
  });

  test("a move that loses its frame sends nothing but keeps the drag alive", () => {
    const h = harness();
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 300, 105));
    h.transformRef.current = null;
    h.handlers.onPointerMove(pointer(h, 400, 105));
    h.transformRef.current = TRANSFORM;
    h.handlers.onPointerUp(pointer(h, 500, 105));
    expect(inputs(h).map((c) => c.kind)).toEqual(["down", "move", "up"]);
  });
});

describe("the wheel", () => {
  test("the wire sign is the inverse of deltaY", () => {
    const h = harness();
    h.handlers.onWheel(wheel(h, 110, 105, 120));
    h.handlers.onWheel(wheel(h, 110, 105, -120));
    expect(inputs(h).map((c) => c.amount)).toEqual([-1, 1]);
  });

  test("a scroll carries the mapped position and no button", () => {
    const h = harness();
    h.handlers.onWheel(wheel(h, 110, 105, 120));
    expect(inputs(h)[0]).toMatchObject({ kind: "scroll", ...expectedScreen(110, 105, 2) });
    expect(inputs(h)[0].button).toBeUndefined();
  });

  test("the amount is a step, not the raw delta — a trackpad's 3 px and a mouse's 120 are the same", () => {
    const h = harness();
    h.handlers.onWheel(wheel(h, 110, 105, 3));
    h.handlers.onWheel(wheel(h, 110, 105, 120));
    expect(inputs(h).map((c) => c.amount)).toEqual([-1, -1]);
  });

  test("a zero delta scrolls forward rather than not at all", () => {
    // Characterisation: the sign test is `> 0`, so deltaY 0 takes the +1 branch.
    const h = harness();
    h.handlers.onWheel(wheel(h, 110, 105, 0));
    expect(inputs(h)[0].amount).toBe(1);
  });
});

describe("disarmed", () => {
  test("a passive viewer's gestures reach nothing, in every handler", () => {
    const h = harness(false);
    h.handlers.onPointerDown(pointer(h, 110, 105));
    h.handlers.onPointerMove(pointer(h, 300, 105));
    h.handlers.onPointerUp(pointer(h, 300, 105));
    h.handlers.onWheel(wheel(h, 110, 105, 120));
    expect(h.sent).toEqual([]);
    expect(h.captured).toEqual([]);
  });
});
