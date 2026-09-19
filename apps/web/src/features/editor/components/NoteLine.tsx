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
import { charOffset } from '../noteTextSelect';

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
  /** 위/아래 화살표로 블록 사이를 옮긴다(글의 끝·시작에서만). */
  onArrowOut?: (dir: -1 | 1) => boolean;
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

export function NoteLine({ runs, onChange, placeholder, style, readOnly, onEnter, onBackspaceAtStart, onArrowOut, onSlash, autoFocus, lineKey, onFocusLine }: Props) {
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
    if (e.key === 'Backspace' && !e.nativeEvent.isComposing) {
      const sel = window.getSelection();
      const atStart = !!sel && sel.isCollapsed && sel.anchorOffset === 0 && caretAtFirstTextNode(el, sel);
      if (atStart && onBackspaceAtStart?.()) {
        e.preventDefault();
        return;
      }
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onArrowOut) {
      const sel = window.getSelection();
      if (sel?.isCollapsed) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (caretOnEdgeLine(el, sel, dir)) {
          /**
           * **한글을 치던 중에도 넘어간다**(제보: 방향키를 두 번 눌러야 윗줄로 간다).
           *
           * 한글은 마지막 글자가 **조합 중**인 채로 남아 있고, 그 상태에서 누른
           * 방향키의 `keydown`은 `isComposing`이 참이다. 예전에는 그때 손을 뗐으므로
           * 브라우저가 조합을 끝내며 캐럿을 **줄 안에서** 옮겼고(그래서 첫 번째
           * 누름이 "문장 처음으로"가 됐다), 두 번째 눌러야 우리 차례가 왔다.
           *
           * 조합 중에는 **막지 않는다** — `preventDefault`로 가로채면 조합이 끊긴 채
           * 글자가 어정쩡하게 남는다. 대신 캐럿이 가장자리 줄에 있다는 것을 지금
           * 재 두고, 브라우저가 조합을 끝낸 **다음**에 이웃 줄로 건너뛴다(브라우저가
           * 줄 안에서 옮긴 캐럿은 그 순간 덮어쓰이므로 눈에는 한 번의 이동이다).
           */
          if (e.nativeEvent.isComposing) {
            setTimeout(() => onArrowOut(dir), 0);
            return;
          }
          if (onArrowOut(dir)) e.preventDefault();
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

/** 캐럿이 놓인 **글자 자리** — 알 수 없으면 글의 끝으로 본다(테스트 하네스 등). */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (sel && sel.isCollapsed && sel.anchorNode && el.contains(sel.anchorNode)) return charOffset(el, sel.anchorNode, sel.anchorOffset);
  return (el.textContent ?? '').length;
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
  try {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const c = range.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (c.height > 0 && b.height > 0) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || c.height;
      return dir === -1 ? c.top - b.top < lh * 0.6 : b.bottom - c.bottom < lh * 0.6;
    }
  } catch {
    /* 좌표를 못 잰다 — 아래 글자 기준으로 */
  }
  return dir === -1 ? caretAtFirstTextNode(el, sel) && sel.anchorOffset === 0 : caretAtLastTextNode(el, sel);
}

/** 캐럿이 이 박스의 **첫 텍스트 노드**에 있는가(백스페이스·위 화살표 판정). */
function caretAtFirstTextNode(el: HTMLElement, sel: Selection): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  // 빈 박스는 텍스트 노드가 없다 — 그때도 "맨 앞"이다.
  return !first || first === sel.anchorNode;
}

/** 캐럿이 **마지막 텍스트 노드의 끝**에 있는가(아래 화살표 판정). */
function caretAtLastTextNode(el: HTMLElement, sel: Selection): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  let node = walker.nextNode();
  while (node) {
    last = node;
    node = walker.nextNode();
  }
  if (!last) return true;
  return last === sel.anchorNode && sel.anchorOffset === (last.nodeValue || '').length;
}
