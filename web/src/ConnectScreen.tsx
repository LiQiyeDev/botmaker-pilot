import { useState } from "react";
import type { Endpoint } from "./types";
import {
  parseUrl,
  loadConnections,
  removeConnection,
  type SavedConnection,
} from "./config";
import { QrScanner } from "./QrScanner";
import { useAppUpdate, LATEST_APK_URL } from "./useAppUpdate";

interface Props {
  initial: Endpoint | null;
  onConnect: (ep: Endpoint) => void;
}

/** Relative "3m ago" / "2d ago" from an epoch millis timestamp. */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * First-run / reconnect pairing screen (used by the APK, and by a browser opened without a token). Offers a
 * list of previously-used connections to reconnect without rescanning, a QR scan, or manual host/port/token.
 */
export function ConnectScreen({ initial, onConnect }: Props) {
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ? String(initial.port) : "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [secure, setSecure] = useState(initial?.secure ?? false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [recent, setRecent] = useState<SavedConnection[]>(() => loadConnections());
  const { version, result, checkNow } = useAppUpdate();

  const applyPaste = (text: string) => {
    const ep = parseUrl(text);
    if (ep) {
      setHost(ep.host);
      setPort(String(ep.port));
      setToken(ep.token);
      setSecure(ep.secure);
      setError(null);
    }
  };

  // A scanned QR is just a pairing URL — parse it and connect straight away (same path as paste).
  const onScan = (text: string) => {
    setScanning(false);
    const ep = parseUrl(text);
    if (ep && ep.token) {
      onConnect(ep);
    } else {
      setError("That QR isn’t a BotPilot link. Scan the LEFT QR in Studio’s Remote Pilot dialog.");
    }
  };

  const forget = (ep: Endpoint) => setRecent(removeConnection(ep));

  const submit = () => {
    const p = Number(port);
    if (!host || !p || !token) {
      setError("Host, port and token are all required.");
      return;
    }
    onConnect({ host, port: p, token, secure });
  };

  if (scanning) {
    return <QrScanner onResult={onScan} onCancel={() => setScanning(false)} />;
  }

  return (
    <div className="connect">
      <h1>BotPilot</h1>
      <p className="muted">
        In BotMaker Studio open <b>Remote Pilot</b>, then scan the QR — nothing to install or register.
      </p>

      {recent.length > 0 && (
        <div className="recent">
          <label>Recent connections</label>
          {recent.map((c) => (
            <div className="recent-row" key={`${c.endpoint.host}:${c.endpoint.port}`}>
              <button className="recent-connect" onClick={() => onConnect(c.endpoint)}>
                <span className="recent-label">{c.label}</span>
                <span className="recent-meta">
                  {c.endpoint.secure ? "https" : "http"} · {ago(c.lastConnected)}
                </span>
              </button>
              <button className="recent-x" onClick={() => forget(c.endpoint)} aria-label="Forget">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="scan" onClick={() => setScanning(true)}>📷 Scan QR</button>

      <label>Or paste URL</label>
      <input
        placeholder="http://100.x.x.x:12345/?token=…"
        onChange={(e) => applyPaste(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="row">
        <div className="grow">
          <label>Host</label>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="100.64.0.1"
                 autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </div>
        <div className="port">
          <label>Port</label>
          <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="12345" />
        </div>
      </div>

      <label>Token</label>
      <input value={token} onChange={(e) => setToken(e.target.value)}
             autoCapitalize="off" autoCorrect="off" spellCheck={false} />

      <label className="check">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> Use TLS (wss)
      </label>

      {error && <p className="error">{error}</p>}
      <button className="go" onClick={submit}>Connect</button>

      <div className="about">
        <span>BotPilot v{version}</span>
        <button className="check-update" onClick={checkNow} disabled={result === "checking"}>
          {result === "checking" ? "Checking…" : "Check for updates"}
        </button>
        {result === "uptodate" && <span className="about-note">Up to date</span>}
        {result === "available" && (
          <a className="about-note update" href={LATEST_APK_URL} target="_blank" rel="noreferrer">
            Update available — Get it
          </a>
        )}
        {result === "error" && <span className="about-note">Couldn’t check (offline?)</span>}
      </div>
    </div>
  );
}
