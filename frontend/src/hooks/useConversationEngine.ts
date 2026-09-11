/**
 * useConversationEngine — drives the voice FSM around a real streamed reply from
 * the in-repo proxy, plus real speech I/O:
 *
 *   LISTENING   MicRecorder captures the utterance (auto-stops on silence)
 *   PROCESSING  the take is sent to /api/transcribe (Groq Whisper), then the
 *               transcript + history stream through /api/chat
 *   SPEAKING    tokens render as they arrive, then speak() voices the full
 *               reply (Groq TTS, or the browser voice) — the state holds until
 *               playback ends
 *   Interrupt   aborts the stream, cuts TTS, cancels any recording
 *
 * With no provider key everything degrades to mock: canned transcript + canned
 * reply + browser voice.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageModel } from '../types';
import type { VoiceStateApi } from './useVoiceState';
import {
  getHealth,
  streamChat,
  type ChatMode,
  type ProviderStatus,
  type TokenUsage,
} from '../lib/chatClient';
import { MicRecorder, transcribe, createSpeechQueue, type SpeechQueue } from '../lib/voice';
import { WakeListener, type WakeEvent } from '../lib/wakeWord';
import { load, save } from '../lib/persist';

const CONVO_KEY = 'conversation';
const STATS_KEY = 'stats';
/** Most recent messages kept in localStorage. */
const PERSIST_LIMIT = 150;

let uid = 0;
const nextId = () => `m${Date.now().toString(36)}-${(uid++).toString(36)}`;

const MOCK_PROMPT = 'Give me a quick system status check.';

/** Sentence terminator followed by whitespace — the boundary we speak on. */
const SENTENCE_END = /[.!?]["')\]]?(?=\s)/;

/**
 * Pull complete sentences off the front of a growing buffer so the speech queue
 * can start on sentence one while the rest still streams. Anything without a
 * terminator stays in `rest`; a long run-on with no punctuation is flushed at a
 * word break so a wall of text doesn't sit silent.
 */
function takeSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;

  for (;;) {
    const m = rest.match(SENTENCE_END);
    if (!m || m.index === undefined) break;
    const cut = m.index + m[0].length;
    const sentence = rest.slice(0, cut).trim();
    rest = rest.slice(cut).replace(/^\s+/, '');
    if (sentence.length >= 2) sentences.push(sentence);
  }

  if (rest.length > 220) {
    const sp = rest.lastIndexOf(' ', 200);
    if (sp > 40) {
      sentences.push(rest.slice(0, sp).trim());
      rest = rest.slice(sp + 1);
    }
  }

  return { sentences, rest };
}

export interface EngineOptions {
  model?: string;
  temperature?: number;
  /** Chat provider id: groq | openrouter | gemini | ollama. */
  provider?: string;
  /** Custom system prompt; empty uses the server default persona. */
  system?: string;
  /** Voice the reply aloud when true. */
  speak?: boolean;
  /** 0.5..2, browser voice only. */
  speechRate?: number;
  voice?: { groqVoice?: string; browserHint?: string; voiceURI?: string };
  /** 0..3 multiplier applied to mic input before recording. */
  inputGain?: number;
  /** Listen continuously for the "Jarvis" wake word while idle. */
  wakeWord?: boolean;
}

export interface TurnStats {
  /** Time-to-first-token of the last reply, ms. */
  ttftMs: number | null;
  /** Total streamed duration of the last reply, ms. */
  totalMs: number | null;
  /** Completed assistant turns this session. */
  turns: number;
  /** Prompt / completion tokens reported for the last turn (null if unknown). */
  lastPromptTokens: number | null;
  lastCompletionTokens: number | null;
  /** Running total of tokens billed this session (prompt + completion). */
  sessionTokens: number;
}

const EMPTY_STATS: TurnStats = {
  ttftMs: null,
  totalMs: null,
  turns: 0,
  lastPromptTokens: null,
  lastCompletionTokens: null,
  sessionTokens: 0,
};

export interface ConversationEngine {
  messages: ChatMessageModel[];
  busy: boolean;
  listening: boolean;
  speaking: boolean;
  /** Wake-word recognition is running. */
  wakeActive: boolean;
  /** Heard "Jarvis"; waiting for the spoken command. */
  wakeArmed: boolean;
  /** 'live' once a provider key is active, else 'mock'. */
  mode: ChatMode;
  /** Per-provider readiness from /api/health (empty until the probe returns). */
  providers: Record<string, ProviderStatus>;
  /** STT model / TTS mode strings from /api/health. */
  sttModel: string;
  ttsMode: string;
  /** The proxy's built-in persona / system prompt (placeholder for the editor). */
  defaultSystem: string;
  /** Timing of the most recent turn. */
  stats: TurnStats;
  error: string | null;
  dismissError: () => void;
  sendText: (text: string) => void;
  /** Start capturing a spoken utterance (enters LISTENING). */
  beginListening: () => void;
  /** Stop capture and run the turn. Safe to call when not listening. */
  endListening: () => void;
  /** Convenience for a single push-to-talk button. */
  toggleListening: () => void;
  interrupt: () => void;
  clear: () => void;
  /** Drop the last assistant reply and generate a fresh one. */
  regenerateLast: () => void;
  /**
   * Remove a user message and everything after it; returns its text so the UI
   * can drop it back in the composer for editing. No-op while busy.
   */
  editUserMessage: (id: string) => string | null;
}

export function useConversationEngine(
  voice: VoiceStateApi,
  opts: EngineOptions = {},
): ConversationEngine {
  const [messages, setMessages] = useState<ChatMessageModel[]>(() =>
    load<ChatMessageModel[]>(CONVO_KEY, []).map((m) => ({ ...m, streaming: false })),
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [wakeArmed, setWakeArmed] = useState(false);
  const [mode, setMode] = useState<ChatMode>('mock');
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [sttModel, setSttModel] = useState('mock');
  const [ttsMode, setTtsMode] = useState('browser');
  const [defaultSystem, setDefaultSystem] = useState('');
  const [stats, setStats] = useState<TurnStats>(() => ({
    ...EMPTY_STATS,
    ...load<Partial<TurnStats>>(STATS_KEY, {}),
    // Per-turn timing has no meaning across a reload.
    ttftMs: null,
    totalMs: null,
  }));
  const [error, setError] = useState<string | null>(null);

  const timers = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const speakRef = useRef<SpeechQueue | null>(null);
  const wakeRef = useRef<WakeListener | null>(null);
  const endListeningRef = useRef<() => void>(() => {});
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const stopSpeech = useCallback(() => {
    speakRef.current?.stop();
    speakRef.current = null;
    setSpeaking(false);
  }, []);

  // Probe the proxy once so the UI can show LIVE / MOCK.
  useEffect(() => {
    const ac = new AbortController();
    getHealth(ac.signal).then((h) => {
      if (!h) return;
      setMode(h.mode);
      if (h.providers) setProviders(h.providers);
      if (h.stt) setSttModel(h.stt);
      if (h.tts) setTtsMode(h.tts);
      if (h.defaultSystem) setDefaultSystem(h.defaultSystem);
    });
    return () => {
      ac.abort();
      clearTimers();
      abortRef.current?.abort();
      recorderRef.current?.cancel();
      speakRef.current?.stop();
    };
  }, [clearTimers]);

  // Persist the transcript + running totals once each turn settles (skipping the
  // per-token churn while a reply streams). `beforeunload` catches a mid-turn reload.
  useEffect(() => {
    if (busy || listening) return;
    save(
      CONVO_KEY,
      messages.slice(-PERSIST_LIMIT).map(({ streaming: _s, ...m }) => m),
    );
    save(STATS_KEY, {
      turns: stats.turns,
      sessionTokens: stats.sessionTokens,
      lastPromptTokens: stats.lastPromptTokens,
      lastCompletionTokens: stats.lastCompletionTokens,
    });
  }, [messages, stats, busy, listening]);

  useEffect(() => {
    const flush = () =>
      save(
        CONVO_KEY,
        messagesRef.current.slice(-PERSIST_LIMIT).map(({ streaming: _s, ...m }) => m),
      );
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessageModel>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const endTurn = useCallback(
    (delay = 400) => {
      streamingIdRef.current = null;
      abortRef.current = null;
      setBusy(false);
      after(delay, () => voice.setState('IDLE'));
    },
    [after, voice],
  );

  /** Stream one assistant turn against `history`, speaking it sentence-by-sentence. */
  const runAssistantTurn = useCallback(
    (history: ChatMessageModel[]) => {
      voice.setState('PROCESSING');
      const id = nextId();
      streamingIdRef.current = id;
      const ac = new AbortController();
      abortRef.current = ac;
      let started = false;
      const t0 = performance.now();
      let ttft: number | null = null;
      let usage: TokenUsage | null = null;

      const wantSpeech = !!optsRef.current.speak;
      let queue: SpeechQueue | null = null;
      let spokenBuf = ''; // text streamed but not yet handed to the speech queue

      setMessages((prev) => [
        ...prev,
        { id, role: 'assistant', content: '', ts: Date.now(), streaming: true },
      ]);

      const finishSpeech = () => {
        if (!queue) {
          endTurn();
          return;
        }
        if (spokenBuf.trim()) queue.push(spokenBuf);
        spokenBuf = '';
        const q = queue;
        queue.end();
        queue.done.finally(() => {
          if (speakRef.current === q) speakRef.current = null;
          setSpeaking(false);
          endTurn(150);
        });
      };

      streamChat({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        model: optsRef.current.model,
        temperature: optsRef.current.temperature,
        provider: optsRef.current.provider,
        system: optsRef.current.system,
        signal: ac.signal,
        onMode: setMode,
        onUsage: (u) => {
          usage = u;
        },
        onDelta: (chunk) => {
          if (streamingIdRef.current !== id) return;
          if (!started) {
            started = true;
            ttft = performance.now() - t0;
            voice.setState('SPEAKING');
            if (wantSpeech) {
              setSpeaking(true);
              queue = createSpeechQueue({
                rate: optsRef.current.speechRate,
                groqVoice: optsRef.current.voice?.groqVoice,
                browserHint: optsRef.current.voice?.browserHint,
              });
              speakRef.current = queue;
            }
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
          );
          if (queue) {
            spokenBuf += chunk;
            const { sentences, rest } = takeSentences(spokenBuf);
            spokenBuf = rest;
            sentences.forEach((s) => queue!.push(s));
          }
        },
      })
        .then(() => {
          if (streamingIdRef.current !== id) return;
          setStats((s) => ({
            ttftMs: ttft,
            totalMs: performance.now() - t0,
            turns: s.turns + 1,
            lastPromptTokens: usage ? usage.prompt : s.lastPromptTokens,
            lastCompletionTokens: usage ? usage.completion : s.lastCompletionTokens,
            sessionTokens: s.sessionTokens + (usage ? usage.total : 0),
          }));
          patchMessage(id, { streaming: false });
          finishSpeech();
        })
        .catch((err: unknown) => {
          queue?.stop();
          if (speakRef.current === queue) speakRef.current = null;
          setSpeaking(false);
          if (ac.signal.aborted || streamingIdRef.current !== id) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          patchMessage(id, { streaming: false, content: '⚠ ' + (msg || 'stream failed') });
          endTurn();
        });
    },
    [endTurn, patchMessage, voice],
  );

  const appendAndRun = useCallback(
    (content: string) => {
      const userMsg: ChatMessageModel = { id: nextId(), role: 'user', content, ts: Date.now() };
      setMessages((prev) => {
        const history = [...prev, userMsg];
        runAssistantTurn(history);
        return history;
      });
    },
    [runAssistantTurn],
  );

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      clearTimers();
      appendAndRun(trimmed);
    },
    [busy, clearTimers, appendAndRun],
  );

  /* -------------------------------- listening ------------------------------- */

  const beginListening = useCallback(() => {
    if (busy || listening) return;
    setError(null);
    clearTimers();
    // Hand the mic over from the wake listener to the recorder.
    wakeRef.current?.stop();
    setWakeActive(false);
    setWakeArmed(false);
    setBusy(true);
    setListening(true);
    voice.setState('LISTENING');

    const rec = new MicRecorder();
    recorderRef.current = rec;
    rec
      .start({
        onAutoStop: () => endListeningRef.current(),
        gain: optsRef.current.inputGain,
      })
      .catch((err: unknown) => {
        recorderRef.current = null;
        setListening(false);
        setBusy(false);
        setError(err instanceof Error ? err.message : 'microphone unavailable');
        voice.setState('IDLE');
      });
  }, [busy, listening, clearTimers, voice]);

  const endListening = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || !listening) return;
    setListening(false);
    recorderRef.current = null;
    voice.setState('PROCESSING');

    const ac = new AbortController();
    abortRef.current = ac;

    rec
      .stop()
      .then(({ blob, durationMs }) => {
        if (durationMs < 350 || blob.size < 1200) {
          throw new Error('nothing recorded — hold the button and speak');
        }
        return transcribe(blob, ac.signal);
      })
      .then(({ text, mode: sttMode }) => {
        const spoken = text || (sttMode === 'mock' ? MOCK_PROMPT : '');
        if (!spoken) throw new Error('no speech detected');
        appendAndRun(sttMode === 'mock' ? `(voice · mock) ${spoken}` : spoken);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'transcription failed');
        setBusy(false);
        abortRef.current = null;
        voice.setState('IDLE');
      });
  }, [listening, voice, appendAndRun]);

  endListeningRef.current = endListening;

  const toggleListening = useCallback(() => {
    if (listening) endListening();
    else beginListening();
  }, [listening, endListening, beginListening]);

  /* ------------------------------- wake word ------------------------------- */

  const wakeWanted = !!opts.wakeWord;

  const onWakeEvent = useCallback(
    (e: WakeEvent) => {
      if (e.type === 'error') {
        if (e.fatal) {
          wakeRef.current?.stop();
          setWakeActive(false);
          setWakeArmed(false);
          setError(e.message);
        }
        return;
      }
      if (e.type === 'armed-timeout') {
        setWakeArmed(false);
        voice.setState('IDLE');
        return;
      }
      if (e.type === 'wake') {
        setWakeArmed(true);
        voice.setState('LISTENING');
        return;
      }
      // e.type === 'command'
      setWakeArmed(false);
      wakeRef.current?.stop();
      setWakeActive(false);
      sendText(e.text);
    },
    [sendText, voice],
  );

  // Keep the wake listener running only while genuinely idle (or armed and
  // waiting for the follow-up command). Anything else — thinking, speaking,
  // manual push-to-talk — takes the mic and silences it.
  useEffect(() => {
    const canRun =
      wakeWanted && !busy && !speaking && !listening && (voice.state === 'IDLE' || wakeArmed);

    if (canRun) {
      if (!wakeRef.current) {
        wakeRef.current = new WakeListener({ phrases: ['jarvis', 'hey jarvis'] });
      }
      if (!wakeRef.current.active) {
        wakeRef.current.start(onWakeEvent);
        setWakeActive(true);
      }
    } else if (wakeRef.current?.active) {
      wakeRef.current.stop();
      setWakeActive(false);
    }
  }, [wakeWanted, busy, speaking, listening, wakeArmed, voice.state, onWakeEvent]);

  useEffect(() => () => wakeRef.current?.stop(), []);

  /* --------------------------------- control ------------------------------- */

  const interrupt = useCallback(() => {
    clearTimers();
    abortRef.current?.abort();
    abortRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    stopSpeech();
    setListening(false);

    const id = streamingIdRef.current;
    streamingIdRef.current = null;
    if (id) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, streaming: false, content: m.content ? `${m.content} —` : '—' }
            : m,
        ),
      );
    }
    setBusy(false);
    voice.interrupt('LISTENING');
    after(1400, () => voice.setState('IDLE'));
  }, [after, clearTimers, stopSpeech, voice]);

  const clear = useCallback(() => {
    clearTimers();
    abortRef.current?.abort();
    abortRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    stopSpeech();
    streamingIdRef.current = null;
    setBusy(false);
    setListening(false);
    setWakeArmed(false);
    setError(null);
    setMessages([]); // the persist effect writes the empty state straight through
    setStats(EMPTY_STATS);
    voice.setState('IDLE');
  }, [clearTimers, stopSpeech, voice]);

  const dismissError = useCallback(() => setError(null), []);

  const regenerateLast = useCallback(() => {
    if (busy) return;
    const msgs = messagesRef.current;
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'assistant') return;
    const history = msgs.slice(0, -1);
    if (history.length === 0) return;
    setError(null);
    clearTimers();
    setBusy(true);
    setMessages(history);
    runAssistantTurn(history);
  }, [busy, clearTimers, runAssistantTurn]);

  const editUserMessage = useCallback(
    (id: string): string | null => {
      if (busy) return null;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx < 0 || msgs[idx].role !== 'user') return null;
      const text = msgs[idx].content;
      setMessages(msgs.slice(0, idx));
      return text;
    },
    [busy],
  );

  return {
    messages,
    busy,
    listening,
    speaking,
    wakeActive,
    wakeArmed,
    mode,
    providers,
    sttModel,
    ttsMode,
    defaultSystem,
    stats,
    error,
    dismissError,
    sendText,
    beginListening,
    endListening,
    toggleListening,
    interrupt,
    clear,
    regenerateLast,
    editUserMessage,
  };
}
