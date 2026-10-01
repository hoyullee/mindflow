// 일정 메모의 **서식 편집기**(요청 — 구글 캘린더의 그 도구 모음: 굵게·기울임·밑줄·
// 번호 매기기·글머리 기호·링크 삽입·서식 제거).
//
// 저장은 HTML이다(`richMemo.ts` 머리말) — 구글의 `description`이 원래 HTML이고
// 우리 표도 같은 문자열을 담는다. 그래서 **모델을 새로 두지 않고** 브라우저의
// `execCommand`로 그 HTML을 직접 만든다.
//
// `execCommand`는 표준에서 물러난(deprecated) API다. 그런데도 쓰는 이유는 셋이다:
//   ① 모든 브라우저가 여전히 구현하고 있고(대체 표준이 없다),
//   ② 우리가 원하는 결과물이 **정확히 그 출력**(HTML)이라 변환 계층이 필요 없다,
//   ③ 직접 구현하면 일곱 명령의 선택·중첩·되돌리기를 전부 다시 짜야 한다.
// 캔버스 편집기가 `execCommand`를 피한 것과 어긋나지 않는다 — 그쪽은 저장 모델이
// 우리 `RichRun`이라 DOM 결과를 다시 해석해야 했다.
//
// 값이 나갈 때는 **언제나 위생 처리**를 지난다(`sanitizeMemoHtml`) — 편집기가 만든
// 것이든 붙여넣은 것이든 허용 목록 밖 태그·주소는 남지 않는다.
//
// **폰은 도구가 키보드 바로 위에 선다**(모바일 홈 디자인 N8 「메모 서식 막대」 — 메모에 커서가
// 있을 때만). 상자 위의 도구 줄은 폰에서 열네 칸이 한 줄에 안 들어가고, 정작 쓰는 동안에는
// 키보드에 밀려 화면 밖이다. 명령은 둘이 같은 것을 쓴다 — 형광펜·체크리스트는 두 자리 다 있다
// (폰에서 칠한 것을 데스크톱이 지울 수 없으면 안 된다). 번호 매기기·서식 제거는 데스크톱에만.
//
// 형광펜·체크리스트는 `execCommand`에 없다(`hiliteColor`는 `style`을 쓰는데 위생 처리가 지운다):
//   - 형광펜 = 고른 글자를 `<mark>`로 감싼다(글자 마디마다 — 목록 여러 줄을 골라도 블록을 감싸지 않는다).
//   - 체크리스트 = 글머리 목록에 표식 `data-check`, 끝낸 항목은 `data-done`. 네모는 CSS가 그리고
//     (`home.css`), 그 네모(항목 왼쪽 여백)를 누르면 표식이 뒤집힌다.

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { normalizeUrl } from '@mindflow/mindmap-core';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { useKeyboardInset } from '../../../hooks/useKeyboardInset';
import { memoHtml, sanitizeMemoHtml } from './richMemo';

/**
 * 구글 일정의 메모 아래 안내(N8) — 구글 웹은 형광펜을 칠하지 않고 체크리스트를 글머리 목록으로 그린다.
 * 디자인 문구는 「굵게·형광펜·목록은 Geurio 안에서만 보여요」인데 **굵게·목록은 구글에서도 보인다**
 * (구글 캘린더의 메모 도구에 같은 것이 있다) — 사실인 둘만 적는다.
 */
export const GOOGLE_MEMO_HINT = '형광펜·체크리스트는 Geurio 안에서만 보여요';

/** 키보드 위 서식 막대의 높이 — 캐럿을 이 위로 끌어올릴 때도 쓴다. */
const DOCK_H = 46;

interface Cmd {
  key: string;
  label: string;
  cmd: string;
  arg?: string;
  icon: JSX.Element;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const I = {
  bold: <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M15 5h-5M14 19H9M14 5l-4 14" />,
  underline: <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />,
  mark: <path d="m4 20 3-1 11-11-2-2L5 17zM14 6l2 2M3 21h6" />,
  ol: <path d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 13h2l-2 3h2" />,
  ul: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  check: <path d="M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  clear: <path d="M6 5h13M9 5 7 19M14 12l6 7M20 12l-6 7" />,
};

const ic = (d: JSX.Element, size = 15, width = 2): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={width}>
    {d}
  </svg>
);

const BOLD: Cmd = { key: 'bold', label: '굵게', cmd: 'bold', icon: ic(I.bold) };
const ITALIC: Cmd = { key: 'italic', label: '기울임', cmd: 'italic', icon: ic(I.italic) };
const UNDERLINE: Cmd = { key: 'underline', label: '밑줄', cmd: 'underline', icon: ic(I.underline) };
const MARK: Cmd = { key: 'mark', label: '형광펜', cmd: 'mark', icon: ic(I.mark) };
const OL: Cmd = { key: 'ol', label: '번호 매기기', cmd: 'insertOrderedList', icon: ic(I.ol) };
const UL: Cmd = { key: 'ul', label: '글머리 기호', cmd: 'insertUnorderedList', icon: ic(I.ul) };
const CHECK: Cmd = { key: 'check', label: '체크리스트', cmd: 'check', icon: ic(I.check) };

const CMDS: Cmd[] = [BOLD, ITALIC, UNDERLINE, MARK, OL, UL, CHECK];

const LINK: Cmd = { key: 'link', label: '링크 삽입', cmd: 'createLink', icon: ic(I.link) };
const CLEAR: Cmd = { key: 'clear', label: '서식 제거', cmd: 'removeFormat', icon: ic(I.clear) };

/** 폰의 막대(N8) — 디자인 순서 그대로, 아이콘은 한 치수 크게(17px · 2.2). */
const DOCK: Cmd[] = [BOLD, ITALIC, UNDERLINE, MARK, { ...UL, label: '글머리 목록' }, CHECK, { ...LINK, label: '링크' }];
const DOCK_ICON: Record<string, JSX.Element> = Object.fromEntries(Object.entries(I).map(([k, d]) => [k, ic(d, 17, 2.2)]));

type Fmt = Record<'bold' | 'italic' | 'underline' | 'mark' | 'ul' | 'check' | 'link', boolean>;
const NO_FMT: Fmt = { bold: false, italic: false, underline: false, mark: false, ul: false, check: false, link: false };

/** 캐럿이 있는 요소 — 편집 상자 **밖**이면 null(`closest`가 상자 바깥 조상까지 올라가지 않게). */
function caretEl(root: HTMLElement): Element | null {
  const sel = document.getSelection();
  let n = sel?.anchorNode ?? null;
  if (!sel || !n || !root.contains(n)) return null;
  // 요소 사이에 선 경계(칠한 범위를 다시 고른 직후 등)는 그 **다음 마디**가 캐럿 자리다.
  if (n.nodeType === 1 && sel.anchorOffset < n.childNodes.length) n = n.childNodes[sel.anchorOffset]!;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
}

function inside(root: HTMLElement, el: Element | null, q: string): Element | null {
  const hit = el?.closest(q) ?? null;
  return hit && hit !== root && root.contains(hit) ? hit : null;
}

function cmdState(c: string): boolean {
  try {
    return document.queryCommandState(c);
  } catch {
    return false;
  }
}

/** 지금 캐럿 자리의 서식 — 폰 막대의 켜진 칸. */
function readFmt(root: HTMLElement): Fmt {
  const el = caretEl(root);
  if (!el) return NO_FMT;
  const ul = inside(root, el, 'ul');
  return {
    bold: cmdState('bold'),
    italic: cmdState('italic'),
    underline: cmdState('underline'),
    mark: !!inside(root, el, 'mark'),
    ul: !!ul && !ul.hasAttribute('data-check'),
    check: !!ul && ul.hasAttribute('data-check'),
    link: !!inside(root, el, 'a'),
  };
}

function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * 형광펜 — 고른 글자를 `<mark>`로 감싸거나(이미 다 칠해져 있으면) 걷어 낸다. 캐럿만 있으면
 * 그 자리의 형광펜을 걷는다(칠할 글자가 없다).
 *
 * 범위를 통째로 `surroundContents`하지 않고 **글자 마디마다** 감싼다 — 목록 두 줄을 고르면 범위가
 * `<li>` 경계를 넘고, 블록을 품은 `<mark>`는 HTML이 아니다.
 */
export function toggleMark(root: HTMLElement): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const markOf = (n: Node): Element | null => inside(root, n.nodeType === 1 ? (n as Element) : n.parentElement, 'mark');
  if (range.collapsed) {
    const m = markOf(range.startContainer);
    if (m) unwrap(m);
    return;
  }
  const parts: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!range.intersectsNode(t)) continue;
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.length;
    if (end <= start) continue;
    // 목록 항목 사이의 줄바꿈 같은 **빈 마디**는 칠하지 않는다(`<ul>` 바로 아래에 `<mark>`가 선다).
    const host = t.parentElement?.tagName;
    if ((host === 'UL' || host === 'OL') && !/\S/.test(t.data)) continue;
    parts.push({ node: t, start, end });
  }
  if (!parts.length) return;
  if (parts.every((p) => markOf(p.node))) {
    for (const m of new Set(parts.map((p) => markOf(p.node)!))) unwrap(m);
    return;
  }
  let first: Node | null = null;
  let last: Node | null = null;
  for (const p of parts) {
    const had = markOf(p.node);
    if (had) {
      first ??= had;
      last = had;
      continue;
    }
    let n = p.node;
    if (p.end < n.length) n.splitText(p.end);
    if (p.start > 0) n = n.splitText(p.start);
    const m = document.createElement('mark');
    n.before(m);
    m.append(n);
    first ??= m;
    last = m;
  }
  // 칠한 범위를 다시 고른다 — 이어서 굵게를 누르면 같은 글자에 걸리게.
  if (first && last) {
    const r = document.createRange();
    r.setStartBefore(first);
    r.setEndAfter(last);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/**
 * 글머리 목록 ↔ 체크리스트 — 둘은 **같은 `<ul>`**이고 표식 하나로 갈린다.
 *   - 같은 종류에서 한 번 더 → 목록을 푼다(`insertUnorderedList`의 토글).
 *   - 다른 종류의 목록 안 → 표식만 바꾼다(줄을 다시 만들지 않는다).
 *   - 목록 밖 → 목록을 만들고, 체크리스트면 표식을 단다.
 */
function toggleList(root: HTMLElement, kind: 'ul' | 'check'): void {
  const ul = inside(root, caretEl(root), 'ul');
  const isCheck = !!ul?.hasAttribute('data-check');
  if (ul && (kind === 'check') !== isCheck) {
    if (kind === 'check') ul.setAttribute('data-check', '');
    else ul.removeAttribute('data-check');
    return;
  }
  document.execCommand('insertUnorderedList');
  if (kind === 'check' && !ul) inside(root, caretEl(root), 'ul')?.setAttribute('data-check', '');
}

/** 세로로 굴러가는 가장 가까운 조상 — 캐럿을 막대 위로 올릴 때 이것을 민다. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** `execCommand`가 없는 환경(jsdom·아주 오래된 브라우저)에서는 도구 모음을 감춘다. */
function canFormat(): boolean {
  return typeof document !== 'undefined' && typeof (document as Document & { execCommand?: unknown }).execCommand === 'function';
}

export function RichMemo({
  value,
  onChange,
  placeholder = '자유롭게 적어 두세요',
  attr,
  height = 110,
  hint,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 테스트·프로브가 이 상자를 집는 표식(`data-event-note` 등). */
  attr?: string;
  height?: number;
  /** 쓰는 동안 상자 아래에 뜨는 한 줄 — 구글 일정이면 `GOOGLE_MEMO_HINT`. */
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** 상자 + 안내 줄 — 캐럿을 끌어올릴 때 "끝"이 어디인지(막대·키보드 자리는 빼고). */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(true);
  const formatting = canFormat();
  const mobile = useIsMobile();
  const inset = useKeyboardInset();
  const [focused, setFocused] = useState(false);
  const [fmt, setFmt] = useState<Fmt>(NO_FMT);
  /** 폰의 막대(N8)는 **커서가 있을 때만** 선다 — 그 밖에는 상자뿐이다. */
  const dock = mobile && formatting && focused;
  /**
   * 우리가 마지막으로 올려 보낸 값 — 그것이 `value`로 되돌아온 것이면 **DOM을 손대지
   * 않는다**(제보 수리). 타이핑 중에 `innerHTML`을 다시 심으면 캐럿이 튀고, 무엇보다
   * **IME 조합이 깨져 한글이 자모로 쪼개진다**. `sanitizeMemoHtml`의 왕복은 완전한
   * 항등이 아니므로(`<div>`↔`<p>`·속성 순서·엔티티) "값이 같으면 안 심는다"는 비교만
   * 으로는 부족하다 — 어느 비대칭이든 여기서 막힌다.
   */
  const lastOut = useRef<string | null>(null);
  /** IME 조합 중에는 밖에서 온 값이라도 미룬다 — 조합을 끊으면 글자가 깨진다. */
  const composing = useRef(false);
  const deferred = useRef(false);

  const seed = (next: string): void => {
    const el = ref.current;
    if (!el) return;
    const html = memoHtml(next);
    if (el.innerHTML !== html) el.innerHTML = html;
    setEmpty(!(el.textContent ?? '').trim() && !el.querySelector('li, img'));
  };

  // **밖에서** 값이 바뀔 때만 다시 심는다(다른 일정을 열었을 때 등).
  useEffect(() => {
    if (!ref.current) return;
    if (value === lastOut.current) return; // 우리 입력의 메아리
    if (composing.current) {
      deferred.current = true;
      return;
    }
    seed(value);
    // `seed`는 렌더마다 새 함수지만 ref·인자만 읽는다 — deps는 `value` 하나다.
  }, [value]);

  const push = (): void => {
    const el = ref.current;
    if (!el) return;
    // 체크리스트에서 Enter를 치면 브라우저가 **앞 항목을 속성째 복제**한다 — 끝낸 항목 아래의 새 줄이
    // 처음부터 끝난 채로 생긴다. 글자가 없는 항목은 끝낼 것이 없으니 표식을 뗀다.
    for (const li of Array.from(el.querySelectorAll('li[data-done]'))) if (!(li.textContent ?? '').trim()) li.removeAttribute('data-done');
    setEmpty(!(el.textContent ?? '').trim() && !el.querySelector('li, img'));
    const out = sanitizeMemoHtml(el.innerHTML);
    lastOut.current = out;
    onChange(out);
  };

  /**
   * 캐럿을 **막대 위로** — 브라우저는 키보드 위까지만 캐럿을 끌어올리고 그 위에 우리 막대(46px)가
   * 있다는 것을 모른다. 마지막 줄을 쓰는 동안 글자가 막대 뒤에 숨지 않게 굴러가는 조상을 민다.
   */
  const keepCaretVisible = (): void => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    // `Range`의 상자를 모르는 환경(jsdom)에서는 요소의 상자로 물러선다.
    let r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : new DOMRect();
    // 빈 줄의 접힌 범위는 상자가 0이다 — 그 줄의 요소로 물러선다.
    if (!r.height) r = (caretEl(el) ?? el).getBoundingClientRect();
    // 캐럿 아래 한 뼘까지 — 끝줄을 쓰는 중이면 상자의 끝과 안내 줄(N8)까지 막대 위에 보인다.
    const tail = (wrapRef.current ?? el).getBoundingClientRect().bottom;
    const want = Math.min(r.bottom + 60, Math.max(r.bottom, tail));
    const bottom = window.innerHeight - inset - DOCK_H - 8;
    if (want <= bottom) return;
    const sc = scrollParent(el);
    if (sc) sc.scrollTop += want - bottom;
  };

  useEffect(() => {
    if (!dock) return;
    const sync = (): void => {
      if (ref.current) setFmt(readFmt(ref.current));
    };
    sync();
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, [dock]);

  // 키보드가 올라오는 동안(높이가 몇 번에 걸쳐 바뀐다)에도 캐럿을 따라간다.
  useEffect(() => {
    if (!dock) return;
    const id = requestAnimationFrame(keepCaretVisible);
    return () => cancelAnimationFrame(id);
    // `keepCaretVisible`은 ref·`inset`만 읽는다.
  }, [dock, inset]);

  const run = (cmd: Cmd): void => {
    const el = ref.current;
    if (!el) return;
    // 이미 쓰는 중이면 초점을 다시 걸지 않는다 — 다시 걸면 고른 글자가 풀리는 환경이 있다.
    if (document.activeElement !== el) el.focus();
    if (cmd.key === 'link') {
      const raw = window.prompt('링크 주소');
      if (raw === null) return;
      const href = normalizeUrl(raw.trim());
      // 열 수 없는 주소는 넣지 않는다 — 값에 들어가지도 못하게(위생 처리와 같은 규칙).
      if (!href) return;
      document.execCommand('createLink', false, href);
    } else if (cmd.key === 'mark') {
      toggleMark(el);
    } else if (cmd.key === 'ul' || cmd.key === 'check') {
      toggleList(el, cmd.key);
    } else {
      document.execCommand(cmd.cmd, false, cmd.arg);
    }
    push();
    setFmt(readFmt(el));
  };

  /**
   * 체크리스트의 **네모를 누르면** 끝냄 표식을 뒤집는다. 네모는 항목 왼쪽 여백에 그린 의사 요소라
   * 누른 자리가 항목 상자의 왼쪽 끝보다 왼쪽이면 네모다. 기본 동작을 막아 캐럿이 그 줄로 옮겨 가지
   * 않게 한다 — 폰에서는 그 한 번에 키보드가 올라온다.
   */
  const onBoxMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const el = ref.current;
    const li = el ? inside(el, e.target as Element, 'li') : null;
    if (!el || !li || li.parentElement?.tagName !== 'UL' || !li.parentElement.hasAttribute('data-check')) return;
    if (e.clientX >= li.getBoundingClientRect().left) return;
    e.preventDefault();
    li.toggleAttribute('data-done');
    push();
  };

  const btn: CSSProperties = {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--mf-subtext)',
    cursor: 'pointer',
    padding: 0,
  };
  const dockBtn = (on: boolean): CSSProperties => ({
    width: 40,
    height: 36,
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 10,
    background: on ? 'var(--mf-m-ink)' : 'transparent',
    color: on ? 'var(--mf-m-card)' : 'var(--mf-m-ink2)',
    cursor: 'pointer',
    padding: 0,
  });

  const pad = mobile ? { x: 16, y: 14 } : { x: 12, y: 11 };
  const font = mobile ? { size: 15, line: 1.65 } : { size: 13, line: 1.6 };

  return (
    <div data-memo-wrap>
      <div ref={wrapRef}>
      <div
        data-memo-box
        style={
          mobile
            ? // 폰(N1·N2·N8) — 둥근 상자 하나. 쓰는 동안은 강조 테두리 + 옅은 고리.
              { border: focused ? '1.5px solid #E8A25F' : '1px solid var(--mf-m-card-line)', boxShadow: focused ? '0 0 0 3px color-mix(in srgb, #E8A25F 22%, var(--mf-m-card))' : 'none', borderRadius: 14, background: 'var(--mf-m-card)', overflow: 'hidden', transition: 'box-shadow .14s ease' }
            : { border: '1px solid var(--mf-border)', borderRadius: 12, background: 'var(--mf-card)', overflow: 'hidden' }
        }
      >
        {formatting && !mobile && (
          <div
            data-memo-toolbar
            role="toolbar"
            aria-label="메모 서식"
            style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 6px', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)' }}
            // 버튼을 누르는 순간 편집 상자가 blur되면 선택이 사라져 명령이 **아무 데도**
            // 걸리지 않는다(서식 툴바에서 겪은 그 함정) — 기본 동작을 막아 선택을 지킨다.
            onMouseDown={(e) => e.preventDefault()}
          >
            {CMDS.map((c) => (
              <button key={c.key} type="button" className="mf-ctl" data-memo-cmd={c.key} title={c.label} aria-label={c.label} onClick={() => run(c)} style={btn}>
                {c.icon}
              </button>
            ))}
            <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--mf-border)', margin: '0 4px' }} />
            {[LINK, CLEAR].map((c) => (
              <button key={c.key} type="button" className="mf-ctl" data-memo-cmd={c.key} title={c.label} aria-label={c.label} onClick={() => run(c)} style={btn}>
                {c.icon}
              </button>
            ))}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="메모"
            {...(attr ? { [attr]: '' } : {})}
            onInput={() => {
              push();
              if (dock) keepCaretVisible();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              push();
            }}
            onMouseDown={onBoxMouseDown}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              // 조합 중에 밖에서 값이 바뀌었으면 이제 반영한다.
              if (deferred.current) {
                deferred.current = false;
                seed(value);
              }
              push();
            }}
            className="lnb-scroll mf-memo-rich"
            style={{
              // 폰은 상자가 페이지와 함께 굴러간다 — 상자 안에 또 하나의 스크롤을 두지 않는다.
              minHeight: mobile ? (focused ? 150 : 96) : height,
              ...(mobile ? {} : { maxHeight: 260, overflowY: 'auto' as const }),
              boxSizing: mobile ? 'border-box' : 'content-box',
              padding: `${pad.y}px ${pad.x}px`,
              font: 'inherit',
              fontSize: font.size,
              lineHeight: font.line,
              color: 'var(--mf-text)',
              ...(mobile ? { wordBreak: 'keep-all' as const } : {}),
              outline: 'none',
            }}
          />
          {empty && (
            <span aria-hidden="true" style={{ position: 'absolute', left: pad.x, top: pad.y, fontSize: font.size, lineHeight: font.line, color: mobile ? 'var(--mf-m-faint2)' : 'var(--mf-faint2)', pointerEvents: 'none' }}>
              {placeholder}
            </span>
          )}
        </div>
      </div>
      {hint && focused && (
        <span data-memo-hint style={{ display: 'block', padding: mobile ? '6px 6px 0' : '6px 2px 0', fontSize: mobile ? 11.5 : 11, color: mobile ? 'var(--mf-m-faint)' : 'var(--mf-faint)' }}>
          {hint}
        </span>
      )}
      </div>
      {dock && (
        <>
          {/* 막대 + 키보드만큼의 자리 — 마지막 줄을 그 위로 끌어올릴 수 있게(굴러갈 거리가 없으면 못 민다). */}
          <div aria-hidden="true" style={{ height: inset + DOCK_H }} />
          <div
            data-memo-dock
            role="toolbar"
            aria-label="메모 서식"
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: 'fixed', left: 0, right: 0, bottom: inset, zIndex: 20, display: 'flex', alignItems: 'center', gap: 2, height: DOCK_H, padding: '0 8px', boxSizing: 'border-box', borderTop: '1px solid var(--mf-m-card-line)', background: 'var(--mf-m-card)' }}
          >
            {DOCK.map((c) => {
              const on = fmt[c.key as keyof Fmt];
              return (
                <button key={c.key} type="button" className="btn" data-memo-cmd={c.key} aria-pressed={on} title={c.label} aria-label={c.label} onClick={() => run(c)} style={dockBtn(on)}>
                  {DOCK_ICON[c.key]}
                </button>
              );
            })}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" data-memo-dismiss title="키보드 내리기" aria-label="키보드 내리기" onClick={() => ref.current?.blur()} style={{ ...dockBtn(false), color: 'var(--mf-m-mut)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
