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

export type ControlCmd = "start" | "stop" | "pause" | "resume";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "closed";

/** Where to reach a Studio PilotServer. */
export interface Endpoint {
  host: string;
  port: number;
  token: string;
  secure: boolean;
}
