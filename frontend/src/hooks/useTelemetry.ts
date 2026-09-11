/**
 * useTelemetry — a synthetic CPU / RAM signal that reacts to the pipeline state.
 * It is only a *fallback*: the app prefers the real figures from
 * `useHostMetrics` (`/api/metrics`) and drops back to this when that stream is
 * down. Latency and token counts are real (from the chat request), not here.
 */

import { useEffect, useState } from 'react';
import type { VoiceState } from '../types';

export interface SynthLoad {
  cpu: number;
  ram: number;
}

const START: SynthLoad = { cpu: 18, ram: 41 };

export function useTelemetry(state: VoiceState, intervalMs = 1400): SynthLoad {
  const [load, setLoad] = useState<SynthLoad>(START);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLoad((prev) => {
        // PROCESSING is the busy peak; IDLE is quiet.
        const bias =
          state === 'PROCESSING' ? 34 : state === 'SPEAKING' ? 20 : state === 'LISTENING' ? 12 : 0;
        const jitter = (base: number, spread: number) =>
          Math.max(2, Math.min(99, base + bias + (Math.random() - 0.5) * spread));
        return {
          cpu: Math.round(jitter(prev.cpu * 0.5 + 16, 26)),
          ram: Math.round(jitter(prev.ram * 0.7 + 20, 10)),
        };
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [state, intervalMs]);

  return load;
}
