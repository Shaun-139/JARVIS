/**
 * useHotkeys — a minimal global keyboard-shortcut binder.
 *
 * Combos: 'escape', 'slash', '?', a bare character ('1'), or 'mod+<key>'
 * (Ctrl on Windows/Linux, Cmd on macOS). While a text field is focused only
 * 'escape' and 'mod+…' combos fire — bare keys are left for typing.
 */

import { useEffect, useRef } from 'react';

export interface Hotkey {
  combo: string;
  /** Shown in the shortcuts overlay. */
  label: string;
  run: () => void;
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  if (combo === 'escape') return key === 'Escape';
  if (combo === 'slash') return key === '/' && !mod;
  if (combo === '?') return key === '?';
  if (combo.startsWith('mod+')) return mod && key.toLowerCase() === combo.slice(4);
  return !mod && !e.altKey && key.toLowerCase() === combo;
}

export function useHotkeys(keys: Hotkey[], enabled = true): void {
  const ref = useRef(keys);
  ref.current = keys;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      for (const k of ref.current) {
        if (!matches(k.combo, e)) continue;
        const isMod = k.combo.startsWith('mod+');
        if (typing && !isMod && k.combo !== 'escape') return; // let the field have it
        e.preventDefault();
        k.run();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
