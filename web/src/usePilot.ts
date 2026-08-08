import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnStatus, ControlCmd, Endpoint, Frame, RunState, TelemetryEvent, VideoStreamInfo } from "./types";

const OVERLAY_TTL_MS = 1200;

/** Binary tag bytes of an H.264 message. A JPEG frame carries no tag — see `handleBinary`. */
const TAG_H264 = 2;
const TAG_H264_KEY = 3;

function wsUrl(ep: Endpoint): string {
  const proto = ep.secure ? "wss" : "ws";
  return `${proto}://${ep.host}:${ep.port}/ws?token=${encodeURIComponent(ep.token)}`;
}

/**
 * Whether this runtime has the WebCodecs decoder at all. It is a capability check, not a guarantee: a WebView
 * can expose `VideoDecoder` and still fail to configure one (no hardware decoder for the profile, a locked-down
 * embedder), which is why `startVideo` also has to survive the attempt failing.
 */
function canDecodeH264(): boolean {
  return typeof VideoDecoder !== "undefined";
}

/**
 * Owns the WebSocket to a PilotServer: connects (with reconnect backoff), decodes the video — as JPEG frames or
 * as an H.264 stream, whichever the server is sending — and text (telemetry/state) messages, and sends control
 * commands. Frame + overlay state are exposed via refs the canvas renderer reads each rAF, so a 24 FPS stream
 * doesn't trigger 24 React renders/sec.
 *
 * ## The two frame paths
 *
 * JPEG is the floor and needs no negotiation: a binary message is a 16-byte rect header and a JPEG, decoded
 * with `createImageBitmap`. H.264 is offered only if this client asks for it in its `hello` and the server has
 * a session it can encode; the server then announces the stream with a `video` message — carrying the surface
 * rect *once*, since it no longer changes per frame — and every binary message after that is one tagged access
 * unit for the decoder.
 *
 * Both paths end in the same `frameRef`, holding a thing `drawImage` accepts and `.close()` releases, so the
 * renderer, the fit maths and the Interact coordinate mapping are identical either way. **Every** failure of
 * the video path — no `VideoDecoder`, a `configure` that throws, a decoder that errors mid-stream — hands back
 * to JPEG by telling the server this client no longer accepts H.264.
 */
export function usePilot(endpoint: Endpoint | null) {
  const [status, setStatus] = useState<ConnStatus>("closed");
  const [runState, setRunState] = useState<RunState>("stopped");
  // Whether the host can synthesize input without hijacking its real cursor (see PilotInputService).
  const [backgroundInput, setBackgroundInput] = useState(true);

  const frameRef = useRef<Frame | null>(null);
  const overlaysRef = useRef<TelemetryEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const closedByUs = useRef(false);

  const send = useCallback((cmd: ControlCmd) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  useEffect(() => {
    if (!endpoint) return;
    closedByUs.current = false;
    let reconnectTimer: number | undefined;

    /** The live decoder and the rect its pictures map to, or null while this connection is on JPEG. */
    let video: { decoder: VideoDecoder; rect: Omit<VideoStreamInfo, "codec"> } | null = null;
    /** A monotonic microsecond stamp. The decoder requires one and passes it through; nothing here reads it. */
    let stamp = 0;

    const publish = (bitmap: Frame["bitmap"], rect: Omit<VideoStreamInfo, "codec">) => {
      const prev = frameRef.current;
      frameRef.current = { bitmap, ...rect };
      // Release the previous picture only once its replacement is in place: a VideoFrame left unclosed
      // stalls the decoder within a few frames, and one closed early is drawn as a blank.
      if (prev) prev.bitmap.close();
    };

    const stopVideo = () => {
      const running = video;
      video = null;
      if (!running) return;
      try {
        running.decoder.close();
      } catch {
        // Already closed by its own error handler; there is nothing to undo.
      }
    };

    /**
     * Give up on H.264 for this connection and say so, so the server resumes JPEG. Called for every way the
     * decoder can fail — the alternative is a canvas that stops updating with nothing to explain it.
     */
    const fallBackToJpeg = (ws: WebSocket) => {
      stopVideo();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cmd: "hello", accept: [] }));
    };

    const startVideo = (ws: WebSocket, info: VideoStreamInfo) => {
      stopVideo();
      const rect = { sx: info.sx, sy: info.sy, sw: info.sw, sh: info.sh };
      try {
        const decoder = new VideoDecoder({
          output: (frame) => publish(frame, rect),
          error: () => fallBackToJpeg(ws),
        });
        decoder.configure({ codec: info.codec, optimizeForLatency: true });
        video = { decoder, rect };
      } catch {
        // The runtime has VideoDecoder but cannot decode this profile. Nothing is broken yet — the server
        // has simply been sending a format this phone can't read, and telling it so restores the picture.
        fallBackToJpeg(ws);
      }
    };

    const connect = () => {
      setStatus((s) => (s === "closed" ? "connecting" : "reconnecting"));
      const ws = new WebSocket(wsUrl(endpoint));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        backoffRef.current = 500;
        // Before anything else on the socket: what this client can decode. A server that predates this
        // ignores the command, and a client that never sends it is served JPEG — so neither end needs a
        // version number.
        ws.send(JSON.stringify({ cmd: "hello", accept: canDecodeH264() ? ["h264"] : [] }));
      };
      ws.onclose = () => {
        wsRef.current = null;
        stopVideo();   // a decoder outliving its socket would decode into a frame nothing draws
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
        if (typeof ev.data === "string") handleText(ws, ev.data);
        else handleBinary(ws, ev.data as ArrayBuffer);
      };
    };

    const handleText = (ws: WebSocket, text: string) => {
      let msg: {
        type?: string;
        run?: RunState;
        backgroundInput?: boolean;
        event?: TelemetryEvent;
        codec?: string | null;
        sx?: number; sy?: number; sw?: number; sh?: number;
      };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "state") {
        if (msg.run) setRunState(msg.run);
        if (typeof msg.backgroundInput === "boolean") setBackgroundInput(msg.backgroundInput);
      }
      else if (msg.type === "video") {
        if (!msg.codec) stopVideo();
        else startVideo(ws, { codec: msg.codec, sx: msg.sx ?? 0, sy: msg.sy ?? 0, sw: msg.sw ?? 0, sh: msg.sh ?? 0 });
      }
      else if (msg.type === "telemetry" && msg.event) {
        const e = msg.event;
        e._exp = Date.now() + OVERLAY_TTL_MS;
        const next = [...overlaysRef.current, e];
        overlaysRef.current = next.length > 40 ? next.slice(next.length - 40) : next;
      }
    };

    /**
     * A binary message is H.264 while a decoder is running, and a JPEG frame otherwise. The decoder's presence
     * is the discriminator rather than the tag byte, because the tag exists only on the newer payload — the
     * JPEG framing is unchanged from builds this server still has to serve. The tag is checked all the same:
     * the `video` message that starts a stream arrives on the same ordered socket as the packets it describes,
     * so a mismatch is not a race, it is a bug.
     */
    const handleBinary = (ws: WebSocket, buf: ArrayBuffer) => {
      if (video) {
        const tag = new Uint8Array(buf, 0, 1)[0];
        if (tag !== TAG_H264 && tag !== TAG_H264_KEY) return;
        try {
          video.decoder.decode(new EncodedVideoChunk({
            type: tag === TAG_H264_KEY ? "key" : "delta",
            timestamp: (stamp += 1000),
            data: new Uint8Array(buf, 1),
          }));
        } catch {
          fallBackToJpeg(ws);
        }
        return;
      }
      const dv = new DataView(buf);
      const sx = dv.getInt32(0), sy = dv.getInt32(4), sw = dv.getInt32(8), sh = dv.getInt32(12);
      // createImageBitmap decodes off the main thread; publish() closes the previous picture.
      createImageBitmap(new Blob([buf.slice(16)], { type: "image/jpeg" }))
        .then((bitmap) => publish(bitmap, { sx, sy, sw, sh }))
        .catch(() => {});
    };

    connect();
    return () => {
      closedByUs.current = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      stopVideo();
      wsRef.current?.close();
      wsRef.current = null;
      frameRef.current?.bitmap.close();
      frameRef.current = null;
      overlaysRef.current = [];
    };
  }, [endpoint]);

  return { status, runState, backgroundInput, frameRef, overlaysRef, send };
}
