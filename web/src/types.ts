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
  kind: "Match" | "Click" | "Region";
  target: Target | null;
  found?: boolean;
  confidence?: number;
  region?: Rect | null;
  rect?: Rect | null;
  x?: number;
  y?: number;
  button?: number;
  /** Client-side expiry stamp for fading overlays; not on the wire. */
  _exp?: number;
}

/** A decoded binary video frame: the JPEG bitmap plus the absolute surface rect its (0,0) maps to. */
export interface Frame {
  bitmap: ImageBitmap;
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
  | InputCmd;

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
