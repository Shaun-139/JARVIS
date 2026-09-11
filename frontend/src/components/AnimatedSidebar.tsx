/**
 * AnimatedSidebar — collapsible glassmorphism rail. React owns `collapsed`;
 * Anime.js tweens the width and staggers the labels / nav items on expand.
 */

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import {
  History,
  LayoutDashboard,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { animateSidebar, revealSidebarItems } from '../utils/animations';

const EXPANDED = 232;
const COLLAPSED = 64;

export type SidebarView = 'session' | 'history' | 'telemetry' | 'settings';

export interface AnimatedSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
}

const ITEMS: { id: SidebarView; label: string; Icon: typeof Mic }[] = [
  { id: 'session', label: 'Live Session', Icon: Mic },
  { id: 'history', label: 'Transcript', Icon: History },
  { id: 'telemetry', label: 'Telemetry', Icon: LayoutDashboard },
  { id: 'settings', label: 'Settings', Icon: Settings2 },
];

export default function AnimatedSidebar({
  collapsed,
  onToggle,
  active,
  onSelect,
}: AnimatedSidebarProps) {
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;

    const widthInst = animateSidebar(aside, collapsed, {
      expandedWidth: EXPANDED,
      collapsedWidth: COLLAPSED,
    });

    // Every text label in the rail — brand lines, nav items and the toggle's
    // own caption — so nothing but the icons survives a collapse.
    const labels = aside.querySelectorAll('.sb-label');
    let labelInst: anime.AnimeInstance | null = null;
    if (labels && labels.length) {
      if (collapsed) {
        labelInst = anime({
          targets: labels,
          opacity: 0,
          translateX: -10,
          duration: 140,
          easing: 'easeInQuad',
        });
      } else {
        labelInst = revealSidebarItems(labels);
      }
    }

    return () => {
      // Snap to the intended end state rather than freezing mid-tween — keeps
      // React StrictMode's throwaway first pass from leaving the rail stuck.
      widthInst.pause();
      labelInst?.pause();
      anime.remove(aside);
      anime.set(aside, { width: collapsed ? COLLAPSED : EXPANDED });
      if (labels) {
        anime.remove(labels);
        anime.set(labels, { opacity: collapsed ? 0 : 1, translateX: 0 });
      }
    };
  }, [collapsed]);

  return (
    <aside
      ref={asideRef}
      className="hud-panel z-20 flex h-full flex-col gap-2 overflow-hidden p-3"
      style={{ width: COLLAPSED }}
    >
      <div className="flex items-center gap-2 px-1 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-arc-cyan/40 bg-arc-cyan/10 shadow-hud">
          <Sparkles size={18} className="text-arc-cyan drop-shadow-glow" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="sb-label font-hud text-base font-bold tracking-[0.18em] text-arc-cyan">
            J.A.R.V.I.<span className="text-cyan-100">S.</span>
          </span>
          <span className="sb-label font-mono text-[9px] text-arc-cyan/45">mk I · arc-core</span>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1">
        {ITEMS.map(({ id, label, Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              title={label}
              className={`group flex items-center gap-3 px-2.5 py-2.5 transition-colors ${
                isActive
                  ? 'border-l-2 border-arc-cyan bg-arc-cyan/10 text-arc-cyan'
                  : 'border-l-2 border-transparent text-cyan-100/60 hover:bg-arc-cyan/5 hover:text-arc-cyan'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span className="sb-label truncate font-hud text-sm tracking-wide">{label}</span>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className="mt-auto flex items-center gap-3 px-2.5 py-2 text-cyan-100/60 transition-colors hover:text-arc-cyan"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? (
          <PanelLeftOpen size={18} className="shrink-0" />
        ) : (
          <PanelLeftClose size={18} className="shrink-0" />
        )}
        <span className="sb-label font-hud text-xs tracking-[0.2em] uppercase">Collapse</span>
      </button>
    </aside>
  );
}
