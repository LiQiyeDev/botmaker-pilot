import { useEffect, useRef, useState } from "react";
import type { Endpoint, ViewTransform } from "./types";
import { initialEndpoint, upsertConnection, touchConnection } from "./config";
import { usePilot } from "./usePilot";
import { Renderer } from "./Renderer";
import { ConnectScreen } from "./ConnectScreen";
import { useInteract } from "./useInteract";
import { useAppUpdate, LATEST_APK_URL } from "./useAppUpdate";

export function App() {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(initialEndpoint);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const { available: updateAvailable, latest } = useAppUpdate();
  const { status, runState, backgroundInput, frameRef, overlaysRef, send } = usePilot(endpoint);

  // Interact: tapping the stage reveals the toggle; the toggle arms it. Both start off, and both reset when
  // the connection drops — an armed session must not silently survive a reconnect to a different endpoint.
  const [controlsShown, setControlsShown] = useState(false);
  const [interact, setInteract] = useState(false);
  const transformRef = useRef<ViewTransform | null>(null);
  const gestures = useInteract(send, transformRef, interact);

  // The server arms per connection, so mirror every local change onto the wire (and re-arm on reconnect).
  useEffect(() => {
    if (status === "connected") send({ cmd: "interact", on: interact });
  }, [status, interact, send]);

  useEffect(() => {
    if (!endpoint) {
      setInteract(false);
      setControlsShown(false);
    }
  }, [endpoint]);

  // Once a socket actually opens, bump the connection's recency so it sorts to the top of "Recent".
  useEffect(() => {
    if (status === "connected" && endpoint) touchConnection(endpoint);
  }, [status, endpoint]);

  const connect = (ep: Endpoint) => {
    upsertConnection(ep);
    setEndpoint(ep);
  };
  // Non-destructive: drop the live socket but keep the endpoint in history so it stays in "Recent".
  const disconnect = () => setEndpoint(null);


  const updateBanner =
    updateAvailable && !updateDismissed ? (
      <div className="update-banner">
        <span>Update available{latest ? ` (${latest})` : ""}</span>
        <a className="update-get" href={LATEST_APK_URL} target="_blank" rel="noreferrer">
          Get it
        </a>
        <button className="update-x" onClick={() => setUpdateDismissed(true)} aria-label="Dismiss">
          ✕
        </button>
      </div>
    ) : null;

  if (!endpoint) {
    return (
      <>
        {updateBanner}
        <ConnectScreen initial={null} onConnect={connect} />
      </>
    );
  }

  return (
    <div className="app">
      {updateBanner}
      <header>
        <b>BotPilot</b>
        <span className={`conn ${status}`}>{status}</span>
        <span className={`run ${runState}`}>{runState}</span>
        <button className="link" onClick={disconnect}>disconnect</button>
      </header>

      <div className="stage" onClick={() => setControlsShown(true)}>
        <Renderer
          frameRef={frameRef}
          overlaysRef={overlaysRef}
          transformRef={transformRef}
          interactive={interact}
          {...gestures}
        />
        {controlsShown && (
          <div className="stage-tools" onClick={(e) => e.stopPropagation()}>
            <button
              className={`interact${interact ? " on" : ""}`}
              onClick={() => setInteract((v) => !v)}
              disabled={status !== "connected"}
            >
              {interact ? "✋ Interacting" : "✋ Interact"}
            </button>
            {interact && !backgroundInput && (
              <span className="interact-warn">moves the computer’s real cursor</span>
            )}
          </div>
        )}
        {status !== "connected" && (
          <div className="reconnect-overlay">
            <p>{status === "connecting" ? "Connecting…" : "Can’t reach this connection — retrying…"}</p>
            <button className="switch" onClick={disconnect}>Switch connection</button>
          </div>
        )}
      </div>

      <nav className="controls">
        <button className="go" onClick={() => send({ cmd: "start" })} disabled={runState === "running"}>▶ Start</button>
        <button onClick={() => send({ cmd: "stop" })} disabled={runState === "stopped"}>■ Stop</button>
        <button onClick={() => send({ cmd: "pause" })} disabled={runState !== "running"}>⏸ Pause</button>
        <button onClick={() => send({ cmd: "resume" })} disabled={runState !== "paused"}>⏵ Resume</button>
      </nav>
    </div>
  );
}
