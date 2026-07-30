import { useCallback, useRef } from "react";
import type { ControlCmd, ViewTransform } from "./types";

/** Below this much movement a press-release is a tap, not a drag. In CSS px, so it scales with the display. */
const DRAG_SLOP_PX = 6;

/** Don't stream more move events than the server's frame cadence can show the result of (12 FPS). */
const MOVE_INTERVAL_MS = 1000 / 12;

/**
 * Turns pointer gestures on the video canvas into Interact commands.
 *
 * <p>Two things it must get right. **Coordinates**: a touch is in CSS px relative to the canvas, but the
 * server wants absolute screen px — so the pointer is mapped through the renderer's live
 * {@link ViewTransform} (device-pixel aware), never through a re-derived fit. **Tap vs drag**: a plain tap is
 * sent as a single `tap`, leaving the host to pick the delivery path that suits its target; only a real drag
 * falls back to down/move/up, which on some backends moves the host's pointer. So the cheap gesture stays cheap.
 *
 * <p>**A tap is sent where the finger landed, not where it lifted.** Up to {@link DRAG_SLOP_PX} of drift still
 * counts as a tap — that is the point of the slop — but it used to be sent at the *up* position, so all of that
 * drift became aim error. It is worse than it sounds: the slop is in CSS px on the phone, and a 1280 px-wide
 * frame shown ~400 px wide multiplies it by ~3, turning 6 px of thumb roll into ~19 px on the target. The
 * down-position is also simply what the user meant. Drags keep using the live position, where following the
 * finger is the whole behaviour.
 */
export function useInteract(
  send: (cmd: ControlCmd) => void,
  transformRef: React.MutableRefObject<ViewTransform | null>,
  enabled: boolean,
) {
  /**
   * Where the gesture started: CSS px (for the drag-slop distance) and the screen coordinate that position
   * mapped to at the time, which is what a tap is sent at and where a drag presses down.
   */
  const startRef = useRef<{ x: number; y: number; screen: { x: number; y: number } } | null>(null);
  const draggingRef = useRef(false);
  const lastMoveRef = useRef(0);

  /** Canvas pointer event → absolute screen coordinate, or null when nothing is being drawn. */
  const toScreen = useCallback(
    (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
      const t = transformRef.current;
      if (!t) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Canvas is sized in device px (see Renderer), but pointer coords are CSS px.
      const cx = (e.clientX - rect.left) * dpr;
      const cy = (e.clientY - rect.top) * dpr;
      return {
        x: Math.round(t.sx + (cx - t.ox) / t.s),
        y: Math.round(t.sy + (cy - t.oy) / t.s),
      };
    },
    [transformRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      const p = toScreen(e);
      if (!p) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY, screen: p };
      draggingRef.current = false;
    },
    [enabled, toScreen],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const start = startRef.current;
      if (!enabled || !start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!draggingRef.current) {
        if (moved < DRAG_SLOP_PX) return;
        // Promote to a drag: press at the point captured on pointerdown, so the drag starts where the finger
        // landed — and at the transform the user was actually looking at when they touched.
        draggingRef.current = true;
        send({ cmd: "input", kind: "down", x: start.screen.x, y: start.screen.y, button: 1 });
      }
      const now = Date.now();
      if (now - lastMoveRef.current < MOVE_INTERVAL_MS) return;
      lastMoveRef.current = now;
      const p = toScreen(e);
      if (p) send({ cmd: "input", kind: "move", x: p.x, y: p.y, button: 1 });
    },
    [enabled, send, toScreen],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const start = startRef.current;
      startRef.current = null;
      if (!enabled || !start) return;
      if (!draggingRef.current) {
        // A tap goes to the down-position: within-slop drift is thumb roll, not aim (see the note above).
        send({ cmd: "input", kind: "tap", x: start.screen.x, y: start.screen.y, button: 1 });
        return;
      }
      draggingRef.current = false;
      // A drag releases where the finger actually lifted, which is the whole point of a drag. If the transform
      // has gone (no frame left to map through), release at the press point anyway — a swallowed `up` leaves
      // the button held down on the host, which is worse than a release a few px off.
      const p = toScreen(e) ?? start.screen;
      send({ cmd: "input", kind: "up", x: p.x, y: p.y, button: 1 });
    },
    [enabled, send, toScreen],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      const p = toScreen(e);
      if (!p) return;
      // Wire convention: + is up/away, - is down/toward — the inverse of deltaY's sign.
      send({ cmd: "input", kind: "scroll", x: p.x, y: p.y, amount: e.deltaY > 0 ? -1 : 1 });
    },
    [enabled, send, toScreen],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onWheel };
}
