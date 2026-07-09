import { useEffect, useRef } from "react";
import type { Frame, Rect, TelemetryEvent } from "./types";

const OVERLAY_TTL_MS = 1200;

interface Props {
  frameRef: React.MutableRefObject<Frame | null>;
  overlaysRef: React.MutableRefObject<TelemetryEvent[]>;
}

/**
 * Draws the latest frame (letterboxed to fit) and the fading telemetry overlays on a canvas, on its own
 * requestAnimationFrame loop reading the refs — decoupled from React renders so streaming video stays smooth.
 */
export function Renderer({ frameRef, overlaysRef }: Props) {
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
      if (!frame) return;

      const s = Math.min(canvas.width / frame.sw, canvas.height / frame.sh);
      const dw = frame.sw * s, dh = frame.sh * s;
      const ox = (canvas.width - dw) / 2, oy = (canvas.height - dh) / 2;
      ctx.drawImage(frame.bitmap, ox, oy, dw, dh);

      const now = Date.now();
      const live = overlaysRef.current.filter((o) => (o._exp ?? 0) > now);
      overlaysRef.current = live;
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
          const px = ox + (o.x - frame.sx) * s, py = oy + (o.y - frame.sy) * s;
          ctx.strokeStyle = `rgba(52,152,219,${a})`;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(px, py, 8 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, overlaysRef]);

  return <canvas ref={canvasRef} className="stage-canvas" />;
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
