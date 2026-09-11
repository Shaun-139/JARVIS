/**
 * useHostMetrics — subscribes to the proxy's `/api/metrics` SSE stream for real
 * host CPU / RAM (which the browser itself cannot read). Auto-reconnects via
 * `EventSource`; `connected` is false whenever the stream is down so callers can
 * fall back to something else.
 */

import { useEffect, useRef, useState } from 'react';

export interface HostMetrics {
  /** Whole-machine CPU utilisation, %. */
  cpu: number;
  /** Whole-machine memory in use, %. */
  ram: number;
  ramUsedGb: number;
  ramTotalGb: number;
  /** The proxy process's resident memory, MB. */
  procMb: number;
  /** The proxy process's CPU, % of one core. */
  procCpu: number;
  cores: number;
  uptimeS: number;
  ts: number;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export function useHostMetrics(): { metrics: HostMetrics | null; connected: boolean } {
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [connected, setConnected] = useState(false);
  const staleTimer = useRef<number>(0);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/metrics`);

    const markStale = () => {
      window.clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => setConnected(false), 5000);
    };

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as HostMetrics;
        setMetrics(m);
        setConnected(true);
        markStale();
      } catch {
        /* keep-alive / malformed frame */
      }
    };
    es.onerror = () => setConnected(false); // EventSource retries on its own

    return () => {
      window.clearTimeout(staleTimer.current);
      es.close();
    };
  }, []);

  return { metrics, connected };
}
