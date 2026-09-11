/**
 * audioBus — a tiny singleton that carries per-frame audio energy from whatever
 * is currently making sound (the mic while LISTENING, the TTS voice while
 * SPEAKING) to the visualiser, without routing 60 fps updates through React
 * state.
 *
 * Producers call `push()`; `VoiceVisualizer` subscribes while it needs a live
 * waveform and feeds each frame straight into Anime.js via `applyAudioFrame`.
 */

import type { AudioFrame } from '../utils/animations';

type Listener = (frame: AudioFrame) => void;

const listeners = new Set<Listener>();
let last: AudioFrame = { level: 0, bins: [] };

export const audioBus = {
  push(frame: AudioFrame) {
    last = frame;
    listeners.forEach((fn) => fn(frame));
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Last frame seen — handy for a component that subscribes late. */
  peek(): AudioFrame {
    return last;
  },
  /** Emit a single silent frame so subscribers settle to rest. */
  silence() {
    audioBus.push({ level: 0, bins: [] });
  },
};
