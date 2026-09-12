/**
 * AuthGate — the optional whole-app password gate, plus the boot reveal.
 * Every load probes the backend once; if that succeeds (no password
 * configured, or this browser's remembered one still checks out) it mounts
 * <App/> and plays BootSplash's reactor-landing animation as the entrance —
 * every time, not just the first unlock. Only a visitor who still needs to
 * type the password sees LockScreen first; once they submit a correct one,
 * the same reveal plays.
 */

import { useEffect, useState } from 'react';
import App from '../App';
import BootSplash from './BootSplash';
import LockScreen from './LockScreen';
import { getHealth } from '../lib/chatClient';

type Status = 'checking' | 'locked' | 'revealing' | 'unlocked';

export default function AuthGate() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let alive = true;
    getHealth().then((h) => {
      if (alive) setStatus(h ? 'revealing' : 'locked');
    });
    return () => {
      alive = false;
    };
  }, []);

  if (status === 'checking') return null;

  if (status === 'locked') {
    return <LockScreen onUnlocked={() => setStatus('revealing')} />;
  }

  // 'revealing' and 'unlocked' render the *same* <App skipBootSweep/>
  // element, so it never remounts or replays its own entrance mid-reveal.
  return (
    <>
      <App skipBootSweep />
      {status === 'revealing' && <BootSplash onDone={() => setStatus('unlocked')} />}
    </>
  );
}
