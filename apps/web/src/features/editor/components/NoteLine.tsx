// 공책 본문의 **편집 가능한 한 줄** — 문단·제목·목록 항목·표 칸이 모두 이 부품이다.
//
// ## 늘 편집 가능하다
//
// 맵·보드의 편집 박스는 "두 번 눌러 열고 확정하면 닫힌다". 공책은 문서 편집기라
// 반대다 — 누르면 바로 캐럿이 가야 하고, 그래서 이 부품은 상시 `contentEditable`이다.
//
// ## innerHTML은 **마운트할 때 한 번만** 심는다
//
// 값이 바뀔 때마다 다시 심으면 타이핑 중에 캐럿이 맨 앞으로 튄다(리액트 제어
// 컴포넌트로 만들 수 없는 이유). 그래서 이 박스는 **비제어**다: 처음 한 번 그리고,
// 그 뒤로는 사용자의 입력이 DOM의 진실이고 우리가 그것을 읽어 문서에 커밋한다.
// 서식 버튼처럼 **우리가** 내용을 갈아야 할 때는 `applyNoteFormat`이 직접 그린다.

import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RichRun } from '@mindflow/mindmap-core';
import { runsText, textRuns } from '@mindflow/mindmap-core';
import { domToRuns, runsToHtml } from '../richtextDom';
import { applyNoteFormat, NOTE_EDIT_ATTR } from '../noteRichDom';
import { charOffset, pointAt } from '../noteTextSelect';

interface Props {
  runs: RichRun[] | undefined;
  onChange: (runs: RichRun[]) => void;
  placeholder?: string;
  style?: CSSProperties;
  readOnly?: boolean;
  /**
   * 엔터 — 대개 "새 블록/항목". 처리했으면 `true`(줄바꿈을 막는다).
   *
   * `at`은 **캐럿이 놓인 글자 자리**다(요청: 문장 가운데서 Enter를 치면 뒤쪽 글이
   * 따라 내려가야 한다). 캐럿 자리를 모르는 환경에서는 글의 길이 — 즉 "끝에서 쳤다"
   * 로 본다(예전 동작 그대로).
   */
  onEnter?: (at: number) => boolean;
  /** 맨 앞에서 백스페이스 — 대개 "이 블록/항목 지우기". 처리했으면 `true`. */
  onBackspaceAtStart?: () => boolean;
  /**
   * **`/`를 쳤다** — 블록 종류 목록을 여는 신호. 인자는 그 `/`가 놓일 **글자 자리**다.
   *
   * `/`는 **본문에 그대로 들어간다**(요청·노션과 같은 동작): 목록은 그 뒤에 이어 치는
   * 글자로 좁혀지고, Esc로 닫으면 `/글머리 목록`이라고 쓴 글이 그대로 남는다. 예전에는
   * 그 글자를 먹어 버려서 `/`로 시작하는 글을 아예 쓸 수 없었다(제보).
   *
   * **낱말의 시작에서만** 부른다(줄 머리이거나 앞이 공백) — 그러지 않으면 주소를
   * 적다 `https://`의 `/`마다 메뉴가 끼어든다.
   */
  onSlash?: (at: number) => void;
  /**
   * 위/아래 화살표로 블록 사이를 옮긴다(글의 첫 줄·마지막 줄에서만).
   *
   * `x`는 캐럿의 **가로 자리**(화면 좌표)다 — 이웃 줄에서도 그 자리에 가장 가까운
   * 글자 틈에 캐럿을 놓기 위한 값이다(요청: 줄을 옮겨도 칸이 흔들리지 않게).
   */
  onArrowOut?: (dir: -1 | 1, x?: number) => boolean;
  /**
   * **왼쪽/오른쪽 화살표로 줄을 넘는다** — 글의 맨 끝에서 →, 맨 앞에서 ←.
   *
   * 블록마다 편집 박스가 따로라 브라우저는 그 경계를 넘지 못한다(제보: 문장 끝에서
   * 오른쪽 키를 눌러도 다음 줄로 가지 않는다). 넘어간 뒤의 캐럿은 →면 다음 줄의
   * **맨 앞**, ←면 앞 줄의 **맨 끝**이다.
   */
  onEdgeOut?: (dir: -1 | 1) => boolean;
  /**
   * **Tab · Shift+Tab** — 목록에서 들여쓰기·내어쓰기. 처리했으면 `true`.
   *
   * 이 고리를 주지 않은 줄에서는 Tab이 브라우저의 것이다(초점이 다음 요소로 간다) —
   * 목록이 아닌 줄에서 Tab을 먹으면 키보드만 쓰는 사람이 편집기에 갇힌다.
   */
  onTab?: (back: boolean) => boolean;
  /** 마운트 직후 캐럿을 놓는다(새로 만든 블록). */
  autoFocus?: boolean;
  /** 이 줄을 가리키는 표식 — 테스트와 캐럿 이동이 쓴다. */
  lineKey?: string;
  /**
   * 이 줄에 포커스가 왔다 — 툴바가 **어느 줄에 서식을 걸지** 아는 두 번째 근거다.
   *
   * 선택만 보면(`noteEditBoxInSelection`) 툴바를 먼저 누른 경우나 캐럿이 접혀 있는
   * 경우에 대상을 잃는다. 포커스는 클릭·탭 이동·프로그램 이동 모두에서 오므로
   * 더 넓게 잡힌다 — 둘을 함께 쓴다(선택이 있으면 그쪽이 정확하다).
   */
  onFocusLine?: (el: HTMLElement) => void;
}

export function NoteLine({ runs, onChange, placeholder, style, readOnly, onEnter, onBackspaceAtStart, onArrowOut, onEdgeOut, onTab, onSlash, autoFocus, lineKey, onFocusLine }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = runsToHtml({ text: runsText(runs), rich: runs ?? null });
    if (autoFocus) {
      el.focus();
      // 캐럿을 **끝**에 둔다 — 새 줄은 대개 이어서 쓰려고 만든다.
      try {
        const sel = window.getSelection();
        const rng = document.createRange();
        rng.selectNodeContents(el);
        rng.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(rng);
      } catch {
        /* 캐럿을 못 놓아도 포커스는 갔다 */
      }
    }
    // **마운트할 때 한 번만**(파일 머리 주석) — 값 변화로 다시 심으면 캐럿이 튄다.
    // 의존성을 일부러 비워 둔다: `runs`를 넣으면 타이핑마다 다시 심어 캐럿이 맨 앞으로
    // 튄다(비제어 박스라는 결정의 핵심이다).
  }, []);

  const commit = (): void => {
    const el = ref.current;
    if (!el) return;
    const { text, rich } = domToRuns(el);
    onChange(rich ?? textRuns(text));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    /**
     * **서식 단축키** — ⌘B·⌘I·⌘U·⌘⇧S(요청: 공책에서도 단축키를 다 쓰게).
     *
     * 툴바 단추와 **같은 길**을 쓴다(`applyNoteFormat` → 이 줄의 `onChange`) — 그래서
     * 문단이든 목록 항목이든 표의 칸이든 여기 달린 줄이면 모두 같은 서식이 걸린다.
     * 브라우저의 기본 동작(`<b>`를 직접 끼워 넣거나 ⌘U로 소스 보기)은 막는다.
     *
     * 고른 글이 없으면 `applyNoteFormat`이 `null`을 돌려준다 — 그때는 아무 일도
     * 하지 않는다(캐럿 뒤로 이어 칠 서식을 예약해 두는 것은 다른 일이다).
     */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !readOnly && !e.nativeEvent.isComposing) {
      const k = e.key.toLowerCase();
      const mark: 'b' | 'i' | 'u' | 's' | null = !e.shiftKey && (k === 'b' || e.code === 'KeyB')
        ? 'b'
        : !e.shiftKey && (k === 'i' || e.code === 'KeyI')
          ? 'i'
          : !e.shiftKey && (k === 'u' || e.code === 'KeyU')
            ? 'u'
            : e.shiftKey && (k === 's' || e.code === 'KeyS')
              ? 's'
              : null;
      if (mark) {
        e.preventDefault();
        e.stopPropagation();
        const runs = applyNoteFormat(el, mark);
        if (runs) onChange(runs);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (onEnter?.(caretOffset(el))) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === '/' && !e.nativeEvent.isComposing && onSlash) {
      // 글자는 막지 않는다 — 브라우저가 `/`를 넣고, 우리는 그 **자리**만 기억한다.
      const text = el.textContent ?? '';
      const at = caretOffset(el);
      const before = text.slice(0, at);
      // 낱말의 시작에서만(줄 머리이거나 앞이 공백) — `https://`에서 열리지 않게.
      if (!before || /\s$/.test(before)) {
        // **글자는 막지 않는다**(`preventDefault` 금지 — `/`는 본문에 들어가야 한다).
        // 대신 전파만 끊어 전역 단축키 핸들러가 같은 키를 또 잡지 않게 한다(스펙 §3).
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        onSlash(at);
      }
    }
    if (e.key === 'Tab' && !e.nativeEvent.isComposing && onTab) {
      // `/` 목록이 열려 있으면 이 키는 그쪽 것이다 — 그쪽이 **캡처 단계**에서
      // 가로채므로 여기까지 오지 않는다(SlashMenu의 키 핸들러).
      if (onTab(e.shiftKey)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Backspace' && !e.nativeEvent.isComposing) {
      const sel = window.getSelection();
      // **글자 자리로** 가른다 — 캐럿이 텍스트 노드가 아니라 요소 경계에 놓이는
      // 경우가 있어(우리가 옮겨 놓았을 때) 노드 비교만으로는 맨 앞을 놓친다.
      const atStart = !!sel && sel.isCollapsed && caretOffset(el) === 0;
      if (atStart && onBackspaceAtStart?.()) {
        e.preventDefault();
        return;
      }
    }
    /**
     * **방향키로 줄을 넘는다.**
     *
     * 수정 키가 붙은 방향키는 브라우저의 것이다(Shift는 선택, ⌘·⌥는 줄·낱말 단위
     * 이동) — 우리가 가로채면 그 기능이 사라진다.
     */
    const plainArrow = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    const composing = e.nativeEvent.isComposing;
    if (plainArrow && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onArrowOut) {
      const sel = window.getSelection();
      /**
       * **조합 중에는 캐럿이 접혀 있지 않다** — 윈도 한글 IME는 조합 중인 글자를
       * 골라 둔 모양으로 두므로 `isCollapsed`가 거짓이다(실측). 그것까지 받는다.
       */
      if (sel && (sel.isCollapsed || composing)) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (caretOnEdgeLine(el, sel, dir)) {
          const x = caretRect(el, sel)?.left;
          // 조합 중에는 **막지 않는다**(가로채면 조합이 끊긴 채 글자가 남는다) —
          // 브라우저가 조합을 끝낸 다음 차례에 건너뛴다.
          if (composing) {
            setTimeout(() => onArrowOut(dir, x), 0);
            return;
          }
          if (onArrowOut(dir, x)) e.preventDefault();
        }
      }
    }
    if (plainArrow && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && onEdgeOut) {
      const sel = window.getSelection();
      if (sel && (sel.isCollapsed || composing)) {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const len = (el.textContent ?? '').length;
        const at = caretOffset(el);
        // 줄의 **맨 끝**에서 → · **맨 앞**에서 ←일 때만 넘어간다.
        if (dir === 1 ? at >= len : at <= 0) {
          if (composing) {
            setTimeout(() => onEdgeOut(dir), 0);
            return;
          }
          if (onEdgeOut(dir)) e.preventDefault();
        }
      }
    }
  };

  return (
    <div
      ref={ref}
      {...{ [NOTE_EDIT_ATTR]: lineKey ?? '' }}
      data-note-line={lineKey ?? ''}
      className="mf-note-line"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      // 소프트 키보드의 액션 키를 줄바꿈으로 못박는다 — 맵 편집 박스와 같은 이유
      // ("완료/이동"류를 고르면 그 키가 키보드를 내려 편집이 끝난다).
      enterKeyHint="enter"
      data-placeholder={placeholder ?? ''}
      onInput={commit}
      onBlur={commit}
      onFocus={() => {
        const el = ref.current;
        if (el) onFocusLine?.(el);
      }}
      onKeyDown={onKeyDown}
      style={{ outline: 'none', minHeight: '1.6em', whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}
    />
  );
}

/**
 * 캐럿이 놓인 **글자 자리** — 알 수 없으면 글의 끝으로 본다(테스트 하네스 등).
 *
 * `anchor`가 아니라 **`focus`**를 본다: 조합 중이거나 범위를 고른 상태에서 캐럿은
 * 그 범위의 **끝**에 있다(한글 IME가 조합 글자를 골라 둘 때가 그렇다 — 실측).
 */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (sel && sel.focusNode && el.contains(sel.focusNode)) return charOffset(el, sel.focusNode, sel.focusOffset);
  return (el.textContent ?? '').length;
}

/**
 * 캐럿의 **화면 사각형** — 가장자리 판정과 「가로 자리 지키기」가 함께 쓴다.
 *
 * 접힌 범위의 사각형이 **비어서 오는 경우**가 있다(캐럿이 텍스트 노드가 아니라
 * 요소 경계에 놓였을 때 크롬이 그렇다). 그러면 **옆 글자 한 칸**을 재서 그 줄의
 * 높이와 가로 자리를 대신 얻는다 — 이 폴백이 없으면 "방향키를 눌렀는데 그 줄 안에서만
 * 움직인다"가 된다(제보 2: 한 번은 넘어가고 다음 번은 제자리).
 */
function caretRect(el: HTMLElement, sel: Selection): DOMRect | null {
  try {
    const node = sel.focusNode && el.contains(sel.focusNode) ? sel.focusNode : el;
    const offset = node === sel.focusNode ? sel.focusOffset : 0;
    const probe = document.createRange();
    probe.setStart(node, offset);
    probe.collapse(true);
    const box = probe.getBoundingClientRect();
    if (box.height > 0) return box;
    const len = (el.textContent ?? '').length;
    if (!len) return null;
    const at = Math.max(0, Math.min(charOffset(el, node, offset), len));
    // 캐럿 **앞 글자**(맨 앞이면 뒤 글자) 한 칸을 재고, 그 변을 캐럿 자리로 본다.
    const a = at > 0 ? at - 1 : 0;
    const s = pointAt(el, a);
    const t = pointAt(el, Math.min(len, a + 1));
    const span = document.createRange();
    span.setStart(s.node, s.offset);
    span.setEnd(t.node, t.offset);
    const r = span.getBoundingClientRect();
    if (!r.height) return null;
    const x = at > 0 ? r.right : r.left;
    return new DOMRect(x, r.top, 0, r.height);
  } catch {
    return null;
  }
}

/**
 * 캐럿이 이 박스의 **첫 줄(위) · 마지막 줄(아래)**에 있는가 — 방향키가 블록을 넘을 때다.
 *
 * 예전에는 "첫 **글자**인가 / 마지막 **글자**인가"로 봤다(제보: 방향키 동작이 이상하다).
 * 한 줄짜리 문단에서 글 끝에 캐럿을 두고 ↑를 누르면 넘어가야 하는데, 끝 글자는 첫
 * 글자가 아니므로 우리가 막지 않고 브라우저가 **그 줄의 처음으로** 캐럿을 옮겼다 —
 * 그래서 한 번 더 눌러야 윗줄로 갔다.
 *
 * 이제 **좌표로** 가른다: 캐럿의 사각형이 박스의 첫 줄(마지막 줄) 안에 있으면 넘어간다.
 * 여러 줄로 감긴 문단 안에서는 여전히 브라우저가 줄을 오르내린다. 좌표를 못 재는
 * 환경(jsdom)에서는 예전의 글자 기준으로 물러선다.
 */
function caretOnEdgeLine(el: HTMLElement, sel: Selection, dir: -1 | 1): boolean {
  const c = caretRect(el, sel);
  const b = el.getBoundingClientRect();
  if (c && b.height > 0) {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || c.height;
    return dir === -1 ? c.top - b.top < lh * 0.6 : b.bottom - c.bottom < lh * 0.6;
  }
  // 좌표를 못 재는 환경(jsdom) — **글자 자리**로 가른다(감긴 줄은 구분하지 못한다).
  const at = caretOffset(el);
  return dir === -1 ? at <= 0 : at >= (el.textContent ?? '').length;
}
