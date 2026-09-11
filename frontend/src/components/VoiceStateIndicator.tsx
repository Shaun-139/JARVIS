/**
 * VoiceStateIndicator — HUD status badge. React swaps the label; Anime.js plays
 * the switch: the outgoing label drops out, the incoming one snaps in, and the
 * status dot re-pulses in the new accent colour.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { Ear, Loader2, Radio, Volume2 } from 'lucide-react';
import type { VoiceState } from '../types';

const META: Record<
  VoiceState,
  { label: string; accent: string; Icon: typeof Radio; blurb: string }
> = {
  IDLE: { label: 'Standby', accent: '#0077FF', Icon: Radio, blurb: 'Awaiting wake word' },
  LISTENING: { label: 'Listening', accent: '#00F0FF', Icon: Ear, blurb: 'Capturing input' },
  PROCESSING: { label: 'Processing', accent: '#39d0ff', Icon: Loader2, blurb: 'Running inference' },
  SPEAKING: { label: 'Speaking', accent: '#7af5ff', Icon: Volume2, blurb: 'Synthesising reply' },
};

export interface VoiceStateIndicatorProps {
  state: VoiceState;
  interrupted?: boolean;
}

export default function VoiceStateIndicator({ state, interrupted }: VoiceStateIndicatorProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dotPulseRef = useRef<anime.AnimeInstance | null>(null);

  const { label, accent, Icon, blurb } = META[state];

  useEffect(() => {
    const el = labelRef.current;
    const dot = dotRef.current;
    const wrap = wrapRef.current;
    if (!el || !dot || !wrap) return;

    const tl = anime.timeline({ easing: 'easeOutExpo' });
    tl.add({
      targets: el,
      opacity: [0, 1],
      translateY: [interrupted ? -6 : 10, 0],
      filter: ['blur(6px)', 'blur(0px)'],
      duration: interrupted ? 180 : 420,
    });
    tl.add(
      {
        targets: wrap,
        boxShadow: [
          `0 0 0px ${hexA(accent, 0)}`,
          `0 0 18px ${hexA(accent, 0.35)}`,
          `0 0 10px ${hexA(accent, 0.18)}`,
        ],
        duration: 520,
      },
      0,
    );

    dotPulseRef.current?.pause();
    dotPulseRef.current = anime({
      targets: dot,
      scale: [1, 1.9],
      opacity: [0.9, 0],
      duration: state === 'PROCESSING' ? 700 : 1500,
      easing: 'easeOutSine',
      loop: true,
    });

    return () => {
      dotPulseRef.current?.pause();
      anime.remove([el, dot, wrap]);
    };
  }, [state, accent, interrupted]);

  return (
    <div
      ref={wrapRef}
      className="hud-panel flex items-center gap-3 px-4 py-2"
      style={{ borderColor: hexA(accent, 0.4) }}
    >
      <span className="relative flex h-2.5 w-2.5 items-center justify-center">
        <span
          ref={dotRef}
          className="absolute inline-flex h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ backgroundColor: accent }}
        />
      </span>

      <Icon
        size={16}
        style={{ color: accent }}
        className={state === 'PROCESSING' ? 'animate-spin' : undefined}
      />

      <div className="flex flex-col leading-none">
        <span
          ref={labelRef}
          className="font-hud text-sm font-semibold tracking-[0.22em] uppercase"
          style={{ color: accent }}
        >
          {interrupted ? 'Interrupted' : label}
        </span>
        <span className="hud-label mt-1">{blurb}</span>
      </div>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
