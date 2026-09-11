/**
 * TelemetryGauge — a single circular SVG HUD meter (RAM / CPU / Latency /
 * Tokens). The arc is drawn with strokeDashoffset and every value change is
 * swept there by Anime.js (`sweepGauge`), never by a CSS transition.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { sweepGauge } from '../utils/animations';
import type { GaugeConfig } from '../types';

export interface TelemetryGaugeProps {
  config: GaugeConfig;
  /** Raw sample value (same unit as `config`). */
  value: number;
  size?: number;
}

const STROKE = 5;

export default function TelemetryGauge({ config, value, size = 84 }: TelemetryGaugeProps) {
  const arcRef = useRef<SVGCircleElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const prevValueRef = useRef(0);

  const r = (size - STROKE * 2) / 2;
  const cx = size / 2;
  const progress = Math.max(0, Math.min(1, value / config.max));

  useEffect(() => {
    const arc = arcRef.current;
    if (!arc) return;

    const sweep = sweepGauge(arc, progress, { duration: 1100, easing: 'easeOutCubic' });

    // Count the readout up/down in step with the arc sweep.
    const from = prevValueRef.current;
    const counter = anime({
      targets: { v: from },
      v: value,
      duration: 1100,
      easing: 'easeOutCubic',
      update: (a) => {
        const v = (a.animatables[0].target as unknown as { v: number }).v;
        if (numRef.current) numRef.current.textContent = config.format(v);
      },
    });
    prevValueRef.current = value;

    return () => {
      sweep.pause();
      counter.pause();
      anime.remove(arc);
    };
  }, [progress, value, config]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke="rgba(0,240,255,0.12)"
            strokeWidth={STROKE}
          />
          <circle
            ref={arcRef}
            className="gauge-circle"
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke="#00F0FF"
            strokeWidth={STROKE}
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 4px rgba(0,240,255,0.7))' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span ref={numRef} className="font-mono text-sm text-arc-cyan drop-shadow-glow">
            {config.format(value)}
          </span>
          <span className="text-[8px] uppercase tracking-[0.2em] text-arc-cyan/50">
            {config.unit}
          </span>
        </div>
      </div>
      <span className="hud-label">{config.label}</span>
    </div>
  );
}
