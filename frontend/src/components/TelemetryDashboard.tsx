/**
 * TelemetryDashboard — the top strip of circular HUD meters inside a
 * glassmorphism panel. Mirrors the RAM / CPU / SWAP-style gauges from the
 * Stark-Expo reference.
 */

import TelemetryGauge from './TelemetryGauge';
import type { PressureState } from '../hooks/useComputePressure';
import type { GaugeConfig, TelemetrySample } from '../types';

export const PRESSURE_COLOR: Record<PressureState, string> = {
  nominal: '#34d399',
  fair: '#00F0FF',
  serious: '#fbbf24',
  critical: '#fb7185',
};

export const GAUGES: GaugeConfig[] = [
  { key: 'cpu', label: 'CPU', max: 100, unit: '%', format: (v) => `${Math.round(v)}` },
  { key: 'ram', label: 'RAM', max: 100, unit: '%', format: (v) => `${Math.round(v)}` },
  {
    key: 'latency',
    label: 'TTFT',
    max: 2500,
    unit: 'ms',
    format: (v) => (v <= 0 ? '—' : `${Math.round(v)}`),
  },
  {
    key: 'tokens',
    label: 'Tokens',
    max: 20000,
    unit: 'session',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
  },
];

export interface TelemetryDashboardProps {
  sample: TelemetrySample;
  /** Real host CPU/RAM stream is connected. */
  hostConnected?: boolean;
  /** 'personal' when a telemetry agent is relaying your own machine's stats. */
  hostSource?: 'personal' | 'server';
  /** Compute Pressure API state, if the browser supports it. */
  pressure?: PressureState | null;
}

export default function TelemetryDashboard({
  sample,
  hostConnected,
  hostSource,
  pressure,
}: TelemetryDashboardProps) {
  return (
    <div className="hud-panel hud-scroll flex max-w-full items-center gap-5 overflow-x-auto px-6 py-3">
      <div className="flex shrink-0 flex-col pr-4">
        <span className="hud-label">System</span>
        <span className="font-hud text-lg font-semibold tracking-[0.16em] text-arc-cyan drop-shadow-glow">
          TELEMETRY
        </span>
        <span className="flex items-center gap-2 text-[10px] font-mono text-arc-cyan/45">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                hostConnected
                  ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.9)]'
                  : 'bg-amber-400/60'
              }`}
            />
            {!hostConnected ? 'host · sim' : hostSource === 'personal' ? 'host · you' : 'host · live'}
          </span>
          {pressure && (
            <span
              className="flex items-center gap-1.5"
              title="Browser Compute Pressure (CPU)"
              style={{ color: PRESSURE_COLOR[pressure] }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: PRESSURE_COLOR[pressure] }}
              />
              {pressure}
            </span>
          )}
        </span>
      </div>
      <div className="h-16 w-px bg-arc-cyan/20" />
      {GAUGES.map((g) => (
        <TelemetryGauge key={g.key} config={g} value={sample[g.key]} />
      ))}
    </div>
  );
}
