// 리스트 렌더링용 줄 분해 — `NodeLayer`(도형/개별도형)와 `mapPreview`(썸네일)가
// 같은 줄 모델을 쓰도록 하는 공유 헬퍼. 해석 규칙 자체는 코어 `list.ts`
// (`parseListPrefix`)가 단일 소스이고, 여기는 rich 런을 하드 줄로 쪼개고
// 리스트 줄의 마커를 떼어내는 접착 코드만 담는다.

import type { CSSProperties } from 'react';
import type { ListPrefix, Node, RichRun } from '@mindflow/mindmap-core';
import { parseListPrefix } from '@mindflow/mindmap-core';
import { escHtml, runsToHtml, setLinearSelection } from './richtextDom';
import { RichSpan } from './richSpans';
import type { RichTextValue } from './richtextDom';

export interface LineSeg {
  t: string;
  b?: boolean;
  c?: string | null;
  i?: boolean;
  s?: boolean;
  /** 하이퍼링크 — 커밋된 렌더에서 밑줄 + Ctrl/⌘+클릭으로 열기(`RichSpan`). */
  href?: string;
}

export interface ContentLine {
  /** 줄의 내용 세그먼트(리스트 줄이면 마커 `raw`를 **뗀** 나머지). */
  segs: LineSeg[];
  /** 리스트 줄이면 마커 해석 결과(렌더러는 `display`를 마커 열에 그린다). */
  list: ListPrefix | null;
}

/** rich 런(또는 평문)을 하드 줄(`\n`) 단위로 쪼갠다 — `metrics.ts`의
 * `richLines`와 같은 규칙(+취소선 `s`까지 보존, 렌더용). */
function splitLines(node: Pick<Node, 'rich' | 'text'>): LineSeg[][] {
  if (node.rich && node.rich.length) {
    const lines: LineSeg[][] = [[]];
    node.rich.forEach((r) => {
      String(r.t)
        .split('\n')
        .forEach((p, i) => {
          if (i > 0) lines.push([]);
          if (p) lines[lines.length - 1]?.push({ t: p, b: r.b, c: r.c, i: r.i, s: r.s, href: r.href });
        });
    });
    return lines;
  }
  return String(node.text || '')
    .split('\n')
    .map((l) => (l ? [{ t: l }] : []));
}

/** 앞쪽 `nChars` 글자를 세그먼트 배열에서 제거(마커가 런 경계에 걸쳐도 안전). */
function stripLead(segs: LineSeg[], nChars: number): LineSeg[] {
  let left = nChars;
  const out: LineSeg[] = [];
  segs.forEach((sg) => {
    if (left <= 0) {
      out.push(sg);
      return;
    }
    if (sg.t.length <= left) {
      left -= sg.t.length;
      return;
    }
    out.push({ ...sg, t: sg.t.slice(left) });
    left = 0;
  });
  return out;
}

/** 노드 본문을 렌더 줄로 — 리스트 줄은 마커를 분리해 둔다. */
export function nodeContentLines(node: Pick<Node, 'rich' | 'text'>): ContentLine[] {
  return splitLines(node).map((segs) => {
    const lineText = segs.map((s) => s.t).join('');
    const list = parseListPrefix(lineText);
    return { segs: list ? stripLead(segs, list.raw.length) : segs, list };
  });
}

/** 평문(메모)을 렌더 줄로. */
export function plainContentLines(text: string): ContentLine[] {
  return String(text || '')
    .split('\n')
    .map((l) => {
      const list = parseListPrefix(l);
      const content = list ? l.slice(list.raw.length) : l;
      return { segs: content ? [{ t: content }] : [], list };
    });
}

/** 노드 본문의 텍스트 정렬 — `align`이 없으면 **가운데**가 기본이다.
 *
 * 렌더(`NodeLayer`)와 편집 중 재구성(컨트롤러 `applyListOp`/`applyPartial`)이
 * **같은 값**을 써야 한다. 예전엔 컨트롤러가 `n.align`을 날것으로 읽어
 * `undefined`(=좌측)로 그렸고, 그래서 들여쓰기 직후 리스트 묶음만 왼쪽으로
 * 튀었다(제보: "번호 매기기 후 들여쓰기 시 정렬이 틀어진다"). */
export function nodeTextAlign(n: Pick<Node, 'align'>): 'left' | 'center' | 'right' {
  return (n.align as 'left' | 'center' | 'right' | undefined) || 'center';
}

/** 리스트 줄의 가로 배치 — 정렬 설정과 무관하게 **항상 좌측**(Notion 방식,
 * 사용자 선정). 정렬 모델의 여정: ① fit-content 묶음 정렬(마커 열 유지) — 도형이
 * 내용에 딱 맞아 여백이 5px뿐이라 정렬이 안 보였다 ② 항목마다 정렬(Word 방식) —
 * 가운데 정렬에서 마커가 들쭉날쭉하고 하위 항목이 상위보다 왼쪽에 놓여 "이상해
 * 보인다"(제보). 지금은 리스트 줄은 좌측 고정, **평문 줄만** 도형 정렬을 따른다 —
 * 마커가 한 열에 서고 계층이 또렷하다. 소비처(에디터 렌더/편집 박스·썸네일
 * `mapPreview`·PNG `png.ts`)가 모두 같은 규칙(그쪽은 줄 왼쪽 = 텍스트 열 왼쪽). */
const LIST_ROW_JUSTIFY = 'flex-start';

/** 리스트가 있을 때만 쓰는 노드/메모 본문 블록 — 하드 줄마다 [마커|내용] flex 행.
 *
 * 행잉 인덴트는 px 계산 없이 flex로 얻는다: 마커 스팬(`pre`, 줄바꿈 없음)이
 * 첫 열을 차지하고 내용 스팬이 나머지 폭에서 감싸므로, 감긴 줄이 자연히 마커
 * 오른쪽에 정렬된다. `metrics.ts`의 wrapMeasure/countWrappedLines가 같은
 * 모델(내용 폭 = 전체 - 마커 폭)로 재기 때문에 박스 크기와 어긋나지 않는다.
 * 내용 스팬은 `flex: 0 1 auto` — 짧은 항목은 제 폭만 차지해야 `justifyContent`
 * (정렬)가 블록을 움직일 수 있다(`1 1 auto`면 항상 행을 꽉 채워 정렬이 죽는다).
 */
export function ListTextBlock({ lines, align, lineHeight = 1.35 }: { lines: ContentLine[]; align?: CSSProperties['textAlign']; lineHeight?: number }) {
  const renderSegs = (ln: ContentLine) => ln.segs.map((sg, si) => <RichSpan key={si} seg={sg}>{sg.t}</RichSpan>);
  return (
    <span style={{ lineHeight, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {lines.map((ln, li) =>
        ln.list ? (
          // 항목([마커|내용]) 한 덩어리를 사용자 정렬대로 — 마커가 텍스트와 함께 움직인다.
          <span key={li} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: LIST_ROW_JUSTIFY }}>
            {/* 마커는 선택 불가(편집 박스 `listEditHtml`과 같은 규칙) — 커밋 렌더가
                선택될 일은 드물지만 두 렌더가 같은 계약을 갖는다. */}
            <span style={{ whiteSpace: 'pre', flexShrink: 0, userSelect: 'none', WebkitUserSelect: 'none' }}>{ln.list.display}</span>
            {/* 내용 열은 항상 좌측 — 도형의 text-align(가운데 등)이 상속되면 **감긴
                줄만** 그 정렬을 따라 튀어 보인다(제보: 줄바꿈된 텍스트가 중앙 정렬).
                항목 위치는 justifyContent가 정하고, 열 안은 행잉 인덴트 기준이다
                (썸네일·PNG의 wrap 모델과 동일). */}
            <span style={{ flex: '0 1 auto', minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left' }}>{ln.segs.length ? renderSegs(ln) : '​'}</span>
          </span>
        ) : (
          <span key={li} style={{ display: 'block', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {ln.segs.length ? renderSegs(ln) : '​'}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * 편집 중(`NodeEditBox`의 contentEditable)에도 커밋 후와 **같은 모습**으로 그리는
 * HTML — 제보: 편집하는 동안엔 `- 항목` 원문이 보이다 확정해야 리스트가 됐다.
 *
 * 구조는 `ListTextBlock`과 같은 [마커|내용] flex 행이되, 마커가 **실제 텍스트**로
 * 들어간다(빈 스팬/의사요소가 아니라). 그래서 캐럿·선택 오프셋이 그대로 유지되고
 * `domToRuns`가 읽어 내는 텍스트도 화면과 정확히 일치한다. 이때 글머리 마커는
 * **그 단계의 표시 글리프**(`•`/`◦`/`▪`)로 치환되는데, `raw`와 글자 수가 같고
 * 그 글리프 자체가 유효한 마커라 오프셋·재파싱 모두 안전하다(입력 규칙: 0단계에서
 * `- `를 치면 곧바로 `• `, 1단계면 `◦ `가 된다).
 *
 * 트레이드오프: 마커 글자에 걸려 있던 부분 서식(색 등)은 이 재구성에서 사라진다.
 * 커밋 후 렌더(`ListTextBlock`)도 마커를 평문으로 그리므로 보이는 결과는 같다.
 */
export function listEditHtml(v: RichTextValue, align?: CSSProperties['textAlign']): string {
  const lines = nodeContentLines(v);
  // 리스트가 없으면 기존 렌더 그대로 — 리스트를 안 쓰는 편집의 DOM을 바꾸지 않는다.
  if (!lines.some((l) => l.list)) {
    const html = runsToHtml(v);
    // 마지막 줄이 비어 있으면 `<br>` **하나로는 화면에 나타나지 않는다**(브라우저가
    // 자기 placeholder를 하나 더 넣는 자리) — 직접 넣어 준다. 이게 없으면 줄 끝에서
    // Shift+Enter를 눌러도 줄이 바뀐 것처럼 보이지 않아 **두 번 눌러야** 했다(제보).
    // 읽을 때는 `domToRuns(el, true)`가 후행 줄바꿈 하나를 접어 원래 값으로 돌린다.
    return /\n$/.test(v.text || '') ? `${html}<br>` : html;
  }
  const rowHtml = (ln: ContentLine): string => {
    const inner = runsToHtml({ text: ln.segs.map((s) => s.t).join(''), rich: ln.segs as RichRun[] }) || '<br>';
    // 평문 줄만 도형 정렬을 따른다 — 리스트 줄은 아래에서 항상 좌측(Notion 방식).
    if (!ln.list) return `<div${align ? ` style="text-align:${align}"` : ''}>${inner}</div>`;
    return (
      `<div style="display:flex;align-items:flex-start;justify-content:${LIST_ROW_JUSTIFY}">` +
      // `data-list-marker`: ① 캐럿이 마커 끝 경계에 오면 **내용 쪽**으로 보낸다
      //   (`setLinearSelection`) ② 사용자가 마커 스팬 안에 글자를 넣었는지 감지한다.
      //   마커 스팬은 `white-space: pre`라 그 안에 들어간 글자는 **줄바꿈되지 않아**
      //   도형을 뚫고 나간다(제보: 리스트에 긴 텍스트를 쓰면 도형을 벗어남).
      // `user-select: none`: 마커·들여쓰기는 편집기가 관리하는 장식이라 선택
      //   하이라이트에 포함되면 "내가 지울 수 있는 글자"로 읽힌다(제보: 전체 선택
      //   시 리스트 마커까지 선택돼 보임). 값(텍스트)에는 그대로 있으므로 오프셋
      //   계산·domToRuns·커밋은 무변경 — 복사만 onCopy가 값에서 잘라 마커를 보존한다.
      `<span data-list-marker style="white-space:pre;flex-shrink:0;user-select:none;-webkit-user-select:none">${escHtml(ln.list.display)}</span>` +
      // 내용 열은 항상 좌측(커밋 렌더 `ListTextBlock`과 같은 이유 — 감긴 줄이
      // 도형 정렬을 상속해 중앙으로 튀지 않게).
      `<span style="flex:0 1 auto;min-width:0;text-align:left">${inner}</span>` +
      `</div>`
    );
  };
  return lines.map(rowHtml).join('');
}

/** 줄별 마커 구성을 요약한 문자열 — 편집 중 DOM 재구성이 **필요한 순간**(마커가
 * 생기거나 사라진 순간)만 감지하는 데 쓴다. 같은 서명이면 사용자가 글자만 친
 * 것이므로 innerHTML을 건드리지 않는다(캐럿·IME 보호). */
export function listSignature(v: RichTextValue): string {
  return nodeContentLines(v)
    .map((l) => (l.list ? l.list.display : ''))
    .join(' ');
}

/**
 * 편집 박스를 다시 그리고 선택을 복원한다 — innerHTML을 갈아 끼우는 **모든**
 * 경로(마운트·입력 재구성·리스트 연산·부분 서식)가 이 함수를 쓴다. 서명을
 * 엘리먼트에 새겨 두므로(`data-list-sig`) 어느 경로가 다시 그렸든 다음 입력의
 * 재구성 판정이 어긋나지 않는다.
 */
export function renderListEdit(el: HTMLElement, v: RichTextValue, align: CSSProperties['textAlign'], s0: number, s1: number): void {
  el.innerHTML = listEditHtml(v, align);
  el.dataset.listSig = listSignature(v);
  setLinearSelection(el, s0, s1);
}

/** 편집 DOM의 마커 스팬들이 실제로 담고 있는 글자 — 텍스트에서 계산한
 * `markerSignature`와 어긋나면 사용자가 마커 스팬 안에 글자를 넣은 것이다
 * (`white-space: pre`라 줄바꿈이 안 돼 도형을 벗어난다). 그때 다시 그려 고친다. */
export function domMarkerSignature(el: HTMLElement): string {
  return Array.from(el.querySelectorAll('[data-list-marker]'))
    .map((s) => s.textContent ?? '')
    .join('\u0000');
}

/** 텍스트에서 계산한 마커들 — `domMarkerSignature`와 짝. */
export function markerSignature(v: RichTextValue): string {
  return nodeContentLines(v)
    .filter((l) => l.list)
    .map((l) => l.list!.display)
    .join('\u0000');
}

/** 편집 박스에 새겨진 마지막 렌더의 줄 구성 서명(`renderListEdit` 참고). */
export function listSigOf(el: HTMLElement): string {
  return el.dataset.listSig ?? '';
}

/** 리스트 마커가 하나라도 있으면 렌더 줄을, 없으면 `null`(기존 렌더 경로 유지 —
 * 리스트 없는 문서의 렌더 트리를 조금도 바꾸지 않는 무회귀 가드). */
export function listLinesOf(node: Pick<Node, 'rich' | 'text'>): ContentLine[] | null {
  const lines = nodeContentLines(node);
  return lines.some((l) => l.list) ? lines : null;
}
