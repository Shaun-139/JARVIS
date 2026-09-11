/**
 * HelpOverlay — the keyboard-shortcut cheatsheet. Opened with `?`, dismissed
 * with Escape or a backdrop click. Fades in via Anime.js.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { X } from 'lucide-react';

export interface Shortcut {
  keys: string;
  label: string;
}

export interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

export default function HelpOverlay({ open, onClose, shortcuts }: HelpOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (card) {
      anime.remove(card);
      anime({
        targets: card,
        opacity: [0, 1],
        translateY: [12, 0],
        scale: [0.96, 1],
        duration: 260,
        easing: 'easeOutExpo',
      });
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-space-900/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="hud-panel w-[min(420px,90vw)] bg-slate-950/90 p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-hud text-sm font-semibold tracking-[0.24em] text-arc-cyan uppercase">
            Shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="text-arc-cyan/50 hover:text-arc-cyan"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-2">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-cyan-100/80">{s.label}</span>
              <kbd className="rounded-sm border border-arc-cyan/30 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-arc-cyan">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
