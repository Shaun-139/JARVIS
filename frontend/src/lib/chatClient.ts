/**
 * chatClient — talks to the in-repo proxy (`backend/index.mjs`) over SSE.
 *
 * `streamChat` POSTs the transcript and invokes `onDelta` for each token as it
 * arrives, resolving with the full text. Pass an `AbortSignal` to support
 * barge-in — aborting rejects with an `AbortError` and the caller keeps
 * whatever text streamed so far.
 */

import type { ChatMessageModel } from '../types';
import { authHeaders } from './appAuth';

export type ChatMode = 'live' | 'mock';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface StreamChatOptions {
  messages: Pick<ChatMessageModel, 'role' | 'content'>[];
  model?: string;
  temperature?: number;
  /** 'groq' | 'openrouter' | 'gemini' | 'ollama' — omit for the server default. */
  provider?: string;
  /** Custom system prompt; empty/omitted uses the server's built-in persona. */
  system?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  /** Fired once when the stream reports whether it was live or mock. */
  onMode?: (mode: ChatMode) => void;
  /** Fired with the token counts from the provider's final chunk, if any. */
  onUsage?: (usage: TokenUsage) => void;
}

export interface ProviderStatus {
  label: string;
  ready: boolean;
  local: boolean;
  model: string;
}

export interface HealthInfo {
  ok: boolean;
  mode: ChatMode;
  defaultProvider: string;
  providers: Record<string, ProviderStatus>;
  stt: string;
  tts: string;
  defaultSystem: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export async function getHealth(signal?: AbortSignal): Promise<HealthInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal, headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  }
}

/** `{ providerId: string[] }` — model ids per configured provider. */
export async function getModels(signal?: AbortSignal): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${API_BASE}/api/models`, { signal, headers: authHeaders() });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      messages: opts.messages,
      model: opts.model,
      temperature: opts.temperature,
      provider: opts.provider,
      system: opts.system,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`chat request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  const handleEvent = (data: string) => {
    if (data === '[DONE]') return;
    let json: {
      delta?: string;
      done?: boolean;
      mode?: ChatMode;
      error?: string;
      usage?: TokenUsage | null;
    };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) throw new Error(json.error);
    if (json.mode && opts.onMode) opts.onMode(json.mode);
    if (json.usage && opts.onUsage) opts.onUsage(json.usage);
    if (json.delta) {
      full += json.delta;
      opts.onDelta(json.delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const t = line.trimStart();
        if (t.startsWith('data:')) handleEvent(t.slice(5).trim());
      }
    }
  }

  return full;
}
