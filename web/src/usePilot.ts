import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnStatus, ControlCmd, Endpoint, Frame, RunState, TelemetryEvent } from "./types";

const OVERLAY_TTL_MS = 1200;

function wsUrl(ep: Endpoint): string {
  const proto = ep.secure ? "wss" : "ws";
  return `${proto}://${ep.host}:${ep.port}/ws?token=${encodeURIComponent(ep.token)}`;
}

/**
 * Owns the WebSocket to a PilotServer: connects (with reconnect backoff), decodes binary frames and text
 * (telemetry/state) messages, and sends control commands. Frame + overlay state are exposed via refs the
 * canvas renderer reads each rAF, so a 12 FPS video stream doesn't trigger 12 React renders/sec.
 */
export function usePilot(endpoint: Endpoint | null) {
  const [status, setStatus] = useState<ConnStatus>("closed");
  const [runState, setRunState] = useState<RunState>("stopped");

  const frameRef = useRef<Frame | null>(null);
  const overlaysRef = useRef<TelemetryEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const closedByUs = useRef(false);

  const send = useCallback((cmd: ControlCmd) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cmd }));
  }, []);

  useEffect(() => {
    if (!endpoint) return;
    closedByUs.current = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      setStatus((s) => (s === "closed" ? "connecting" : "reconnecting"));
      const ws = new WebSocket(wsUrl(endpoint));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        backoffRef.current = 500;
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closedByUs.current) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 8000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") handleText(ev.data);
        else handleBinary(ev.data as ArrayBuffer);
      };
    };

    const handleText = (text: string) => {
      let msg: { type?: string; run?: RunState; event?: TelemetryEvent };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "state" && msg.run) setRunState(msg.run);
      else if (msg.type === "telemetry" && msg.event) {
        const e = msg.event;
        e._exp = Date.now() + OVERLAY_TTL_MS;
        const next = [...overlaysRef.current, e];
        overlaysRef.current = next.length > 40 ? next.slice(next.length - 40) : next;
      }
    };

    const handleBinary = (buf: ArrayBuffer) => {
      const dv = new DataView(buf);
      const sx = dv.getInt32(0), sy = dv.getInt32(4), sw = dv.getInt32(8), sh = dv.getInt32(12);
      const blob = new Blob([buf.slice(16)], { type: "image/jpeg" });
      // createImageBitmap decodes off the main thread; close the previous bitmap to free memory.
      createImageBitmap(blob)
        .then((bitmap) => {
          const prev = frameRef.current;
          frameRef.current = { bitmap, sx, sy, sw, sh };
          if (prev) prev.bitmap.close();
        })
        .catch(() => {});
    };

    connect();
    return () => {
      closedByUs.current = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
      frameRef.current?.bitmap.close();
      frameRef.current = null;
      overlaysRef.current = [];
    };
  }, [endpoint]);

  return { status, runState, frameRef, overlaysRef, send };
}
