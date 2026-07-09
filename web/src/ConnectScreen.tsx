import { useState } from "react";
import type { Endpoint } from "./types";
import { parseUrl } from "./config";
import { QrScanner } from "./QrScanner";

interface Props {
  initial: Endpoint | null;
  onConnect: (ep: Endpoint) => void;
}

/**
 * First-run pairing screen (used by the APK, and by a browser opened without a token). Accepts either a
 * pasted full URL from Studio's "Enable Remote Pilot" dialog, or manual host / port / token fields.
 */
export function ConnectScreen({ initial, onConnect }: Props) {
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ? String(initial.port) : "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [secure, setSecure] = useState(initial?.secure ?? false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

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
    </div>
  );
}
