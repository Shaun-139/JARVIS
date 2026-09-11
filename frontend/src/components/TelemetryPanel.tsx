/**
 * TelemetryPanel — the sidebar's "Telemetry" view: an expanded systems screen.
 * CPU/RAM are real host figures from the proxy's /api/metrics stream (synthetic
 * fallback until it connects); TTFT + session tokens come from the chat request.
 * Everything here is real bar the CPU/RAM fallback.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import TelemetryGauge from './TelemetryGauge';
import { GAUGES } from './TelemetryDashboard';
import { staggerIn } from '../utils/animations';
import type { ProviderStatus } from '../lib/chatClient';
import type { TurnStats } from '../hooks/useConversationEngine';
import type { HostMetrics } from '../hooks/useHostMetrics';
import { computePressureSupported, type PressureState } from '../hooks/useComputePressure';
import { PRESSURE_COLOR } from './TelemetryDashboard';
import type { ChatMessageModel, TelemetrySample } from '../types';

export interface TelemetryPanelProps {
  sample: TelemetrySample;
  host: HostMetrics | null;
  hostConnected: boolean;
  pressure?: PressureState | null;
  providers: Record<string, ProviderStatus>;
  activeProvider: string;
  stats: TurnStats;
  messages: ChatMessageModel[];
  stt: string;
  tts: string;
}

const ms = (v: number | null) => (v == null ? '—' : `${Math.round(v)} ms`);

function uptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export default function TelemetryPanel({
  sample,
  host,
  hostConnected,
  pressure,
  providers,
  activeProvider,
  stats,
  messages,
  stt,
  tts,
}: TelemetryPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const blocks = rootRef.current?.querySelectorAll('.tel-block');
    if (!blocks || !blocks.length) return;
    const inst = staggerIn(blocks, { each: 50, translateY: 12 });
    return () => {
      inst.pause();
      anime.remove(blocks);
    };
  }, []);

  const stat = (label: string, value: string) => (
    <div className="flex items-center justify-between border-b border-arc-cyan/10 py-1.5 last:border-0">
      <span className="hud-label">{label}</span>
      <span className="font-mono text-xs text-arc-cyan">{value}</span>
    </div>
  );

  return (
    <section
      ref={rootRef}
      className="hud-scroll hud-panel flex h-full flex-col gap-4 overflow-y-auto bg-slate-950/60 p-5"
    >
      <div className="tel-block flex items-baseline justify-between opacity-0">
        <span className="font-hud text-sm font-semibold tracking-[0.22em] text-arc-cyan uppercase">
          Systems
        </span>
        <span
          className={`font-mono text-[9px] uppercase tracking-widest ${
            hostConnected ? 'text-emerald-300/70' : 'text-amber-300/60'
          }`}
        >
          {hostConnected ? 'all readings live' : 'cpu·ram sim — host stream down'}
        </span>
      </div>

      <div className="tel-block grid grid-cols-2 gap-y-4 opacity-0">
        {GAUGES.map((g) => {
          // cpu/ram need the host stream; ttft/tokens are always real measurements.
          const isLive =
            g.key === 'cpu' || g.key === 'ram' ? hostConnected : true;
          return (
            <div key={g.key} className="relative flex justify-center">
              <TelemetryGauge config={g} value={sample[g.key]} size={92} />
              {isLive && (
                <span className="absolute right-3 top-0 h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.9)]" />
              )}
            </div>
          );
        })}
      </div>

      {host && (
        <div className="tel-block opacity-0">
          <span className="hud-label mb-1 block">Host</span>
          {stat('CPU cores', String(host.cores))}
          {stat('Memory', `${host.ramUsedGb} / ${host.ramTotalGb} GB`)}
          {stat('Proxy process', `${host.procMb} MB · ${host.procCpu}% cpu`)}
          {stat('Proxy uptime', uptime(host.uptimeS))}
          <div className="flex items-center justify-between py-1.5">
            <span className="hud-label">CPU pressure</span>
            {pressure ? (
              <span
                className="font-mono text-xs capitalize"
                style={{ color: PRESSURE_COLOR[pressure] }}
              >
                {pressure}
              </span>
            ) : (
              <span className="font-mono text-xs text-arc-cyan/35">
                {computePressureSupported() ? 'reading…' : 'n/a'}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="tel-block opacity-0">
        <span className="hud-label mb-1 block">Session</span>
        {stat('Turns', String(stats.turns))}
        {stat('Transcript', `${messages.length} msg`)}
        {stat(
          'Tokens · session',
          stats.sessionTokens ? stats.sessionTokens.toLocaleString() : '—',
        )}
        {stat(
          'Tokens · last turn',
          stats.lastPromptTokens == null
            ? '—'
            : `${stats.lastPromptTokens} in · ${stats.lastCompletionTokens} out`,
        )}
        {stat('Time-to-first-token', ms(stats.ttftMs))}
        {stat('Last response', ms(stats.totalMs))}
      </div>

      <div className="tel-block opacity-0">
        <span className="hud-label mb-1 block">Chat providers</span>
        {Object.entries(providers).length === 0 && (
          <span className="font-mono text-[11px] text-arc-cyan/35">probing…</span>
        )}
        {Object.entries(providers).map(([id, p]) => {
          const active = id === activeProvider;
          return (
            <div
              key={id}
              className={`flex items-center gap-2 border-b border-arc-cyan/10 py-1.5 last:border-0 ${
                active ? 'text-arc-cyan' : 'text-cyan-100/70'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  p.ready ? 'bg-emerald-400' : 'bg-amber-400/70'
                }`}
                style={p.ready ? { boxShadow: '0 0 6px rgba(52,211,153,0.8)' } : undefined}
              />
              <span className="font-hud text-xs tracking-wide">{p.label}</span>
              {p.local && (
                <span className="rounded-sm border border-arc-cyan/25 px-1 font-mono text-[8px] uppercase text-arc-cyan/50">
                  local
                </span>
              )}
              {active && (
                <span className="rounded-sm border border-arc-cyan/40 px-1 font-mono text-[8px] uppercase text-arc-cyan">
                  active
                </span>
              )}
              <span className="ml-auto truncate font-mono text-[10px] text-arc-cyan/45">
                {p.ready ? p.model : `set key`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="tel-block opacity-0">
        <span className="hud-label mb-1 block">Speech</span>
        {stat('Transcription', stt)}
        {stat('Synthesis', tts)}
      </div>
    </section>
  );
}
