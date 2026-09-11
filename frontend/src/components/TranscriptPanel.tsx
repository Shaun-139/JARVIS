/**
 * TranscriptPanel — the sidebar's "Transcript" view: the full conversation,
 * read-only, with copy / download. Rows stagger in via Anime.js on mount.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import anime from 'animejs';
import { Check, Copy, Download, Trash2 } from 'lucide-react';
import { staggerIn } from '../utils/animations';
import type { ChatMessageModel } from '../types';

export interface TranscriptPanelProps {
  messages: ChatMessageModel[];
  turns: number;
  onClear: () => void;
}

function toMarkdown(messages: ChatMessageModel[]): string {
  const head = `# J.A.R.V.I.S. transcript\n\n_${new Date().toLocaleString()}_\n`;
  const body = messages
    .map((m) => {
      const who = m.role === 'user' ? 'Operator' : 'JARVIS';
      const t = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `**${who}** · ${t}\n\n${m.content}\n`;
    })
    .join('\n');
  return `${head}\n${body}`;
}

export default function TranscriptPanel({ messages, turns, onClear }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const chars = useMemo(
    () => messages.reduce((n, m) => n + m.content.length, 0),
    [messages],
  );

  useEffect(() => {
    const rows = scrollRef.current?.querySelectorAll('.tx-row');
    if (!rows || !rows.length) return;
    const inst = staggerIn(rows, { each: 28, translateY: 10 });
    return () => {
      inst.pause();
      anime.remove(rows);
    };
  }, [messages.length === 0]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(messages));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const download = () => {
    const blob = new Blob([toMarkdown(messages)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const empty = messages.length === 0;

  return (
    <section className="hud-panel flex h-full flex-col overflow-hidden bg-slate-950/60">
      <header className="flex items-center justify-between gap-2 border-b border-arc-cyan/15 px-4 py-2.5">
        <div className="flex flex-col leading-none">
          <span className="font-hud text-sm font-semibold tracking-[0.22em] text-arc-cyan uppercase">
            Transcript
          </span>
          <span className="mt-1 font-mono text-[10px] text-arc-cyan/45">
            {turns} turn{turns === 1 ? '' : 's'} · {messages.length} msg · {chars.toLocaleString()} chars
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyAll}
            disabled={empty}
            title="Copy as Markdown"
            className="flex items-center gap-1 border border-arc-cyan/25 px-2 py-1 font-mono text-[10px] text-arc-cyan/70 transition-colors hover:border-arc-cyan/50 hover:text-arc-cyan disabled:opacity-30"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'copied' : 'copy'}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={empty}
            title="Download .md"
            className="flex items-center gap-1 border border-arc-cyan/25 px-2 py-1 font-mono text-[10px] text-arc-cyan/70 transition-colors hover:border-arc-cyan/50 hover:text-arc-cyan disabled:opacity-30"
          >
            <Download size={12} /> md
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={empty}
            title="Clear conversation"
            className="flex items-center gap-1 border border-rose-400/30 px-2 py-1 font-mono text-[10px] text-rose-300/70 transition-colors hover:border-rose-400/60 hover:text-rose-200 disabled:opacity-30"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="hud-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {empty && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-arc-cyan/40">
            <span className="font-hud tracking-[0.3em] uppercase">No transcript yet</span>
            <span className="font-mono text-xs">Start a conversation in Live Session</span>
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className="tx-row opacity-0">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="font-hud text-[10px] uppercase tracking-[0.24em]"
                  style={{ color: isUser ? '#00F0FF' : '#7af5ff' }}
                >
                  {isUser ? 'Operator' : 'JARVIS'}
                </span>
                <span className="font-mono text-[9px] text-arc-cyan/35">
                  {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p
                className={`whitespace-pre-wrap border-l-2 pl-3 text-sm leading-relaxed ${
                  isUser
                    ? 'border-arc-cyan/40 text-cyan-50'
                    : 'border-arc-blue/40 text-cyan-100/85'
                }`}
              >
                {m.content || <span className="text-arc-cyan/30">…</span>}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
