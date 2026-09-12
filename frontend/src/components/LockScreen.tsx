/**
 * LockScreen — the password prompt itself, split out of AuthGate so
 * BootSplash can mount it underneath and reveal it on exit, the same way it
 * reveals <App/> on the unlocked path.
 */

import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { getHealth } from '../lib/chatClient';
import { setAppPassword, clearAppPassword } from '../lib/appAuth';

export interface LockScreenProps {
  onUnlocked: () => void;
}

export default function LockScreen({ onUnlocked }: LockScreenProps) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true);
    setError('');
    setAppPassword(pw.trim());
    const h = await getHealth();
    setBusy(false);
    if (h) {
      onUnlocked();
    } else {
      clearAppPassword();
      setError('Incorrect password.');
    }
  };

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
