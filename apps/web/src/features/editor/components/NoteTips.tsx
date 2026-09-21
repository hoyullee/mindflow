import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayUrl } from '@mindflow/mindmap-core';

/**
 * 공책의 **툴팁 한 겹** — 툴바 단추의 이름(요청 5)과 링크의 주소(요청 4)를 같은 상자로 띄운다.
 *
 * ## 왜 브라우저의 `title`을 쓰지 않나
 *
 * `title`은 **느리다**: 브라우저가 1초 안팎을 기다렸다가 띄우고, 그 시간은 우리가 정할 수
 * 없다(제보: "hover 즉시 노출되게"). 게다가 공책 본문의 링크는 `runsToHtml`이 innerHTML로
 * 그리는 `<span data-href>`라 리액트가 속성을 얹을 자리가 없다 — 줄마다 `title`을 심으려면
 * 그리는 쪽을 고쳐야 하는데, 그쪽은 되돌리기·선택 좌표가 걸린 자리다.
 *
 * 그래서 **위임 한 곳**으로 푼다: 문서에 리스너 하나를 두고 `[data-tip]`(툴바)과
 * `[data-href]`(링크)를 `closest`로 찾아 상자를 body로 포털한다. 줄이 몇 개든 리스너는
 * 하나이고, 새로 그려진 줄에도 그대로 붙는다.
 *
 * ## 언제 띄우지 않나
 * - **손가락**: hover가 없는 기기에서는 누르는 순간 잠깐 떴다 사라져 방해만 된다.
 * - **글을 고르는 중**: 끌고 있는데 상자가 따라다니면 글자가 가려진다.
 * - 누르거나·굴리거나·키를 치면 바로 감춘다(그 다음 화면이 곧 바뀐다).
 */
/** ⌥ 키의 이름 — 맥은 기호, 그 밖은 `Alt`. */
const ALT_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌥' : 'Alt';

export function NoteTips({ enabled = true }: { enabled?: boolean }) {
  const [tip, setTip] = useState<{ text: string; sub: string | null; rect: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 지금 가리키고 있는 요소 — 같은 요소 안에서 움직일 때 다시 띄우지 않는다. */
  const onRef = useRef<Element | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    // hover가 없는 기기(손가락)에서는 아예 붙이지 않는다.
    if (window.matchMedia?.('(hover: none)')?.matches) return;

    const clear = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const hide = () => {
      clear();
      onRef.current = null;
      setTip((cur) => (cur === null ? cur : null));
    };
    const over = (e: Event) => {
      const from = e.target as Element | null;
      const el = from?.closest?.('[data-tip],[data-href]') ?? null;
      if (!el || !el.closest('[data-note-editor]')) {
        hide();
        return;
      }
      if (el === onRef.current) return;
      clear();
      const href = el.getAttribute('data-href');
      const tipText = el.getAttribute('data-tip');
      const text = tipText || (href ? displayUrl(href, 80) : '');
      if (!text) {
        hide();
        return;
      }
      // 끌어서 고르는 중이면 띄우지 않는다 — 상자가 고르는 글자를 가린다.
      const sel = window.getSelection();
      if (!tipText && sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        hide();
        return;
      }
      onRef.current = el;
      const rect = el.getBoundingClientRect();
      const sub = tipText ? null : `눌러서 열기 · ${ALT_LABEL}+눌러서 커서`;
      // **툴바는 0ms**(요청) — 이름을 보려고 기다리는 자리가 아니다. 링크는 글 사이에
      // 섞여 있어 지나가는 것만으로 번쩍이면 시끄러우므로 아주 짧게 기다린다.
      if (tipText) setTip({ text, sub, rect });
      else timerRef.current = window.setTimeout(() => setTip({ text, sub, rect }), 160);
    };

    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, [enabled]);

  // 재 놓기 — 상자를 그린 뒤 **재어서** 자리를 정한다(폭이 글자에 따라 달라진다).
  useLayoutEffect(() => {
    if (!tip) {
      setPos(null);
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(tip.rect.left + tip.rect.width / 2 - w / 2, vw - w - 8));
    // 아래가 기본, 넘치면 위로 — 툴바 단추는 아래로, 화면 밑단의 링크는 위로 선다.
    let top = tip.rect.bottom + 7;
    if (top + h > vh - 8) top = Math.max(8, tip.rect.top - h - 7);
    setPos({ left, top });
  }, [tip]);

  if (!tip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={boxRef}
      data-note-tip
      role="tooltip"
      style={{
        position: 'fixed',
        left: pos?.left ?? tip.rect.left,
        top: pos?.top ?? tip.rect.bottom + 7,
        zIndex: 90,
        // 재기 전에는 보이지 않는다 — 한 프레임 엉뚱한 자리에 번쩍이지 않게.
        opacity: pos ? 1 : 0,
        pointerEvents: 'none',
        maxWidth: 'min(360px, 90vw)',
        padding: '5px 8px',
        borderRadius: 7,
        background: 'var(--mf-tip-bg, #2f2a25)',
        color: 'var(--mf-tip-fg, #f7f2ea)',
        fontFamily: 'inherit',
        fontSize: 11.5,
        lineHeight: 1.45,
        boxShadow: '0 6px 18px rgba(30,26,22,.22)',
        overflowWrap: 'anywhere',
      }}
    >
      {tip.text}
      {tip.sub && <div style={{ opacity: 0.62, fontSize: 10.5, marginTop: 1 }}>{tip.sub}</div>}
    </div>,
    document.body,
  );
}
