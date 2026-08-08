import { useEffect, useRef } from "react";
import type { Frame, Rect, TelemetryEvent, ViewTransform } from "./types";

const OVERLAY_TTL_MS = 1200;

interface Props {
  frameRef: React.MutableRefObject<Frame | null>;
  overlaysRef: React.MutableRefObject<TelemetryEvent[]>;
  /**
   * Filled with the letterbox transform of every drawn frame. Interact inverts it to turn a touch into an
   * absolute screen coordinate — it must come from here, since only the draw loop knows the fit actually
   * used, and a stale or re-derived transform would land clicks in the wrong place.
   */
  transformRef?: React.MutableRefObject<ViewTransform | null>;
  /** Armed Interact: shows the crosshair + live border so it is obvious touches now reach the game. */
  interactive?: boolean;
  /**
   * Whether to draw the telemetry layer at all. Off still expires the events — the ref is pruned every
   * frame regardless, so turning the layer back on shows what the bot is doing *now* rather than a backlog
   * of everything it did while nobody was looking.
   */
  overlays?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void;
}

/**
 * Draws the latest frame (letterboxed to fit) and the fading telemetry overlays on a canvas, on its own
 * requestAnimationFrame loop reading the refs — decoupled from React renders so streaming video stays smooth.
 */
export function Renderer({
  frameRef,
  overlaysRef,
  transformRef,
  interactive = false,
  overlays = true,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const frame = frameRef.current;
      if (!frame) {
        if (transformRef) transformRef.current = null;
        return;
      }

      const s = Math.min(canvas.width / frame.sw, canvas.height / frame.sh);
      const dw = frame.sw * s, dh = frame.sh * s;
      const ox = (canvas.width - dw) / 2, oy = (canvas.height - dh) / 2;
      ctx.drawImage(frame.bitmap, ox, oy, dw, dh);
      if (transformRef) transformRef.current = { ox, oy, s, sx: frame.sx, sy: frame.sy };

      const now = Date.now();
      const live = overlaysRef.current.filter((o) => (o._exp ?? 0) > now);
      overlaysRef.current = live;
      if (!overlays) return;
      const toPoint = (x: number, y: number) => ({
        x: ox + (x - frame.sx) * s,
        y: oy + (y - frame.sy) * s,
      });
      const toCanvas = (r: Rect) => ({
        x: ox + (r.x - frame.sx) * s,
        y: oy + (r.y - frame.sy) * s,
        w: r.w * s,
        h: r.h * s,
      });
      for (const o of live) {
        const a = Math.max(0, ((o._exp ?? 0) - now) / OVERLAY_TTL_MS);
        if (o.region) strokeRect(ctx, toCanvas(o.region), `rgba(241,196,15,${a * 0.7})`, 1 * dpr);
        if (o.rect) {
          const color =
            o.kind === "Match"
              ? o.found
                ? `rgba(46,204,113,${a})`
                : `rgba(231,76,60,${a})`
              : `rgba(241,196,15,${a})`;
          strokeRect(ctx, toCanvas(o.rect), color, 2 * dpr);
        }
        if (o.kind === "Click" && o.x != null && o.y != null) {
          const p = toPoint(o.x, o.y);
          ctx.strokeStyle = `rgba(52,152,219,${a})`;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 8 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (o.kind === "Swipe" && o.x1 != null && o.y1 != null && o.x2 != null && o.y2 != null) {
          strokeArrow(ctx, toPoint(o.x1, o.y1), toPoint(o.x2, o.y2), `rgba(155,89,182,${a})`, 3 * dpr);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, overlaysRef, transformRef, overlays]);

  return (
    <canvas
      ref={canvasRef}
      className={`stage-canvas${interactive ? " interactive" : ""}`}
      // touch-action is what stops the browser from swallowing a drag as a scroll/pinch gesture.
      style={interactive ? { touchAction: "none" } : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
      onWheel={interactive ? onWheel : undefined}
    />
  );
}

interface Pt {
  x: number;
  y: number;
}

/**
 * The swipe: a line from where the gesture started to where it ended, with a head on the end.
 *
 * The head is the whole point. A bare line says a swipe happened somewhere along it, which is the one thing
 * already obvious; the direction is what a user is checking when they ask why a scroll went the wrong way.
 */
function strokeArrow(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, color: string, lineWidth: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // A tap-length "swipe" is a real gesture (a long-press that drifted a pixel) but has no direction worth
  // drawing, and normalising by a near-zero length would point the head anywhere at all.
  if (len < 1) return;
  const head = Math.min(14 * (lineWidth / 3), len / 2);
  const ux = dx / len, uy = dy / len;
  const bx = to.x - ux * head, by = to.y - uy * head;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(bx - uy * head * 0.5, by + ux * head * 0.5);
  ctx.lineTo(bx + uy * head * 0.5, by - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

function strokeRect(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  color: string,
  lineWidth: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}
