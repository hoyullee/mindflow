// 커밋된(편집 중이 아닌) 리치 텍스트 런을 그리는 공용 조각 — 노드 본문의
// 평문/리스트 렌더가 **같은 모양**으로 그리도록 한 곳에 둔다.
//
// 하이퍼링크는 진짜 `<a href>`가 아니라 `data-href` span이다. 캔버스에서 링크는
// **Ctrl/⌘+클릭**으로만 열리는데(단일 클릭은 도형 선택, 더블클릭은 편집이라
// 충돌한다), 진짜 `<a>`를 쓰면 평범한 클릭 한 번에 SPA가 통째로 그 주소로
// 떠나 버린다. 여는 동작을 우리가 쥐고 있으면 그런 사고가 없고, 열 때
// `noopener,noreferrer`도 확실히 붙일 수 있다.

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { displayUrl, normalizeUrl } from '@mindflow/mindmap-core';

/** 링크 클릭을 여는 수정 키가 눌린 상태인가 — 맥은 ⌘, 그 외는 Ctrl. */
export function isLinkOpenModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

/** 캔버스 링크를 새 탭으로 연다 — 저장 전에 `normalizeUrl`을 통과했더라도
 * 여기서 한 번 더 확인한다(옛 문서·협업으로 들어온 값까지 방어). */
export function openLink(href: string): void {
  const safe = normalizeUrl(href);
  if (!safe) return;
  window.open(safe, '_blank', 'noopener,noreferrer');
}

/** 수정 키가 눌렸을 때만 링크를 여는 span에 붙일 핸들러 묶음.
 * `pointerdown`을 멈춰야 노드 선택·드래그가 시작되지 않는다. */
export function linkHandlers(href: string) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (isLinkOpenModifier(e)) e.stopPropagation();
    },
    onClick: (e: React.MouseEvent) => {
      if (!isLinkOpenModifier(e)) return;
      e.stopPropagation();
      e.preventDefault();
      openLink(href);
    },
  };
}

/** 링크 span의 시각 — **파란 글자 + 밑줄**(요청). 색 자체는 CSS 변수
 * `--mf-link`가 정하고(아래 `linkInk` 참고) 여기서는 밑줄만 잡는다: 그래야
 * 편집 박스가 쓰는 HTML 문자열 경로(`runsToHtml`)와 같은 규칙을 공유하고,
 * 무엇보다 인라인 `color`를 심지 않아 **커밋 때 파란색이 모델에 굳지 않는다**
 * (`domToRuns`가 인라인 색을 읽어 `c`로 저장한다 — 그러면 링크를 떼도 파란 글자가
 * 남는다). 런에 사용자가 고른 색이 있으면 안쪽 span의 인라인 색이 이겨서
 * 그 색이 그대로 보인다(색 지정이 먹히지 않으면 그게 더 이상하다). */
export const linkSpanStyle: CSSProperties = {
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  // 노드 본문은 평소 `pointer-events: none`이라 클릭이 도형으로 통과한다
  // (선택·드래그). 링크만 이벤트를 되살려 Ctrl/⌘+클릭을 받는다 — 수정 키 없이
  // 누른 클릭은 우리가 아무것도 하지 않으므로 그대로 도형까지 버블한다.
  pointerEvents: 'auto',
};

/** 링크 span에 붙는 클래스 — `.mf-link { color: var(--mf-link, …) }`(editor.css).
 * React 렌더와 편집 박스용 HTML 문자열이 같은 이름을 쓰도록 한 곳에 둔다. */
export const LINK_CLASS = 'mf-link';

/** 밝은 배경(글자가 어두운 곳)용 링크색 / 어두운 배경(글자가 밝은 곳)용 링크색. */
export const LINK_INK_ON_LIGHT = '#1a63d8';
export const LINK_INK_ON_DARK = '#8ec8ff';

/** 이 색이 우리가 넣은 링크 파랑인가 — 커밋 때 모델로 새어 들어가지 않게
 * 거르는 데 쓴다(`richtextDom.domToRuns`). */
export function isLinkInk(hex: string): boolean {
  const v = hex.trim().toLowerCase();
  return v === LINK_INK_ON_LIGHT || v === LINK_INK_ON_DARK;
}

/** `#rrggbb`(또는 `#rgb`)의 상대 휘도. 못 읽으면 `null`. */
function luminance(hex: string): number | null {
  const c = hex.trim().replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(full.substring(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** 도형의 **글자색**을 보고 그 위에서 읽히는 파랑을 고른다.
 *
 * 배경이 아니라 글자색을 기준으로 삼는 이유: 배경은 사용자가 색·투명도를 바꿀 수
 * 있고 캔버스 위에 겹쳐 보이지만, 글자색은 이미 "이 배경에서 읽히도록" 정해진
 * 값이다(테마 `text`/`accentInk`, 또는 사용자가 고른 `textColor`). 그 밝기를
 * 따라가면 다크 테마·진한 루트 도형에서도 파랑이 배경에 묻히지 않는다.
 * (그래도 대비가 약한 조합은 남으므로 **밑줄은 항상 함께 그린다** — 파랑은 힌트,
 *  링크임을 보장하는 건 밑줄이다.) */
export function linkInk(baseColor: string | null | undefined): string {
  const l = baseColor ? luminance(baseColor) : null;
  if (l == null) return LINK_INK_ON_LIGHT;
  return l > 0.5 ? LINK_INK_ON_DARK : LINK_INK_ON_LIGHT;
}

const MOD_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

/** 링크 툴팁 — 주소와 여는 방법. */
export function linkTitle(href: string): string {
  return `${displayUrl(href, 80)}\n${MOD_LABEL}+클릭으로 열기`;
}

/** 한 런(또는 리스트 줄의 한 세그먼트)을 span으로. 링크면 클릭 핸들러까지 붙는다. */
export function RichSpan({ seg, children }: { seg: { b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string; m?: string }; children: ReactNode }) {
  const styled = seg.b || seg.c || seg.i || seg.s;
  const inner = styled ? (
    <span style={{ fontWeight: seg.b ? 800 : 'inherit', color: seg.c || 'inherit', fontStyle: seg.i ? 'italic' : undefined, textDecoration: seg.s ? 'line-through' : undefined }}>{children}</span>
  ) : (
    <span>{children}</span>
  );
  // 인라인 멘션 — 링크와 같은 색 파이프라인(`--mf-link`)을 타되 밑줄은 없다
  // (밑줄 있는 파랑 = 링크, 밑줄 없는 파랑 = 멘션). 폭이 변하는 굵게는 쓰지 않는다.
  if (seg.m && !seg.href) {
    return (
      <span data-mention-email={seg.m} className="mf-mention">
        {inner}
      </span>
    );
  }
  if (!seg.href) return inner;
  return (
    <span data-href={seg.href} role="link" title={linkTitle(seg.href)} className={LINK_CLASS} style={linkSpanStyle} {...linkHandlers(seg.href)}>
      {inner}
    </span>
  );
}

/** Ctrl/⌘ 가 눌려 있는 동안 `true` — 캔버스 링크에 손가락 커서를 띄우는 데 쓴다.
 * (평소엔 기본 커서다: 그냥 클릭하면 링크가 아니라 **도형이 선택**되므로,
 *  손가락 커서를 상시 띄우면 클릭하면 열릴 것처럼 거짓말을 하게 된다.) */
export function useLinkModifier(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => setHeld(e.metaKey || e.ctrlKey);
    const off = () => setHeld(false);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return held;
}
