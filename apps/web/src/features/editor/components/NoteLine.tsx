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
// 서식 버튼처럼 **우리가** 내용을 갈아야 할 때는 에디터가 `applyNoteFormat`으로 직접 그린다.

import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RichRun } from '@mindflow/mindmap-core';
import { applyAutoLinks, charsToRuns, runsToChars, runsText, textRuns } from '@mindflow/mindmap-core';
import { domToRuns, liveEditValue, runsToHtml, setLinearSelection } from '../richtextDom';
import { codeHtml } from '../noteCode';
import { NOTE_EDIT_ATTR, armedCaretAt, armedHasMark, closeArmedAnchor, disarmCaretMark, fireCaretMark, openArmedAnchor } from '../noteRichDom';
import { caretMetrics, charOffset, hasRowBeyond, lineBoundaryAt, lineLength, lineText, paintCode, pointAt, rangeOfChars, rowStepInLine } from '../noteTextSelect';
import { cellListBackspace, cellListBreak, cellListHtml, cellListSync, cellListTab } from '../noteCellList';
import { chipAtCaret, chipRange } from '../noteChip';
import { listSignature } from '../listLines';
import { snapCaretOffListMarker } from '../richtextDom';
import { editCaretKeydown } from '../caretPolicy';

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
  /** Shift+Enter — **한 블록 안에서** 줄을 바꾼다(막았으면 `true`). */
  onSoftEnter?: (at: number) => boolean;
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
  onSlash?: (at: number, tail: string) => void;
  /**
   * `@`를 친 자리 — 사람·날짜·페이지를 한 메뉴에서 부른다(스펙 4절).
   *
   * 인자·규칙은 `onSlash`와 **같다**: 낱말의 시작에서만 열고, 캐럿 뒤에 이미 있던
   * 글을 함께 넘겨 질의가 어디서 끝나는지 알린다.
   *
   * **낱말의 시작**이라는 조건을 여기에도 두는 이유가 따로 있다 — 주소(`a@b.com`)를
   * 적을 때마다 메뉴가 끼어들면 그 자리에서 Enter가 삼켜진다. 스펙은 "`@`를 입력하면"
   * 이라고만 적었지만, `/`에서 이미 같은 오탐을 겪고 세운 규칙이라 그대로 따른다.
   */
  onMention?: (at: number, tail: string) => void;
  /**
   * 위/아래 화살표로 블록 사이를 옮긴다(글의 첫 줄·마지막 줄에서만).
   *
   * `x`는 캐럿의 **가로 자리**(화면 좌표)다 — 이웃 줄에서도 그 자리에 가장 가까운
   * 글자 틈에 캐럿을 놓기 위한 값이다(요청: 줄을 옮겨도 칸이 흔들리지 않게).
   */
  onArrowOut?: (dir: -1 | 1, x?: number) => boolean;
  /**
   * **여러 줄이 칠해져 있는 동안**은 이 줄의 키 처리를 멈춘다.
   *
   * 그때 캐럿은 첫 줄의 시작점에 접혀 있고(한글 조합의 목적지를 남겨 두려고) 키는
   * **문서 리스너**가 통째로 맡는다 — 둘 다 움직이면 방향키가 두 번 먹고 Backspace가
   * 글자와 선택을 함께 지운다.
   */
  selecting?: boolean;
  /**
   * **⌘A를 한 번 더** — 줄 하나를 다 고른 상태에서 다시 누르면 본문 전체.
   * 처리했으면 `true`(브라우저의 "이 박스 전체 고르기"를 막는다).
   */
  onSelectAll?: () => boolean;
  /**
   * **Shift+위/아래로 줄을 넘어 고른다** — 브라우저는 편집 박스 **밖으로** 선택을
   * 늘리지 못하므로(블록마다 박스가 따로다) 우리가 이어 그린다. 처리했으면 `true`.
   */
  onSelectOut?: (dir: -1 | 1, x?: number, y?: number) => boolean;
  /**
   * **Shift+왼쪽/오른쪽으로 줄을 넘어 고른다**(제보: 문장의 끝·처음에 닿으면 거기서
   * 멈춘다). 브라우저의 선택은 이 편집 박스 안에 갇혀 있어 이웃 줄로 이어지지 않는다 —
   * 가장자리에 닿았을 때만 넘겨받는다(위·아래의 `onSelectOut`과 같은 규칙).
   */
  onSelectSide?: (dir: -1 | 1) => boolean;
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
  /**
   * **평문 붙여넣기** — `[from, to)`를 그 글로 바꾼다. 처리했으면 `true`.
   *
   * 왜 가로채나(제보): 목록을 복사해 붙이면 표식이 사라졌다. 클립보드에 가는 것은
   * 평문이라 받는 쪽에서 `- `·`1. `을 다시 목록으로 세워야 하는데, 브라우저의 기본
   * 붙여넣기는 이 **한 줄짜리 편집 박스 안에** 줄바꿈째로 밀어 넣는다.
   *
   * 고리를 주지 않았거나 `false`를 돌려주면 브라우저의 기본 붙여넣기다 — 표식도
   * 줄바꿈도 없는 평범한 한 줄은 그쪽이 낫다(되돌리기가 자연스럽다).
   */
  onPasteText?: (text: string, from: number, to: number) => boolean;
  /**
   * **이 박스 안에서 목록을 글자로 다룬다**(표의 칸 — `noteCellList` 머리말).
   *
   * 본문의 목록은 블록이라 이 모드가 아니다: 마커를 항목 옆에 따로 그리고
   * Tab·Enter를 컨트롤러가 받는다. 칸은 모델이 `RichRun[]` 하나뿐이라 마커가 곧
   * 글자이고, 그래서 이 박스가 직접 들여쓰기·이어쓰기·다시 그리기를 맡는다.
   */
  /**
   * **이 박스가 코드 블록인가**(요청 7) — 문법 색칠을 여기서 그린다.
   *
   * 색은 **클래스로만** 준다(`noteCode` 머리말) — 인라인 `color`로 심으면
   * `domToRuns`가 그것을 런의 `c`로 읽어 색칠이 문서 값이 된다.
   */
  codeBox?: boolean;
  listBox?: boolean;
  /**
   * **이 박스가 목록 글쇠를 받는가** — Tab·Shift+Enter·마커 Backspace.
   *
   * 그리는 것(`listBox`)과 나누는 이유: 표의 칸은 **고른 상태**와 **고치는 상태**가
   * 다르다. 고르기만 한 칸에서 Tab은 다음 칸이고 ⌫는 그 행을 지우는 일이라, 글을
   * 고치는 중일 때만 이 글쇠들이 목록의 것이다.
   */
  listKeys?: boolean;
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

export function NoteLine({ runs, onChange, placeholder, style, readOnly, selecting, onEnter, onSoftEnter, onBackspaceAtStart, onArrowOut, onEdgeOut, onSelectOut, onSelectSide, onSelectAll, onTab, onSlash, onMention, onPasteText, listBox, codeBox, listKeys, autoFocus, lineKey, onFocusLine }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** 조합 중에는 `innerHTML`을 갈지 않는다 — 갈면 자모가 갈린다(공책에서 겪은 제보). */
  const composing = useRef(false);
  /**
   * **세로로 오르내리는 동안 지킬 목표 칸**(화면 좌표 x) — 브라우저의 "desired column"과
   * 같은 것을 우리가 든다. 짧은 행을 지날 때 칸이 그 행의 끝으로 줄어들면 안 되기
   * 때문이고, 세로가 아닌 키를 누르면 그 자리에서 잊는다.
   */
  const vertX = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = { text: runsText(runs), rich: runs ?? null };
    if (listBox) {
      el.innerHTML = cellListHtml(value);
      el.dataset.listSig = listSignature(value);
    } else if (codeBox) {
      el.innerHTML = codeHtml(value.text);
    } else {
      el.innerHTML = runsToHtml(value);
    }
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

  /**
   * **글을 고친 적이 있는가** — 초점을 잃을 때 커밋할지 가르는 표식이다(요청 8).
   *
   * 왜 필요한가: 비제어 박스는 떠날 때 DOM을 읽어 커밋한다(`onBlur`). 그런데
   * **DOM을 읽는 일 자체가 값을 아주 조금 바꿀 때가 있다** — 링크가 그렇다.
   * `domToRuns`는 주소를 `normalizeUrl`에 태우므로 `https://a.b`가 `https://a.b/`로
   * 돌아온다. 그러면 글자 하나 건드리지 않고 줄을 지나가기만 해도 "바뀌었다"가 되어
   * 페이지의 `updatedAt`이 새로 찍히고 자동저장이 돈다(실측으로 그 한 줄이었다).
   * 고치지 않았으면 읽지도 않는다 — 어떤 왕복 차이가 새로 생겨도 같은 길로 막힌다.
   */
  const dirty = useRef(false);

  /** 값을 이 박스에 **다시 그린다** — 칸은 마커가 글자라 그리는 함수가 다르다. */
  const redraw = (el: HTMLElement, value: { text: string; rich: RichRun[] | null }): void => {
    if (listBox) {
      el.innerHTML = cellListHtml(value);
      el.dataset.listSig = listSignature(value);
    } else if (codeBox) {
      el.innerHTML = codeHtml(value.text);
    } else {
      el.innerHTML = runsToHtml(value);
    }
  };

  /**
   * **조합 중인 첫 글자도 코드로 보이게**(제보 5).
   *
   * 켜 둔 인라인 코드는 글자가 들어온 **뒤**에야 값에 걸린다(`armCaretMark` 머리말 —
   * 폭 0인 빈 `<code>` 안에는 캐럿이 서지 못한다). 한글은 그 "뒤"가 음절을 **확정한**
   * 다음이라, 조합하는 동안 글자가 평문으로 남아 브라우저의 조합 표시만 보였다 —
   * 제보의 "텍스트를 선택한 듯한 배경"이 그것이다.
   *
   * 조합 중에는 `innerHTML`을 갈 수 없으므로(자모가 갈린다) **칠하기로 흉내만** 낸다.
   * 확정되는 순간 진짜 `<code>`가 그 자리를 이어받고 칠은 걷힌다.
   */
  const paintArmedCode = (): void => {
    const el = ref.current;
    if (!el || !armedHasMark(el, 'k')) return;
    const at = armedCaretAt(el);
    const now = at === null ? -1 : charOffset(el, window.getSelection()?.focusNode ?? el, window.getSelection()?.focusOffset ?? 0);
    paintCode(at !== null && now > at ? rangeOfChars(el, at, now) : null);
  };

  /**
   * **친 글을 다시 칠한다** — 코드 블록의 매 입력마다(조합 중에는 건너뛴다).
   *
   * 값이 그대로면 손대지 않는다(`html === innerHTML`): 글쇠마다 `innerHTML`을 갈면
   * 캐럿이 튀고 한글 조합이 끊긴다(`cellListSync`와 같은 계약). 갈아야 할 때는 고른
   * 자리를 **값 좌표**로 적어 두었다가 그대로 되돌린다.
   */
  const codeSync = (el: HTMLElement): void => {
    const html = codeHtml(liveEditValue(el).text);
    if (html === el.innerHTML) return;
    const span = selectedRange(el);
    el.innerHTML = html;
    setLinearSelection(el, span.from, span.to);
  };

  /**
   * `final`이면 **줄을 떠나는 커밋**이다 — 그때 친 주소를 링크로 바꾼다(요청).
   *
   * 타이핑 중에 실시간으로 걸지 않는 이유는 맵 편집과 같다: 반쯤 친 주소가 링크가
   * 됐다 풀렸다 하며 캐럿과 한글 조합이 흔들린다. 떠나는 순간이면 그 흔들림이 없고,
   * 비제어 박스라 화면도 우리가 함께 다시 그려야 링크가 보인다.
   */
  /**
   * `/` 넣기 목록을 **이 자리에서** 연다 — 키보드와 입력 이벤트가 함께 쓴다.
   *
   * @param back 캐럿이 `/` **뒤에** 서 있으면 1(`input`), 아직 넣기 전이면 0(`keydown`).
   * @returns 열었으면 참(키보드 쪽은 그때만 전파를 끊는다).
   */
  const openSlashHere = (back = 0): boolean => openTriggerHere(onSlash, back);
  /** `@` 허브를 이 자리에서 — `/`와 같은 규칙이다(위 `onMention` 머리말). */
  const openMentionHere = (back = 0): boolean => openTriggerHere(onMention, back);
  /**
   * `/`와 `@`가 **한 함수를 나눠 쓴다** — 여는 조건이 같기 때문이다(낱말의 시작,
   * 캐럿 뒤의 글을 꼬리로 넘김). 둘을 따로 쓰면 한쪽만 고쳐지는 날이 온다.
   */
  const openTriggerHere = (cb: ((at: number, tail: string) => void) | undefined, back = 0): boolean => {
    const el = ref.current;
    if (!el || !cb) return false;
    const text = lineText(el);
    const at = Math.max(0, caretOffset(el) - back);
    const before = text.slice(0, at);
    // 낱말의 시작에서만(줄 머리이거나 앞이 공백) — `https://`·`a@b.com`에서 열리지 않게.
    if (before && !/\s$/.test(before)) return false;
    /**
     * **캐럿 뒤에 이미 있는 글**을 함께 넘긴다(요청) — 질의가 어디서 끝나는지
     * 그 값으로 안다. 이미 쓰인 글 앞에서 `/`를 치면 뒤의 글이 줄에 그대로
     * 남으므로, 이것이 없으면 질의가 그 글까지 삼켜 아무 항목도 맞지 않는다
     * (`안녕하세요` 앞에서 `/제목`을 쳐도 목록이 비던 이유다).
     */
    cb(at, text.slice(at + back));
    return true;
  };

  const commit = (final = false): void => {
    const el = ref.current;
    if (!el) return;
    // 마커가 생기거나 사라졌으면 **읽기 전에** 다시 그린다 — 그래야 화면과 값이
    // 같은 것을 말한다(`- `를 친 그 순간 `• `가 되는 자리).
    if (listBox && !composing.current) cellListSync(el);
    if (codeBox && !composing.current) codeSync(el);
    /**
     * **켜 두었던 서식을 방금 친 글자에 건다**(제보 2 — `armCaretMark` 머리말).
     * 걸면 박스를 이미 다시 그렸으므로 여기서 값을 읽을 필요가 없다.
     */
    if (!composing.current) {
      const marked = fireCaretMark(el);
      if (marked) {
        onChange(marked);
        return;
      }
    }
    const { text, rich } = domToRuns(el);
    let value: { text: string; rich: RichRun[] | null } = { text, rich };
    if (final) {
      const linked = applyAutoLinks(value);
      if (linked) {
        value = linked;
        redraw(el, value);
      }
    }
    // **떠나는 커밋에서만** 표식을 내린다 — 글쇠마다 내리면 그 뒤의 blur가
    // "고친 적 없음"으로 읽혀 주소를 링크로 바꿀 마지막 기회를 놓친다(실측).
    if (final) dirty.current = false;
    onChange(value.rich ?? textRuns(value.text));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    // 여러 줄이 칠해져 있으면 **문서 리스너가 맡는다**(`selecting` 머리말).
    if (selecting) return;
    /**
     * **캐럿 정책은 한 벌이다**(`caretPolicy.ts`) — 맵의 도형·메모 편집과 같은 함수를
     * 쓴다(요청: "텍스트 편집 정책은 하나의 묶음으로"). 지금 그 정책에 담긴 것은
     * 마커 건너뛰기와 [마커|내용] 행 오르내리기뿐이라, 마커가 박스 **안의 글자**인
     * 상자(= 표의 칸)에서만 할 일이 있다. 그래도 **모든** 줄에서 부른다 — 정책이
     * 늘어나면 그날로 모든 상자에 함께 걸리는 것이 이 배선의 요점이다.
     *
     * 칸을 *고르기만* 한 상태(`!listKeys`)에서는 마커 규칙을 끈다 — 그때 방향키는
     * 칸 사이를 옮겨 다니는 표의 것이다.
     */
    if (!readOnly && editCaretKeydown(el, e, { composing: e.nativeEvent.isComposing, list: !!(listBox && listKeys) })) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    /**
     * **칸 안의 목록**(`listBox`) — Tab·Shift+Enter·마커 Backspace를 여기서 받는다.
     *
     * 전파까지 끊는 이유: 표는 루트에서 Tab을 "다음 칸"으로 쓰고 있어, 막기만
     * 하면 들여쓰기와 칸 이동이 **둘 다** 일어난다.
     */
    if (listBox && listKeys && !readOnly && !e.nativeEvent.isComposing) {
      const mod = e.metaKey || e.ctrlKey || e.altKey;
      if (e.key === 'Tab' && !mod && cellListTab(el, e.shiftKey, onChange)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey && !mod && cellListBreak(el, onChange)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Backspace' && !mod && cellListBackspace(el, onChange)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    /**
     * **⌘A** — 브라우저는 이 편집 박스(한 줄) 안만 고른다. 이미 그 줄이 통째로
     * 골라져 있으면 두 번째 ⌘A는 **본문 전체**여야 한다(제보).
     */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') && onSelectAll) {
      const sel = window.getSelection();
      const len = lineLength(el);
      const whole = !len || (!!sel && !sel.isCollapsed && (sel.toString() ?? '').length >= len);
      if (whole && onSelectAll()) {
        e.preventDefault();
        return;
      }
    }
    /**
     * ⌘B·⌘I·⌘U·⌘⇧S는 **여기서 받지 않는다** — 에디터가 문서에서 받는다(제보 3).
     * 여러 줄을 칠하는 동안에는 어느 박스에도 초점이 없어 이 손이 닿지 않았고,
     * 그래서 같은 단축키가 한 줄에서만 들었다(`NoteEditor`의 같은 이름 효과).
     */
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (onEnter?.(caretOffset(el))) {
        e.preventDefault();
        return;
      }
    }
    /**
     * **Shift+Enter는 줄바꿈이다** — 브라우저 기본에 맡기면 엔진마다 `<br>`·`<div>`로
     * 갈리고, 글 끝에서는 빈 줄이 그려지지 않는다(보초 `<br>`이 없어서). 값에 `\n`을
     * 넣는 길 하나로 모은다(`softBreak`).
     */
    if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing && onSoftEnter) {
      if (onSoftEnter(caretOffset(el))) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === '/' && !e.nativeEvent.isComposing && onSlash) {
      // **글자는 막지 않는다**(`preventDefault` 금지 — `/`는 본문에 들어가야 한다).
      // 대신 전파만 끊어 전역 단축키 핸들러가 같은 키를 또 잡지 않게 한다(스펙 §3).
      // 이 시점의 캐럿은 `/`를 넣기 **전**이라 그 자리가 곧 `/`의 자리다.
      if (openSlashHere(0)) {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      }
    }
    if (e.key === '@' && !e.nativeEvent.isComposing && onMention) {
      // `/`와 같다 — 글자는 본문에 들어가야 하므로 막지 않고 전파만 끊는다.
      if (openMentionHere(0)) {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
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
    /**
     * **칩은 한 덩어리로 지운다**(제보: 날짜 칩을 Backspace로 지우면 글자가 하나씩
     * 지워진다). 캐럿 바로 앞(Backspace)·바로 뒤(Delete)에 칩이 붙어 있으면 그
     * 스팬을 통째로 걷고 캐럿을 그 자리에 놓는다.
     *
     * 마크업의 `contenteditable="false"`가 이미 캐럿을 안으로 들이지 않지만, 경계에서
     * 무엇이 지워지는가는 브라우저마다 갈린다 — 여기서 못박아야 어디서나 같다.
     * 값은 DOM을 고친 뒤 **다시 읽어** 만든다(이 화면의 저장 경로가 원래 그렇다).
     */
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.nativeEvent.isComposing && !readOnly) {
      const sel = window.getSelection();
      if (sel?.isCollapsed) {
        const at = caretOffset(el);
        const chip = chipAtCaret(el, at, e.key === 'Backspace' ? -1 : 1);
        if (chip) {
          const { start } = chipRange(el, chip);
          chip.remove();
          e.preventDefault();
          setLinearSelection(el, start, start);
          commit();
          return;
        }
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
    // 세로 이동이 아닌 키를 누르면 **목표 칸을 잊는다**(다음 위·아래는 그 자리에서 다시 잡는다).
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') vertX.current = undefined;
    /**
     * **Home·End는 「지금 이 시각 행의 끝」으로 못박는다**(제보).
     *
     * 브라우저 기본값이 **OS마다 다르다**: 윈도·리눅스의 크로뮴에서 이 키는 감긴
     * **행**의 처음·끝으로 가는데, macOS에서는 같은 키가 **편집 박스 전체**의
     * 처음·끝으로 간다(맥의 관례는 ⌘←·⌘→가 행이고 Home·End는 문서다). 그래서
     * 맥에서 문장 끝에 커서를 두고 Shift+Home을 누르면 감긴 문단이 **통째로**
     * 골라졌고, 이어지는 Shift+↑는 "한 행 더"가 아니라 이미 다 골라진 상태에서
     * 윗 블록으로 넘어갔다 — 제보의 그림이 정확히 이것이다.
     *
     * 그래서 어느 OS에서든 같게 만든다: 행의 끝은 **브라우저가 아는 그 자리**
     * (`lineboundary`)로 옮기고, `Shift`면 그리로 **늘린다**. ⌘·Ctrl이 붙은 것은
     * "문서의 처음·끝"이라는 다른 뜻이라 그대로 브라우저에 맡긴다.
     */
    if ((e.key === 'Home' || e.key === 'End') && !e.metaKey && !e.ctrlKey && !e.altKey && !composing) {
      const sel = window.getSelection();
      const modify = (sel as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null)?.modify;
      if (sel && typeof modify === 'function' && sel.focusNode && el.contains(sel.focusNode)) {
        e.preventDefault();
        try {
          modify.call(sel, e.shiftKey ? 'extend' : 'move', e.key === 'Home' ? 'backward' : 'forward', 'lineboundary');
        } catch {
          /* 못 옮겨도 캐럿은 제자리다 */
        }
        return;
      }
    }
    /**
     * **Shift+위/아래 = 줄을 넘는 선택**(제보: 여러 줄이 골라지지 않는다).
     *
     * 한 박스 **안**에서는 브라우저가 알아서 늘린다 — 우리는 그 박스의 가장자리 줄에
     * 닿았을 때만 넘겨받아 이웃 줄까지 이어 그린다(드래그 선택과 같은 길).
     */
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onSelectOut) {
      const sel = window.getSelection();
      if (sel?.focusNode && el.contains(sel.focusNode) && sel.anchorNode) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const m = caretMetrics(el, sel);
        // **목표 칸을 지킨다** — 세로로 오르내리는 동안에는 처음 잡은 세로줄을 쓴다
        // (짧은 행을 지날 때 칸이 그 행의 끝으로 줄어드는 것은 브라우저도 하지 않는다).
        const wantX = vertX.current ?? m.x;
        const at = charOffset(el, sel.focusNode, sel.focusOffset);
        const step = rowStepInLine(el, dir, wantX, m.y, at);
        if (step) {
          // **이 블록 안에 다음 행이 있다 — 우리가 옮긴다.** 브라우저에 맡기지 않는
          // 이유는 아래 `caretOnEdgeLine` 머리말의 반대쪽 이야기다: 맡기려면 먼저
          // 「가장자리인가」를 물어야 하고, 그 물음이 `Selection.modify`로 선택을
          // 움직였다 되돌리는 일이라 **브라우저가 기억하던 것**(affinity·목표 칸)이
          // 그 자리에서 흔들린다. 한 행씩 늘어나는 것이 OS·판올림과 무관하게 같아야
          // 한다는 요청이라(제보), 잴 수 있는 좌표로 우리가 직접 놓는다.
          e.preventDefault();
          try {
            sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, step.node, step.offset);
            vertX.current = wantX;
            return;
          } catch {
            /* 못 세우면 아래로 흘러 브라우저에 맡긴다 */
          }
        }
        /**
         * 더 갈 행이 **없을 때만** 이웃 블록으로 넘긴다(칠하기는 에디터가 맡는다).
         * 행은 있는데 짚지 못한 것(화면 밖이라 `caretRangeFromPoint`가 빈손)까지 넘기면
         * 화면 아래로 이어지는 긴 문단에서 다음 행 대신 **다음 블록**이 골라진다 —
         * 그때는 아무것도 하지 않고 브라우저의 기본 동작에 맡긴다(그쪽은 스크롤도 한다).
         */
        if (!step && hasRowBeyond(el, dir, m.y)) return;
        if (!step && onSelectOut(dir, wantX, m.y)) {
          vertX.current = wantX;
          e.preventDefault();
          return;
        }
      }
    }
    if (plainArrow && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onArrowOut) {
      const sel = window.getSelection();
      /**
       * **조합 중에는 캐럿이 접혀 있지 않다** — 윈도 한글 IME는 조합 중인 글자를
       * 골라 둔 모양으로 두므로 `isCollapsed`가 거짓이다(실측). 그것까지 받는다.
       */
      if (sel && (sel.isCollapsed || composing)) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (caretOnEdgeLine(el, sel, dir)) {
          const x = caretMetrics(el, sel).x;
          // 조합 중에는 **막지 않는다**(가로채면 조합이 끊긴 채 글자가 남는다) —
          // 브라우저가 조합을 끝낸 다음 차례에 건너뛴다. **다만 그때 가장자리에
          // 그대로 있는지 다시 본다**(제보 5) — 아래 `stillEdge` 머리말.
          if (composing) {
            setTimeout(() => {
              if (stillOnEdge(el, dir, 'line')) onArrowOut(dir, x);
            }, 0);
            return;
          }
          if (onArrowOut(dir, x)) e.preventDefault();
        }
      }
    }
    /**
     * **Shift+←/→ = 줄을 넘는 선택**(제보) — 글의 맨 끝에서 →, 맨 앞에서 ←.
     *
     * 자리는 **focus** 쪽으로 잰다: Shift로 고르는 동안 움직이는 끝이 그쪽이다
     * (앵커는 처음 자리에 남아 있다).
     */
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onSelectSide && !composing) {
      const sel = window.getSelection();
      if (sel) {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const len = lineLength(el);
        const at = caretOffset(el);
        if ((dir === 1 ? at >= len : at <= 0) && onSelectSide(dir)) {
          e.preventDefault();
          return;
        }
      }
    }
    if (plainArrow && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && onEdgeOut) {
      const sel = window.getSelection();
      if (sel && (sel.isCollapsed || composing)) {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const len = lineLength(el);
        const at = caretOffset(el);
        // 줄의 **맨 끝**에서 → · **맨 앞**에서 ←일 때만 넘어간다.
        if (dir === 1 ? at >= len : at <= 0) {
          if (composing) {
            setTimeout(() => {
              if (stillOnEdge(el, dir, 'char')) onEdgeOut(dir);
            }, 0);
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
      /**
       * 마커가 **글자**인 박스(표의 칸)임을 DOM에 남긴다 — 우리 밖에서 이 박스를 다시
       * 그리는 길(툴바 서식·링크·우클릭·단축키)이 같은 갈래를 고를 수 있게(`redrawBox`).
       */
      data-list-box={listBox ? '' : undefined}
      className="mf-note-line"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      // 소프트 키보드의 액션 키를 줄바꿈으로 못박는다 — 맵 편집 박스와 같은 이유
      // ("완료/이동"류를 고르면 그 키가 키보드를 내려 편집이 끝난다).
      enterKeyHint="enter"
      data-placeholder={placeholder ?? ''}
      onInput={(e) => {
        dirty.current = true;
        // 조합 중인 코드 조각은 **칠하기로** 흉내 낸다(아래 `paintArmedCode`).
        if (composing.current) paintArmedCode();
        commit();
        /**
         * **소프트 키보드의 `/`는 여기서 잡는다**(제보: 모바일에서 넣기 목록이 안 뜬다).
         *
         * 안드로이드 IME는 `keydown`에 글자를 싣지 않는다(`key: 'Unidentified'` ·
         * `keyCode: 229`) — 그래서 아래 `keydown`의 `e.key === '/'` 갈래가 손가락에서는
         * **한 번도 참이 되지 않았다**. 실제로 들어온 글자는 `input` 이벤트의 `data`에
         * 있으므로 그 값으로 같은 판정을 한 번 더 한다(마우스·하드웨어 키보드는 이미
         * `keydown`에서 열렸으므로, 그쪽에서는 `slashFor`가 이미 서 있어 두 번 열리지
         * 않는다 — 여는 쪽이 같은 자리를 다시 적을 뿐이다).
         */
        const data = (e.nativeEvent as InputEvent).data;
        // 여기서는 `/`가 **이미 들어간** 뒤라 캐럿이 한 칸 앞서 있다.
        if (data === '/' && !composing.current && onSlash) openSlashHere(1);
        // 손가락 키보드는 `keydown`에 글자를 싣지 않는다(`keyCode 229`) — `@`도 같다.
        if (data === '@' && !composing.current && onMention) openMentionHere(1);
      }}
      // 고친 적이 없으면 읽지 않는다(`dirty` 머리말) — 커서만 지나가도 저장되던 자리.
      onBlur={() => {
        // 줄을 떠나면 켜 두었던 서식도 잊는다 — 그 자리는 이 줄의 좌표였다.
        const el = ref.current;
        // 조합이 끝나지 않은 채 떠나는 길도 있다(다른 곳을 눌렀다) — 껍데기를 남기지 않는다.
        if (el) closeArmedAnchor(el);
        if (el) disarmCaretMark(el);
        paintCode(null);
        if (dirty.current) commit(true);
      }}
      onCompositionStart={() => {
        composing.current = true;
        /**
         * 켜 둔 서식이 있으면 **그 껍데기 안에서 조합하게** 한다(제보 8) — 그래야
         * 첫 글자부터 굵게·기울임이 보인다(`openArmedAnchor` 머리말).
         */
        const el = ref.current;
        if (el) openArmedAnchor(el);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        dirty.current = true;
        paintCode(null);
        // 껍데기의 폭 0 글자를 먼저 걷는다 — 그 뒤의 `fireCaretMark`가 세는 자리와
        // 값이 어긋나지 않게(`commit` 안에서 돈다).
        const el = ref.current;
        if (el) closeArmedAnchor(el);
        commit();
      }}
      onKeyUp={() => {
        // 캐럿이 마커 **안**에 떨어지면 내용 쪽으로 물린다 — 그 스팬에 친 글자는
        // 줄바꿈되지 않아 칸을 뚫고 나간다(맵과 같은 계약).
        const el = ref.current;
        if (listBox && el && !composing.current) snapCaretOffListMarker(el);
      }}
      onPaste={(e) => {
        // 여러 줄이 칠해져 있으면 **문서 리스너가 맡는다**(`selecting` 머리말).
        if (readOnly || selecting) return;
        const el = ref.current;
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!el || !text) return;
        const span = selectedRange(el);
        if (onPasteText?.(text, span.from, span.to)) {
          e.preventDefault();
          return;
        }
        /**
         * 목록·줄바꿈이 없는 평범한 한 줄 — **우리가 넣는다**(제보: 붙여넣은 글의
         * 크기가 서식을 걸었다 풀면 달라진다).
         *
         * 예전에는 여기서 손을 뗐다("되돌리기가 자연스럽다"는 이유로). 그러면 크롬이
         * 클립보드의 `text/html`을 그대로 심는데, 거기엔 **원본 앱의 계산된
         * `font-size`·`font-family`·`line-height`가 인라인으로** 붙어 온다. 모델은
         * 그런 것을 담지 않으므로(`domToRuns`는 아는 서식 아홉만 읽는다) **화면에만
         * 살아 있는 유령**이 되고, 나중에 서식을 걸어 `runsToHtml`로 다시 그리는
         * 순간 사라진다 — 그것이 "서식을 걸었다 취소하면 크기가 달라진다"의 정체다.
         *
         * 이제 붙인 직후에 **모델에서 다시 그린다**(`redraw`). 클립보드 HTML을 따로
         * 파싱하지 않는 이유: `domToRuns`가 이미 **아는 것만 남기는 화이트리스트**라,
         * 크롬이 무엇을 더 실어 와도 저절로 걸러진다(버릴 속성 목록을 따로 들고
         * 다니면 언젠가 샌다). 주소가 있으면 링크까지 이어서 건다.
         */
        e.preventDefault();
        pasteRuns(el, text, span.from, span.to, onChange, redraw);
        dirty.current = false;
      }}
      /**
       * **링크 글자를 눌러도 곧바로 열지 않는다**(제보 — 되돌린 결정).
       *
       * 한동안은 "누르면 열린다"였다(문서 편집기의 관례). 그런데 링크 판(이동·삭제)이
       * 생기고 나니 한 번의 클릭이 **두 가지 일**을 했다 — 브라우저가 열리면서 동시에
       * 판이 떴다. 그래서 여는 일은 **판의 「이동」 하나로 모았다**: 누르면 캐럿이
       * 놓이고(고치던 자리를 잃지 않는다) 그 자리에 판이 뜬다.
       */
      onFocus={() => {
        const el = ref.current;
        if (el) onFocusLine?.(el);
      }}
      onKeyDown={onKeyDown}
      /**
       * `break-spaces`는 **줄 끝의 공백도 줄바꿈에 센다**(제보 7).
       *
       * `pre-wrap`은 줄 끝에 남은 공백을 "넘쳐도 그만"으로 흘려 보낸다 — 그래서 줄
       * 끝에서 스페이스를 아무리 눌러도 캐럿이 그 자리에 붙박여 다음 줄로 넘어가지
       * 않았고(글자를 하나 쳐야 비로소 넘어갔다), 그동안 공백은 눈에 보이지 않게
       * 쌓였다. `break-spaces`는 그 공백들도 자리를 차지하게 하므로 폭을 넘는 순간
       * 다음 줄로 넘어간다 — 값(`\n`·공백 보존)은 `pre-wrap`과 같다.
       */
      style={{ outline: 'none', minHeight: '1.6em', whiteSpace: 'break-spaces', wordBreak: 'break-word', ...style }}
    />
  );
}


/**
 * 붙여넣은 글을 **우리 값으로** 넣는다 — 주소가 섞여 있으면 링크까지 건다(요청).
 *
 * 왜 붙여넣기에서만 하나: 타이핑 중에 실시간으로 걸면 반쯤 친 주소가 링크가 됐다
 * 풀렸다 하며 캐럿과 IME가 흔들린다(맵 편집이 같은 이유로 **커밋 때 한 번**만 건다).
 * 붙여넣기는 한 번에 끝나는 조작이라 그 흔들림이 없다.
 *
 * 값은 **글자 단위**로 다룬다(`runsToChars`) — 붙인 글에만 주소가 걸리는 것이 아니라
 * 이어 붙은 결과 전체를 다시 보므로, 앞뒤와 이어져 주소가 되는 경우도 잡힌다.
 * 이미 링크·멘션이 걸린 구간은 `applyAutoLinks`가 건너뛴다.
 */
function pasteRuns(
  el: HTMLElement,
  text: string,
  from: number,
  to: number,
  onChange: (runs: RichRun[]) => void,
  redraw: (el: HTMLElement, value: { text: string; rich: RichRun[] | null }) => void,
): boolean {
  try {
    /**
     * **끝의 줄바꿈을 지키며 읽는다**(`keepTrailing` — 제보 3: 코드 블록에서 Enter를
     * 누르고 붙여넣으면 새 줄이 아니라 **이전 줄 끝**에 들어간다).
     *
     * 기본값(`false`)은 끝의 줄바꿈을 **전부** 걷어 낸다 — 커밋이 쓰는 규칙이다. 그런데
     * 붙여넣을 자리(`from`)는 화면의 살아 있는 캐럿에서 잰 값이라 그 줄바꿈까지 세고
     * 있어서, 값에서만 사라지면 `from`이 글자 수를 넘어간다: `slice(0, from)`이 전부를
     * 집어 삼켜 **줄바꿈이 없어진 채** 글이 이어 붙었다. `true`는 보초 `<br>` 한 개만
     * 걷으므로(`codeHtml`·`softBreak`이 그 한 개를 붙인다) 두 좌표가 다시 맞는다.
     * 코드 블록뿐 아니라 Shift+Enter로 끝에 줄을 만든 문단도 같은 길이었다.
     */
    const chars = runsToChars(domToRuns(el, true));
    const next = [...chars.slice(0, from), ...[...text].map((ch) => ({ ch, b: false, c: null })), ...chars.slice(to)];
    const body = charsToRuns(next).filter((r) => r.t);
    const plain = { text: next.map((c) => c.ch).join(''), rich: body.length ? body : null };
    // 주소가 섞여 있으면 링크까지 이어서 건다 — 없으면 평문 그대로 다시 그린다.
    const value = (/[.:]/.test(text) ? applyAutoLinks(plain) : null) ?? plain;
    redraw(el, value);
    const spot = pointAt(el, from + [...text].length);
    const range = document.createRange();
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    onChange(value.rich ?? textRuns(value.text));
    return true;
  } catch {
    // 값을 못 만들면 아무것도 넣지 못한다 — 기본 동작은 이미 막았으므로 조용히 만다.
    return false;
  }
}

/**
 * 이 줄에서 **고른 구간**(없으면 캐럿 자리의 빈 구간) — 붙여넣기가 덮어쓸 자리다.
 *
 * `anchor`가 뒤일 수도 있으므로(아래에서 위로 끌었을 때) 늘 작은 쪽을 앞에 둔다.
 */
function selectedRange(el: HTMLElement): { from: number; to: number } {
  const sel = window.getSelection();
  const end = lineLength(el);
  if (!sel || !sel.focusNode || !el.contains(sel.focusNode)) return { from: end, to: end };
  const b = charOffset(el, sel.focusNode, sel.focusOffset);
  const a = sel.anchorNode && el.contains(sel.anchorNode) ? charOffset(el, sel.anchorNode, sel.anchorOffset) : b;
  return { from: Math.min(a, b), to: Math.max(a, b) };
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
  return lineLength(el);
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
    const len = lineLength(el);
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
 * 조합이 끝난 **다음 차례에** 캐럿이 아직 가장자리에 있는가 — 넘어가도 되는가.
 *
 * 왜 다시 보나(제보 5): 조합 중(`안녕`의 `녕` 밑에 줄이 그어진 상태)에 방향키를
 * 누르면 **두 칸**이 움직였다. IME는 그 키로 조합을 끝내는데, 크롬은 그 뒤에
 * `isComposing`이 꺼진 **두 번째 keydown**을 한 번 더 보낸다 — 그것이 정상 길을
 * 타 한 칸 넘어가고, 조합 때 걸어 둔 `setTimeout`이 한 칸 더 넘겼다.
 *
 * 그래서 미뤄 둔 그 일은 **조건이 아직 참일 때만** 한다: 초점이 이 박스에 그대로
 * 있고(이미 넘어갔으면 다른 박스다), 캐럿이 접혀 있고, 여전히 그 가장자리다.
 * 막지 않고 미루는 까닭은 그대로다 — 가로채면 조합이 끊긴 채 글자가 남는다.
 */
function stillOnEdge(el: HTMLElement, dir: -1 | 1, unit: 'char' | 'line'): boolean {
  if (!el.isConnected || typeof document === 'undefined' || document.activeElement !== el) return false;
  const sel = window.getSelection();
  // 접혀 있는지는 보지 않는다 — 윈도 IME는 조합 글자를 **골라 둔** 모양으로 둔다.
  if (!sel || !sel.focusNode || !el.contains(sel.focusNode)) return false;
  if (unit === 'line') return caretOnEdgeLine(el, sel, dir);
  const at = caretOffset(el);
  return dir === 1 ? at >= lineLength(el) : at <= 0;
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
  /**
   * **브라우저에게 직접 묻는다** — 「줄 끝으로/줄 처음으로」가 글의 끝(처음)에 닿으면
   * 지금 그 시각 줄에 있다는 뜻이다.
   *
   * 왜 사각형만으로는 안 되나(제보): 감긴 줄의 **랩 지점**은 글자 수로는 한 자리인데
   * 화면에는 둘이고(앞 행의 끝 · 뒷 행의 머리), `Range`의 사각형은 그 자리를 **늘 앞
   * 행으로 접어** 돌려준다(`probe-pitfalls` E12). 그래서 감긴 목록 줄의 두 번째 행
   * 머리에 캐럿을 두고 ↓를 누르면, 우리는 "아직 마지막 행이 아니다"로 읽어 넘기지
   * 않았고 브라우저는 "더 내려갈 행이 없다"며 **글의 끝으로** 캐럿을 보냈다.
   *
   * `modify`는 선택을 움직이므로 두 끝을 적어 두었다 되돌린다(`setBaseAndExtent`는
   * 방향까지 지킨다 — Shift로 고르는 중에도 안전하다).
   */
  const edge = lineBoundaryAt(el, sel, dir);
  if (edge >= 0) return dir === -1 ? edge <= 0 : edge >= lineLength(el);
  const c = caretRect(el, sel);
  const b = el.getBoundingClientRect();
  if (c && b.height > 0) {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || c.height;
    return dir === -1 ? c.top - b.top < lh * 0.6 : b.bottom - c.bottom < lh * 0.6;
  }
  // 좌표를 못 재는 환경(jsdom) — **글자 자리**로 가른다(감긴 줄은 구분하지 못한다).
  const at = caretOffset(el);
  return dir === -1 ? at <= 0 : at >= lineLength(el);
}
