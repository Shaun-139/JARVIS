/**
 * voice.ts — microphone capture + speech I/O for J.A.R.V.I.S..
 *
 *  • MicRecorder  — records an utterance, pushes live mic energy to `audioBus`,
 *                   auto-stops on sustained silence.
 *  • transcribe() — POSTs the recording to `/api/transcribe` (Groq Whisper).
 *  • speak()      — tries `/api/speak` (Groq TTS); on any failure falls back to
 *                   the browser's SpeechSynthesis. Either way it pushes the
 *                   playback energy to `audioBus` so the SPEAKING waveform is
 *                   driven by real audio, and exposes `.stop()` for barge-in.
 */

import { audioBus } from './audioBus';
import type { AudioFrame } from '../utils/animations';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const BINS = 28;

/* --------------------------- shared frequency meter -------------------------- */

function attachMeter(ctx: AudioContext, node: AudioNode) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  node.connect(analyser);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  return function read(): AudioFrame {
    analyser.getByteFrequencyData(freq);
    const usable = Math.floor(freq.length * 0.7);
    const bins = new Array<number>(BINS).fill(0);
    let sum = 0;
    for (let i = 0; i < usable; i++) {
      const v = freq[i] / 255;
      sum += v;
      const b = Math.min(BINS - 1, Math.floor((i / usable) * BINS));
      if (v > bins[b]) bins[b] = v;
    }
    return { level: Math.min(1, (sum / usable) * 2.4), bins };
  };
}

/* ------------------------------- MicRecorder -------------------------------- */

export interface RecordResult {
  blob: Blob;
  durationMs: number;
}

export interface StartRecordingOpts {
  /** Fired when sustained silence (or the max cap) ends the utterance. */
  onAutoStop?: () => void;
  /** ms of continuous near-silence that ends the take. Default 1500. */
  silenceHold?: number;
  /** hard cap on take length. Default 15000. */
  maxMs?: number;
  /** Linear gain applied to the mic before recording. 1 = unity (default). */
  gain?: number;
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private ctx: AudioContext | null = null;
  private raf = 0;
  private startedAt = 0;
  private silenceMs = 0;
  private resolveStop: ((r: RecordResult) => void) | null = null;

  get active(): boolean {
    return this.rec?.state === 'recording';
  }

  async start(opts: StartRecordingOpts = {}): Promise<void> {
    if (this.active) return;
    const silenceHold = opts.silenceHold ?? 1500;
    const maxMs = opts.maxMs ?? 15_000;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext
          ? 'This browser exposes no microphone API.'
          : 'Microphone needs a secure page — open http://localhost:5173 (not the 192.168.x.x network URL) or serve over HTTPS.',
      );
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser has no MediaRecorder — try Chrome or Edge.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);

    // Route through a GainNode when the user has pushed the slider off unity;
    // the recorder then captures the boosted/attenuated stream, and the meter
    // reads it too.
    const gain = opts.gain ?? 1;
    let recordStream: MediaStream = this.stream;
    let meterNode: AudioNode = src;
    if (Math.abs(gain - 1) > 0.02) {
      const g = this.ctx.createGain();
      g.gain.value = Math.max(0, gain);
      const dest = this.ctx.createMediaStreamDestination();
      src.connect(g);
      g.connect(dest);
      recordStream = dest.stream;
      meterNode = g;
    }
    const read = attachMeter(this.ctx, meterNode);

    const mime = pickRecorderMime();
    this.rec = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.rec.onstop = () => {
      const type = this.rec?.mimeType || mime || 'audio/webm';
      const blob = new Blob(this.chunks, { type });
      const result: RecordResult = { blob, durationMs: performance.now() - this.startedAt };
      this.teardown();
      this.resolveStop?.(result);
      this.resolveStop = null;
    };

    this.startedAt = performance.now();
    this.silenceMs = 0;
    this.rec.start(120);

    const loop = () => {
      if (!this.active) return;
      const frame = read();
      audioBus.push(frame);

      this.silenceMs = frame.level < 0.055 ? this.silenceMs + 16 : 0;
      const elapsed = performance.now() - this.startedAt;
      if ((this.silenceMs >= silenceHold && elapsed > 800) || elapsed >= maxMs) {
        opts.onAutoStop?.();
        return; // caller invokes stop()
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): Promise<RecordResult> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.teardown();
        resolve({ blob, durationMs: 0 });
        return;
      }
      this.resolveStop = resolve;
      try {
        this.rec.requestData();
      } catch {
        /* not all impls support this */
      }
      try {
        this.rec.stop();
      } catch {
        /* already stopping */
      }
      audioBus.silence();
    });
  }

  cancel(): void {
    this.resolveStop = null;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.teardown();
    audioBus.silence();
  }

  private teardown(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.silenceMs = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.rec = null;
  }
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/* ------------------------------- transcribe -------------------------------- */

export interface TranscribeResult {
  text: string;
  mode: 'live' | 'mock';
}

export async function transcribe(blob: Blob, signal?: AbortSignal): Promise<TranscribeResult> {
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Filename': filenameFor(blob.type),
    },
    body: blob,
    signal,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `transcribe failed (${res.status})`);
  return { text: (j.text || '').trim(), mode: j.mode === 'live' ? 'live' : 'mock' };
}

function filenameFor(mime: string): string {
  if (mime.includes('ogg')) return 'audio.ogg';
  if (mime.includes('mp4')) return 'audio.mp4';
  if (mime.includes('wav')) return 'audio.wav';
  return 'audio.webm';
}

/* ---------------------------------- speak --------------------------------- */

export interface SpeakOptions {
  /** 0.5..2 — only honoured by the browser fallback. */
  rate?: number;
  /** Groq/Orpheus voice id (e.g. "tara"). */
  groqVoice?: string;
  /** Substring to match against installed SpeechSynthesis voices. */
  browserHint?: string;
  /** Exact `SpeechSynthesisVoice.voiceURI` to use — wins over `browserHint`. */
  voiceURI?: string;
}

export interface SpeakHandle {
  /** Resolves when playback finishes or is stopped. */
  done: Promise<void>;
  /** Barge-in: cut playback immediately. */
  stop: () => void;
}

export function speak(text: string, opts: SpeakOptions = {}): SpeakHandle {
  const ac = new AbortController();
  let stopped = false;
  let raf = 0;
  let audioEl: HTMLAudioElement | null = null;
  let ctx: AudioContext | null = null;

  const teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
      audioEl = null;
    }
    if (ctx && ctx.state !== 'closed') void ctx.close();
    ctx = null;
    audioBus.silence();
  };

  const playServerAudio = async (buf: ArrayBuffer, ctype: string) => {
    const url = URL.createObjectURL(new Blob([buf], { type: ctype }));
    audioEl = new Audio(url);
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    const src = ctx.createMediaElementSource(audioEl);
    const read = attachMeter(ctx, src);
    src.connect(ctx.destination);

    const pump = () => {
      audioBus.push(read());
      raf = requestAnimationFrame(pump);
    };

    await new Promise<void>((resolve) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioEl!.onended = finish;
      audioEl!.onerror = finish;
      ac.signal.addEventListener('abort', finish, { once: true });
      raf = requestAnimationFrame(pump);
      void audioEl!.play().catch(finish);
    });
    teardown();
  };

  const done = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: opts.groqVoice }),
        signal: ac.signal,
      });
      const ctype = res.headers.get('content-type') || '';
      if (res.ok && ctype.startsWith('audio/')) {
        await playServerAudio(await res.arrayBuffer(), ctype);
        return;
      }
      // JSON body ⇒ { fallback: true } — drop through to the browser voice.
    } catch {
      if (ac.signal.aborted) return;
    }
    if (stopped) return;
    await speakWithBrowser(text, opts.rate ?? 1, opts.browserHint, opts.voiceURI, ac.signal);
  })();

  return {
    done,
    stop: () => {
      stopped = true;
      ac.abort();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      teardown();
    },
  };
}

/* --------------------------- streaming speech queue ------------------------- */

export interface SpeechQueue {
  /** Enqueue a chunk of text (typically one sentence) to be spoken in order. */
  push: (text: string) => void;
  /** No more chunks are coming; `done` resolves once the queue drains. */
  end: () => void;
  /** Barge-in: stop the current chunk and drop everything pending. */
  stop: () => void;
  /** Resolves when the queue has spoken everything and `end()` was called. */
  done: Promise<void>;
}

/**
 * Speaks chunks back-to-back as they arrive. Feed it sentences off the token
 * stream so JARVIS starts talking on sentence one while the rest is still
 * being generated.
 */
export function createSpeechQueue(opts: SpeakOptions = {}): SpeechQueue {
  const pending: string[] = [];
  let current: SpeakHandle | null = null;
  let ended = false;
  let stopped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const pump = () => {
    if (stopped || current) return;
    const next = pending.shift();
    if (next === undefined) {
      if (ended) resolveDone();
      return;
    }
    const text = next.trim();
    if (!text) {
      pump();
      return;
    }
    const handle = speak(text, opts);
    current = handle;
    handle.done.finally(() => {
      current = null;
      pump();
    });
  };

  return {
    done,
    push: (text) => {
      if (stopped || ended) return;
      pending.push(text);
      pump();
    },
    end: () => {
      ended = true;
      if (!current && pending.length === 0) resolveDone();
      else pump();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      pending.length = 0;
      current?.stop();
      current = null;
      resolveDone();
    },
  };
}

function speakWithBrowser(
  text: string,
  rate: number,
  hint: string | undefined,
  voiceURI: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) {
      resolve();
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = Math.max(0.5, Math.min(2, rate));
    const v = pickBrowserVoice(hint, voiceURI);
    if (v) utter.voice = v;

    // SpeechSynthesis gives no audio graph to analyse, and `onboundary` is
    // unreliable across voices — so synthesise a speech-like waveform for the
    // whole utterance and let any boundary events add an extra pulse.
    let raf = 0;
    let pulse = 0;
    const started = performance.now();
    let speaking = true;
    const drive = () => {
      if (!speaking) return;
      const t = (performance.now() - started) / 1000;
      pulse *= 0.88;
      const env = 0.45 + 0.35 * Math.sin(t * 2.2) + 0.2 * Math.sin(t * 5.7 + 1);
      const level = Math.min(1, Math.max(0.12, Math.abs(env) * (0.8 + rate * 0.2)) + pulse * 0.5);
      const bins = Array.from({ length: 24 }, (_, i) => {
        const wobble = 0.5 + 0.5 * Math.sin(t * (4 + i * 0.5) + i);
        return Math.min(1, Math.max(0, (1 - i / 30) * level * (0.5 + 0.7 * wobble)));
      });
      audioBus.push({ level, bins });
      raf = requestAnimationFrame(drive);
    };

    const finish = () => {
      speaking = false;
      if (raf) cancelAnimationFrame(raf);
      audioBus.silence();
      resolve();
    };

    utter.onboundary = () => {
      pulse = Math.min(1, pulse + 0.6);
    };
    utter.onend = finish;
    utter.onerror = finish;
    signal.addEventListener(
      'abort',
      () => {
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        finish();
      },
      { once: true },
    );

    raf = requestAnimationFrame(drive);
    synth.speak(utter);
  });
}

/* --------------------------- browser voice picking -------------------------- */

let cachedVoices: SpeechSynthesisVoice[] = [];
function refreshVoices() {
  try {
    cachedVoices = window.speechSynthesis?.getVoices() ?? [];
  } catch {
    cachedVoices = [];
  }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

/** Installed SpeechSynthesis voices, English first. Empty until the browser
 *  populates them (fires `voiceschanged`). */
export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (!cachedVoices.length) refreshVoices();
  const en = cachedVoices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const rest = cachedVoices.filter((v) => !/^en(-|_|$)/i.test(v.lang));
  return [...en, ...rest];
}

export function pickBrowserVoice(
  hint?: string,
  voiceURI?: string,
): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) refreshVoices();
  if (!cachedVoices.length) return null;
  if (voiceURI) {
    const exact = cachedVoices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  const english = cachedVoices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : cachedVoices;
  if (hint) {
    const h = hint.toLowerCase();
    const match = pool.find((v) => v.name.toLowerCase().includes(h));
    if (match) return match;
    const idx = [...h].reduce((a, c) => a + c.charCodeAt(0), 0) % pool.length;
    return pool[idx];
  }
  return pool[0];
}
