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

/**
 * Small preview of a node shape, drawn as an SVG outline so the shape picker
 * shows what each option looks like instead of a cryptic first-letter ("R", "P",
 * …). Uses `currentColor`, so it inherits the button's active/inactive color.
 */
export function ShapeGlyph({ kind }: { kind: string }) {
  const common = {
    width: 22,
    height: 15,
    viewBox: '0 0 24 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
    style: { display: 'block' as const },
  };
  switch (kind) {
    case 'rect':
      return <svg {...common}><rect x={3.5} y={3} width={17} height={10} rx={0.5} /></svg>;
    case 'pill':
      return <svg {...common}><rect x={3} y={3} width={18} height={10} rx={5} /></svg>;
    case 'ellipse':
      return <svg {...common}><ellipse cx={12} cy={8} rx={9} ry={5} /></svg>;
    case 'underline':
      return (
        <svg {...common}>
          <line x1={6} y1={5.5} x2={18} y2={5.5} />
          <line x1={4} y1={12} x2={20} y2={12} strokeWidth={2} />
        </svg>
      );
    case 'hexagon':
      return <svg {...common}><polygon points="7 3 17 3 21 8 17 13 7 13 3 8" /></svg>;
    case 'diamond':
      return <svg {...common}><polygon points="12 2 21 8 12 14 3 8" /></svg>;
    case 'parallelogram':
      return <svg {...common}><polygon points="7 3 21 3 17 13 3 13" /></svg>;
    case 'round':
    default:
      return <svg {...common}><rect x={3} y={3} width={18} height={10} rx={3} /></svg>;
  }
}

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
/**
 * @param lowered 독칩(DocChip)이 평소보다 높아진 상태 — 저장 충돌 안내 줄이 붙으면
 * 칩 바닥이 기본 패널 top(80)을 넘어 그림자가 패널을 침범한다(제보). 그동안만
 * 패널을 그만큼 내려 두 상자 사이 간격(10px)을 유지한다.
 */
export function panelWrapStyle(th: Theme, isMobile = false, lowered = false): CSSProperties {
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
  const top = lowered ? 98 : 80;
  return {
    position: 'absolute',
    left: 16,
    top,
    width: 236,
    maxHeight: `calc(100% - ${top + 78}px)`,
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

export function ColorSwatch({ hex, active, theme, onClick, title, size = 22 }: { hex: string; active: boolean; theme: Theme; onClick: () => void; title?: string; size?: number }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: hex,
        border: active ? `2px solid ${theme.text}` : `2px solid ${theme.panel}`,
        boxShadow: active ? `0 0 0 2px ${hex}` : `0 0 0 1px ${theme.border}`,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
      }}
    />
  );
}

/** "자동(테마 기본)" 리셋 — 색상 스와치와 **같은 원형/크기**로 그린다(대각선 =
 * '색 없음' 관례). 예전엔 알약형 '자동' 칩이라 원형 스와치 행에 홀로 섞여
 * 줄 정렬이 들쭉날쭉해 보이는 원인 중 하나였다(제보: 배치가 중구난방). */
export function ResetChip({ active, theme, onClick, size = 22 }: { active: boolean; theme: Theme; onClick: () => void; size?: number }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      title="자동 (테마 기본)"
      aria-label="자동 (테마 기본)"
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: theme.panel,
        border: active ? `2px solid ${theme.text}` : `2px solid ${theme.panel}`,
        boxShadow: active ? `0 0 0 2px ${theme.subtext}` : `0 0 0 1px ${theme.border}`,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size - 8} height={size - 8} viewBox="0 0 14 14" aria-hidden style={{ display: 'block' }}>
        <line x1={2.5} y1={11.5} x2={11.5} y2={2.5} stroke="#d64545" strokeWidth={1.8} strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * 색상 선택 행 — flex-wrap 대신 **정방 그리드**로 그린다. 예전엔 스와치가
 * 6+6+1처럼 들쭉날쭉 감겨 "정렬이 이상하다"는 제보의 주 원인이었다.
 * 열 수는 개수에 맞춰 직사각형이 되게: ≤9개는 한 줄, 그 외 7열(이 앱의
 * 팔레트 조합 — 리셋+13색 = 14 = 7×2 — 가 정확히 떨어진다).
 */
export function SwatchRow({ theme, palette, current, onPick, onReset }: { theme: Theme; palette: string[]; current: string | null | undefined; onPick: (hex: string) => void; onReset?: () => void }) {
  const total = palette.length + (onReset ? 1 : 0);
  const cols = total <= 9 ? total : 7;
  const size = cols > 8 ? 20 : 22;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, rowGap: 9, justifyItems: 'center', marginBottom: onReset ? 10 : 16 }}>
      {onReset && <ResetChip active={!current} theme={theme} onClick={onReset} size={size} />}
      {palette.map((hex) => (
        <ColorSwatch key={hex} hex={hex} active={current === hex} theme={theme} onClick={() => onPick(hex)} size={size} />
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

export function SegButton({ label, active, theme, onClick, title }: { label: ReactNode; active: boolean; theme: Theme; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      className="mf-ed-btn"
      onClick={onClick}
      title={title}
      aria-pressed={active}
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
  italic,
  strike,
  onToggleItalic,
  onToggleStrike,
}: {
  theme: Theme;
  bold: boolean;
  size: 's' | 'l' | undefined;
  onToggleBold: () => void;
  onSetSize: (v: 's' | 'm' | 'l') => void;
  /** I·S 토글(전체 텍스트 기울임/취소선) — 핸들러를 준 패널에서만 버튼이 뜬다.
   * 노드 패널이 유일한 소비자(플로트는 rich 모델이 없어 아직 미지원). */
  italic?: boolean;
  strike?: boolean;
  onToggleItalic?: () => void;
  onToggleStrike?: () => void;
}) {
  const sizeButtons = SIZE_OPTIONS.map((o) => <SegButton key={o.k} label={o.label} active={(size || 'm') === o.k} theme={theme} onClick={() => onSetSize(o.k)} />);
  // I·S가 있으면(노드 패널) 한 행에 다 안 들어가 '크게'가 홀로 다음 줄로 감겼다
  // (제보: 배치가 중구난방). 3열 그리드 두 행 — [B|I|S] / [작게|보통|크게] — 으로
  // 나눠 열이 수직으로 정렬되게 한다. I·S가 없는 패널(메모·선)은 기존 한 행 그대로.
  if (onToggleItalic || onToggleStrike) {
    return (
      <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <SegButton label="B" title="굵게" active={bold} theme={theme} onClick={onToggleBold} />
          {onToggleItalic && <SegButton label={<span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</span>} title="기울임" active={!!italic} theme={theme} onClick={onToggleItalic} />}
          {onToggleStrike && <SegButton label={<span style={{ textDecoration: 'line-through' }}>S</span>} title="취소선" active={!!strike} theme={theme} onClick={onToggleStrike} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>{sizeButtons}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
      <SegButton label="B" title="굵게" active={bold} theme={theme} onClick={onToggleBold} />
      <div style={{ width: 1, height: 20, background: theme.border }} />
      {sizeButtons}
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
