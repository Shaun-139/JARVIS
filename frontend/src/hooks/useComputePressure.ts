/**
 * useComputePressure — the one browser-native "how hard is the CPU working"
 * signal: the Compute Pressure API (`PressureObserver`, Chrome 125+, secure
 * context). Reports a state, not a percentage. Absent everywhere else.
 */

import { useEffect, useState } from 'react';

export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';

interface PressureRecordLike {
  source: string;
  state: PressureState;
}
interface PressureObserverLike {
  observe: (source: string, options?: { sampleInterval?: number }) => Promise<void>;
  disconnect: () => void;
}
type PressureObserverCtor = new (
  cb: (records: PressureRecordLike[]) => void,
) => PressureObserverLike;

export function computePressureSupported(): boolean {
  return typeof window !== 'undefined' && 'PressureObserver' in window;
}

export function useComputePressure(): PressureState | null {
  const [state, setState] = useState<PressureState | null>(null);

  useEffect(() => {
    const Ctor = (window as unknown as { PressureObserver?: PressureObserverCtor }).PressureObserver;
    if (!Ctor) return;

    let obs: PressureObserverLike | null = null;
    try {
      obs = new Ctor((records) => {
        const last = records[records.length - 1];
        if (last?.state) setState(last.state);
      });
      obs.observe('cpu', { sampleInterval: 2000 }).catch(() => setState(null));
    } catch {
      setState(null);
    }
    return () => obs?.disconnect();
  }, []);

  return state;
}
