// 리스트 렌더링용 줄 분해 — `NodeLayer`(도형/개별도형)와 `mapPreview`(썸네일)가
// 같은 줄 모델을 쓰도록 하는 공유 헬퍼. 해석 규칙 자체는 코어 `list.ts`
// (`parseListPrefix`)가 단일 소스이고, 여기는 rich 런을 하드 줄로 쪼개고
// 리스트 줄의 마커를 떼어내는 접착 코드만 담는다.

import type { CSSProperties } from 'react';
import type { ListPrefix, Node } from '@mindflow/mindmap-core';
import { parseListPrefix } from '@mindflow/mindmap-core';

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

/** 리스트가 있을 때만 쓰는 노드/메모 본문 블록 — 하드 줄마다 [마커|내용] flex 행.
 *
 * 행잉 인덴트는 px 계산 없이 flex로 얻는다: 마커 스팬(`pre`, 줄바꿈 없음)이
 * 첫 열을 차지하고 내용 스팬(`flex:1`)이 나머지 폭에서 감싸므로, 감긴 줄이
 * 자연히 마커 오른쪽에 정렬된다. `metrics.ts`의 wrapMeasure/countWrappedLines가
 * 같은 모델(내용 폭 = 전체 - 마커 폭)로 재기 때문에 박스 크기와 어긋나지 않는다.
 * 리스트 줄은 정렬(align)과 무관하게 좌측 정렬 — 가운데 정렬된 불릿 목록은
 * 마커 열이 들쭉날쭉해져 리스트로 읽히지 않는다.
 */
export function ListTextBlock({ lines, align, lineHeight = 1.35 }: { lines: ContentLine[]; align?: CSSProperties['textAlign']; lineHeight?: number }) {
  return (
    <span style={{ lineHeight, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {lines.map((ln, li) => {
        const segs = ln.segs.map((sg, si) =>
          sg.b || sg.c || sg.i || sg.s ? (
            <span key={si} style={{ fontWeight: sg.b ? 800 : 'inherit', color: sg.c || 'inherit', fontStyle: sg.i ? 'italic' : undefined, textDecoration: sg.s ? 'line-through' : undefined }}>
              {sg.t}
            </span>
          ) : (
            <span key={si}>{sg.t}</span>
          ),
        );
        if (ln.list) {
          return (
            <span key={li} style={{ display: 'flex', alignItems: 'flex-start', textAlign: 'left' }}>
              <span style={{ whiteSpace: 'pre', flexShrink: 0 }}>{ln.list.display}</span>
              <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{segs.length ? segs : '​'}</span>
            </span>
          );
        }
        return (
          <span key={li} style={{ display: 'block', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {segs.length ? segs : '​'}
          </span>
        );
      })}
    </span>
  );
}

/** 리스트 마커가 하나라도 있으면 렌더 줄을, 없으면 `null`(기존 렌더 경로 유지 —
 * 리스트 없는 문서의 렌더 트리를 조금도 바꾸지 않는 무회귀 가드). */
export function listLinesOf(node: Pick<Node, 'rich' | 'text'>): ContentLine[] | null {
  const lines = nodeContentLines(node);
  return lines.some((l) => l.list) ? lines : null;
}
