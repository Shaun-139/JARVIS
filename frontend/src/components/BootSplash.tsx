/**
 * BootSplash — the unlock reveal: a centred arc reactor with the J.A.R.V.I.S.
 * wordmark beneath it appears, then flies and shrinks onto the real reactor
 * already mounted underneath (#arc-reactor-dock, in App — which must be
 * rendered with `skipBootSweep` so its own entrance sweep doesn't fight this
 * one and its layout is stable to measure). Plays once from mount to
 * `onDone`, no external triggering needed.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import VoiceVisualizer from './VoiceVisualizer';
import { REDUCED_MOTION } from '../utils/animations';

export interface BootSplashProps {
  onDone: () => void;
}

export default function BootSplash({ onDone }: BootSplashProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const reactorRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const reactor = reactorRef.current;
    const text = textRef.current;
    if (!overlay || !reactor || !text) return;

    // One frame's grace so App (mounted this same tick, skipBootSweep) has
    // definitely laid out before we measure its reactor's position below.
    const raf = requestAnimationFrame(() => {
      const tl = anime.timeline({ complete: onDone });

      tl.add({
        targets: [reactor, text],
        opacity: [0, 1],
        translateY: [16, 0],
        delay: anime.stagger(100),
        duration: REDUCED_MOTION ? 1 : 420,
        easing: 'easeOutExpo',
      });

      tl.add(
        {
          targets: text,
          opacity: [1, 0],
          translateY: [0, -12],
          duration: REDUCED_MOTION ? 1 : 280,
          easing: 'easeInQuad',
        },
        REDUCED_MOTION ? '+=0' : '+=150',
      );

      const dock = document.getElementById('arc-reactor-dock');
      const to = dock?.getBoundingClientRect();
      if (to && to.width > 0) {
        const from = reactor.getBoundingClientRect();
        const scale = to.width / from.width;
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        tl.add(
          {
            targets: reactor,
            translateX: [0, dx],
            translateY: [0, dy],
            scale: [1, scale],
            duration: REDUCED_MOTION ? 1 : 820,
            easing: 'easeInOutCubic',
          },
          REDUCED_MOTION ? '+=0' : '-=100',
        );
        // Small overlap only — the overlay must stay opaque for nearly all of
        // the flight, or the real (still-arriving, misaligned) reactor ghosts
        // through underneath it. Fade only once the flight is basically done.
        tl.add(
          {
            targets: overlay,
            opacity: [1, 0],
            duration: REDUCED_MOTION ? 1 : 420,
            easing: 'easeInQuad',
          },
          REDUCED_MOTION ? '+=0' : '-=80',
        );
      } else {
        // Dock not found (shouldn't happen) — just dissolve instead of landing nowhere.
        tl.add({
          targets: overlay,
          opacity: [1, 0],
          duration: REDUCED_MOTION ? 1 : 380,
          easing: 'easeInQuad',
        });
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-space-900"
    >
      <div ref={reactorRef} className="w-[min(70vw,320px)] opacity-0">
        <VoiceVisualizer state="IDLE" prevState="IDLE" interrupted={false} size={320} />
      </div>
      <div ref={textRef} className="flex flex-col items-center gap-1 opacity-0">
        <span className="font-hud text-3xl font-bold tracking-[0.35em] text-arc-cyan drop-shadow-glow sm:text-4xl">
          J.A.R.V.I.S.
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-arc-cyan/40">
          access granted
        </span>
      </div>
    </div>
  );
}
