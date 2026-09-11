/**
 * SettingsPanel — grouped configuration: Model · Persona · Voice · Audio ·
 * Behaviour. Rows stagger in via Anime.js; the little arc gauges sweep to each
 * slider value. Every control is wired through `VoiceSettings`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import anime from 'animejs';
import { Gauge, Mic, RotateCcw, Volume2, Waves } from 'lucide-react';
import ModelSelector from './ModelSelector';
import { staggerIn, sweepGauge } from '../utils/animations';
import { getModels, type ProviderStatus } from '../lib/chatClient';
import { wakeWordSupported } from '../lib/wakeWord';
import { listBrowserVoices } from '../lib/voice';
import { PROVIDERS, type ProviderId } from '../types';

const wakeSupported = wakeWordSupported();

export interface VoiceSettings {
  provider: ProviderId;
  /** Per-provider model override; '' / missing = provider default. */
  models: Partial<Record<ProviderId, string>>;
  /** Custom system prompt; '' = server's built-in persona. */
  persona: string;
  /** Chosen SpeechSynthesisVoice.voiceURI; '' = auto. */
  voiceURI: string;
  /** 0..1 (sent to the API as-is; the proxy clamps to 0..2). */
  temperature: number;
  /** 0..1 → 0.5..1.5× playback rate. */
  speechRate: number;
  /** 0..1 → 0..2 linear mic gain (0.5 = unity). */
  inputGain: number;
  bargeIn: boolean;
  voiceOut: boolean;
  wakeWord: boolean;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  provider: 'groq',
  models: {},
  persona: '',
  voiceURI: '',
  temperature: 0.6,
  speechRate: 0.5,
  inputGain: 0.5,
  bargeIn: true,
  voiceOut: true,
  wakeWord: false,
};

export const toSpeechRate = (n: number): number => 0.5 + n; // 0.5..1.5
export const toInputGain = (n: number): number => Math.round(n * 40) / 20; // 0..2, 0.5→1.0

export interface SettingsPanelProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  onReset: () => void;
  micActive: boolean;
  ttsMode?: string;
  providerStatus?: Record<string, ProviderStatus>;
  /** The proxy's built-in persona, shown as the editor placeholder. */
  defaultPersona?: string;
}

function Section({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  /** Extra classes on the wrapper — e.g. a stacking-context escape for a section with a popover. */
  className?: string;
}) {
  return (
    <div className={`settings-row flex flex-col gap-2 opacity-0 ${className}`}>
      <span className="hud-label border-b border-arc-cyan/15 pb-1">{title}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-5 w-10 shrink-0 rounded-full border transition-colors ${
        on ? 'border-arc-cyan bg-arc-cyan/25' : 'border-arc-cyan/25 bg-slate-900'
      }`}
    >
      <span
        className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-arc-cyan shadow-hud transition-all"
        style={{ left: on ? 22 : 3 }}
      />
    </button>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  onReset,
  micActive,
  ttsMode,
  providerStatus,
  defaultPersona,
}: SettingsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tempArcRef = useRef<SVGCircleElement>(null);
  const rateArcRef = useRef<SVGCircleElement>(null);
  const gainArcRef = useRef<SVGCircleElement>(null);

  const [models, setModelList] = useState<Record<string, string[]>>({});
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    getModels(ac.signal).then(setModelList);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const load = () => setVoices(listBrowserVoices());
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);

  useEffect(() => {
    const rows = rootRef.current?.querySelectorAll('.settings-row');
    if (!rows || !rows.length) return;
    const inst = staggerIn(rows, { each: 45, translateY: 12 });
    return () => {
      inst.pause();
      anime.remove(rows);
    };
  }, []);

  useEffect(() => {
    const insts = [
      tempArcRef.current && sweepGauge(tempArcRef.current, settings.temperature, { duration: 600 }),
      rateArcRef.current && sweepGauge(rateArcRef.current, settings.speechRate, { duration: 600 }),
      gainArcRef.current && sweepGauge(gainArcRef.current, settings.inputGain, { duration: 600 }),
    ].filter(Boolean) as anime.AnimeInstance[];
    return () => insts.forEach((i) => i.pause());
  }, [settings.temperature, settings.speechRate, settings.inputGain]);

  const providerModels = models[settings.provider] ?? [];
  const currentModel =
    settings.models[settings.provider] ??
    PROVIDERS.find((p) => p.id === settings.provider)?.model ??
    '';
  const isDefaultModel = !settings.models[settings.provider];

  const personaDirty = settings.persona.trim().length > 0;

  const miniGauge = (ref: React.RefObject<SVGCircleElement>, Icon: typeof Gauge) => (
    <div className="relative h-10 w-10 shrink-0">
      <svg width={40} height={40} className="-rotate-90">
        <circle cx={20} cy={20} r={15} fill="none" stroke="rgba(0,240,255,0.12)" strokeWidth={3} />
        <circle
          ref={ref}
          cx={20}
          cy={20}
          r={15}
          fill="none"
          stroke="#00F0FF"
          strokeWidth={3}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 3px rgba(0,240,255,0.7))' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon size={12} className="text-arc-cyan/70" />
      </div>
    </div>
  );

  const slider = (
    label: string,
    key: 'temperature' | 'speechRate' | 'inputGain',
    ref: React.RefObject<SVGCircleElement>,
    Icon: typeof Gauge,
    fmt: (v: number) => string,
  ) => (
    <div className="flex items-center gap-3">
      {miniGauge(ref, Icon)}
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="hud-label">{label}</span>
          <span className="font-mono text-xs text-arc-cyan">{fmt(settings[key])}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings[key]}
          aria-label={label}
          onChange={(e) => onChange({ [key]: Number(e.target.value) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-arc-cyan/15 accent-arc-cyan"
        />
      </div>
    </div>
  );

  const inputCls =
    'w-full border border-arc-cyan/25 bg-slate-950/60 px-2.5 py-1.5 font-mono text-xs text-cyan-100 outline-none placeholder:text-arc-cyan/25 focus:border-arc-cyan/60';

  const voiceOptions = useMemo(
    () =>
      voices.map((v) => ({
        uri: v.voiceURI,
        label: `${v.name} · ${v.lang}${v.localService ? '' : ' · online'}`,
      })),
    [voices],
  );

  return (
    <div
      ref={rootRef}
      className="hud-scroll hud-panel flex h-full w-full flex-col gap-4 overflow-y-auto bg-slate-950/60 p-5"
    >
      <div className="flex items-center justify-between">
        <span className="font-hud text-sm font-semibold tracking-[0.22em] text-arc-cyan uppercase">
          Configuration
        </span>
        <span
          className={`flex items-center gap-1.5 font-mono text-[10px] ${
            micActive ? 'text-arc-cyan' : 'text-arc-cyan/35'
          }`}
        >
          <Mic size={12} />
          {micActive ? 'MIC LIVE' : 'MIC IDLE'}
        </span>
      </div>

      {/* ---- Model ---- */}
      {/* relative z-20: ModelSelector's dropdown must out-rank the sections
          below it. Each .settings-row is its own stacking context (a lingering
          post-animation `transform` on it triggers that), so z-index set only
          on ModelSelector's own root is trapped inside this section and can
          never beat a later sibling section — it has to be set here instead. */}
      <Section title="Model" className="relative z-20">
        <ModelSelector
          value={settings.provider}
          onChange={(provider) => onChange({ provider })}
          status={providerStatus}
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="hud-label">Model</span>
            {!isDefaultModel && (
              <button
                type="button"
                onClick={() =>
                  onChange({ models: { ...settings.models, [settings.provider]: '' } })
                }
                className="font-mono text-[9px] text-arc-cyan/50 hover:text-arc-cyan"
              >
                use default
              </button>
            )}
          </div>
          <input
            className={inputCls}
            list="model-list"
            value={currentModel}
            placeholder="provider default"
            aria-label="Model id"
            onChange={(e) =>
              onChange({ models: { ...settings.models, [settings.provider]: e.target.value } })
            }
          />
          <datalist id="model-list">
            {providerModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {providerModels.length > 0 && (
            <span className="font-mono text-[9px] text-arc-cyan/35">
              {providerModels.length} available
            </span>
          )}
        </div>
      </Section>

      {/* ---- Persona ---- */}
      <Section title="Persona">
        <textarea
          className={`${inputCls} min-h-[84px] resize-y leading-relaxed`}
          value={settings.persona}
          placeholder={defaultPersona || 'Describe how JARVIS should speak and behave…'}
          aria-label="System prompt / persona"
          maxLength={4000}
          onChange={(e) => onChange({ persona: e.target.value })}
        />
        <div className="flex items-center justify-between font-mono text-[9px] text-arc-cyan/40">
          <span>{personaDirty ? 'custom persona active' : 'using built-in persona'}</span>
          {personaDirty && (
            <button
              type="button"
              onClick={() => onChange({ persona: '' })}
              className="text-arc-cyan/50 hover:text-arc-cyan"
            >
              reset to default
            </button>
          )}
        </div>
      </Section>

      {/* ---- Voice ---- */}
      <Section title="Voice">
        <div className="flex items-center justify-between">
          <span className="hud-label">
            Speak replies{ttsMode ? <span className="ml-1 text-arc-cyan/35">· {ttsMode}</span> : null}
          </span>
          <Toggle on={settings.voiceOut} onClick={() => onChange({ voiceOut: !settings.voiceOut })} />
        </div>
        <div className="flex items-center gap-2">
          <Volume2 size={14} className="shrink-0 text-arc-cyan/70" />
          <select
            className={`${inputCls} cursor-pointer`}
            value={settings.voiceURI}
            aria-label="Speech synthesis voice"
            disabled={!settings.voiceOut}
            onChange={(e) => onChange({ voiceURI: e.target.value })}
          >
            <option value="">Auto ({voiceOptions[0]?.label.split(' · ')[0] ?? 'default'})</option>
            {voiceOptions.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        {voices.length === 0 && (
          <span className="font-mono text-[9px] text-arc-cyan/35">
            no browser voices detected
          </span>
        )}
      </Section>

      {/* ---- Audio ---- */}
      <Section title="Audio">
        {slider('Temperature', 'temperature', tempArcRef, Waves, (v) => v.toFixed(2))}
        {slider('Speech Rate', 'speechRate', rateArcRef, Gauge, (v) => `${toSpeechRate(v).toFixed(2)}×`)}
        {slider('Input Gain', 'inputGain', gainArcRef, Mic, (v) => `${toInputGain(v).toFixed(2)}×`)}
      </Section>

      {/* ---- Behaviour ---- */}
      <Section title="Behaviour">
        <div className="flex items-center justify-between">
          <span className="hud-label">
            Wake word “Jarvis”
            {!wakeSupported && <span className="ml-1 text-amber-300/50">· Chrome / Edge</span>}
          </span>
          <Toggle
            on={settings.wakeWord && wakeSupported}
            onClick={() => wakeSupported && onChange({ wakeWord: !settings.wakeWord })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="hud-label">Barge-in (interrupt TTS)</span>
          <Toggle on={settings.bargeIn} onClick={() => onChange({ bargeIn: !settings.bargeIn })} />
        </div>
      </Section>

      <button
        type="button"
        onClick={onReset}
        className="settings-row mt-1 flex items-center justify-center gap-2 border border-arc-cyan/25 px-3 py-2 font-hud text-[11px] tracking-[0.2em] text-arc-cyan/60 uppercase opacity-0 transition-colors hover:border-arc-cyan/50 hover:text-arc-cyan"
      >
        <RotateCcw size={12} /> Reset to defaults
      </button>
    </div>
  );
}
