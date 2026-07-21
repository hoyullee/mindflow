import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { EditorController } from '../useEditorState';
import { StyleMenu } from './StyleMenu';
import { ExportMenu } from './ExportMenu';
import { AnchoredMenu } from './AnchoredMenu';
import { EditMenu, InsertMenu, ViewMenu, MoreMenu } from './ToolbarMenus';
import { useIsMobile } from '../../../hooks/useMediaQuery';

interface ToolbarProps {
  controller: EditorController;
}

type MenuKey = 'edit' | 'insert' | 'view' | 'style' | 'export' | 'more';

/**
 * Top menu bar (GNB) — a port of `.mf-topbar` (MindFlow.dc.html:36-96)
 * reorganized from a flat row of ~10 buttons into grouped dropdown menus:
 * 편집(실행취소/다시실행) · 삽입(도형/메모/선/영역) · 보기(맵/아웃라인) · 스타일 ·
 * 내보내기. Fewer top-level controls keeps the bar compact (no horizontal scroll
 * on mobile). Only one menu opens at a time; an outside click or an item pick
 * closes it. Keyboard shortcuts (Ctrl+Z, etc.) still work via the global handler
 * in `useEditorState`, independent of these menus.
 */
export function Toolbar({ controller }: ToolbarProps) {
  const { theme: th } = controller;
  const isMobile = useIsMobile();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const editRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const refs: Record<MenuKey, RefObject<HTMLDivElement>> = { edit: editRef, insert: insertRef, view: viewRef, style: styleRef, export: exportRef, more: moreRef };

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent): void => {
      const wrap = refs[openMenu].current;
      if (wrap && !wrap.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  const close = (): void => setOpenMenu(null);
  const toggle = (k: MenuKey): void => setOpenMenu((cur) => (cur === k ? null : k));

  return (
    <div
      className="mf-ed-topbar"
      style={{
        height: 56,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px',
        background: th.panel,
        borderBottom: `1px solid ${th.border}`,
        zIndex: 20,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 8, flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: th.accentInk, fontWeight: 800, fontSize: 15 }}>
          G
        </div>
        {/* Wordmark hidden on mobile to leave room for the menu items */}
        {!isMobile && <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.01em' }}>Geurio</div>}
      </div>

      <Divider theme={th} />

      <MenuBarButton label="편집" wrapRef={editRef} open={openMenu === 'edit'} onToggle={() => toggle('edit')} th={th} isMobile={isMobile} width={230} align="left">
        <EditMenu controller={controller} onDone={close} isMobile={isMobile} />
      </MenuBarButton>
      <MenuBarButton label="삽입" wrapRef={insertRef} open={openMenu === 'insert'} onToggle={() => toggle('insert')} th={th} isMobile={isMobile} width={200} align="left">
        <InsertMenu controller={controller} onDone={close} isMobile={isMobile} />
      </MenuBarButton>
      {/* 보기 is a top-level trigger on desktop; on mobile it folds into the ☰ menu
          on the right (with 내보내기) so the narrow bar doesn't scroll. */}
      {!isMobile && (
        <MenuBarButton label="보기" wrapRef={viewRef} open={openMenu === 'view'} onToggle={() => toggle('view')} th={th} isMobile={isMobile} width={190} align="left">
          <ViewMenu controller={controller} onDone={close} isMobile={isMobile} />
        </MenuBarButton>
      )}
      <MenuBarButton
        label="스타일"
        wrapRef={styleRef}
        open={openMenu === 'style'}
        onToggle={() => toggle('style')}
        th={th}
        isMobile={isMobile}
        width={250}
        align="left"
        leading={
          <span
            aria-hidden="true"
            style={{
              width: 14,
              height: 14,
              borderRadius: 5,
              background: 'conic-gradient(from 210deg,#f0663f,#e0b23c,#3fae9e,#3f8fd0,#8a6bd1,#f0663f)',
              boxShadow: `inset 0 0 0 1.5px ${th.panel}`,
              flexShrink: 0,
            }}
          />
        }
      >
        <StyleMenu controller={controller} />
      </MenuBarButton>

      <div style={{ flex: '1 1 auto' }} />

      {isMobile ? (
        /* Mobile: one ☰ button on the right holds 보기 + 내보내기 (see `MoreMenu`),
           so the bar fits without a horizontal scroll. */
        <MenuBarButton label="" ariaLabel="더보기" wrapRef={moreRef} open={openMenu === 'more'} onToggle={() => toggle('more')} th={th} isMobile={isMobile} width={210} align="right" leading={<HamburgerIcon />} noCaret>
          <MoreMenu controller={controller} onDone={close} isMobile={isMobile} />
        </MenuBarButton>
      ) : (
        <MenuBarButton label="내보내기" wrapRef={exportRef} open={openMenu === 'export'} onToggle={() => toggle('export')} th={th} isMobile={isMobile} width={200} align="right" leading={<ExportGlyph />}>
          <ExportMenu controller={controller} onDone={close} />
        </MenuBarButton>
      )}
    </div>
  );
}

/** One top-level menu-bar entry: a text trigger (optional leading glyph) + a
 * ▾ caret, with its dropdown portaled via `AnchoredMenu` when open. */
function MenuBarButton({
  label,
  ariaLabel,
  leading,
  wrapRef,
  open,
  onToggle,
  th,
  isMobile,
  width,
  align,
  noCaret,
  children,
}: {
  label: string;
  ariaLabel?: string;
  leading?: ReactNode;
  wrapRef: RefObject<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  th: EditorController['theme'];
  isMobile: boolean;
  width: number;
  align: 'left' | 'right';
  noCaret?: boolean;
  children: ReactNode;
}) {
  const triggerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: isMobile ? 44 : 34,
    padding: label ? '0 11px' : '0 9px',
    border: `1px solid ${open ? th.accent : 'transparent'}`,
    borderRadius: 9,
    background: open ? th.panel2 : 'transparent',
    color: th.text,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" className="mf-ed-btn" onClick={onToggle} aria-expanded={open} aria-haspopup="menu" aria-label={ariaLabel} style={triggerStyle}>
        {leading}
        {label}
        {!noCaret && <Caret open={open} color={th.subtext} />}
      </button>
      {open && (
        <AnchoredMenu anchorRef={wrapRef} width={width} align={align}>
          {children}
        </AnchoredMenu>
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1={3} y1={6} x2={21} y2={6} />
      <line x1={3} y1={12} x2={21} y2={12} />
      <line x1={3} y1={18} x2={21} y2={18} />
    </svg>
  );
}

function Caret({ open, color }: { open: boolean; color: string }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease', flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ExportGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1={12} y1={15} x2={12} y2={3} />
    </svg>
  );
}

function Divider({ theme: th }: { theme: EditorController['theme'] }) {
  return <div style={{ width: 1, height: 24, background: th.border, flexShrink: 0 }} />;
}
