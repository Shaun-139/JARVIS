/**
 * VoiceVisualizer — the central multi-ringed ARC-reactor HUD.
 *
 * React decides the `state`; every pixel of motion here is produced by Anime.js
 * via `src/utils/animations.ts`:
 *   • persistent concentric ring rotations (alternating direction / duration)
 *   • per-state loops (IDLE breathing, PROCESSING strobe, gauge spin)
 *   • one-shot transition timelines on every state change
 *   • a crisp interrupt-reset timeline for barge-in
 *   • live Web-Audio reactivity driving scale / opacity / strokeDashoffset
 *
 * All instances are held in refs and an `AnimationRegistry`, and disposed in the
 * matching `useEffect` cleanup so no rAF loop outlives the component.
 */

import { useEffect, useMemo, useRef } from 'react';
import anime from 'animejs';
import type { VoiceState } from '../types';
import { audioBus } from '../lib/audioBus';
import {
  AnimationRegistry,
  applyAudioFrame,
  createBreathing,
  createConcentricRings,
  createCorePulse,
  createGaugeSpin,
  interruptReset,
  pathLength,
  relaxAudioTargets,
  transitionTo,
  type RingController,
  type VisualizerRefs,
} from '../utils/animations';

export interface VoiceVisualizerProps {
  state: VoiceState;
  prevState: VoiceState;
  interrupted: boolean;
  /** viewBox px. Default 420. */
  size?: number;
}

const NODE_COUNT = 8;
const BAR_COUNT = 44;
const CENTER = 210;

export default function VoiceVisualizer({
  state,
  prevState,
  interrupted,
  size = 420,
}: VoiceVisualizerProps) {
  const rootRef = useRef<SVGSVGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  const ringOuterRef = useRef<SVGGElement>(null);
  const ringMidRef = useRef<SVGGElement>(null);
  const ringInnerRef = useRef<SVGGElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const reactiveRingRef = useRef<SVGCircleElement>(null);
  const nodesRef = useRef<SVGGElement>(null);
  const barsRef = useRef<SVGGElement>(null);
  const gaugeRef = useRef<SVGGElement>(null);

  // Long-lived controllers / loop instances (created once).
  const ringsRef = useRef<RingController | null>(null);
  const loopRef = useRef<anime.AnimeInstance | null>(null);
  const gaugeSpinRef = useRef<anime.AnimeInstance | null>(null);
  const reactiveBaseOffsetRef = useRef(0);

  const bars = useMemo(() => Array.from({ length: BAR_COUNT }, (_, i) => i), []);
  const nodes = useMemo(() => Array.from({ length: NODE_COUNT }, (_, i) => i), []);

  /** Build the refs bundle the animation helpers expect. */
  const getRefs = (): VisualizerRefs | null => {
    if (
      !haloRef.current ||
      !ringOuterRef.current ||
      !ringMidRef.current ||
      !ringInnerRef.current ||
      !coreRef.current ||
      !reactiveRingRef.current ||
      !nodesRef.current ||
      !barsRef.current
    ) {
      return null;
    }
    return {
      halo: haloRef.current,
      ringOuter: ringOuterRef.current,
      ringMid: ringMidRef.current,
      ringInner: ringInnerRef.current,
      core: coreRef.current,
      reactiveRing: reactiveRingRef.current,
      nodes: nodesRef.current.querySelectorAll('.hud-node'),
      bars: barsRef.current.querySelectorAll('.hud-bar'),
    };
  };

  /* ---- Persistent rotations + reactive-ring baseline (mount once) -------- */
  useEffect(() => {
    const refs = getRefs();
    if (!refs) return;

    // Cache the reactive ring's resting strokeDashoffset (75% arc visible).
    const circ = pathLength(reactiveRingRef.current as SVGElement);
    reactiveBaseOffsetRef.current = circ * 0.25;
    anime.set(reactiveRingRef.current, {
      strokeDasharray: circ,
      strokeDashoffset: reactiveBaseOffsetRef.current,
    });

    ringsRef.current = createConcentricRings(refs);
    gaugeSpinRef.current = createGaugeSpin(gaugeRef.current as SVGGElement);
    gaugeSpinRef.current.pause();

    return () => {
      ringsRef.current?.destroy();
      ringsRef.current = null;
      gaugeSpinRef.current?.pause();
      anime.remove(gaugeRef.current as SVGGElement);
      gaugeSpinRef.current = null;
    };
  }, []);

  /* ---- State-transition timelines + per-state loops --------------------- */
  useEffect(() => {
    const refs = getRefs();
    if (!refs) return;

    const registry = new AnimationRegistry();
    registry.track(refs.halo, refs.core, refs.nodes, refs.bars, refs.reactiveRing);

    // Kill the previous per-state loop before starting the next one.
    loopRef.current?.pause();
    anime.remove(refs.halo);

    if (interrupted && (state === 'IDLE' || state === 'LISTENING')) {
      registry.add(interruptReset(refs, state));
    } else {
      registry.add(transitionTo(state, refs));
    }

    // Ring speed + telemetry gauge spin per state.
    switch (state) {
      case 'IDLE':
        ringsRef.current?.setSpeed(1);
        gaugeSpinRef.current?.pause();
        loopRef.current = createBreathing(refs.halo);
        break;
      case 'LISTENING':
        ringsRef.current?.setSpeed(1.6);
        gaugeSpinRef.current?.pause();
        loopRef.current = createCorePulse(refs.core, { fast: false });
        relaxAudioTargets(refs);
        break;
      case 'PROCESSING':
        ringsRef.current?.setSpeed(4.5);
        gaugeSpinRef.current?.play();
        loopRef.current = createCorePulse(refs.core, { fast: true });
        break;
      case 'SPEAKING':
        ringsRef.current?.setSpeed(2.2);
        gaugeSpinRef.current?.pause();
        // No core-pulse loop here — the live audio frame drives the core so the
        // two don't fight over `scale` every frame.
        loopRef.current = null;
        break;
    }
    if (loopRef.current) registry.add(loopRef.current);

    return () => {
      registry.disposeAll();
      loopRef.current?.pause();
      loopRef.current = null;
    };
    // `prevState` is intentionally not a dep: it would force a second dispose +
    // rebuild on every transition and truncate the entry timeline.
  }, [state, interrupted]);

  /* ---- Live audio reactivity (LISTENING mic + SPEAKING voice) ---------- */
  useEffect(() => {
    if (state !== 'SPEAKING' && state !== 'LISTENING') return;

    // audioBus carries frames from whatever is currently making sound:
    // MicRecorder while LISTENING, the TTS voice while SPEAKING.
    const unsub = audioBus.subscribe((frame) => {
      const refs = getRefs();
      if (!refs) return;
      const shaped =
        state === 'LISTENING'
          ? { level: frame.level * 0.6, bins: frame.bins.map((b) => b * 0.5) }
          : frame;
      applyAudioFrame(refs, shaped, reactiveBaseOffsetRef.current);
    });

    return () => {
      unsub();
      const refs = getRefs();
      if (refs) relaxAudioTargets(refs);
    };
  }, [state]);

  const seg = (r: number, dash: string, opacity: number, width = 2) => (
    <circle
      cx={CENTER}
      cy={CENTER}
      r={r}
      fill="none"
      stroke="#00F0FF"
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="round"
      opacity={opacity}
    />
  );

  return (
    <div
      className="relative flex aspect-square w-full items-center justify-center"
      style={{ maxWidth: size, maxHeight: size }}
      data-state={state}
      data-prev-state={prevState}
    >
      {/* Ambient bloom behind the reactor */}
      <div className="pointer-events-none absolute inset-0 bg-hud-radial blur-2xl" />

      <svg
        ref={rootRef}
        viewBox="0 0 420 420"
        width="100%"
        height="100%"
        className="relative overflow-visible"
        style={{ filter: 'drop-shadow(0 0 24px rgba(0,240,255,0.25))' }}
      >
        <defs>
          <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#eafdff" />
            <stop offset="35%" stopColor="#00F0FF" />
            <stop offset="100%" stopColor="#0077FF" />
          </radialGradient>
          <filter id="coreGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* HALO — scaled as one unit for breathing / expansion */}
        <g ref={haloRef} style={{ transformOrigin: '210px 210px' }}>
          {/* Outer segmented ring (clockwise, 18s) */}
          <g ref={ringOuterRef} style={{ transformOrigin: '210px 210px' }}>
            {seg(188, '3 10', 0.55, 1.5)}
            {seg(178, '46 26', 0.8, 3)}
            {seg(170, '2 6', 0.4, 1.5)}
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1={CENTER + Math.cos(a) * 192}
                  y1={CENTER + Math.sin(a) * 192}
                  x2={CENTER + Math.cos(a) * 200}
                  y2={CENTER + Math.sin(a) * 200}
                  stroke="#00F0FF"
                  strokeWidth={i % 6 === 0 ? 3 : 1}
                  opacity={i % 6 === 0 ? 0.9 : 0.35}
                />
              );
            })}
          </g>

          {/* Mid segmented ring (counter-clockwise, 12s) */}
          <g ref={ringMidRef} style={{ transformOrigin: '210px 210px' }}>
            {seg(150, '30 18', 0.85, 4)}
            {seg(140, '4 12', 0.5, 2)}
            {Array.from({ length: 3 }, (_, i) => {
              const start = (i / 3) * 360;
              return (
                <path
                  key={i}
                  d={describeArc(CENTER, CENTER, 158, start + 6, start + 84)}
                  fill="none"
                  stroke="#0077FF"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.7}
                />
              );
            })}
          </g>

          {/* Inner segmented ring (clockwise, 9s) */}
          <g ref={ringInnerRef} style={{ transformOrigin: '210px 210px' }}>
            {seg(112, '18 10', 0.9, 3)}
            {seg(104, '2 5', 0.5, 1.5)}
          </g>

          {/* Circular telemetry gauge that spins while PROCESSING */}
          <g ref={gaugeRef} style={{ transformOrigin: '210px 210px' }} opacity={0.9}>
            <path
              d={describeArc(CENTER, CENTER, 128, -46, 46)}
              fill="none"
              stroke="#00F0FF"
              strokeWidth={2}
              strokeDasharray="2 4"
            />
            <path
              d={describeArc(CENTER, CENTER, 128, 150, 210)}
              fill="none"
              stroke="#00F0FF"
              strokeWidth={2}
              strokeDasharray="2 4"
            />
          </g>

          {/* Audio-reactive ring (strokeDashoffset modulated per frame) */}
          <circle
            ref={reactiveRingRef}
            cx={CENTER}
            cy={CENTER}
            r={122}
            fill="none"
            stroke="#7af5ff"
            strokeWidth={2.5}
            strokeLinecap="round"
            style={{ transformOrigin: '210px 210px' }}
          />

          {/* Radial waveform bars (SPEAKING) */}
          <g ref={barsRef}>
            {bars.map((i) => {
              const angle = (i / BAR_COUNT) * 360;
              return (
                <g key={i} transform={`rotate(${angle} ${CENTER} ${CENTER})`}>
                  <rect
                    className="hud-bar"
                    x={CENTER - 1.6}
                    y={CENTER - 92}
                    width={3.2}
                    height={26}
                    rx={1.6}
                    fill="#00F0FF"
                    opacity={0.18}
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
                  />
                </g>
              );
            })}
          </g>

          {/* Orbiting nodes */}
          <g ref={nodesRef}>
            {nodes.map((i) => {
              const a = (i / NODE_COUNT) * Math.PI * 2;
              return (
                <circle
                  key={i}
                  className="hud-node"
                  cx={CENTER + Math.cos(a) * 162}
                  cy={CENTER + Math.sin(a) * 162}
                  r={4.5}
                  fill="#00F0FF"
                  opacity={0.5}
                  style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
                />
              );
            })}
          </g>
        </g>

        {/* Solid arc-reactor core */}
        <circle
          ref={coreRef}
          cx={CENTER}
          cy={CENTER}
          r={34}
          fill="url(#coreGrad)"
          filter="url(#coreGlow)"
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
        />
        <circle cx={CENTER} cy={CENTER} r={20} fill="#eafdff" opacity={0.9} />
      </svg>
    </div>
  );
}

/* Small SVG arc helper (degrees, clockwise from 3 o'clock). */
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

/** Alias kept for imports that expect `VoiceOrb`. */
export { VoiceVisualizer as VoiceOrb };
