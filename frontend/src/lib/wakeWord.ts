/**
 * wakeWord.ts — always-on "Jarvis" wake-word listener built on the browser's
 * Web Speech API (SpeechRecognition). Chrome / Edge only, secure context only.
 *
 * Two shapes of activation:
 *   • "Jarvis, what's the system status"  → one utterance → emits { command }
 *   • "Jarvis" … <pause> … "what's the status" → emits { wake }, then the next
 *     final transcript within `commandWindowMs` → emits { command }
 *
 * Recognition is continuous and self-restarts (Chrome ends it every ~minute).
 * The caller is expected to `stop()` it while the assistant is thinking or
 * speaking, then `start()` again when idle — otherwise it hears the TTS voice.
 */

export type WakeEvent =
  | { type: 'command'; text: string }
  | { type: 'wake' }
  | { type: 'armed-timeout' }
  | { type: 'error'; message: string; fatal: boolean };

export interface WakeListenerOptions {
  /** Trigger words, matched case-insensitively as substrings. */
  phrases?: string[];
  /** How long to wait for a spoken command after a bare wake word. */
  commandWindowMs?: number;
}

interface MinimalRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

function getRecognitionCtor(): (new () => MinimalRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalRecognition;
    webkitSpeechRecognition?: new () => MinimalRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function wakeWordSupported(): boolean {
  return getRecognitionCtor() !== null;
}

const STRIP_LEAD = /^[\s,.:;!?—-]+/;

export class WakeListener {
  private rec: MinimalRecognition | null = null;
  private running = false;
  private armed = false;
  private armTimer = 0;
  private restartTimer = 0;
  private lastEmit = 0;
  private readonly phrases: string[];
  private readonly commandWindowMs: number;
  private handler: (e: WakeEvent) => void = () => {};

  constructor(opts: WakeListenerOptions = {}) {
    this.phrases = (opts.phrases ?? ['jarvis']).map((p) => p.toLowerCase());
    this.commandWindowMs = opts.commandWindowMs ?? 8000;
  }

  get active(): boolean {
    return this.running;
  }

  start(handler: (e: WakeEvent) => void): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handler({ type: 'error', message: 'Wake word needs Chrome or Edge.', fatal: true });
      return;
    }
    if (this.running) {
      this.handler = handler;
      return;
    }
    this.handler = handler;
    this.running = true;
    this.armed = false;
    this.spinUp(Ctor);
  }

  stop(): void {
    this.running = false;
    this.armed = false;
    window.clearTimeout(this.armTimer);
    window.clearTimeout(this.restartTimer);
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
  }

  private spinUp(Ctor: new () => MinimalRecognition): void {
    const rec = new Ctor();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        this.consume(r[0].transcript.toLowerCase().trim());
      }
    };

    rec.onerror = (e) => {
      // no-speech / aborted / audio-capture blips are normal in continuous mode.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false;
        this.handler({ type: 'error', message: 'Microphone permission denied.', fatal: true });
      }
    };

    rec.onend = () => {
      if (!this.running) return;
      // Chrome stops continuous recognition periodically — bounce it.
      this.restartTimer = window.setTimeout(() => {
        if (this.running) this.spinUp(Ctor);
      }, 250);
    };

    try {
      rec.start();
    } catch {
      /* start() throws if called too soon after a previous instance; onend retries */
    }
  }

  private emit(e: WakeEvent): void {
    this.lastEmit = Date.now();
    this.handler(e);
  }

  private consume(transcript: string): void {
    if (!transcript) return;
    // Debounce: ignore anything within 900ms of a previous emit (echo / repeats).
    if (Date.now() - this.lastEmit < 900) return;

    if (this.armed) {
      // We already heard "Jarvis"; the next real utterance is the command.
      if (this.phrases.some((p) => transcript === p)) return; // just "jarvis" again
      window.clearTimeout(this.armTimer);
      this.armed = false;
      this.emit({ type: 'command', text: capitalise(transcript) });
      return;
    }

    const hit = this.phrases
      .map((p) => ({ p, idx: transcript.indexOf(p) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx)[0];
    if (!hit) return;

    const tail = transcript.slice(hit.idx + hit.p.length).replace(STRIP_LEAD, '').trim();
    if (tail.length >= 2 && /[a-z0-9]/.test(tail)) {
      this.emit({ type: 'command', text: capitalise(tail) });
      return;
    }

    // Bare wake word — arm for a follow-up utterance.
    this.armed = true;
    this.emit({ type: 'wake' });
    window.clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => {
      this.armed = false;
      this.emit({ type: 'armed-timeout' });
    }, this.commandWindowMs);
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
