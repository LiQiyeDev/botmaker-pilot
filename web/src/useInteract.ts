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
 * sent as a single `tap`, which the host can deliver via the cursor-preserving path; only a real drag falls
 * back to down/move/up, which on some backends moves the host's pointer. So the cheap gesture stays cheap.
 */
export function useInteract(
  send: (cmd: ControlCmd) => void,
  transformRef: React.MutableRefObject<ViewTransform | null>,
  enabled: boolean,
) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
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
      startRef.current = { x: e.clientX, y: e.clientY };
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
        // Promote to a drag: press at the *original* point, so the drag starts where the finger landed.
        const origin = toScreen({ clientX: start.x, clientY: start.y, currentTarget: e.currentTarget });
        if (!origin) return;
        draggingRef.current = true;
        send({ cmd: "input", kind: "down", x: origin.x, y: origin.y, button: 1 });
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
      const p = toScreen(e);
      if (!p) {
        draggingRef.current = false;
        return;
      }
      if (draggingRef.current) send({ cmd: "input", kind: "up", x: p.x, y: p.y, button: 1 });
      else send({ cmd: "input", kind: "tap", x: p.x, y: p.y, button: 1 });
      draggingRef.current = false;
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
