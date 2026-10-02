// 모바일 홈의 공통 부품 — 아이콘·구획 머리·시트·종류 표식.
//
// 모바일 홈 디자인(하단 탭 네 개 · 스페이스 · 새로 만들기 · 전체)이 같은 낱말을 여러 화면에서
// 되풀이한다(셰브론, 등폭 개수가 붙은 구획 머리, 바닥에서 올라오는 시트). 화면마다 베껴 두면
// 한쪽만 고쳐지는 날이 오므로 여기 한 벌만 둔다.

import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../../components/Modal';
import { MONO_FONT } from '../chrome';
import type { CardViewData, DocKindName } from '../viewModel';

/** 디자인 원본의 선 아이콘(24 격자) — 화면마다 같은 획을 쓴다. */
export const M_ICON = {
  space: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  cal: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  noti: (
    <>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  more: <path d="M4 7h16M4 12h16M4 17h16" />,
  /** 하단 탭 「도구」(M4b) — 고리 둘. 「도구 관리」의 퍼즐(`tools`)과 다르다: 탭은 **연결한 곳으로 가는 길**이다. */
  link: <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  share: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c.8-3.5 3.2-5 6-5s5.2 1.5 6 5M17 8h5M19.5 5.5 22 8l-2.5 2.5" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  note: (
    <>
      <path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  map: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 12h3c2 0 2-6 4-6M11.5 12c2 0 2 6 4 6" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21l4-4 4 4" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18M15 3v18" />
    </>
  ),
  jira: (
    <>
      <path d="M12 3 4 11l8 8 8-8z" />
      <path d="M12 8v6M9 11h6" />
    </>
  ),
  tools: (
    <path d="M14 4h4a2 2 0 0 1 2 2v4h-3a2 2 0 0 0 0 4h3v4a2 2 0 0 1-2 2h-4v-3a2 2 0 0 0-4 0v3H6a2 2 0 0 1-2-2v-4h3a2 2 0 0 0 0-4H4V6a2 2 0 0 1 2-2h4v3a2 2 0 0 0 4 0z" />
  ),
  list: <path d="M4 7h16M4 12h16M4 17h10" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />,
  out: <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l5 4-5 4M20 12H9" />,
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-5.5 8.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10v6M9 13h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  restore: (
    <>
      <polyline points="3 4 3 10 9 10" />
      <path d="M5.4 15a8 8 0 1 0 1.9-8.3L3 10" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v4.5M12 16.5h.01" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v9" />
      <path d="m8.5 9 3.5 3.5L15.5 9" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
} as const;

export function Glyph({ d, size = 18, stroke = 'currentColor', width = 2, style }: { d: ReactNode; size?: number; stroke?: string; width?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block', ...style }}>
      {d}
    </svg>
  );
}

/** 행 끝의 `›` — 눌러서 한 겹 들어간다는 표식. */
export function Chevron({ color = 'var(--mf-m-faint2)', size = 14 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CloseGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function BackGlyph({ size = 22, width = 2.2 }: { size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

export const M_FONT = "Pretendard, 'Pretendard-fallback', system-ui, sans-serif";

/** 구획 머리 — `이름 N` (이름은 옅은 굵은 글자, 개수는 더 옅은 등폭). */
export function MSectionHead({ label, count, pad = '22px 20px 8px', trailing }: { label: string; count?: number | string; pad?: string; trailing?: ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: pad, fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>
      {label}
      {count !== undefined && count !== '' && <span style={{ fontFamily: MONO_FONT, fontWeight: 600, color: 'var(--mf-m-faint2)' }}>{count}</span>}
      {trailing && (
        <>
          <span style={{ flex: 1 }} />
          {trailing}
        </>
      )}
    </span>
  );
}

/** 문서 종류 — 이름·색·아이콘. 색은 데스크톱 카드의 종류 색과 **같은 토큰**이다
 * (디자인 목업의 색을 따로 들이면 같은 문서가 화면마다 다른 색이 된다). */
export const KIND_META: Record<DocKindName, { label: string; color: string; icon: ReactNode }> = {
  note: { label: '공책', color: 'var(--mf-doc-note)', icon: M_ICON.note },
  map: { label: '마인드맵', color: 'var(--mf-doc-map)', icon: M_ICON.map },
  board: { label: '화이트보드', color: 'var(--mf-doc-board)', icon: M_ICON.board },
  kanban: { label: '칸반 보드', color: 'var(--mf-doc-kanban)', icon: M_ICON.kanban },
};

export function kindOfCard(c: Pick<CardViewData, 'isNote' | 'isBoard' | 'isKanban'>): DocKindName {
  return c.isNote ? 'note' : c.isKanban ? 'kanban' : c.isBoard ? 'board' : 'map';
}

/** 종류 색을 옅게 깐 면(아이콘 타일) — 테마의 카드 면과 섞는다(다크에서도 같은 결). */
export function kindTile(kind: DocKindName): string {
  return `color-mix(in srgb, ${KIND_META[kind].color} 12%, var(--mf-m-card))`;
}

/** 공책 제목의 글자색 — 표지색 그대로(다크에서만 잉크 쪽으로 끌어올린다 · `--mf-m-cover-lift`). */
export function coverInk(cover: string): string {
  return `color-mix(in srgb, var(--mf-m-ink) var(--mf-m-cover-lift), ${cover})`;
}

/** 공책 표지의 모눈 — 데스크톱 표지와 같은 결. */
export function noteGrid(): string {
  return 'linear-gradient(var(--mf-m-grid) 1px, transparent 1px), linear-gradient(90deg, var(--mf-m-grid) 1px, transparent 1px)';
}

/**
 * 바닥에서 올라오는 시트 — 모바일의 「새로 만들기」·「스페이스」가 쓴다.
 *
 * 껍데기는 앱의 모달(`Modal` — Radix Dialog)이다: 초점 가두기·Escape·바깥 누름 닫기·
 * 「지금 모달이 떠 있는가」(`useAnyModalOpen`) 셈을 새로 만들지 않고 그대로 얻는다. 다른 점은
 * 자리(바닥에 붙는다)와 생김새(위 모서리만 둥글다 · 손잡이)뿐이다.
 */
export function MobileSheet({
  open,
  onClose,
  label,
  attrs,
  children,
  maxHeight = 'calc(100% - 72px)',
  zIndex = 130,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  attrs?: Record<string, string>;
  children: ReactNode;
  maxHeight?: string;
  /** 전체 화면(설정 150 · Jira 설정 · 휴일) **위에** 여는 시트는 그보다 높게. */
  zIndex?: number;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={label}
      dimAttrs={{ 'data-m-sheet-scrim': '' }}
      dim={{ alignItems: 'flex-end', zIndex, background: 'var(--mf-m-scrim)' }}
      cardClass="mf-m-sheet"
      cardAttrs={attrs}
      card={{
        width: '100%',
        maxHeight,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '24px 24px 0 0',
        background: 'var(--mf-m-card)',
        color: 'var(--mf-m-ink)',
        fontFamily: M_FONT,
        boxShadow: '0 -20px 50px -30px rgba(46,42,38,.5)',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        outline: 'none',
        overflow: 'hidden',
      }}
    >
      <span aria-hidden="true" style={{ alignSelf: 'center', flex: '0 0 auto', width: 36, height: 4, marginTop: 8, borderRadius: 99, background: 'var(--mf-m-grip)', display: 'block' }} />
      {children}
    </Modal>
  );
}

/** 시트 머리의 동그란 닫기(32px). */
export function SheetClose({ onClick, label = '닫기' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="btn mf-m-press"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: 32, height: 32, flex: '0 0 auto', border: 0, borderRadius: 99, background: 'var(--mf-m-soft)', color: 'var(--mf-m-mut)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
    >
      <CloseGlyph />
    </button>
  );
}

/** 한 겹 들어간 화면(공유받음·휴지통·즐겨찾기 …)의 머리 — `‹ 전체 · 제목 N · 오른쪽 동작`. */
export function SubPageHeader({ back, onBack, title, count, action }: { back: string; onBack: () => void; title: string; count?: number; action?: ReactNode }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', height: 52, padding: '0 8px' }}>
      <button
        type="button"
        className="btn mf-m-press"
        onClick={onBack}
        aria-label={`${back}(으)로 돌아가기`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, width: 76, height: 40, padding: '0 8px', border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', flex: '0 0 auto' }}
      >
        <BackGlyph size={20} width={2.4} />
        {back}
      </button>
      <h2 style={{ flex: 1, minWidth: 0, margin: 0, textAlign: 'center', fontSize: 16, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {title}
        {count !== undefined && <span style={{ marginLeft: 5, fontFamily: MONO_FONT, fontSize: 13, fontWeight: 600, color: 'var(--mf-m-faint)' }}>{count}</span>}
      </h2>
      <span style={{ width: 76, flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end' }}>{action}</span>
    </div>
  );
}
