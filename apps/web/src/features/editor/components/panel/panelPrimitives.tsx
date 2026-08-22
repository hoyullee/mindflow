import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Segmented } from '../../../../components/Segmented';
import { hexA, mixHex } from '../../theme';
import type { Theme } from '../../theme';
import { MONO_FONT, glassCard } from '../../chrome';

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
export const MOBILE_SIDE_PANEL_W = 288;

export function panelWrapStyle(th: Theme, isMobile = false, lowered = false, short = false): CSSProperties {
  if (isMobile && short) {
    // 가로로 돌린 폰: 높이가 350~430px 남짓이라 55dvh 바텀시트를 그대로 두면
    // 캔버스가 거의 남지 않는다. 남는 축(가로)으로 돌려 **오른쪽 사이드 시트**로.
    return {
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: MOBILE_SIDE_PANEL_W,
      maxWidth: '70vw',
      border: `1px solid ${th.border}`,
      borderRight: 'none',
      borderRadius: '16px 0 0 16px',
      boxShadow: '-8px 0 30px rgba(0,0,0,.14)',
      // 화이트보드 하단 도구 막대(120)보다 위 — 폰에서 시트를 도구 막대가
      // 가리고 있었다(제보). 시트는 "지금 고른 것"을 다루는 화면이라 그 위다.
      zIndex: 130,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: th.panel,
    };
  }
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
      // 화이트보드 하단 도구 막대(120)보다 위 — 폰에서 시트를 도구 막대가
      // 가리고 있었다(제보).
      zIndex: 130,
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
    // 디자인 원본(마인드맵 리디자인)의 인스펙터 — 296폭·r18·가까운 선그늘 +
    // 멀리 깔리는 큰 그늘. 유리질 면(반투명+블러)은 그대로.
    width: 296,
    maxHeight: `calc(100% - ${top + 78}px)`,
    ...glassCard(th),
    borderRadius: 18,
    boxShadow: '0 2px 5px -3px rgba(46,42,38,.18), 0 30px 60px -30px rgba(46,42,38,.55)',
    zIndex: 15,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
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
  // 디자인 원본은 구획 이름을 **대문자 트래킹이 아니라** 작고 굵은 한 줄로 쓴다
  // (한글에는 대문자가 없어 letter-spacing만 남아 자간이 벌어져 보였다).
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: theme.subtext, marginBottom: 8 }}>{children}</div>;
}

/**
 * Collapsible property-panel section — port of the dc original's `panelSec`
 * accordion (MindFlow.dc.html:150-234 etc.): a clickable header row with a
 * ▸/▾ chevron and a max-height-animated body. Callers drive `open` from a
 * single "which section is open" state so only one is expanded at a time, and
 * remount the panel (via a React `key`) on selection change to reset to all
 * collapsed — matching the original's one-open accordion + reset behavior.
 */
export function PanelSection({ theme, title, value, open, onToggle, children }: { theme: Theme; title: string; value?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);
  // 첫 구획은 열린 채로 마운트된다(요청) — 그때 펼침 애니메이션이 재생되면
  // "열려 있다"가 아니라 "지금 열렸다"로 읽힌다. 전이는 **open이 처음 바뀐
  // 뒤**(사용자의 첫 토글)부터만 켠다. 패널은 선택이 바뀔 때 key로 리마운트되므로
  // 매번 성립한다. (렌더 중 상태 조정 — React의 adjust-state-during-render 관용구.)
  const [toggled, setToggled] = useState(false);
  const prevOpenRef = useRef(open);
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (!toggled) setToggled(true);
  }
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
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', margin: '0 -6px 4px', padding: '12px 6px', borderRadius: 10 }}
      >
        {/* 디자인 원본의 구획 머리 — 작은 회색 라벨이 아니라 13px 잉크색 제목이
            46px 행을 차지한다(접힌 패널에서도 구획이 목차처럼 읽힌다). */}
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {/* 지금 값(글자 크기·색 이름)을 접힌 채로도 읽는다 — 디자인 원본이
              등폭으로 눈금처럼 보여 주는 자리. */}
          {value && <span style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: theme.subtext, opacity: 0.75 }}>{value}</span>}
          {/* ▸/▾ 글자 대신 회전하는 셰브론(디자인 원본) — 열림·닫힘이 움직임으로 읽힌다. */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={theme.subtext}
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden
            style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform .18s ease', display: 'block' }}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </div>
      <div
        ref={bodyRef}
        style={{ overflow: 'hidden', opacity: open ? 1 : 0, maxHeight: open ? maxH : 0, transition: toggled ? 'max-height .3s cubic-bezier(.4,0,.2,1), opacity .24s ease' : 'none' }}
      >
        <div style={{ paddingTop: 2 }}>{children}</div>
      </div>
    </>
  );
}

/**
 * 패널 제목에 쓸 **한 줄** — 여러 줄 텍스트는 첫 줄만 남긴다.
 *
 * 제목은 "지금 무엇을 고쳤는가"를 가리키는 **이름**이지 내용 미리보기가 아니다.
 * 제목 줄은 `white-space: nowrap`이라 줄바꿈이 공백으로 접히는데, 그래서 여러 줄
 * 도형을 고르면 내용 전체가 한 줄로 나열됐다(제보).
 *
 * 첫 줄이 비어 있으면(줄바꿈으로 시작하는 텍스트) 다음 비지 않은 줄을 쓴다 —
 * 빈 자리를 보여 주는 것보다 낫다.
 */
export function panelTitleLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/**
 * 패널 머리 — 디자인 원본은 **색 조각 + [무엇을 고르고 있는가 / 그 이름]**을
 * 가라앉은 띠에 얹는다. `swatch`(지금 대상의 색)를 주면 그 조각이 함께 뜬다.
 */
export function PanelTitle({ theme, kicker, name, swatch, onClose }: { theme: Theme; kicker: string; name: string; swatch?: string | null; onClose?: () => void }) {
  const line = panelTitleLine(name);
  void swatch; // 디자인 개정: 머리에 색 조각을 두지 않는다(강조 띠가 정체를 말한다)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '-14px -14px 10px', padding: '13px 15px 14px', borderBottom: `1px solid ${hexA(theme.accent, 0.18)}`, background: hexA(theme.accent, 0.1) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span data-panel-kicker style={{ fontSize: 11, fontWeight: 600, color: theme.subtext }}>{kicker}</span>
        {/* 툴팁에는 전체 텍스트 — 첫 줄만 보이니 나머지를 확인할 길은 남겨 둔다. */}
        <span data-panel-name title={name || undefined} style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-.015em', lineHeight: 1.35, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line}
        </span>
      </div>
      {onClose && (
        <button
          type="button"
          className="mf-ed-btn"
          aria-label="속성 닫기"
          title="닫기"
          onClick={onClose}
          style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2, borderRadius: 8, border: 'none', background: 'transparent', color: theme.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
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
  // 작게/보통/크게 — 디자인 원본(마인드맵 리디자인)의 **세그먼트 트랙**: 가라앉은
  // 면(panel2) 위에서 활성 칸만 카드 면 + 진한 강조 잉크 + 작은 그늘로 떠오른다
  // (원본 seg(): 활성 #FFFDFB/#C9512A/그늘, 비활성 투명/#8A8078). 값은 고정 헥스가
  // 아니라 테마에서 파생 — 다크·모노에서도 성립한다.
  // 하나만 고르는 묶음이므로 `Segmented`(Radix ToggleGroup) — 묶음 안에서 ←/→로
  // 옮겨 다닌다(예전에는 `aria-pressed` 버튼 셋이라 Tab이 칸마다 멈췄다).
  const sizeSeg = (
    <Segmented
      value={size || 'm'}
      onChange={onSetSize}
      label="글자 크기"
      trackAttrs={{ 'data-size-seg': '' }}
      track={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: theme.panel2, border: `1px solid ${theme.border}`, boxSizing: 'border-box', flex: 1, minWidth: 0 }}
      items={SIZE_OPTIONS.map((o) => ({
        value: o.k,
        label: o.label,
        style: (on: boolean) => ({
          flex: 1,
          height: 30,
          border: 0,
          borderRadius: 8,
          padding: 0,
          background: on ? theme.panel : 'transparent',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 700,
          color: on ? mixHex(theme.accent, theme.text, 0.2) : theme.subtext,
          boxShadow: on ? '0 2px 5px -3px rgba(46,42,38,.35)' : 'none',
          cursor: 'pointer',
        }),
      }))}
    />
  );
  // I·S가 있으면(노드 패널) 한 행에 다 안 들어가 '크게'가 홀로 다음 줄로 감겼다
  // (제보: 배치가 중구난방). [B|I|S] 그리드 아래에 크기 세그 트랙 한 줄.
  // I·S가 없는 패널(선)은 기존 한 행 그대로(B + 트랙).
  if (onToggleItalic || onToggleStrike) {
    return (
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <SegButton label="B" title="굵게" active={bold} theme={theme} onClick={onToggleBold} />
          {onToggleItalic && <SegButton label={<span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</span>} title="기울임" active={!!italic} theme={theme} onClick={onToggleItalic} />}
          {onToggleStrike && <SegButton label={<span style={{ textDecoration: 'line-through' }}>S</span>} title="취소선" active={!!strike} theme={theme} onClick={onToggleStrike} />}
        </div>
        {sizeSeg}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
      <SegButton label="B" title="굵게" active={bold} theme={theme} onClick={onToggleBold} />
      <div style={{ width: 1, height: 20, background: theme.border, flexShrink: 0 }} />
      {sizeSeg}
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
