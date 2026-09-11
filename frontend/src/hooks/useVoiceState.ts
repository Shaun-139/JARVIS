/**
 * useVoiceState — the finite-state machine that owns WHAT state the voice
 * pipeline is in. It performs no animation itself; components observe `state`
 * (and `prevState`) and hand the transition to Anime.js.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { VoiceState } from '../types';

const FORWARD: Record<VoiceState, VoiceState> = {
  IDLE: 'LISTENING',
  LISTENING: 'PROCESSING',
  PROCESSING: 'SPEAKING',
  SPEAKING: 'IDLE',
};

export interface VoiceStateApi {
  state: VoiceState;
  /** The state we were in immediately before the current one. */
  prevState: VoiceState;
  /** True when an interruption drove the last transition. */
  interrupted: boolean;
  setState: (next: VoiceState) => void;
  /** Advance one step around IDLE → LISTENING → PROCESSING → SPEAKING → IDLE. */
  advance: () => void;
  /**
   * Barge-in: only meaningful while SPEAKING (or PROCESSING). Cancels the
   * assistant turn and drops straight back to `to` (default LISTENING).
   */
  interrupt: (to?: Extract<VoiceState, 'IDLE' | 'LISTENING'>) => void;
  reset: () => void;
}

export function useVoiceState(initial: VoiceState = 'IDLE'): VoiceStateApi {
  const [state, _setState] = useState<VoiceState>(initial);
  const prevRef = useRef<VoiceState>(initial);
  const [interrupted, setInterrupted] = useState(false);

  const setState = useCallback((next: VoiceState) => {
    _setState((cur) => {
      if (cur === next) return cur;
      prevRef.current = cur;
      setInterrupted(false);
      return next;
    });
  }, []);

  const advance = useCallback(() => {
    _setState((cur) => {
      prevRef.current = cur;
      setInterrupted(false);
      return FORWARD[cur];
    });
  }, []);

  const interrupt = useCallback((to: Extract<VoiceState, 'IDLE' | 'LISTENING'> = 'LISTENING') => {
    _setState((cur) => {
      if (cur !== 'SPEAKING' && cur !== 'PROCESSING') return cur;
      prevRef.current = cur;
      setInterrupted(true);
      return to;
    });
  }, []);

  const reset = useCallback(() => {
    prevRef.current = state;
    setInterrupted(false);
    _setState('IDLE');
  }, [state]);

  return useMemo(
    () => ({ state, prevState: prevRef.current, interrupted, setState, advance, interrupt, reset }),
    [state, interrupted, setState, advance, interrupt, reset],
  );
}
