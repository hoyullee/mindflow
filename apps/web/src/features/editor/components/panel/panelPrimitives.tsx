import type { CSSProperties, ReactNode } from 'react';
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

export function panelWrapStyle(th: Theme): CSSProperties {
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

export function panelBodyStyle(): CSSProperties {
  return { overflowY: 'auto', padding: 14, minHeight: 0 };
}

export function SectionLabel({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: theme.subtext, marginBottom: 8 }}>{children}</div>;
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
