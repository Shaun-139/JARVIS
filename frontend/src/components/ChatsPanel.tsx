/**
 * ChatsPanel — the sidebar's "Chats" view: past conversations, ChatGPT /
 * Claude / Gemini-style. Selecting one loads it into Live Session; "New"
 * starts a fresh one. Rows stagger in via Anime.js on mount.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { staggerIn } from '../utils/animations';
import type { ChatSummary } from '../types';

export interface ChatsPanelProps {
  chats: ChatSummary[];
  activeChatId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsPanel({
  chats,
  activeChatId,
  onSelect,
  onNew,
  onDelete,
}: ChatsPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    const rows = listRef.current?.querySelectorAll('.chat-row');
    if (!rows || !rows.length) return;
    const inst = staggerIn(rows, { each: 24, translateY: 8 });
    return () => {
      inst.pause();
      anime.remove(rows);
    };
    // Re-stagger only when the row *count* changes, not on every timestamp tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length]);

  return (
    <section className="hud-panel flex h-full flex-col overflow-hidden bg-slate-950/60">
      <header className="flex items-center justify-between gap-2 border-b border-arc-cyan/15 px-4 py-2.5">
        <div className="flex flex-col leading-none">
          <span className="font-hud text-sm font-semibold tracking-[0.22em] text-arc-cyan uppercase">
            Chats
          </span>
          <span className="mt-1 font-mono text-[10px] text-arc-cyan/45">
            {chats.length} saved
          </span>
        </div>
        <button
          type="button"
          onClick={onNew}
          title="New chat"
          className="flex items-center gap-1 border border-arc-cyan/25 px-2 py-1 font-mono text-[10px] text-arc-cyan/70 transition-colors hover:border-arc-cyan/50 hover:text-arc-cyan"
        >
          <MessageSquarePlus size={12} /> new
        </button>
      </header>

      <div ref={listRef} className="hud-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {sorted.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-arc-cyan/40">
            <span className="font-hud tracking-[0.3em] uppercase">No chats yet</span>
            <span className="font-mono text-xs">Start one in Live Session</span>
          </div>
        )}
        {sorted.map((c) => {
          const active = c.id === activeChatId;
          return (
            <div
              key={c.id}
              className={`chat-row flex items-center gap-1 border-l-2 pl-3 pr-1 opacity-0 transition-colors ${
                active
                  ? 'border-arc-cyan bg-arc-cyan/10'
                  : 'border-transparent hover:border-arc-cyan/30 hover:bg-arc-cyan/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className="min-w-0 flex-1 py-2.5 text-left"
              >
                <span
                  className={`block truncate font-hud text-sm ${
                    active ? 'text-arc-cyan' : 'text-cyan-100/80'
                  }`}
                >
                  {c.title}
                </span>
                <span className="font-mono text-[10px] text-arc-cyan/40">
                  {relativeTime(c.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label={`Delete "${c.title}"`}
                className="shrink-0 p-2 text-arc-cyan/30 transition-colors hover:text-rose-300"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
