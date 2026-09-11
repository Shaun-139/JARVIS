/**
 * ChatMessage — a single bubble in the chat overlay. Mount entry is played by
 * Anime.js (`enterMessage`). On hover it reveals row actions: copy (any), plus
 * regenerate (last assistant) or edit (user).
 */

import { useEffect, useRef, useState } from 'react';
import anime from 'animejs';
import { Check, Copy, Pencil, RefreshCw } from 'lucide-react';
import { enterMessage } from '../utils/animations';
import type { ChatMessageModel } from '../types';

export interface ChatMessageProps {
  message: ChatMessageModel;
  /** Position within the most recent append batch — drives the stagger delay. */
  index?: number;
  /** False for bubbles rehydrated from storage — they render without an entry. */
  animate?: boolean;
  /** Regenerate this reply (passed only for the last assistant message). */
  onRegenerate?: () => void;
  /** Pull this user message back into the composer for editing. */
  onEdit?: (id: string) => void;
}

export default function ChatMessage({
  message,
  index = 0,
  animate = true,
  onRegenerate,
  onEdit,
}: ChatMessageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  useEffect(() => {
    if (!animate) return;
    const el = ref.current;
    if (!el) return;
    const inst = enterMessage(el, { role: message.role, index });
    return () => {
      inst.pause();
      anime.remove(el);
    };
  }, [message.id, message.role, index, animate]);

  useEffect(() => {
    const caret = caretRef.current;
    if (!caret || !message.streaming) return;
    const inst = anime({
      targets: caret,
      opacity: [1, 0.15],
      duration: 620,
      direction: 'alternate',
      loop: true,
      easing: 'steps(2)',
    });
    return () => {
      inst.pause();
      anime.remove(caret);
    };
  }, [message.streaming]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  const actionBtn =
    'flex items-center gap-1 rounded-sm border border-arc-cyan/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-arc-cyan/60 transition-colors hover:border-arc-cyan/50 hover:text-arc-cyan';

  return (
    <div
      ref={ref}
      className={`group flex w-full flex-col ${animate ? 'opacity-0' : ''} ${
        isUser ? 'items-end' : 'items-start'
      }`}
    >
      <div
        className={`max-w-[78%] px-4 py-2.5 text-sm leading-relaxed backdrop-blur-md ${
          isUser
            ? 'border border-arc-cyan/40 bg-cyan-950/30 text-cyan-50 shadow-hud'
            : 'border border-arc-blue/30 bg-slate-950/50 text-cyan-100/90'
        }`}
        style={{
          clipPath:
            'polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        }}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="hud-label" style={{ color: isUser ? '#00F0FF' : '#7af5ff' }}>
            {isUser ? 'Operator' : 'JARVIS'}
          </span>
          <span className="font-mono text-[9px] text-arc-cyan/35">
            {new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="whitespace-pre-wrap">
          {message.content}
          {message.streaming && (
            <span
              ref={caretRef}
              className="ml-0.5 inline-block h-3.5 w-1.5 bg-arc-cyan align-middle"
            />
          )}
        </p>
      </div>

      {!message.streaming && (
        <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" className={actionBtn} onClick={copy} aria-label="Copy message">
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'copied' : 'copy'}
          </button>
          {onRegenerate && (
            <button
              type="button"
              className={actionBtn}
              onClick={onRegenerate}
              aria-label="Regenerate reply"
            >
              <RefreshCw size={11} /> retry
            </button>
          )}
          {isUser && onEdit && (
            <button
              type="button"
              className={actionBtn}
              onClick={() => onEdit(message.id)}
              aria-label="Edit and resend message"
            >
              <Pencil size={11} /> edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
