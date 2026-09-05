// 앱의 **우클릭 메뉴 디자인** — 값이 여기 한곳에 있다.
//
// 제보: 같은 우클릭인데 화면마다 글자 크기·간격·굵기가 달랐다(칸반 카드 메뉴만
// 시안대로였고 캔버스·홈은 각자 값을 들고 있었다). 기준은 **칸반 카드 메뉴**다
// (사용자 선정) — 아래 값이 그 메뉴의 값 그대로이고, 세 소비처가 이 함수들만 쓴다:
//
//   · 캔버스(마인드맵·화이트보드) `editor/components/ContextMenu.tsx`
//   · 칸반 카드 `editor/components/KanbanCardMenu.tsx`
//   · 홈·일정 `home/components/HomeContextMenu.tsx`(`HomeMenuPanel`)
//
// **앞으로 새 우클릭 메뉴는 이 모듈을 쓴다.** 값을 그 자리에 다시 적으면 그 순간
// 네 번째 디자인이 생긴다(이 프로젝트가 "소비처 N곳"으로 여러 번 겪은 드리프트).
//
// 색은 화면마다 오는 곳이 다르다 — 에디터는 인라인 `Theme` 객체, 홈은 CSS 변수다.
// 그래서 톤을 **구조적 프롭**(`MenuTone`)으로 받고 기본값만 CSS 변수로 둔다
// (`DateTone`·`ShareTheme`와 같은 처방). hover 칠하기는 `menu.css`가 맡는다 —
// 인라인 배경은 클래스 규칙을 이기므로 값만 변수로 내려 준다.

import type { CSSProperties } from 'react';
import './menu.css';

/** 메뉴가 쓰는 색 — 화면이 자기 팔레트에서 만들어 넘긴다. */
export interface MenuTone {
  /** 패널 면 */
  panel: string;
  border: string;
  /** 행 글자 */
  text: string;
  /** 머리 라벨·단축키 */
  subtext: string;
  /** hover·활성 행의 면(강조색 옅은 틴트) */
  hoverBg: string;
  /** hover·활성 행의 글자 */
  hoverInk: string;
  /** 위험(삭제) 행의 글자 */
  danger: string;
  /** 위험 행 hover의 면 */
  dangerBg: string;
  /** 구분선 */
  divider: string;
  /** 비활성 행의 글자 */
  faint: string;
}

/** 홈처럼 CSS 변수로 색을 내려받는 화면의 기본 톤. */
export const CSS_MENU_TONE: MenuTone = {
  panel: 'var(--mf-panel)',
  border: 'var(--mf-border)',
  text: 'var(--mf-text)',
  subtext: 'var(--mf-subtext)',
  hoverBg: 'var(--mf-accent-soft)',
  hoverInk: 'var(--mf-accent-strong)',
  danger: 'var(--mf-danger)',
  dangerBg: 'var(--mf-danger-bg)',
  divider: 'var(--mf-border-soft)',
  faint: 'var(--mf-faint2)',
};

/** 행 높이 — 손가락은 앱 전체가 지켜 온 44px 터치 타깃. */
export const MENU_ROW_H = 38;
export const MENU_TOUCH_ROW_H = 44;
export const MENU_RADIUS = 14;
export const MENU_PAD = 6;
export const MENU_SHADOW = '0 24px 54px -22px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.06)';
/** 글리프 칸 — 아이콘 크기가 달라도 라벨이 한 열에 선다. */
export const MENU_GLYPH_W = 17;

/**
 * 패널 — 자리(`position`/`left`/`top`/`zIndex`)는 호출부가 더한다(메뉴마다 서는
 * 방식이 다르다: 고정 좌표 · Radix 팝퍼 · 캔버스 절대 좌표).
 */
export function menuPanelStyle(tone: MenuTone, width: number): CSSProperties {
  return {
    width,
    boxSizing: 'border-box',
    padding: MENU_PAD,
    background: tone.panel,
    border: `1px solid ${tone.border}`,
    borderRadius: MENU_RADIUS,
    boxShadow: MENU_SHADOW,
    transformOrigin: 'top left',
    ...menuVars(tone),
  };
}

/** `menu.css`가 읽는 hover 색 — 패널에 한 번 내려 주면 그 안의 행이 전부 쓴다. */
export function menuVars(tone: MenuTone): CSSProperties {
  return {
    ['--mf-menu-hover' as string]: tone.hoverBg,
    ['--mf-menu-hover-ink' as string]: tone.hoverInk,
    ['--mf-menu-danger-bg' as string]: tone.dangerBg,
    ['--mf-menu-danger-ink' as string]: tone.danger,
  } as CSSProperties;
}

export interface MenuRowOpts {
  /** 손가락용 44px 행 */
  touch?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

/** 행 — `className="mf-menu-row"`와 함께 쓴다(hover는 CSS가 칠한다). */
export function menuRowStyle(tone: MenuTone, opts: MenuRowOpts = {}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    minHeight: opts.touch ? MENU_TOUCH_ROW_H : MENU_ROW_H,
    padding: '0 11px',
    border: 0,
    borderRadius: 9,
    background: 'transparent',
    color: opts.disabled ? tone.faint : opts.danger ? tone.danger : tone.text,
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'inherit',
    lineHeight: 1.3,
    cursor: opts.disabled ? 'not-allowed' : 'pointer',
    textAlign: 'left',
    boxSizing: 'border-box',
  };
}

/** 아이콘 칸 — 색은 **글자를 따른다**(hover에서 라벨과 함께 강조색이 된다). */
export const MENU_GLYPH_STYLE: CSSProperties = {
  display: 'flex',
  width: MENU_GLYPH_W,
  justifyContent: 'center',
  alignItems: 'center',
  flex: '0 0 auto',
  color: 'inherit',
};

/** 라벨 — 좁은 메뉴에서 줄바꿈 대신 말줄임(행 높이가 흔들리지 않게). */
export const MENU_LABEL_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** 단축키 — 오른쪽에 등폭으로. 적는 것은 **실제로 듣는 키**뿐이다. */
export function menuKeyStyle(tone: MenuTone): CSSProperties {
  return {
    flex: '0 0 auto',
    fontSize: 11.5,
    color: tone.subtext,
    opacity: 0.85,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
}

/** 머리 — 무엇에 대고 연 메뉴인지(색 점 + 이름 한 줄). */
export const MENU_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px 9px',
  minWidth: 0,
};

export const MENU_HEAD_DOT_STYLE: CSSProperties = { flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, display: 'block' };

export function menuHeadTitleStyle(tone: MenuTone): CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 700,
    color: tone.text,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

export function menuDividerStyle(tone: MenuTone): CSSProperties {
  return { height: 1, background: tone.divider, margin: '5px 8px' };
}
