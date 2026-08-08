// Wire protocol shared with the Studio-side PilotServer (see botmaker-pilot/README.md).

export type RunState = "running" | "stopped" | "paused";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Target {
  title: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A decoded telemetry event (the body of a {"type":"telemetry","event":…} message). */
export interface TelemetryEvent {
  ts: number;
  kind: "Match" | "Click" | "Region" | "Swipe";
  target: Target | null;
  found?: boolean;
  confidence?: number;
  region?: Rect | null;
  rect?: Rect | null;
  x?: number;
  y?: number;
  button?: number;
  /** Swipe: both ends of the gesture, absolute, and how long it was asked to take. */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  duration?: number;
  /** Client-side expiry stamp for fading overlays; not on the wire. */
  _exp?: number;
}

/**
 * A decoded picture plus the absolute surface rect its (0,0) maps to.
 *
 * `bitmap` is whichever of the two paths produced it: an `ImageBitmap` decoded from a JPEG frame, or a
 * `VideoFrame` out of the H.264 decoder. They are interchangeable everywhere it matters — both are a
 * `CanvasImageSource` that `drawImage` takes, and both are released with `.close()` — which is what let the
 * video path reuse the renderer, the fit maths and the telemetry overlay untouched.
 *
 * The rect is *not* the picture's pixel size and never has been: it is the surface the picture is *of*, in
 * absolute screen coordinates, which is what lets the stream be downscaled without moving a single tap.
 */
export interface Frame {
  bitmap: CanvasImageSource & { close(): void };
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** One manual Interact gesture step. Coordinates are absolute screen px on the Studio host. */
export interface InputCmd {
  cmd: "input";
  kind: "tap" | "down" | "move" | "up" | "scroll";
  x: number;
  y: number;
  button?: number;
  amount?: number;
}

/**
 * Anything the client can send. Run control and the Interact arm/disarm are simple flag commands; gestures
 * carry coordinates. Interact starts disarmed on every new connection — the server enforces that too, so a
 * passive viewer can never poke the game.
 */
export type ControlCmd =
  | { cmd: "start" | "stop" | "pause" | "resume" }
  | { cmd: "interact"; on: boolean }
  | HelloCmd
  | InputCmd;

/**
 * What this client can decode. Sent on connect, and *again* with an empty `accept` if the decoder later turns
 * out not to work — a WebView can advertise `VideoDecoder` and still refuse the stream, and telling the server
 * to stop sending H.264 is the only recovery that ends with a picture on screen.
 *
 * Saying nothing at all is a valid client: Studio serves JPEG to anyone who never says hello, which is every
 * build of this app that predates the video path.
 */
export interface HelloCmd {
  cmd: "hello";
  accept: "h264"[];
}

/** A running H.264 stream, as announced by `{"type":"video",…}`. A null codec ends one. */
export interface VideoStreamInfo {
  codec: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "closed";

/**
 * The letterbox transform the canvas is currently drawing with. Inverting it is what turns a touch on the
 * video into the absolute screen coordinate an Interact gesture needs, so the renderer publishes it rather
 * than each consumer re-deriving the fit maths.
 */
export interface ViewTransform {
  /** Canvas-space offset of the drawn image's top-left, in device pixels. */
  ox: number;
  oy: number;
  /** Scale from surface px to canvas device px. */
  s: number;
  /** Absolute screen origin the drawn image's (0,0) maps to. */
  sx: number;
  sy: number;
}

/** Where to reach a Studio PilotServer. */
export interface Endpoint {
  host: string;
  port: number;
  token: string;
  secure: boolean;
}
