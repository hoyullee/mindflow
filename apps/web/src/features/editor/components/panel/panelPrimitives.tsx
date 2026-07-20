import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { hexA } from '../../theme';
import type { Theme } from '../../theme';

/** Emoji picker options — port of `Component.EMOJIS` (MindFlow.dc.html:475). */
export const EMOJIS = ['🎯', '💪', '🚀', '📚', '💰', '❤️', '🎨', '✨', '🔥', '🌱', '🧠', '⭐', '📈', '🏆', '🧘', '☕', '✈️', '🎸', '📷', '🍎'];

/** Node shape options — port of the `SHAPES` list in `Component#renderVals` (MindFlow.dc.html:2944-2953). */
export const SHAPES: { k: string; label: string }[] = [
  { k: 'round', label: '둥근 사각형' },
  { k: 'rect', label: '사각형' },
  { k: 'pill', label: '캡슐' },
  { k: 'ellipse', label: '타원' },
  { k: 'underline', label: '밑줄' },
  { k: 'hexagon', label: '육각형' },
  { k: 'diamond', label: '마름모' },
  { k: 'parallelogram', label: '평행사변형' },
];

export const SIZE_OPTIONS: { k: 's' | 'm' | 'l'; label: string }[] = [
  { k: 's', label: '작게' },
  { k: 'm', label: '보통' },
  { k: 'l', label: '크게' },
];

/**
 * M6: on mobile there's no room for a floating 236px-wide side panel over the
 * canvas, so the property panel becomes a bottom sheet instead — anchored to
 * the viewport bottom, full width, at a FIXED 55% of the viewport height (the
 * canvas above stays reachable for pan/zoom/tap-to-deselect). A fixed (not
 * max-) height keeps the sheet from resizing as accordion sections expand or
 * collapse — sections just scroll within it, so the box never jumps.
 */
export function panelWrapStyle(th: Theme, isMobile = false): CSSProperties {
  if (isMobile) {
    return {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '55dvh',
      border: `1px solid ${th.border}`,
      borderBottom: 'none',
      borderRadius: '16px 16px 0 0',
      boxShadow: '0 -8px 30px rgba(0,0,0,.14)',
      zIndex: 25,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: th.panel,
    };
  }
  return {
    position: 'absolute',
    left: 16,
    top: 80,
    width: 236,
    maxHeight: 'calc(100% - 158px)',
    border: `1px solid ${th.border}`,
    borderRadius: 14,
    boxShadow: '0 8px 30px rgba(0,0,0,.10)',
    zIndex: 15,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: th.panel,
  };
}

export function panelBodyStyle(isMobile = false): CSSProperties {
  return {
    overflowY: 'auto',
    padding: isMobile ? '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))' : 14,
    minHeight: 0,
    // On mobile the wrapper is a fixed-height flex column; let the body fill it
    // and scroll, so expanding a section changes the scroll content, not the
    // sheet's outer size.
    ...(isMobile ? { flex: '1 1 auto' } : null),
  };
}

/**
 * Small line icons for the mobile drill-down tiles (`MobilePanelSheet`). Each is
 * a 20×20 `currentColor` stroke glyph so it inherits the tile's accent color.
 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
export const TileIcon = {
  shape: (
    <Svg>
      <rect x={3} y={3} width={8} height={8} rx={1.5} />
      <circle cx={17} cy={7} r={4} />
      <path d="M7 15l4 6H3z" />
    </Svg>
  ),
  palette: (
    <Svg>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7.3-9-7.3z" />
      <circle cx={7.5} cy={10.5} r={1} fill="currentColor" />
      <circle cx={12} cy={7.5} r={1} fill="currentColor" />
      <circle cx={16.5} cy={10.5} r={1} fill="currentColor" />
    </Svg>
  ),
  text: (
    <Svg>
      <path d="M5 6V5h14v1" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </Svg>
  ),
  emoji: (
    <Svg>
      <polygon points="12 3 14.6 8.6 20.7 9.3 16.1 13.4 17.4 19.4 12 16.3 6.6 19.4 7.9 13.4 3.3 9.3 9.4 8.6" />
    </Svg>
  ),
  note: (
    <Svg>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
    </Svg>
  ),
  edit: (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </Svg>
  ),
  line: (
    <Svg>
      <line x1={4} y1={20} x2={20} y2={4} />
      <circle cx={5} cy={19} r={1.6} fill="currentColor" />
      <circle cx={19} cy={5} r={1.6} fill="currentColor" />
    </Svg>
  ),
  curve: (
    <Svg>
      <path d="M4 20C4 9 20 15 20 4" />
    </Svg>
  ),
} as const;

export function SectionLabel({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: theme.subtext, marginBottom: 8 }}>{children}</div>;
}

/**
 * Collapsible property-panel section — port of the dc original's `panelSec`
 * accordion (MindFlow.dc.html:150-234 etc.): a clickable header row with a
 * ▸/▾ chevron and a max-height-animated body. Callers drive `open` from a
 * single "which section is open" state so only one is expanded at a time, and
 * remount the panel (via a React `key`) on selection change to reset to all
 * collapsed — matching the original's one-open accordion + reset behavior.
 */
export function PanelSection({ theme, title, open, onToggle, children }: { theme: Theme; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);
  // Keep the expanded height in sync with the (always-rendered) body content so
  // the open transition animates to the right height even as content changes.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setMaxH((h) => (h === el.scrollHeight ? h : el.scrollHeight));
  });
  return (
    <>
      <div
        className="mf-ed-btn"
        role="button"
        aria-expanded={open}
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', margin: '0 -6px 8px', padding: '5px 6px', borderRadius: 8 }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: theme.subtext }}>{title}</span>
        <span style={{ fontSize: 15, color: theme.subtext }}>{open ? '▾' : '▸'}</span>
      </div>
      <div
        ref={bodyRef}
        style={{ overflow: 'hidden', opacity: open ? 1 : 0, maxHeight: open ? maxH : 0, transition: 'max-height .3s cubic-bezier(.4,0,.2,1), opacity .24s ease' }}
      >
        <div style={{ paddingTop: 2 }}>{children}</div>
      </div>
    </>
  );
}

export function PanelTitle({ theme, kicker, name }: { theme: Theme; kicker: string; name: string }) {
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: theme.subtext, marginBottom: 4 }}>{kicker}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
    </>
  );
}

export function Divider({ theme }: { theme: Theme }) {
  return <div style={{ height: 0, borderTop: `1px solid ${theme.border}`, margin: '0 0 7px' }} />;
}

export function ColorSwatch({ hex, active, theme, onClick, title }: { hex: string; active: boolean; theme: Theme; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: hex,
        border: active ? `2px solid ${theme.text}` : `2px solid ${theme.panel}`,
        boxShadow: active ? `0 0 0 2px ${hex}` : `0 0 0 1px ${theme.border}`,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}

export function ResetChip({ active, theme, onClick, children = '자동' }: { active: boolean; theme: Theme; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      title="기본"
      onClick={onClick}
      style={{
        height: 24,
        padding: '0 8px',
        borderRadius: 12,
        border: `1px solid ${active ? theme.accent : theme.border}`,
        background: active ? hexA(theme.accent, 0.12) : theme.panel,
        color: active ? theme.accent : theme.subtext,
        fontSize: 10.5,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export function SwatchRow({ theme, palette, current, onPick, onReset }: { theme: Theme; palette: string[]; current: string | null | undefined; onPick: (hex: string) => void; onReset?: () => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: onReset ? 9 : 16 }}>
      {onReset && <ResetChip active={!current} theme={theme} onClick={onReset} />}
      {palette.map((hex) => (
        <ColorSwatch key={hex} hex={hex} active={current === hex} theme={theme} onClick={() => onPick(hex)} />
      ))}
    </div>
  );
}

export function AlphaSlider({ theme, value, onChange }: { theme: Theme; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 11, color: theme.subtext, whiteSpace: 'nowrap' }}>투명도</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ flex: 1, accentColor: theme.accent }}
      />
      <span style={{ fontSize: 11, color: theme.subtext, width: 30, textAlign: 'right' }}>{pct}</span>
    </div>
  );
}

export function SegButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: Theme; onClick: () => void }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      onClick={onClick}
      style={{
        height: 26,
        minWidth: 30,
        padding: '0 9px',
        borderRadius: 7,
        border: `1px solid ${active ? theme.accent : theme.border}`,
        background: active ? hexA(theme.accent, 0.12) : theme.panel,
        color: active ? theme.accent : theme.text,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

export function BoldSizeRow({
  theme,
  bold,
  size,
  onToggleBold,
  onSetSize,
}: {
  theme: Theme;
  bold: boolean;
  size: 's' | 'l' | undefined;
  onToggleBold: () => void;
  onSetSize: (v: 's' | 'm' | 'l') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
      <SegButton label="B" active={bold} theme={theme} onClick={onToggleBold} />
      <div style={{ width: 1, height: 20, background: theme.border }} />
      {SIZE_OPTIONS.map((o) => (
        <SegButton key={o.k} label={o.label} active={(size || 'm') === o.k} theme={theme} onClick={() => onSetSize(o.k)} />
      ))}
    </div>
  );
}

export function RenameButton({ theme, onClick, label = '이름 편집' }: { theme: Theme; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      onClick={onClick}
      style={{
        width: '100%',
        height: 32,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: theme.panel,
        color: theme.text,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

export function DeleteButton({ theme, onClick, label = '삭제' }: { theme: Theme; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      onClick={onClick}
      style={{
        width: '100%',
        height: 32,
        marginTop: 8,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: theme.panel,
        color: '#d64545',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
