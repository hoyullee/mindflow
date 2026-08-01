// 리스트 렌더링용 줄 분해 — `NodeLayer`(도형/개별도형)와 `mapPreview`(썸네일)가
// 같은 줄 모델을 쓰도록 하는 공유 헬퍼. 해석 규칙 자체는 코어 `list.ts`
// (`parseListPrefix`)가 단일 소스이고, 여기는 rich 런을 하드 줄로 쪼개고
// 리스트 줄의 마커를 떼어내는 접착 코드만 담는다.

import type { CSSProperties } from 'react';
import type { ListPrefix, Node, RichRun } from '@mindflow/mindmap-core';
import { parseListPrefix } from '@mindflow/mindmap-core';
import { escHtml, runsToHtml, setLinearSelection } from './richtextDom';
import type { RichTextValue } from './richtextDom';

export interface LineSeg {
  t: string;
  b?: boolean;
  c?: string | null;
  i?: boolean;
  s?: boolean;
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
          if (p) lines[lines.length - 1]?.push({ t: p, b: r.b, c: r.c, i: r.i, s: r.s });
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

/** 리스트 **항목 하나**([마커|내용] 한 덩어리)를 사용자 정렬대로 놓는 flex 정렬.
 *
 * 예전엔 연속한 항목을 `width: fit-content` 상자로 묶어 그 **상자만** 정렬했다
 * (마커를 한 열에 세우려고). 그런데 도형이 내용 크기에 맞춰 커지는 탓에 상자가
 * 움직일 여백이 5px밖에 안 남아 **정렬이 사실상 보이지 않았다**(제보: "정렬
 * 설정과 무관하게 좌측 정렬"). 그래서 워드프로세서 표준대로 **항목마다** 정렬한다
 * — 마커가 자기 텍스트와 함께 움직인다.
 * 소비처(에디터 렌더/편집 박스·썸네일 `mapPreview`·PNG `png.ts`)가 모두 같은
 * 규칙을 쓴다(그쪽은 각 항목의 폭 `itemW`로 같은 계산). */
export function listItemJustify(align?: CSSProperties['textAlign']): 'flex-start' | 'center' | 'flex-end' {
  return align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
}

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
  const renderSegs = (ln: ContentLine) =>
    ln.segs.map((sg, si) =>
      sg.b || sg.c || sg.i || sg.s ? (
        <span key={si} style={{ fontWeight: sg.b ? 800 : 'inherit', color: sg.c || 'inherit', fontStyle: sg.i ? 'italic' : undefined, textDecoration: sg.s ? 'line-through' : undefined }}>
          {sg.t}
        </span>
      ) : (
        <span key={si}>{sg.t}</span>
      ),
    );
  return (
    <span style={{ lineHeight, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {lines.map((ln, li) =>
        ln.list ? (
          // 항목([마커|내용]) 한 덩어리를 사용자 정렬대로 — 마커가 텍스트와 함께 움직인다.
          <span key={li} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: listItemJustify(align) }}>
            <span style={{ whiteSpace: 'pre', flexShrink: 0 }}>{ln.list.display}</span>
            <span style={{ flex: '0 1 auto', minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ln.segs.length ? renderSegs(ln) : '​'}</span>
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
  if (!lines.some((l) => l.list)) return runsToHtml(v);
  const justify = listItemJustify(align);
  const rowHtml = (ln: ContentLine): string => {
    const inner = runsToHtml({ text: ln.segs.map((s) => s.t).join(''), rich: ln.segs as RichRun[] }) || '<br>';
    if (!ln.list) return `<div>${inner}</div>`;
    return (
      `<div style="display:flex;align-items:flex-start;justify-content:${justify}">` +
      // `data-list-marker`: ① 캐럿이 마커 끝 경계에 오면 **내용 쪽**으로 보낸다
      //   (`setLinearSelection`) ② 사용자가 마커 스팬 안에 글자를 넣었는지 감지한다.
      //   마커 스팬은 `white-space: pre`라 그 안에 들어간 글자는 **줄바꿈되지 않아**
      //   도형을 뚫고 나간다(제보: 리스트에 긴 텍스트를 쓰면 도형을 벗어남).
      `<span data-list-marker style="white-space:pre;flex-shrink:0">${escHtml(ln.list.display)}</span>` +
      `<span style="flex:0 1 auto;min-width:0">${inner}</span>` +
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
