import { useState } from "react";
import type { Endpoint } from "./types";
import { parseUrl } from "./config";

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

  const submit = () => {
    const p = Number(port);
    if (!host || !p || !token) {
      setError("Host, port and token are all required.");
      return;
    }
    onConnect({ host, port: p, token, secure });
  };

  return (
    <div className="connect">
      <h1>BotPilot</h1>
      <p className="muted">Connect to BotMaker Studio (Enable Remote Pilot → copy the URL).</p>

      <label>Paste URL</label>
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
