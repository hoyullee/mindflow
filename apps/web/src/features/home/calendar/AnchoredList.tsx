// 검색 상자 곁에 뜨는 **툴팁 리스트**(요청 — 후보가 팝업 안에서 자리를 차지해 팝업이
// 길어졌다). 일별 리스트 팝업과 같은 결: body 포털 + fixed, 실측해 화면 안으로 당기고
// 아래가 모자라면 상자 위로 뒤집는다. 스크롤·리사이즈에 따라온다.
//
// 여기 있는 이유: 참석자·회의실 후보(`GoogleEventFields`)와 캘린더 추가 후보
// (`GoogleCalendarSection`)가 **같은 것**을 쓴다 — 두 벌로 두면 자리 계산이 갈린다.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 후보 목록 상자의 면 — 툴팁과 팝업 안 목록이 같은 값을 쓴다. */
export const listCard: CSSProperties = { display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', overflowY: 'auto' };

export const rowDivider = (i: number): CSSProperties => (i === 0 ? {} : { borderTop: '1px solid var(--mf-border-soft)' });

export function AnchoredList({ anchor, attrs, children }: { anchor: HTMLElement | null; attrs: Record<string, string>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const update = (): void => {
      const r = anchor?.getBoundingClientRect();
      const el = ref.current;
      if (!r || !el) return;
      const h = el.offsetHeight;
      const below = r.bottom + 6;
      const top = below + h + 8 > window.innerHeight ? Math.max(8, r.top - 6 - h) : below;
      setPos({ left: r.left, top, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    // 팝업 본문이 스크롤돼도 상자를 따라간다(캡처 — 스크롤러가 어느 층이든).
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchor, children]);
  return createPortal(
    <div
      ref={ref}
      {...attrs}
      className="lnb-scroll"
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: pos?.width ?? 240,
        // 첫 커밋(실측 전)의 프레임이 화면에 나가지 않게 — 자리가 서면 보인다.
        visibility: pos ? 'visible' : 'hidden',
        // **모달 위의 포털은 포인터를 되찾아야 한다**(제보: hover도 스크롤도 선택도
        // 안 됐다). Radix Dialog가 열려 있는 동안 `document.body`는 `pointer-events:
        // none`이고, body 포털인 이 층은 그것을 상속한다.
        pointerEvents: 'auto',
        zIndex: 400,
        boxSizing: 'border-box',
        maxHeight: 186,
        ...listCard,
        boxShadow: '0 18px 40px -18px rgba(46,42,38,.45), 0 2px 8px rgba(46,42,38,.08)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
