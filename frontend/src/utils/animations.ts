/**
 * animations.ts — Centralised Anime.js helper factory for J.A.R.V.I.S..
 *
 * Anime.js is the *single source of truth* for interface motion. React state
 * decides WHAT state the app is in; every helper below decides HOW that state
 * is visually presented: SVG ring rotations, gauge sweeps (strokeDashoffset),
 * path morphs, node staggers and the IDLE → LISTENING → PROCESSING → SPEAKING
 * transition timelines.
 *
 * Every factory returns the raw `anime` instance (or a small controller that
 * owns several instances) so callers can pause / seek / destroy them from a
 * React `useEffect` cleanup and never leak a running rAF loop.
 */

import anime from 'animejs';

/* -------------------------------------------------------------------------- */
/*  Shared types & constants                                                  */
/* -------------------------------------------------------------------------- */

import type { VoiceState } from '../types';

export type AnimeInstance = anime.AnimeInstance;
export type AnimeTimeline = anime.AnimeTimelineInstance;

/**
 * The subset of anime.js target inputs we actually hand around. `@types/animejs`
 * keeps `AnimeTarget` module-private, so we mirror it here.
 */
export type Target = string | Element | NodeListOf<Element> | Element[] | null;

/** Element refs the visualiser hands to the animation layer. */
export interface VisualizerRefs {
  /** Outermost segmented tech-ring. */
  ringOuter: Target;
  /** Middle segmented ring (counter-rotates). */
  ringMid: Target;
  /** Inner segmented ring. */
  ringInner: Target;
  /** `<g>` wrapping every ring — scaled as one unit for breathing / expansion. */
  halo: Target;
  /** Solid arc-reactor core circle. */
  core: Target;
  /** Ring whose strokeDashoffset is modulated by live audio. */
  reactiveRing: Target;
  /** Small orbiting node circles (NodeList / array). */
  nodes: Target;
  /** Radial waveform bars used while SPEAKING (NodeList / array). */
  bars: Target;
}

/** Per-frame audio frame pushed from the Web Audio analyser. */
export interface AudioFrame {
  /** Overall amplitude, 0..1 (already smoothed). */
  level: number;
  /** Normalised frequency bins, each 0..1. Length is arbitrary. */
  bins: number[];
}

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Ring rotation timings from the PRD. */
export const RING_TIMING = {
  outer: { rotate: 360, duration: 18_000 },
  mid: { rotate: -360, duration: 12_000 },
  inner: { rotate: 360, duration: 9_000 },
} as const;

/* -------------------------------------------------------------------------- */
/*  Low-level utilities                                                       */
/* -------------------------------------------------------------------------- */

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

/** Total outline length for any SVG geometry element (path, circle, rect…). */
export function pathLength(el: SVGElement): number {
  const geo = el as SVGGeometryElement;
  if (typeof geo.getTotalLength === 'function') {
    try {
      const len = geo.getTotalLength();
      if (len > 0) return len;
    } catch {
      /* detached node — fall through */
    }
  }
  // Fallback for a plain <circle r="…">
  const r = parseFloat(el.getAttribute('r') ?? '0');
  return r > 0 ? 2 * Math.PI * r : 0;
}

/**
 * AnimationRegistry — tracks every instance created for a component so a single
 * `disposeAll()` in the `useEffect` cleanup guarantees no orphaned rAF loops.
 */
export class AnimationRegistry {
  private instances = new Set<{ pause: () => void }>();
  private targets: Target[] = [];

  /** Register an instance (or controller) and return it unchanged. */
  add<T extends { pause: () => void }>(instance: T): T {
    this.instances.add(instance);
    return instance;
  }

  /** Also track raw targets so `anime.remove` can hard-stop tweens on them. */
  track(...targets: Target[]): void {
    this.targets.push(...targets);
  }

  /** Pause every instance and strip all anime tweens from tracked targets. */
  disposeAll(): void {
    this.instances.forEach((i) => {
      try {
        i.pause();
      } catch {
        /* already gone */
      }
    });
    this.instances.clear();
    this.targets.forEach((t) => anime.remove(t));
    this.targets = [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Concentric ring rotations                                                 */
/* -------------------------------------------------------------------------- */

export interface RingController {
  instances: AnimeInstance[];
  /** Multiply every ring's base speed (1 = nominal, >1 = PROCESSING spin-up). */
  setSpeed: (multiplier: number) => void;
  pause: () => void;
  play: () => void;
  destroy: () => void;
}

/**
 * Outer concentric tech-rings rotating in alternating directions with distinct
 * durations and a linear, infinite loop. Returns a controller whose `setSpeed`
 * is used by the PROCESSING state to kick every ring into a high-speed spin.
 */
export function createConcentricRings(
  refs: Pick<VisualizerRefs, 'ringOuter' | 'ringMid' | 'ringInner'>,
): RingController {
  const specs: Array<{ target: Target; rotate: number; duration: number }> = [
    { target: refs.ringOuter, ...RING_TIMING.outer },
    { target: refs.ringMid, ...RING_TIMING.mid },
    { target: refs.ringInner, ...RING_TIMING.inner },
  ];

  let multiplier = 1;
  let instances: AnimeInstance[] = [];

  // anime.js v3 has no per-instance playback-rate, so a speed change rebuilds
  // each rotation from its current angle with a scaled duration — visually
  // seamless and it keeps the linear infinite loop intact.
  const build = () => {
    instances.forEach((i) => i.pause());
    specs.forEach((s) => anime.remove(s.target));

    const m = REDUCED_MOTION ? Math.max(0.1, multiplier) * 0.25 : Math.max(0.1, multiplier);

    instances = specs.map(({ target, rotate, duration }) => {
      const current = target ? Number(anime.get(target, 'rotate', 'deg')) || 0 : 0;
      return anime({
        targets: target,
        rotate: [current, current + rotate],
        transformOrigin: ['50% 50%', '50% 50%'],
        duration: duration / m,
        easing: 'linear',
        loop: true,
        autoplay: true,
      });
    });
  };

  build();

  return {
    get instances() {
      return instances;
    },
    setSpeed(next: number) {
      const clamped = Math.max(0.1, next);
      if (clamped === multiplier) return;
      multiplier = clamped;
      build();
    },
    pause: () => instances.forEach((i) => i.pause()),
    play: () => instances.forEach((i) => i.play()),
    destroy: () => {
      instances.forEach((i) => i.pause());
      specs.forEach((s) => anime.remove(s.target));
      instances = [];
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Persistent per-state loops                                                */
/* -------------------------------------------------------------------------- */

/** IDLE — gentle breathing / pulsing loop on the halo group. */
export function createBreathing(target: Target): AnimeInstance {
  return anime({
    targets: target,
    scale: [0.98, 1.02],
    opacity: [0.82, 1],
    duration: 3000,
    direction: 'alternate',
    easing: 'easeInOutSine',
    loop: true,
  });
}

/**
 * Core pulse loop. `fast` is used by PROCESSING for a high-frequency strobe;
 * the default cadence is the calm SPEAKING/LISTENING heartbeat.
 */
export function createCorePulse(target: Target, opts: { fast?: boolean } = {}): AnimeInstance {
  const fast = opts.fast ?? false;
  return anime({
    targets: target,
    scale: fast ? [1, 1.14] : [1, 1.06],
    opacity: fast ? [0.7, 1] : [0.85, 1],
    duration: fast ? 340 : 1400,
    direction: 'alternate',
    easing: fast ? 'easeInOutQuad' : 'easeInOutSine',
    loop: true,
  });
}

/** PROCESSING — spinning circular telemetry gauges (continuous rotation). */
export function createGaugeSpin(target: Target): AnimeInstance {
  return anime({
    targets: target,
    rotate: [0, 360],
    transformOrigin: ['50% 50%', '50% 50%'],
    duration: 2400,
    easing: 'linear',
    loop: true,
  });
}

/* -------------------------------------------------------------------------- */
/*  One-shot state-transition timelines                                       */
/* -------------------------------------------------------------------------- */

const ACCENT = {
  IDLE: '#0077FF',
  LISTENING: '#00F0FF',
  PROCESSING: '#39d0ff',
  SPEAKING: '#7af5ff',
} as const;

/**
 * Build the crisp one-shot timeline that presents a transition INTO `state`.
 * The persistent loops (breathing / core pulse / ring speed) are toggled
 * separately by the caller; this timeline handles scale, accent-colour shift,
 * node staggers and waveform reveal.
 */
export function transitionTo(state: VoiceState, refs: VisualizerRefs): AnimeTimeline {
  const tl = anime.timeline({
    easing: 'easeOutExpo',
    duration: REDUCED_MOTION ? 200 : 600,
  });

  // Common: shift the reactive-ring accent colour for every state.
  tl.add(
    {
      targets: [refs.reactiveRing, refs.ringInner],
      stroke: ACCENT[state],
      duration: 400,
    },
    0,
  );

  switch (state) {
    case 'IDLE':
      tl.add({ targets: refs.halo, scale: 1, duration: 700, easing: 'easeOutElastic(1, .6)' }, 0)
        .add({ targets: refs.core, scale: 1, opacity: 0.9 }, 0)
        .add(
          {
            targets: refs.nodes,
            scale: 0.7,
            opacity: 0.45,
            delay: anime.stagger(40),
          },
          0,
        )
        .add({ targets: refs.bars, scaleY: 0.08, opacity: 0.15, delay: anime.stagger(8) }, 0);
      break;

    case 'LISTENING':
      // Rapid ring expansion + glowing cyan accent + dynamic node scaling.
      tl.add({ targets: refs.halo, scale: 1.12, duration: 420, easing: 'easeOutBack' }, 0)
        .add({ targets: refs.core, scale: 1.08, opacity: 1 }, 0)
        .add(
          {
            targets: refs.nodes,
            scale: [0.7, 1.25],
            opacity: 1,
            delay: anime.stagger(45, { from: 'center' }),
          },
          40,
        )
        .add({ targets: refs.bars, scaleY: 0.14, opacity: 0.3, delay: anime.stagger(6) }, 0);
      break;

    case 'PROCESSING':
      // Tight contraction, high-frequency feel, telemetry nodes snap to a grid.
      tl.add({ targets: refs.halo, scale: 1.04, duration: 260, easing: 'easeOutQuart' }, 0)
        .add({ targets: refs.core, scale: 0.9, opacity: 1, duration: 220 }, 0)
        .add(
          {
            targets: refs.nodes,
            scale: 1,
            opacity: [1, 0.55, 1],
            delay: anime.stagger(30, { from: 'first' }),
            duration: 500,
          },
          0,
        );
      break;

    case 'SPEAKING':
      // Audio-reactive radial bar sweep + waveform extension.
      tl.add({ targets: refs.halo, scale: 1.06, duration: 360, easing: 'easeOutCubic' }, 0)
        .add({ targets: refs.core, scale: 1.05, opacity: 1 }, 0)
        .add(
          {
            targets: refs.bars,
            scaleY: [0.08, 0.6],
            opacity: 1,
            delay: anime.stagger(9, { from: 'center' }),
            easing: 'easeOutExpo',
          },
          0,
        )
        .add(
          {
            targets: refs.nodes,
            scale: 1.1,
            opacity: 0.9,
            delay: anime.stagger(35),
          },
          80,
        );
      break;
  }

  return tl;
}

/**
 * AI-interruption response — a barge-in while the assistant is SPEAKING. Cancels
 * every in-flight TTS animation and snaps the visualiser back to `to`
 * (LISTENING or IDLE) in a single crisp beat.
 */
export function interruptReset(refs: VisualizerRefs, to: Extract<VoiceState, 'IDLE' | 'LISTENING'>): AnimeTimeline {
  // Hard-cancel anything still tweening the speaking-only targets.
  anime.remove(refs.bars);
  anime.remove(refs.core);
  anime.remove(refs.halo);

  const tl = anime.timeline({ easing: 'easeOutQuint', duration: 220 });

  tl.add({ targets: refs.bars, scaleY: 0.06, opacity: 0.12, delay: anime.stagger(4) }, 0)
    .add({ targets: refs.core, scale: to === 'LISTENING' ? 1.08 : 1, opacity: 0.95 }, 0)
    .add({ targets: refs.halo, scale: to === 'LISTENING' ? 1.12 : 1 }, 0)
    .add({ targets: [refs.reactiveRing, refs.ringInner], stroke: ACCENT[to] }, 0);

  return tl;
}

/* -------------------------------------------------------------------------- */
/*  Gauge sweeps (strokeDashoffset)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sweep a circular SVG gauge to `progress` (0..1) by animating strokeDashoffset,
 * exactly the PRD pattern:
 *   anime({ targets, strokeDashoffset: [anime.setDashoffset, target], … })
 */
export function sweepGauge(
  targets: Target,
  progress: number,
  opts: { duration?: number; easing?: string; delay?: number } = {},
): AnimeInstance {
  const p = clamp(progress, 0, 1);

  return anime({
    targets,
    strokeDashoffset: [
      // FROM — set the dash-array to the full outline and start fully "empty".
      (el: SVGElement) => {
        const len = pathLength(el);
        el.setAttribute('stroke-dasharray', String(len));
        return len;
      },
      // TO — leave `len * (1 - progress)` hidden so `progress` of the ring shows.
      (el: SVGElement) => pathLength(el) * (1 - p),
    ],
    duration: opts.duration ?? 1200,
    delay: opts.delay ?? 0,
    easing: opts.easing ?? 'easeOutCubic',
  });
}

/* -------------------------------------------------------------------------- */
/*  SVG path morphing                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Morph an SVG `<path>` `d` attribute to `d`. Both paths must share the same
 * command structure (same number of vertices) for a clean interpolation.
 */
export function morphPath(
  target: Target,
  d: string,
  opts: { duration?: number; easing?: string } = {},
): AnimeInstance {
  return anime({
    targets: target,
    d: [{ value: d }],
    duration: opts.duration ?? 700,
    easing: opts.easing ?? 'easeInOutQuad',
  });
}

/* -------------------------------------------------------------------------- */
/*  Node / element staggers                                                   */
/* -------------------------------------------------------------------------- */

/** Generic staggered reveal — fades + rises a set of elements into place. */
export function staggerIn(
  targets: Target,
  opts: {
    each?: number;
    from?: 'first' | 'last' | 'center' | number;
    translateY?: number;
    duration?: number;
    delay?: number;
  } = {},
): AnimeInstance {
  return anime({
    targets,
    opacity: [0, 1],
    translateY: [opts.translateY ?? 12, 0],
    scale: [0.94, 1],
    duration: opts.duration ?? 520,
    delay: anime.stagger(opts.each ?? 60, {
      start: opts.delay ?? 0,
      from: opts.from ?? 'first',
    }),
    easing: 'easeOutExpo',
  });
}

/* -------------------------------------------------------------------------- */
/*  Chat message entry                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Staggered message-entry timeline. `index` lets a freshly appended batch keep
 * a coherent rhythm; user messages slide from the right, assistant from the left.
 */
export function enterMessage(
  target: Target,
  opts: { role: 'user' | 'assistant'; index?: number } = { role: 'assistant' },
): AnimeInstance {
  const dir = opts.role === 'user' ? 1 : -1;
  return anime({
    targets: target,
    opacity: [0, 1],
    translateX: [dir * 26, 0],
    translateY: [10, 0],
    scale: [0.96, 1],
    duration: REDUCED_MOTION ? 1 : 460,
    delay: (opts.index ?? 0) * 55,
    easing: 'easeOutExpo',
  });
}

/* -------------------------------------------------------------------------- */
/*  Sidebar collapse / expand                                                 */
/* -------------------------------------------------------------------------- */

export function animateSidebar(
  target: Target,
  collapsed: boolean,
  opts: { expandedWidth: number; collapsedWidth: number },
): AnimeInstance {
  return anime({
    targets: target,
    width: collapsed ? opts.collapsedWidth : opts.expandedWidth,
    duration: REDUCED_MOTION ? 1 : 420,
    easing: 'easeInOutCubic',
  });
}

/** Stagger the sidebar's nav items whenever it expands. */
export function revealSidebarItems(targets: Target): AnimeInstance {
  return anime({
    targets,
    opacity: [0, 1],
    translateX: [-14, 0],
    duration: 380,
    delay: anime.stagger(45),
    easing: 'easeOutQuad',
  });
}

/* -------------------------------------------------------------------------- */
/*  Live audio reactivity (per-frame, anime.set as the mutation layer)        */
/* -------------------------------------------------------------------------- */

/**
 * Apply a single audio frame to the visualiser. Called from the analyser's rAF
 * loop; uses `anime.set` so Anime.js remains the only thing mutating the DOM.
 * `reactiveRingBaseOffset` is the ring's resting strokeDashoffset.
 */
export function applyAudioFrame(
  refs: VisualizerRefs,
  frame: AudioFrame,
  reactiveRingBaseOffset: number,
): void {
  const level = clamp(frame.level, 0, 1);

  anime.set(refs.core, {
    scale: 1 + level * 0.32,
    opacity: 0.8 + level * 0.2,
  });

  anime.set(refs.halo, {
    scale: 1.06 + level * 0.06,
  });

  anime.set(refs.reactiveRing, {
    strokeDashoffset: reactiveRingBaseOffset - level * 140,
    opacity: 0.5 + level * 0.5,
  });

  const bars = toElementArray(refs.bars);
  const n = bars.length;
  if (n === 0) return;
  for (let i = 0; i < n; i++) {
    const bin = frame.bins.length
      ? frame.bins[Math.floor((i / n) * frame.bins.length)] ?? 0
      : level;
    anime.set(bars[i], {
      scaleY: 0.12 + bin * 1.4,
      opacity: 0.35 + bin * 0.65,
    });
  }
}

/** Ease every audio-reactive target back to rest (call on LISTENING/IDLE entry). */
export function relaxAudioTargets(refs: VisualizerRefs): AnimeInstance {
  return anime({
    targets: [refs.core, refs.reactiveRing, refs.bars],
    scale: 1,
    scaleY: 0.1,
    opacity: (el: SVGElement) => (el === (refs.core as SVGElement) ? 0.9 : 0.3),
    duration: 360,
    easing: 'easeOutQuad',
  });
}

function toElementArray(t: Target): Element[] {
  if (typeof t === 'string') return Array.from(document.querySelectorAll(t));
  if (t instanceof Element) return [t];
  if (t instanceof NodeList) return Array.from(t) as Element[];
  if (Array.isArray(t)) return t.filter((x): x is Element => x instanceof Element);
  return [];
}

/* -------------------------------------------------------------------------- */
/*  Convenience: whole-panel intro                                            */
/* -------------------------------------------------------------------------- */

/** Boot sequence — sweeps the HUD panels in on first mount. */
export function bootSequence(panels: Target): AnimeTimeline {
  const tl = anime.timeline({ easing: 'easeOutExpo' });
  tl.add({
    targets: panels,
    opacity: [0, 1],
    translateY: [24, 0],
    filter: ['blur(8px)', 'blur(0px)'],
    duration: REDUCED_MOTION ? 1 : 720,
    delay: anime.stagger(90),
  });
  return tl;
}

export { REDUCED_MOTION, clamp };
