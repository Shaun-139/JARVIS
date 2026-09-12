/**
 * Shared domain types for J.A.R.V.I.S..
 *
 * React state determines WHAT state the app is in; Anime.js (see
 * `src/utils/animations.ts`) determines HOW that state transition is
 * visually presented.
 */

/** Finite-state machine for the voice pipeline. */
export type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

export const VOICE_STATES: VoiceState[] = ['IDLE', 'LISTENING', 'PROCESSING', 'SPEAKING'];

/** Inference provider options surfaced in the model selector. */
export type ProviderId = 'groq' | 'openrouter' | 'gemini' | 'ollama';

export interface Provider {
  id: ProviderId;
  label: string;
  /** Human-friendly default model string. */
  model: string;
  /** Short description shown in the dropdown. */
  hint: string;
  /** True when the provider runs on the user's own machine. */
  local: boolean;
}

export const PROVIDERS: Provider[] = [
  { id: 'groq', label: 'Groq', model: 'openai/gpt-oss-20b', hint: 'LPU · ultra-low latency', local: false },
  { id: 'openrouter', label: 'OpenRouter', model: 'openrouter/auto', hint: 'Unified model router', local: false },
  { id: 'gemini', label: 'Gemini', model: 'gemini-flash-latest', hint: 'Google multimodal', local: false },
  { id: 'ollama', label: 'Local Ollama', model: 'llama3.2:3b', hint: 'On-device · private', local: true },
];


export type Role = 'user' | 'assistant';

export interface ChatMessageModel {
  id: string;
  role: Role;
  content: string;
  /** Epoch ms. */
  ts: number;
  /** True while tokens are still streaming in. */
  streaming?: boolean;
}

/** One saved conversation in the Chats list — messages live separately, keyed by id. */
export interface ChatSummary {
  id: string;
  /** Auto-derived from the first message; editable later if that's ever added. */
  title: string;
  /** Epoch ms — drives the Chats list ordering and its relative-time label. */
  updatedAt: number;
}

/** Live telemetry sample rendered by the circular gauges. */
export interface TelemetrySample {
  /** 0..100 */
  cpu: number;
  /** 0..100 */
  ram: number;
  /** milliseconds */
  latency: number;
  /** tokens used this session */
  tokens: number;
}

export interface GaugeConfig {
  key: keyof TelemetrySample;
  label: string;
  /** Value that maps to a full sweep. */
  max: number;
  unit: string;
  /** Formats the raw sample value for display. */
  format: (v: number) => string;
}
