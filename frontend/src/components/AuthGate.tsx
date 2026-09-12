/**
 * AuthGate — the optional whole-app password gate. If the backend has no
 * APP_PASSWORD configured (or this browser already unlocked it before),
 * this is invisible: straight to <App/>, no splash. Otherwise it shows
 * LockScreen; on a *correct* password it mounts <App/> underneath and plays
 * BootSplash's reactor-landing animation as the reveal — a reward for the
 * moment you actually unlock it, not a wait tax on every load.
 */

import { useEffect, useRef, useState } from 'react';
import App from '../App';
import BootSplash from './BootSplash';
import LockScreen from './LockScreen';
import { getHealth } from '../lib/chatClient';
import { getAppPassword } from '../lib/appAuth';

type Status = 'checking' | 'locked' | 'unlocking' | 'unlocked';

export default function AuthGate() {
  const [status, setStatus] = useState<Status>(() => (getAppPassword() ? 'unlocked' : 'checking'));
  const viaSplashRef = useRef(false);

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

  if (status === 'checking') return null;

  if (status === 'locked') {
    return (
      <LockScreen
        onUnlocked={() => {
          viaSplashRef.current = true;
          setStatus('unlocking');
        }}
      />
    );
  }

  // 'unlocking' and (once BootSplash finishes) 'unlocked'-via-splash render
  // the *same* <App skipBootSweep/> element across that transition, so it
  // never remounts and never replays its own entrance sweep mid-reveal.
  if (status === 'unlocking' || (status === 'unlocked' && viaSplashRef.current)) {
    return (
      <>
        <App skipBootSweep />
        {status === 'unlocking' && <BootSplash onDone={() => setStatus('unlocked')} />}
      </>
    );
  }

  // Returning visitor whose password was already stored — no splash shown.
  return <App />;
}
