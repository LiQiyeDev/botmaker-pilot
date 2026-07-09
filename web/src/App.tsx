import { useState } from "react";
import type { Endpoint } from "./types";
import { initialEndpoint, saveEndpoint } from "./config";
import { usePilot } from "./usePilot";
import { Renderer } from "./Renderer";
import { ConnectScreen } from "./ConnectScreen";
import { useAppUpdate, LATEST_APK_URL } from "./useAppUpdate";

export function App() {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(initialEndpoint);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const { available: updateAvailable, latest } = useAppUpdate();
  const { status, runState, frameRef, overlaysRef, send } = usePilot(endpoint);

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
        <ConnectScreen
          initial={null}
          onConnect={(ep) => {
            saveEndpoint(ep);
            setEndpoint(ep);
          }}
        />
      </>
    );
  }

  const disconnect = () => setEndpoint(null);

  return (
    <div className="app">
      {updateBanner}
      <header>
        <b>BotPilot</b>
        <span className={`conn ${status}`}>{status}</span>
        <span className={`run ${runState}`}>{runState}</span>
        <button className="link" onClick={disconnect}>disconnect</button>
      </header>

      <div className="stage">
        <Renderer frameRef={frameRef} overlaysRef={overlaysRef} />
      </div>

      <nav className="controls">
        <button className="go" onClick={() => send("start")} disabled={runState === "running"}>▶ Start</button>
        <button onClick={() => send("stop")} disabled={runState === "stopped"}>■ Stop</button>
        <button onClick={() => send("pause")} disabled={runState !== "running"}>⏸ Pause</button>
        <button onClick={() => send("resume")} disabled={runState !== "paused"}>⏵ Resume</button>
      </nav>
    </div>
  );
}
