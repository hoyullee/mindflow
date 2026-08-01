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

/** 링크 span의 시각 — 밑줄만. 색은 런의 색(없으면 도형 글자색)을 그대로 쓴다:
 * 도형 배경이 테마마다 달라 고정 링크색은 어딘가에서 반드시 안 보인다. */
export const linkSpanStyle: CSSProperties = {
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  // 노드 본문은 평소 `pointer-events: none`이라 클릭이 도형으로 통과한다
  // (선택·드래그). 링크만 이벤트를 되살려 Ctrl/⌘+클릭을 받는다 — 수정 키 없이
  // 누른 클릭은 우리가 아무것도 하지 않으므로 그대로 도형까지 버블한다.
  pointerEvents: 'auto',
};

const MOD_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

/** 링크 툴팁 — 주소와 여는 방법. */
export function linkTitle(href: string): string {
  return `${displayUrl(href, 80)}\n${MOD_LABEL}+클릭으로 열기`;
}

/** 한 런(또는 리스트 줄의 한 세그먼트)을 span으로. 링크면 클릭 핸들러까지 붙는다. */
export function RichSpan({ seg, children }: { seg: { b?: boolean; c?: string | null; i?: boolean; s?: boolean; href?: string }; children: ReactNode }) {
  const styled = seg.b || seg.c || seg.i || seg.s;
  const inner = styled ? (
    <span style={{ fontWeight: seg.b ? 800 : 'inherit', color: seg.c || 'inherit', fontStyle: seg.i ? 'italic' : undefined, textDecoration: seg.s ? 'line-through' : undefined }}>{children}</span>
  ) : (
    <span>{children}</span>
  );
  if (!seg.href) return inner;
  return (
    <span data-href={seg.href} role="link" title={linkTitle(seg.href)} style={linkSpanStyle} {...linkHandlers(seg.href)}>
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
