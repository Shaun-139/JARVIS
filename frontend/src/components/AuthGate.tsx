/**
 * AuthGate — optional whole-app password gate. If the backend has no
 * APP_PASSWORD configured, this is invisible: one unauthenticated health
 * check succeeds and the app mounts normally. Otherwise it shows a single
 * password prompt, verified against the server, remembered on this device.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import App from '../App';
import { getHealth } from '../lib/chatClient';
import { getAppPassword, setAppPassword, clearAppPassword } from '../lib/appAuth';

type Status = 'checking' | 'locked' | 'unlocked';

export default function AuthGate() {
  const [status, setStatus] = useState<Status>(() => (getAppPassword() ? 'unlocked' : 'checking'));
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Nothing stored yet — one unauthenticated probe tells us whether the
  // server even requires a password before bothering the user with a prompt.
  useEffect(() => {
    if (status !== 'checking') return;
    let alive = true;
    getHealth().then((h) => {
      if (alive) setStatus(h ? 'unlocked' : 'locked');
    });
    return () => {
      alive = false;
    };
  }, [status]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true);
    setError('');
    setAppPassword(pw.trim());
    const h = await getHealth();
    setBusy(false);
    if (h) {
      setStatus('unlocked');
    } else {
      clearAppPassword();
      setError('Incorrect password.');
    }
  };

  if (status === 'unlocked') return <App />;
  if (status === 'checking') return null;

  return (
    <div className="flex min-h-[100dvh] w-screen items-center justify-center bg-space-900 px-4 text-cyan-100">
      <form onSubmit={submit} className="hud-panel w-[min(360px,100%)] bg-slate-950/80 p-6">
        <div className="mb-4 flex items-center gap-2 text-arc-cyan">
          <Lock size={18} />
          <span className="font-hud text-sm font-semibold tracking-[0.22em] uppercase">
            Access Restricted
          </span>
        </div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          aria-label="App password"
          className="w-full border border-arc-cyan/25 bg-slate-950/60 px-3 py-2 font-mono text-sm text-cyan-100 outline-none placeholder:text-arc-cyan/25 focus:border-arc-cyan/60"
        />
        {error && <p className="mt-2 font-mono text-[11px] text-rose-300/80">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 border border-arc-cyan/40 px-3 py-2 font-hud text-[11px] tracking-[0.2em] text-arc-cyan uppercase transition-colors hover:border-arc-cyan hover:bg-arc-cyan/10 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
