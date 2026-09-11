/**
 * J.A.R.V.I.S. chat proxy — keeps the provider API key server-side and streams tokens
 * to the browser as Server-Sent Events.
 *
 *   POST /api/chat   { messages, temperature?, model?, provider? } -> SSE
 *                       data: {"delta":"..."}         (repeated)
 *                       data: {"done":true,"mode":"live"|"mock","provider":"…"}
 *                       data: [DONE]
 *                       data: {"error":"..."}          (on failure)
 *   GET  /api/health -> { ok, mode, defaultProvider, providers, stt, tts }
 *
 * Chat providers: Groq · OpenRouter · Gemini · local Ollama — all reached over
 * their OpenAI-compatible streaming endpoint. Speech I/O (transcribe / speak)
 * stays on Groq. With nothing configured, /api/chat streams a canned mock.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHostSampler } from './lib/metrics.mjs';

/* --------------------------- tiny .env loader --------------------------- */
for (const file of ['.env.local', '.env']) {
  try {
    const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const raw of txt.split('\n')) {
      const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m || raw.trim().startsWith('#')) continue;
      const key = m[1];
      let val = (m[2] ?? '').trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* both files are optional */
  }
}

/* ------------------------------- config -------------------------------- */
// An explicit API_PORT (set in .env.local for local dev, where it must stay
// distinct from the web dev server's own port) always wins. Otherwise fall
// back to the platform-assigned PORT (Render, etc.) so the health check can
// find us — this only applies in a hosting context, since a local dev
// harness may also inject a generic PORT meant for the *web* process.
const PORT = Number(process.env.API_PORT || process.env.PORT || process.env.TALKAI_API_PORT || 8787);

/**
 * Chat providers. All four expose an OpenAI-compatible streaming
 * `/chat/completions`, so a single code path drives every one of them — only
 * the base URL, auth and default model differ.
 */
const CHAT_PROVIDERS = {
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    apiKey: () => process.env.GROQ_API_KEY || '',
    defaultModel: () => process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    local: false,
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    apiKey: () => process.env.OPENROUTER_API_KEY || '',
    defaultModel: () => process.env.OPENROUTER_MODEL || 'openrouter/auto',
    headers: () => ({ 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'J.A.R.V.I.S.' }),
    local: false,
  },
  gemini: {
    label: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVar: 'GEMINI_API_KEY',
    apiKey: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    defaultModel: () => process.env.GEMINI_MODEL || 'gemini-flash-latest',
    local: false,
  },
  ollama: {
    label: 'Local Ollama',
    baseURL: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '') + '/v1',
    envVar: 'OLLAMA_URL',
    apiKey: () => 'ollama', // Ollama ignores the token; any non-empty value works
    defaultModel: () => process.env.OLLAMA_MODEL || 'llama3.2',
    local: true,
  },
};

const DEFAULT_PROVIDER = CHAT_PROVIDERS[process.env.DEFAULT_PROVIDER]
  ? process.env.DEFAULT_PROVIDER
  : 'groq';

/** A provider is "ready" if it's local (Ollama) or has its key set. */
const providerReady = (id) => {
  const p = CHAT_PROVIDERS[id];
  return Boolean(p) && (p.local || Boolean(p.apiKey()));
};
const ANY_CLOUD_READY = ['groq', 'openrouter', 'gemini'].some(providerReady);

// Speech I/O stays on Groq regardless of the chosen chat provider.
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GROQ_LIVE = Boolean(GROQ_API_KEY);
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
// Text-to-speech: Groq's Orpheus needs one-time terms acceptance in the console,
// so it's opt-in. Off ⇒ the browser's SpeechSynthesis handles TTS.
const TTS_ENABLED = process.env.GROQ_TTS_ENABLED === '1';
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const GROQ_TTS_VOICE = process.env.GROQ_TTS_VOICE || 'tara';

const SYSTEM_PROMPT =
  "You are J.A.R.V.I.S., the user's personal assistant: unfailingly composed, quietly precise, " +
  'with a dry, understated wit. Address the user as "sir" only occasionally, never every line. ' +
  'Reply in 1–3 short spoken sentences unless asked for detail. This is read aloud — no markdown ' +
  'headings, no bullet-point dumps, no emoji.';

const MOCK_REPLIES = [
  'Arc reactor online. Telemetry is nominal — load is comfortably within range and latency is on target.',
  'I heard you. This is a mock response because no provider key is configured yet; set GROQ_API_KEY in .env.local to go live.',
  'Understood. I have staged that and I am standing by for your confirmation before doing anything irreversible.',
  'Here is the short version: the three things that actually matter for this decision are scope, cost, and timing.',
];

/* --------------------------- host metrics sampler --------------------- */
// The browser can't read host CPU/RAM; this process can. Sample this
// container's own stats once every ~1.5 s into `hostMetrics` — the fallback
// whenever no personal-machine agent (see below) is currently phoning in.
const sampleHost = createHostSampler();
let hostMetrics = sampleHost();
setInterval(() => {
  hostMetrics = sampleHost();
}, 1500).unref();

/* ------------------- personal-machine telemetry relay ------------------ */
// backend/agent.mjs, run on your own machine, POSTs its real CPU/RAM here so
// the deployed HUD can show YOUR PC instead of just this container. Falls
// back to `hostMetrics` above whenever the agent hasn't checked in recently.
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const PERSONAL_STALE_MS = 5000; // a couple of missed 1.5s beats' grace
let personalMetrics = null;
let personalMetricsAt = 0;

function currentHostMetrics() {
  if (personalMetrics && Date.now() - personalMetricsAt < PERSONAL_STALE_MS) {
    return { ...personalMetrics, source: 'personal' };
  }
  return { ...hostMetrics, source: 'server' };
}

/* -------------------------------- app --------------------------------- */
const app = express();

// Same-origin locally (Vite proxies /api to us) — this only matters once the
// frontend is deployed on a different origin (e.g. Vercel, with this proxy on
// Render). Comma-separated allow-list; unset ⇒ reflect any origin, which is
// fine since nothing here relies on cookies.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const jsonBody = express.json({ limit: '1mb' });
const rawAudioBody = express.raw({ type: () => true, limit: '25mb' });

app.get('/api/health', (_req, res) => {
  const providers = Object.fromEntries(
    Object.entries(CHAT_PROVIDERS).map(([id, p]) => [
      id,
      { label: p.label, ready: providerReady(id), local: p.local, model: p.defaultModel() },
    ]),
  );
  res.json({
    ok: true,
    mode: providerReady(DEFAULT_PROVIDER) || ANY_CLOUD_READY ? 'live' : 'mock',
    defaultProvider: DEFAULT_PROVIDER,
    providers,
    stt: GROQ_LIVE ? GROQ_STT_MODEL : 'mock',
    tts: GROQ_LIVE && TTS_ENABLED ? GROQ_TTS_MODEL : 'browser',
    defaultSystem: SYSTEM_PROMPT,
    host: currentHostMetrics(),
  });
});

/**
 * Personal-machine telemetry relay — backend/agent.mjs posts here. Requires
 * AGENT_TOKEN to be set on this server; without it the endpoint just refuses
 * everything, since there'd be no way to tell a real agent from anyone else.
 */
app.post('/api/host-metrics', jsonBody, (req, res) => {
  if (!AGENT_TOKEN) {
    res.status(501).json({ error: 'AGENT_TOKEN is not configured on this server' });
    return;
  }
  if (req.get('x-agent-token') !== AGENT_TOKEN) {
    res.status(401).json({ error: 'bad or missing X-Agent-Token' });
    return;
  }
  const b = req.body ?? {};
  personalMetrics = {
    cpu: Number(b.cpu) || 0,
    ram: Number(b.ram) || 0,
    ramUsedGb: Number(b.ramUsedGb) || 0,
    ramTotalGb: Number(b.ramTotalGb) || 0,
    procMb: Number(b.procMb) || 0,
    procCpu: Number(b.procCpu) || 0,
    cores: Number(b.cores) || 0,
    uptimeS: Number(b.uptimeS) || 0,
  };
  personalMetricsAt = Date.now();
  res.json({ ok: true });
});

/* Available model ids per configured provider (60 s cache). */
const modelsCache = { data: {}, ts: 0 };

async function fetchProviderModels(id) {
  const cfg = CHAT_PROVIDERS[id];
  try {
    if (id === 'ollama') {
      const base = cfg.baseURL.replace(/\/v1$/, '');
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.models || []).map((m) => m.name).sort();
    }
    const r = await fetch(`${cfg.baseURL}/models`, {
      headers: {
        ...(cfg.apiKey() ? { Authorization: `Bearer ${cfg.apiKey()}` } : {}),
        ...(cfg.headers ? cfg.headers() : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data || [])
      .map((m) => String(m.id).replace(/^models\//, ''))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

app.get('/api/models', async (_req, res) => {
  if (Date.now() - modelsCache.ts < 60_000 && Object.keys(modelsCache.data).length) {
    return res.json(modelsCache.data);
  }
  const ready = Object.keys(CHAT_PROVIDERS).filter(providerReady);
  const entries = await Promise.all(
    ready.map(async (id) => [id, await fetchProviderModels(id)]),
  );
  modelsCache.data = Object.fromEntries(entries.filter(([, list]) => list.length));
  modelsCache.ts = Date.now();
  res.json(modelsCache.data);
});

/* Live host CPU / RAM — one SSE frame per sample. */
app.get('/api/metrics', (req, res) => {
  const sse = openSSE(res);
  sse.send(currentHostMetrics());
  const id = setInterval(() => sse.send(currentHostMetrics()), 1500);
  res.on('close', () => clearInterval(id));
});

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  return {
    send: (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`),
    end: () => {
      res.write('data: [DONE]\n\n');
      res.end();
    },
  };
}

/** Normalise a provider `usage` object to `{ prompt, completion, total }`. */
function normUsage(u) {
  if (!u) return null;
  const prompt = u.prompt_tokens ?? u.promptTokens ?? 0;
  const completion = u.completion_tokens ?? u.completionTokens ?? 0;
  const total = u.total_tokens ?? u.totalTokens ?? prompt + completion;
  return { prompt, completion, total };
}

function streamMock(sse, ac) {
  const text = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];
  const words = text.split(' ');
  let i = 0;
  const tick = () => {
    if (ac.signal.aborted) return;
    i += 1;
    sse.send({ delta: (i === 1 ? '' : ' ') + words[i - 1] });
    if (i < words.length) setTimeout(tick, 45 + Math.random() * 65);
    else {
      sse.send({
        done: true,
        mode: 'mock',
        provider: 'mock',
        usage: { prompt: 0, completion: words.length, total: words.length },
      });
      sse.end();
    }
  };
  setTimeout(tick, 250);
}

app.post('/api/chat', jsonBody, async (req, res) => {
  const { messages = [], temperature = 0.6, model, provider, system } = req.body ?? {};
  const sysPrompt =
    typeof system === 'string' && system.trim() ? system.trim().slice(0, 4000) : SYSTEM_PROMPT;
  const sse = openSSE(res);
  const ac = new AbortController();
  // Client disconnect / barge-in. Use the RESPONSE stream's close event — on
  // modern Node `req`'s 'close' fires as soon as the request body is consumed,
  // which would abort us before we've streamed a single token.
  res.on('close', () => ac.abort());

  const providerId = CHAT_PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
  const cfg = CHAT_PROVIDERS[providerId];

  if (!providerReady(providerId)) {
    // Nothing configured at all ⇒ keep the demo alive with a canned reply.
    if (!ANY_CLOUD_READY && !providerReady('ollama')) {
      streamMock(sse, ac);
      return;
    }
    sse.send({
      error: `${cfg.label} isn't configured — set ${cfg.envVar} in .env.local and restart the server.`,
    });
    sse.end();
    return;
  }

  try {
    const upstream = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey() ? { Authorization: `Bearer ${cfg.apiKey()}` } : {}),
        ...(cfg.headers ? cfg.headers() : {}),
      },
      body: JSON.stringify({
        model: model || cfg.defaultModel(),
        temperature: Math.max(0, Math.min(2, Number(temperature) || 0.6)),
        stream: true,
        stream_options: { include_usage: true }, // token counts in the final chunk
        messages: [
          { role: 'system', content: sysPrompt },
          ...messages
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
            .map((m) => ({ role: m.role, content: String(m.content) })),
        ],
      }),
      signal: ac.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const errTxt = await upstream.text().catch(() => '');
      const hint =
        providerId === 'ollama' && upstream.status === 404
          ? ` — pull it first: \`ollama pull ${model || cfg.defaultModel()}\` (or set OLLAMA_MODEL)`
          : '';
      sse.send({ error: `${cfg.label} ${upstream.status}: ${errTxt.slice(0, 200)}${hint}` });
      sse.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') {
          sse.send({ done: true, mode: 'live', provider: providerId, usage: normUsage(usage) });
          sse.end();
          return;
        }
        try {
          const json = JSON.parse(payload);
          if (json.error) {
            sse.send({ error: `${cfg.label}: ${json.error.message || 'stream error'}` });
            sse.end();
            return;
          }
          if (json.usage) usage = json.usage;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) sse.send({ delta });
        } catch {
          /* keep-alive comment or split frame — ignore */
        }
      }
    }
    sse.send({ done: true, mode: 'live', provider: providerId, usage: normUsage(usage) });
    sse.end();
  } catch (err) {
    if (ac.signal.aborted) {
      try {
        res.end();
      } catch {
        /* already closed */
      }
      return;
    }
    const hint =
      providerId === 'ollama'
        ? ` — is Ollama running at ${cfg.baseURL.replace(/\/v1$/, '')}? (\`ollama serve\`)`
        : '';
    sse.send({ error: `${cfg.label}: ${String(err?.message || err)}${hint}` });
    try {
      sse.end();
    } catch {
      /* already closed */
    }
  }
});

/* ----------------------- speech-to-text (Whisper) --------------------- */
app.post('/api/transcribe', rawAudioBody, async (req, res) => {
  if (!GROQ_LIVE) {
    res.json({ text: '', mode: 'mock', note: 'no GROQ_API_KEY — transcription disabled' });
    return;
  }
  const buf = req.body;
  if (!buf || !buf.length) {
    res.status(400).json({ error: 'empty audio body' });
    return;
  }
  try {
    const filename = (req.get('x-filename') || 'audio.webm').replace(/[^\w.-]/g, '') || 'audio.webm';
    const type = req.get('content-type') || 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([buf], { type }), filename);
    form.append('model', GROQ_STT_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const up = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });
    const j = await up.json().catch(() => ({}));
    if (!up.ok) {
      res.status(502).json({ error: j?.error?.message || `stt ${up.status}` });
      return;
    }
    res.json({ text: String(j.text || '').trim(), mode: 'live' });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/* ----------------------- text-to-speech (Orpheus) -------------------- */
app.post('/api/speak', jsonBody, async (req, res) => {
  const { text = '', voice } = req.body ?? {};
  if (!GROQ_LIVE || !TTS_ENABLED) {
    res.json({ fallback: true, reason: GROQ_LIVE ? 'GROQ_TTS_ENABLED is not 1' : 'no GROQ_API_KEY' });
    return;
  }
  const input = String(text).slice(0, 4000).trim();
  if (!input) {
    res.status(400).json({ error: 'empty text' });
    return;
  }
  try {
    const up = await fetch(`${GROQ_BASE}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_TTS_MODEL,
        input,
        voice: voice || GROQ_TTS_VOICE,
        response_format: 'wav',
      }),
    });
    if (!up.ok || !up.body) {
      const t = await up.text().catch(() => '');
      // Not an error the client should choke on — it just means "use the browser".
      res.json({ fallback: true, reason: `tts ${up.status}: ${t.slice(0, 200)}` });
      return;
    }
    res.setHeader('Content-Type', up.headers.get('content-type') || 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    const reader = up.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.json({ fallback: true, reason: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  const ready = Object.keys(CHAT_PROVIDERS).filter(providerReady);
  // eslint-disable-next-line no-console
  console.log(
    `[api] J.A.R.V.I.S. proxy → http://localhost:${PORT}\n` +
      `      chat: ${ready.length ? ready.join(', ') : 'mock'}  (default: ${DEFAULT_PROVIDER})\n` +
      `      stt: ${GROQ_LIVE ? GROQ_STT_MODEL : 'mock'}   tts: ${
        GROQ_LIVE && TTS_ENABLED ? 'groq' : 'browser'
      }`,
  );
});
