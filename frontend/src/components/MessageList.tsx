/**
 * MessageList — scrolling chat overlay. Tracks how many messages existed on the
 * previous render so only the freshly appended batch gets a stagger index;
 * older bubbles never re-animate. Messages restored from localStorage on first
 * mount render instantly (no entry animation). Auto-scrolls to the newest entry.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import type { ChatMessageModel } from '../types';

export interface MessageListProps {
  messages: ChatMessageModel[];
  /** Regenerate the last assistant reply. */
  onRegenerate?: () => void;
  /** Pull a user message back into the composer. */
  onEdit?: (id: string) => void;
  /** True while a turn is in flight — hides the actions. */
  busy?: boolean;
}

export default function MessageList({ messages, onRegenerate, onEdit, busy }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whatever was already there on first render was rehydrated from storage —
  // don't animate those in.
  const hydratedCountRef = useRef(messages.length);
  const prevCountRef = useRef(messages.length);
  const batchStartRef = useRef(messages.length);

  // Freeze the index at which the current append batch begins.
  if (messages.length !== prevCountRef.current) {
    batchStartRef.current = prevCountRef.current;
    prevCountRef.current = messages.length;
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Smoothly follow streaming content growth.
    const id = window.setInterval(() => {
      el.scrollTop = el.scrollHeight;
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={scrollRef}
      className="hud-scroll flex h-full flex-col gap-3 overflow-y-auto px-1 py-2"
    >
      {messages.length === 0 && (
        <div className="m-auto flex flex-col items-center gap-2 text-center text-arc-cyan/40">
          <span className="font-hud tracking-[0.3em] uppercase">Channel open</span>
          <span className="font-mono text-xs">Say &ldquo;Jarvis&rdquo; or type below</span>
        </div>
      )}
      {messages.map((m, i) => {
        const isLastAssistant = i === messages.length - 1 && m.role === 'assistant';
        return (
          <ChatMessage
            key={m.id}
            message={m}
            index={Math.max(0, i - batchStartRef.current)}
            animate={i >= hydratedCountRef.current}
            onRegenerate={!busy && isLastAssistant ? onRegenerate : undefined}
            onEdit={!busy ? onEdit : undefined}
          />
        );
      })}
    </div>
  );
}
