/**
 * ModelSelector — provider dropdown (Groq · OpenRouter · Gemini · Local Ollama).
 * React holds the open flag and the selection; Anime.js expands the panel and
 * staggers the option rows in / out.
 */

import { useEffect, useRef, useState } from 'react';
import anime from 'animejs';
import { Check, ChevronDown, Cpu, Server } from 'lucide-react';
import type { ProviderStatus } from '../lib/chatClient';
import { PROVIDERS, type Provider, type ProviderId } from '../types';

export interface ModelSelectorProps {
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  /** Per-provider readiness from /api/health; absent = unknown (dot hidden). */
  status?: Record<string, ProviderStatus>;
}

/** ●  green = key present / local reachable · amber = needs a key. */
function ReadyDot({ st }: { st?: ProviderStatus }) {
  if (!st) return null;
  const ok = st.ready;
  return (
    <span
      title={ok ? (st.local ? 'local — reachable if Ollama is running' : 'API key set') : 'API key not set'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400/70'}`}
      style={ok ? { boxShadow: '0 0 6px rgba(52,211,153,0.8)' } : undefined}
    />
  );
}

export default function ModelSelector({ value, onChange, status }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<SVGSVGElement>(null);

  const selected = PROVIDERS.find((p) => p.id === value) ?? PROVIDERS[0];

  // Open / close animation.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    anime.remove(panel);
    anime.remove(panel.querySelectorAll('.model-opt'));

    if (open) {
      panel.style.pointerEvents = 'auto';
      anime({
        targets: panel,
        opacity: [0, 1],
        translateY: [-8, 0],
        scaleY: [0.86, 1],
        duration: 260,
        easing: 'easeOutExpo',
      });
      anime({
        targets: panel.querySelectorAll('.model-opt'),
        opacity: [0, 1],
        translateX: [-12, 0],
        delay: anime.stagger(38, { start: 60 }),
        duration: 300,
        easing: 'easeOutQuad',
      });
    } else {
      anime({
        targets: panel,
        opacity: [1, 0],
        translateY: [0, -8],
        duration: 160,
        easing: 'easeInQuad',
        complete: () => {
          panel.style.pointerEvents = 'none';
        },
      });
    }
    anime({
      targets: caretRef.current,
      rotate: open ? 180 : 0,
      duration: 240,
      easing: 'easeOutBack',
    });
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (p: Provider) => {
    onChange(p.id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative z-30 w-64">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hud-panel flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-900/60"
      >
        {selected.local ? (
          <Server size={16} className="text-arc-cyan" />
        ) : (
          <Cpu size={16} className="text-arc-cyan" />
        )}
        <span className="flex flex-1 flex-col leading-none">
          <span className="hud-label">Inference Provider</span>
          <span className="mt-1 flex items-center gap-1.5 font-hud text-sm font-semibold tracking-wide text-arc-cyan">
            {selected.label}
            <ReadyDot st={status?.[selected.id]} />
          </span>
        </span>
        <ChevronDown ref={caretRef} size={16} className="text-arc-cyan/70" />
      </button>

      <div
        ref={panelRef}
        data-boot-skip
        className="hud-panel absolute left-0 right-0 top-[calc(100%+8px)] origin-top space-y-1 bg-slate-950/90 p-2 opacity-0"
        style={{ pointerEvents: 'none' }}
        role="listbox"
      >
        {PROVIDERS.map((p) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => pick(p)}
              className={`model-opt flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${
                active ? 'bg-arc-cyan/15' : 'hover:bg-arc-cyan/8'
              }`}
            >
              {p.local ? (
                <Server size={14} className="text-arc-cyan/80" />
              ) : (
                <Cpu size={14} className="text-arc-cyan/80" />
              )}
              <span className="flex flex-1 flex-col leading-tight">
                <span className="flex items-center gap-1.5 font-hud text-sm font-medium text-cyan-100">
                  {p.label}
                  <ReadyDot st={status?.[p.id]} />
                </span>
                <span className="font-mono text-[10px] text-arc-cyan/50">
                  {status?.[p.id]?.model ?? p.model} · {p.hint}
                </span>
              </span>
              {active && <Check size={14} className="text-arc-cyan drop-shadow-glow" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
