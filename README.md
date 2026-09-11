# J.A.R.V.I.S. — Stark-Expo HUD

Real-time conversational voice & text AI assistant. Say **"Jarvis"** to activate,
or type. **Anime.js is the single source of truth for motion** — React state
decides *what* state the app is in, Anime.js decides *how* every transition is
presented.

```bash
npm install                              # one install at the repo root — npm workspaces
cp backend/.env.example backend/.env.local   # then paste your GROQ_API_KEY (optional — see below)
npm run dev                              # web http://localhost:5173  +  api http://localhost:8787
npm run build                            # tsc --noEmit + vite build (frontend)
npm run typecheck
```

The repo is an **npm workspaces** monorepo: [`frontend/`](frontend) (the Vite HUD)
and [`backend/`](backend) (the Express proxy) are separate packages with their own
`package.json`; the root `package.json` only orchestrates. One `npm install` at the
root wires both. Every root script above still behaves exactly as before — it just
delegates into the matching workspace (`npm --workspace frontend run …` etc.), so
`npm run dev`, `npm run dev:secure`, `npm run build`, `npm run preview`,
`npm run typecheck`, `npm run dev:web`, `npm run dev:api` and `npm start` are
unchanged from the caller's side.

`npm run dev` runs the Vite app **and** the chat proxy together (via `concurrently`).
Without a key the proxy streams canned replies in **MOCK** mode and the app is
fully usable; add `GROQ_API_KEY` to `.env.local` and restart to go **LIVE**.

### Microphone on a LAN address

`navigator.mediaDevices` only exists in a secure context. `http://localhost:5173`
counts; `http://192.168.x.x:5173` (a phone on the same Wi-Fi) does **not**. For
that, run **`npm run dev:secure`** — it serves HTTPS with a self-signed cert
(`@vitejs/plugin-basic-ssl`); accept the one-time browser warning on each device.
Chat/telemetry work on any URL — only the mic needs this.

## Real chat (backend proxy)

The provider key never reaches the browser. `backend/index.mjs` is a tiny Express
proxy:

| Route | Behaviour |
| ----- | --------- |
| `POST /api/chat` | Streams tokens back as SSE (`data: {"delta"}` … `data: {"done", usage}` … `data: [DONE]`); `usage` carries the provider's real `{prompt, completion, total}` token counts. Client disconnect aborts the upstream call — that's the barge-in path. |
| `POST /api/transcribe` | Raw audio body → Groq Whisper (`whisper-large-v3-turbo`) → `{ text }`. |
| `POST /api/speak` | `{ text, voice }` → Groq TTS audio bytes **if** `GROQ_TTS_ENABLED=1`, else `{ fallback: true }` so the client uses the browser voice. |
| `GET /api/metrics` | SSE, one frame / 1.5 s — **real host CPU %, RAM %** (`os.cpus()` + `os.freemem()`), plus RAM used/total GB, the proxy process's own RSS + CPU, core count and uptime. The browser can't read these. |
| `GET /api/models` | `{ providerId: string[] }` — model ids per *configured* provider (60 s cache), feeds the Settings model picker. |
| `GET /api/health` | `{ ok, mode, defaultProvider, providers, stt, tts, defaultSystem, host }` — per-provider readiness drives the dropdown dots + the LIVE/MOCK pill; `defaultSystem` is the built-in persona; `host` is the latest metrics snapshot. |

- **Providers:** Groq · OpenRouter · Gemini · local Ollama — all reached over a
  single OpenAI-compatible streaming path (`CHAT_PROVIDERS` in `backend/index.mjs`).
  The request body's `provider` field picks one; each shows a green/amber
  readiness dot in the model dropdown.
- **Env:** `GROQ_API_KEY` + `GROQ_MODEL` (chat default), `GROQ_STT_MODEL`,
  `GROQ_TTS_ENABLED` / `GROQ_TTS_MODEL` / `GROQ_TTS_VOICE`; `OPENROUTER_API_KEY`,
  `GEMINI_API_KEY`, `OLLAMA_URL` / `OLLAMA_MODEL`, `DEFAULT_PROVIDER`; `API_PORT`
  (default 8787 — deliberately *not* `PORT`). All of it lives in
  `backend/.env.local` (the proxy reads it from its own working directory); Vite
  proxies `/api` → `http://localhost:$API_PORT`.

## Voice I/O

| Direction | How |
| --------- | --- |
| **Wake word** | `WakeListener` (`src/lib/wakeWord.ts`, Web Speech API — Chrome/Edge) listens for "Jarvis" while idle. "Jarvis, do X" runs immediately; a bare "Jarvis" arms an ~8 s window for the follow-up. Opt-in toggle in Settings; the listener is released whenever the assistant is recording, thinking or speaking. |
| **Speech-in** | `MicRecorder` (`src/lib/voice.ts`) captures the utterance, auto-stops on ~1.5 s of silence (or the button / a 15 s cap), then `POST /api/transcribe`. Works on any standard Groq key. |
| **Speech-out** | **Streaming** — `createSpeechQueue` speaks the reply sentence-by-sentence as tokens arrive (JARVIS starts talking ~1 s before the text finishes), one utterance at a time. Each chunk goes through `speak()`, which tries `/api/speak` (Groq Orpheus — needs terms acceptance + `GROQ_TTS_ENABLED=1`) and falls back to the browser's `SpeechSynthesis`. |
| **Waveform** | Both the mic and the TTS playback push per-frame energy onto a lightweight singleton, `src/lib/audioBus.ts`; `VoiceVisualizer` subscribes while LISTENING / SPEAKING and feeds each frame into Anime.js. Groq audio is analysed for real; the browser voice is approximated from a speech-shaped generator + `onboundary` pulses. |

`SPEAKING` is held until TTS playback ends, not just until the text finishes.
**Interrupt** aborts the chat stream, cancels any recording, and cuts TTS.

### Client path

`src/lib/chatClient.ts` + `src/lib/voice.ts` + `src/lib/audioBus.ts` →
`src/hooks/useConversationEngine.ts`, which owns the whole
LISTENING → PROCESSING → SPEAKING → IDLE choreography.

## Stack

| Concern    | Choice                                            |
| ---------- | ------------------------------------------------- |
| Framework  | React 18 + TypeScript + Vite                      |
| Styling    | Tailwind CSS v3 (custom `arc` / `space` palette)  |
| Motion     | **Anime.js v3** (`animejs`, `@types/animejs`)     |
| Audio      | Web Audio API (`AnalyserNode`) → Anime.js         |
| Icons      | lucide-react                                      |

## Architecture

Two npm workspaces under the repo root:

```
backend/                 workspace "jarvis-backend" — dep: express
├─ index.mjs             Express SSE proxy — providers, keys server-side, mock fallback.
└─ .env.local            provider keys / models / API_PORT (git-ignored)

frontend/                workspace "jarvis-frontend" — React + Vite + Tailwind + Anime.js
├─ index.html
├─ vite.config.ts        dev server :5173, proxies /api → :$API_PORT
├─ tailwind.config.js · postcss.config.js · tsconfig.json
└─ src/
   ├─ lib/
   │  ├─ chatClient.ts      streamChat() / getHealth() — SSE reader for /api/chat.
   │  ├─ voice.ts           MicRecorder + transcribe() + speak() (Groq → browser).
   │  ├─ wakeWord.ts        "Jarvis" wake listener (Web Speech API).
   │  ├─ audioBus.ts        Singleton per-frame energy channel (mic ⇄ TTS ⇄ visualiser).
   │  └─ persist.ts         Namespaced, safe localStorage helpers.
   ├─ utils/
   │  └─ animations.ts      Centralised Anime.js factory — the ONLY file that
   │                        imports animejs for motion logic. Ring rotations,
   │                        gauge sweeps (strokeDashoffset), path morphs, node
   │                        staggers, per-state transition timelines, interrupt
   │                        reset, live audio-frame application, AnimationRegistry.
   ├─ hooks/
   │  ├─ useVoiceState.ts        IDLE→LISTENING→PROCESSING→SPEAKING FSM + interrupt.
   │  ├─ useHostMetrics.ts       EventSource client for /api/metrics (real CPU/RAM).
   │  ├─ useTelemetry.ts         Synthetic latency/token stream + CPU/RAM fallback.
   │  └─ useConversationEngine.ts Owns the full turn: record → transcribe → stream
   │                              → speak; AbortController barge-in; timer cleanup.
   ├─ components/
   │  ├─ VoiceVisualizer.tsx     Central multi-ring ARC-reactor HUD. (alias: VoiceOrb)
   │  ├─ VoiceStateIndicator.tsx HUD status badge, animated state switch.
   │  ├─ TelemetryGauge.tsx      One circular SVG meter, strokeDashoffset sweep.
   │  ├─ TelemetryDashboard.tsx  Glass panel of gauges (CPU/RAM/Latency/Tokens).
   │  ├─ ModelSelector.tsx       Provider dropdown + per-provider readiness dots.
   │  ├─ ChatMessage.tsx         Staggered bubble entry + streaming caret.
   │  ├─ MessageList.tsx         Scroll overlay; only the new batch staggers.
   │  ├─ AnimatedSidebar.tsx     Collapsible rail — switches the right-hand panel.
   │  ├─ TranscriptPanel.tsx     Full history · copy / download .md / clear.
   │  ├─ TelemetryPanel.tsx      Expanded systems screen — gauges, session timing,
   │  │                          provider readiness, STT/TTS status.
   │  └─ SettingsPanel.tsx       Provider / voice customisation.
   └─ App.tsx                    HUD shell — composition + boot sweep only.
```

## State machine → animation mapping

| State        | Anime.js presentation                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `IDLE`       | Halo breathing loop `scale [0.98,1.02]` 3000ms `easeInOutSine`; rings at 1×.     |
| `LISTENING`  | Halo expands to `scale 1.12` (`easeOutBack`), cyan accent, node stagger, 1.6× rings, damped mic shimmer. |
| `PROCESSING` | Rings 4.5× counter-rotation, fast core strobe (340ms), spinning telemetry gauge. |
| `SPEAKING`   | Audio-reactive radial bar sweep + waveform, `strokeDashoffset` driven per frame. |
| **Interrupt**| `interruptReset()` — `anime.remove` cancels TTS tweens, one 220ms beat back to LISTENING/IDLE. |

## Lifecycle / leak safety

Every component holds its Anime.js instances in refs (or an `AnimationRegistry`)
and disposes them in the matching `useEffect` cleanup: `instance.pause()` +
`anime.remove(targets)`. Mount-once animations (boot sweep, sidebar width) also
snap targets to their intended end state on cleanup so React StrictMode's
double-invoke can never leave an element frozen mid-tween.

## Telemetry sources

| Gauge | Source |
| ----- | ------ |
| CPU / RAM | Real host figures — `/api/metrics` SSE (`os.cpus()` + `os.freemem()`) via `useHostMetrics`. Synthetic `useTelemetry` fills in only until that stream connects. |
| TTFT | Real — time from sending the chat request to the first streamed token (`performance.now()` in `useConversationEngine`). |
| Tokens | Real — running session total from each turn's provider `usage` chunk (`stream_options.include_usage`). |

The Telemetry view also shows per-turn token split (in/out), last-response time,
host RAM used/total, and the proxy process's own footprint.

## Persistence

`src/lib/persist.ts` — namespaced (`jarvis:v1:`), every access wrapped so a
private window / full quota / disabled storage just yields the fallback.

- **Settings** + **UI** (collapsed rail, active panel) save on change, restore on load.
- **Conversation** + session token/turn totals save once each turn settles
  (never mid-stream) plus on `beforeunload`; last 150 messages kept. Restored
  bubbles render without the entry animation. "clear" wipes them.
- Per-turn timing (`ttftMs` / `totalMs`) is deliberately not restored.

## Settings

Grouped panel — **Model** (provider + editable model id with a `/api/models`
datalist), **Persona** (custom system prompt; empty falls back to the built-in
one, sent per request), **Voice** (real installed `SpeechSynthesis` voice list),
**Audio** (Temperature, Speech Rate → 0.5–1.5×, Input Gain → a real `GainNode`
in the mic chain, 0.5 = unity), **Behaviour** (wake word, barge-in). All persisted;
one **Reset to defaults**.

## UX

- **Message actions** (hover a bubble): copy · regenerate (last reply) · edit & resend (drops that message + everything after, back into the composer).
- **Keyboard shortcuts** — `/` or `Ctrl+K` focus composer · `Esc` stop/close · `Ctrl+.` push-to-talk · `Ctrl+B` toggle sidebar · `1`–`4` switch panel · `Ctrl+Backspace` clear · `?` shortcut sheet. (The chord key is shown as `⌘` on macOS; either modifier works.)
- **Mobile** — sidebar becomes a slide-over drawer (hamburger, below 768 px); the layout scrolls instead of clipping; telemetry strip scrolls horizontally.
- **a11y** — icon buttons carry `aria-label`s; an `aria-live` region announces voice-state changes; motion respects `prefers-reduced-motion`.
- **Compute Pressure API** — the browser's CPU-pressure state (`nominal`/`fair`/`serious`/`critical`) shows in the telemetry strip + panel where supported (Chrome, secure context).

## Deployment

Frontend and backend deploy separately — **Vercel** for `frontend/`, **Render**
for `backend/`. Deploy the backend first; the frontend build needs its URL.

**Render (`backend/`)** — New → Web Service → connect this repo. It picks up
[`render.yaml`](render.yaml) (Node runtime, `npm install`, `npm start`, health
check `/api/health`). In the dashboard set the secrets marked `sync: false`
there — at minimum `GROQ_API_KEY`; add `OPENROUTER_API_KEY` / `GEMINI_API_KEY`
for those providers. Local Ollama can't be reached from a Render service — that
provider just shows not-ready in production. Note the service URL (e.g.
`https://jarvis-backend.onrender.com`).

**Vercel (`frontend/`)** — New Project → import this repo. It picks up
[`vercel.json`](vercel.json) (`npm install`, `npm run build`, output
`frontend/dist`). Add one env var (Production, and Preview if you want preview
deploys to talk to the same backend): `VITE_API_BASE` = the Render URL from
above, no trailing slash. Deploy, then note the resulting `https://….vercel.app`
URL.

**Close the loop** — back in Render, set `CORS_ORIGIN` to that Vercel URL and
save (the service restarts automatically); without it the backend reflects any
origin, which works but is wide open. `CORS_ORIGIN` accepts a comma-separated
list if you also want e.g. a custom domain to work.

Both platforms redeploy automatically on every push to the branch you connect.

## Not yet built

- **Groq TTS** — gated behind Orpheus terms acceptance; the browser voice covers
  the gap. Accept the terms + set `GROQ_TTS_ENABLED=1` for the higher-quality,
  truly amplitude-reactive path.
