/**
 * App — the J.A.R.V.I.S. HUD shell.
 *
 * Composition only: it owns app state (voice FSM, conversation, settings,
 * layout) and hands every transition to the Anime.js layer via the child
 * components. The one animation it runs directly is the boot sweep of the
 * glass panels on first mount.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HelpCircle,
  Menu,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import anime from 'animejs';

import VoiceVisualizer from './components/VoiceVisualizer';
import VoiceStateIndicator from './components/VoiceStateIndicator';
import TelemetryDashboard from './components/TelemetryDashboard';
import MessageList from './components/MessageList';
import AnimatedSidebar, { type SidebarView } from './components/AnimatedSidebar';
import SettingsPanel, {
  DEFAULT_SETTINGS,
  toInputGain,
  toSpeechRate,
  type VoiceSettings,
} from './components/SettingsPanel';
import ChatsPanel from './components/ChatsPanel';
import TelemetryPanel from './components/TelemetryPanel';
import HelpOverlay from './components/HelpOverlay';

import { useVoiceState } from './hooks/useVoiceState';
import { useTelemetry } from './hooks/useTelemetry';
import { useHostMetrics } from './hooks/useHostMetrics';
import { useComputePressure } from './hooks/useComputePressure';
import { useConversationEngine } from './hooks/useConversationEngine';
import { useHotkeys, type Hotkey } from './hooks/useHotkeys';
import { load, save } from './lib/persist';
import { bootSequence } from './utils/animations';
import { PROVIDERS, VOICE_STATES, type TelemetrySample, type VoiceState } from './types';

/**
 * The chord modifier is `Ctrl` everywhere except macOS, where it's `⌘`
 * (the key binder in `useHotkeys` already accepts either). These strings are
 * display-only — shown in the shortcuts sheet.
 */
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || (navigator as any).userAgentData?.platform || '');
const kbd = (key: string) => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);
const CLEAR_KEYS = IS_MAC ? '⌘⌫' : 'Ctrl+Backspace';

export interface AppProps {
  /** True when BootSplash is about to land its reactor on this App's own —
   *  skips App's own entrance sweep so the panels (and the reactor's
   *  position) are stable and measurable from the very first frame. */
  skipBootSweep?: boolean;
}

export default function App({ skipBootSweep = false }: AppProps = {}) {
  const voice = useVoiceState('IDLE');
  const synthTelemetry = useTelemetry(voice.state);
  const { metrics: host, connected: hostConnected } = useHostMetrics();
  const pressure = useComputePressure();

  const ui = load<{ collapsed: boolean; view: SidebarView }>('ui', {
    collapsed: false,
    view: 'session',
  });
  const [collapsed, setCollapsed] = useState(ui.collapsed);
  const [view, setView] = useState<SidebarView>(ui.view);
  const [settings, setSettings] = useState<VoiceSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...load<Partial<VoiceSettings>>('settings', {}),
  }));
  const [draft, setDraft] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile sidebar drawer
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    save('settings', settings);
  }, [settings]);
  useEffect(() => {
    save('ui', { collapsed, view });
  }, [collapsed, view]);

  const chatOpts = useMemo(
    () => ({
      provider: settings.provider,
      model:
        settings.models[settings.provider] ||
        PROVIDERS.find((p) => p.id === settings.provider)?.model,
      temperature: settings.temperature,
      system: settings.persona.trim() || undefined,
      speak: settings.voiceOut,
      speechRate: toSpeechRate(settings.speechRate),
      voice: { voiceURI: settings.voiceURI || undefined },
      inputGain: toInputGain(settings.inputGain),
      wakeWord: settings.wakeWord,
    }),
    [
      settings.provider,
      settings.models,
      settings.temperature,
      settings.persona,
      settings.voiceOut,
      settings.speechRate,
      settings.voiceURI,
      settings.inputGain,
      settings.wakeWord,
    ],
  );
  const convo = useConversationEngine(voice, chatOpts);

  // CPU/RAM: real from the proxy stream, synthetic fallback until it connects.
  // Latency: last time-to-first-token. Tokens: running session total — both real.
  const telemetry = useMemo<TelemetrySample>(
    () => ({
      cpu: host ? host.cpu : synthTelemetry.cpu,
      ram: host ? host.ram : synthTelemetry.ram,
      latency: convo.stats.ttftMs ?? 0,
      tokens: convo.stats.sessionTokens,
    }),
    [host, synthTelemetry, convo.stats.ttftMs, convo.stats.sessionTokens],
  );

  const shellRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

  // Boot sweep — stagger the glass panels in once. Guarded so React StrictMode's
  // double-invoke (and any cleanup mid-flight) can never leave a panel hidden.
  // [data-boot-skip] excludes panels with their own show/hide animation (e.g.
  // ModelSelector's dropdown) — sweeping those in would force them visible
  // regardless of open state, and permanently, since this only ever runs once.
  useEffect(() => {
    const panels = shellRef.current?.querySelectorAll('.hud-panel:not([data-boot-skip])');
    if (!panels || !panels.length) return;

    if (bootedRef.current || skipBootSweep) {
      anime.set(panels, { opacity: 1, translateX: 0, translateY: 0, filter: 'blur(0px)' });
      bootedRef.current = true;
      return;
    }
    bootedRef.current = true;

    const tl = bootSequence(panels);
    return () => {
      tl.pause();
      anime.remove(panels);
      anime.set(panels, { opacity: 1, translateX: 0, translateY: 0, filter: 'blur(0px)' });
    };
  }, []);

  const patchSettings = useCallback(
    (patch: Partial<VoiceSettings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );
  const resetSettings = useCallback(() => setSettings({ ...DEFAULT_SETTINGS }), []);

  const canInterrupt =
    settings.bargeIn &&
    (convo.speaking ||
      convo.listening ||
      voice.state === 'SPEAKING' ||
      voice.state === 'PROCESSING');

  const submitDraft = () => {
    if (!draft.trim()) return;
    convo.sendText(draft);
    setDraft('');
  };

  const startEdit = useCallback(
    (id: string) => {
      const text = convo.editUserMessage(id);
      if (text != null) {
        setDraft(text);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [convo],
  );

  const escape = useCallback(() => {
    if (helpOpen) return setHelpOpen(false);
    if (navOpen) return setNavOpen(false);
    if (convo.listening) return convo.endListening();
    if (canInterrupt) return convo.interrupt();
    inputRef.current?.blur();
  }, [helpOpen, navOpen, convo, canInterrupt]);

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { combo: 'slash', label: 'Focus composer', run: () => inputRef.current?.focus() },
      { combo: 'mod+k', label: 'Focus composer', run: () => inputRef.current?.focus() },
      { combo: 'escape', label: 'Stop / close', run: escape },
      { combo: 'mod+.', label: 'Push-to-talk', run: () => convo.toggleListening() },
      { combo: 'mod+b', label: 'Toggle sidebar', run: () => setCollapsed((c) => !c) },
      { combo: 'mod+backspace', label: 'Clear channel', run: () => convo.clear() },
      { combo: '1', label: 'Live Session', run: () => setView('session') },
      { combo: '2', label: 'Chats', run: () => setView('history') },
      { combo: '3', label: 'Telemetry', run: () => setView('telemetry') },
      { combo: '4', label: 'Settings', run: () => setView('settings') },
      { combo: '?', label: 'This help', run: () => setHelpOpen((o) => !o) },
    ],
    [escape, convo],
  );
  useHotkeys(hotkeys);

  const shortcutList = useMemo(
    () => [
      { keys: `/  ·  ${kbd('K')}`, label: 'Focus composer' },
      { keys: 'Esc', label: 'Stop speaking / close' },
      { keys: kbd('.'), label: 'Push-to-talk' },
      { keys: kbd('B'), label: 'Toggle sidebar' },
      { keys: '1–4', label: 'Switch panel' },
      { keys: CLEAR_KEYS, label: 'Clear channel' },
      { keys: '?', label: 'Toggle this help' },
    ],
    [],
  );

  return (
    <div className="relative flex min-h-[100dvh] w-screen flex-col overflow-x-hidden bg-space-900 text-cyan-100 md:h-screen md:overflow-hidden">
      {/* Background grid + vignette */}
      <div className="pointer-events-none fixed inset-0 bg-hud-grid [background-size:44px_44px] opacity-60" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_35%,rgba(2,8,19,0.9)_100%)]" />

      {/* Screen-reader status announcements */}
      <div className="sr-only" aria-live="polite">
        {voice.interrupted ? 'Interrupted' : voice.state.toLowerCase()}
      </div>

      <div ref={shellRef} className="relative z-10 flex min-h-full w-full gap-4 p-4 lg:h-full">
        {/* Mobile drawer backdrop — must be a sibling of .nav-drawer (both
            inside shellRef), not a sibling of shellRef itself: shellRef's own
            z-10 caps whatever nests inside it, so a backdrop placed *outside*
            shellRef at a higher z-index (as this used to be) sat visually and
            interactively above the whole drawer, swallowing every tap on it
            regardless of the drawer's own (locally-higher, but trapped) z-index. */}
        {navOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        )}
        <div
          className="nav-drawer"
          style={navOpen ? { transform: 'translateX(0)' } : undefined}
        >
          <AnimatedSidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            active={view}
            onSelect={(v) => {
              setView(v);
              setNavOpen(false);
            }}
          />
        </div>

        {/* Main column */}
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Top telemetry + provider + status */}
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="hud-panel flex h-10 w-10 items-center justify-center text-arc-cyan md:hidden"
            >
              <Menu size={18} />
            </button>
            <TelemetryDashboard
              sample={telemetry}
              hostConnected={hostConnected}
              hostSource={host?.source}
              pressure={pressure}
            />
            <div className="ml-auto flex items-start gap-3">
              <VoiceStateIndicator state={voice.state} interrupted={voice.interrupted} />
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts ( ? )"
                className="hud-panel flex h-10 w-10 items-center justify-center text-arc-cyan/60 hover:text-arc-cyan"
              >
                <HelpCircle size={16} />
              </button>
            </div>
          </div>

          {/* Stage: central visualiser with the channel / settings overlay.
              Overlay floats over the stage on lg+, stacks below it when narrow. */}
          <div className="relative flex min-h-0 flex-1 flex-col gap-4 lg:block">
            {/* Central HUD arc core */}
            <section className="hud-panel relative flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 overflow-hidden px-6 py-4 lg:h-full lg:pr-[380px]">
              <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-col">
                <span className="hud-label">Arc Core</span>
                <span className="font-mono text-[10px] text-arc-cyan/45">
                  {settings.provider.toUpperCase()}
                  {settings.models[settings.provider] ? ` · ${settings.models[settings.provider]}` : ''}
                </span>
              </div>

              <VoiceVisualizer
                id="arc-reactor-dock"
                state={voice.state}
                prevState={voice.prevState}
                interrupted={voice.interrupted}
                size={420}
              />

              {/* Manual state switcher (dev affordance — hidden on small screens) */}
              <div className="hidden flex-wrap items-center justify-center gap-2 sm:flex">
                {VOICE_STATES.map((s: VoiceState) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => voice.setState(s)}
                    className={`px-3 py-1.5 font-hud text-[11px] tracking-[0.2em] uppercase transition-colors ${
                      voice.state === s
                        ? 'border border-arc-cyan/60 bg-arc-cyan/15 text-arc-cyan shadow-hud'
                        : 'border border-arc-cyan/20 text-cyan-100/50 hover:border-arc-cyan/40 hover:text-arc-cyan'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={convo.toggleListening}
                  disabled={convo.busy && !convo.listening}
                  aria-label={convo.listening ? 'Stop recording and send' : 'Push to talk'}
                  className={`flex items-center gap-2 border px-4 py-2 font-hud text-xs tracking-[0.2em] uppercase transition-colors disabled:opacity-40 ${
                    convo.listening
                      ? 'border-rose-400/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                      : 'border-arc-cyan/50 bg-arc-cyan/10 text-arc-cyan hover:bg-arc-cyan/20'
                  }`}
                >
                  {convo.listening ? <MicOff size={14} /> : <Mic size={14} />}
                  {convo.listening ? 'Stop & send' : 'Hold to talk'}
                </button>
                <button
                  type="button"
                  onClick={convo.interrupt}
                  disabled={!canInterrupt}
                  aria-label="Interrupt JARVIS"
                  className="flex items-center gap-2 border border-rose-400/50 bg-rose-500/10 px-4 py-2 font-hud text-xs tracking-[0.2em] text-rose-300 uppercase transition-colors hover:bg-rose-500/20 disabled:opacity-30"
                >
                  <Square size={13} /> Interrupt
                </button>
              </div>
              {convo.listening && (
                <span className="font-mono text-[10px] tracking-wide text-rose-300/80">
                  ● listening — speak, then tap “Stop &amp; send” (auto-stops on silence)
                </span>
              )}
              {!convo.listening && convo.wakeArmed && (
                <span className="font-mono text-[10px] tracking-wide text-arc-cyan animate-pulse">
                  ◉ heard “Jarvis” — go ahead
                </span>
              )}
              {!convo.listening && !convo.wakeArmed && convo.wakeActive && (
                <span className="font-mono text-[10px] tracking-wide text-arc-cyan/45">
                  ◎ wake word armed — say “Jarvis”
                </span>
              )}
            </section>

            {/* Channel / settings overlay — glass panel floating over the stage */}
            <div className="z-10 flex h-[42vh] w-full flex-col lg:absolute lg:right-3 lg:top-3 lg:bottom-3 lg:h-auto lg:w-[min(356px,44vw)]">
              {view === 'settings' ? (
                <SettingsPanel
                  settings={settings}
                  onChange={patchSettings}
                  onReset={resetSettings}
                  micActive={convo.listening}
                  ttsMode={convo.ttsMode}
                  providerStatus={convo.providers}
                  defaultPersona={convo.defaultSystem}
                />
              ) : view === 'history' ? (
                <ChatsPanel
                  chats={convo.chats}
                  activeChatId={convo.activeChatId}
                  onSelect={(id) => {
                    convo.switchChat(id);
                    setView('session');
                  }}
                  onNew={() => {
                    convo.newChat();
                    setView('session');
                  }}
                  onDelete={convo.deleteChat}
                />
              ) : view === 'telemetry' ? (
                <TelemetryPanel
                  sample={telemetry}
                  host={host}
                  hostConnected={hostConnected}
                  pressure={pressure}
                  providers={convo.providers}
                  activeProvider={settings.provider}
                  stats={convo.stats}
                  messages={convo.messages}
                  stt={convo.sttModel}
                  tts={convo.ttsMode}
                />
              ) : (
                <section className="hud-panel flex h-full flex-col overflow-hidden bg-slate-950/60">
                  <header className="flex items-center justify-between gap-2 border-b border-arc-cyan/15 px-4 py-2.5">
                    <span className="flex items-center gap-2 font-hud text-sm font-semibold tracking-[0.22em] text-arc-cyan uppercase">
                      Channel
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-normal ${
                          convo.mode === 'live'
                            ? 'border-emerald-400/50 text-emerald-300'
                            : 'border-amber-400/40 text-amber-300/80'
                        }`}
                        title={
                          convo.mode === 'live'
                            ? 'Connected to a provider'
                            : 'No provider key — proxy is returning canned replies'
                        }
                      >
                        {convo.mode === 'live' ? 'LIVE' : 'MOCK'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={convo.clear}
                      className="flex items-center gap-1 font-mono text-[10px] text-arc-cyan/45 hover:text-arc-cyan"
                    >
                      <Trash2 size={12} /> clear
                    </button>
                  </header>

                  {convo.error && (
                    <div className="flex items-start gap-2 border-b border-rose-400/30 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
                      <span className="min-w-0 flex-1 break-words font-mono">{convo.error}</span>
                      <button
                        type="button"
                        onClick={convo.dismissError}
                        aria-label="Dismiss error"
                        className="shrink-0 text-rose-300/70 hover:text-rose-200"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  <div className="min-h-0 flex-1 px-3">
                    <MessageList
                      messages={convo.messages}
                      busy={convo.busy}
                      onRegenerate={convo.regenerateLast}
                      onEdit={startEdit}
                    />
                  </div>

                  <footer className="border-t border-arc-cyan/15 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitDraft()}
                        placeholder="Transmit message…  ( / )"
                        aria-label="Message composer"
                        disabled={convo.busy}
                        className="min-w-0 flex-1 border border-arc-cyan/25 bg-slate-950/60 px-3 py-2 font-mono text-sm text-cyan-100 outline-none placeholder:text-arc-cyan/30 focus:border-arc-cyan/60 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={submitDraft}
                        disabled={convo.busy || !draft.trim()}
                        aria-label="Send message"
                        className="flex items-center justify-center border border-arc-cyan/50 bg-arc-cyan/10 p-2.5 text-arc-cyan transition-colors hover:bg-arc-cyan/20 disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                    </div>
                  </footer>
                </section>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Reset FAB */}
      <button
        type="button"
        onClick={() => {
          convo.clear();
          voice.reset();
        }}
        title="Reset session"
        aria-label="Reset session"
        className="fixed bottom-5 right-5 z-20 flex h-10 w-10 items-center justify-center border border-arc-cyan/40 bg-slate-950/70 text-arc-cyan/70 backdrop-blur-md transition-colors hover:text-arc-cyan"
      >
        <RotateCcw size={16} />
      </button>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={shortcutList} />
    </div>
  );
}
