// 표의 **클립보드** — 고른 칸·행·열·구역을 복사하고 붙여넣는다(요청 7·8).
//
// 예전에는 표 메뉴의 `복사`가 **칸 하나**만 읽고 `붙여넣기`가 **칸 하나**만 썼다.
// 행 레일을 골라 복사해도 앵커 칸의 글자 하나가 실렸고, 단축키는 아예 닿지 않았다.
//
// ## 두 벌로 싣는다
//
// - `text/plain` — **TSV**(칸은 탭, 행은 줄바꿈). 엑셀·구글 시트·노션이 모두 읽는
//   표의 공용어다. 그래서 우리 표를 그대로 시트에 붙일 수 있다.
// - `text/html` — 진짜 `<table>`이라 워드·메일에 붙이면 표로 온다. 거기에 칸마다
//   `data-mf-runs`(런 JSON)를 달아 **우리끼리는 서식이 온전히** 돌아온다. 남의
//   표를 붙여넣을 때는 그 속성이 없으므로 칸의 HTML을 읽어 런으로 옮긴다.
//
// 칸 안의 줄바꿈은 TSV에서 탭·줄바꿈과 섞이면 격자가 깨지므로 평문에서만 공백으로
// 접는다 — HTML 벌은 그대로 싣는다(우리끼리는 그쪽이 쓰인다).

import type { RichRun } from '@mindflow/mindmap-core';
import { runsText, textRuns } from '@mindflow/mindmap-core';
import { domToRuns, runsToHtml } from './richtextDom';
import type { ClipPayload } from './noteClipboard';

/** 고른 네모 — 두 모서리를 정렬해 담는다(`r0 ≤ r1`, `c0 ≤ c1`). */
export interface TableRect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 칸의 격자 — 행의 배열이고, 행은 칸(런 배열)의 배열이다. */
export type CellGrid = RichRun[][][];

/** 그 네모를 표에서 떠낸다 — 표 밖으로 나간 자리는 빈 칸으로 채운다. */
export function tableGridOf(rows: CellGrid | undefined, rect: TableRect): CellGrid {
  const out: CellGrid = [];
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    const row: RichRun[][] = [];
    for (let c = rect.c0; c <= rect.c1; c += 1) row.push(rows?.[r]?.[c] ?? textRuns(''));
    out.push(row);
  }
  return out;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 격자를 두 벌로 — 평문은 TSV, HTML은 런을 실은 진짜 표. */
export function tableClipboard(grid: CellGrid): ClipPayload {
  const plain = grid.map((row) => row.map((cell) => runsText(cell).replace(/\s*\n\s*/g, ' ')).join('\t')).join('\n');
  const body = grid
    .map((row) => `<tr>${row.map((cell) => `<td data-mf-runs="${esc(JSON.stringify(cell ?? []))}">${runsToHtml({ text: runsText(cell), rich: cell ?? null })}</td>`).join('')}</tr>`)
    .join('');
  return { plain, html: `<table data-mf-table="1"><tbody>${body}</tbody></table>` };
}

/** 칸 하나를 런으로 — 우리 표식이 있으면 그것을, 없으면 칸의 HTML을 읽는다. */
function cellRuns(td: HTMLElement): RichRun[] {
  const raw = td.getAttribute('data-mf-runs');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RichRun[];
    } catch {
      /* 남이 손댄 표식 — 아래 길로 물러선다 */
    }
  }
  const v = domToRuns(td);
  return v.rich ?? textRuns(v.text);
}

/**
 * 클립보드의 두 벌에서 격자를 읽는다 — 표가 아니면 `null`.
 *
 * HTML 벌에 `<table>`이 있으면 그쪽이 정확하다(칸 안의 줄바꿈·서식이 살아 있다).
 * 없으면 TSV로 본다 — **탭이나 줄바꿈이 있을 때만**이다. 그러지 않으면 낱말 하나를
 * 붙여넣는 평범한 일까지 "1×1짜리 표"로 보고 이 길로 끌어와, 글을 고치던 칸의
 * 캐럿 자리를 무시하고 칸을 통째로 덮어쓴다.
 */
export function parseTableClip(html: string, plain: string): CellGrid | null {
  if (html && typeof DOMParser !== 'undefined') {
    const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
    if (table) {
      const grid = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td, th')].map((td) => cellRuns(td as HTMLElement))).filter((row) => row.length > 0);
      if (grid.length) return grid;
    }
  }
  if (!plain || !/[\t\n]/.test(plain)) return null;
  return plain
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.split('\t').map((t) => textRuns(t)));
}

/**
 * 시스템 클립보드에서 격자를 읽는다 — **메뉴의 「붙여넣기」**가 쓴다.
 *
 * 단축키는 진짜 `paste` 이벤트를 타므로 이 길이 필요 없다(권한도 묻지 않는다).
 * 메뉴에는 그 이벤트가 없어 여기서 직접 읽어야 하고, 그래서 브라우저가 한 번
 * 물어볼 수 있다. HTML 벌을 못 읽는 환경에서는 평문 한 벌로 물러선다.
 */
export async function readTableClip(): Promise<CellGrid | null> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  let html = '';
  let plain = '';
  try {
    const items = (await nav?.clipboard?.read?.()) ?? [];
    for (const it of items) {
      if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
      if (it.types.includes('text/plain')) plain = await (await it.getType('text/plain')).text();
    }
  } catch {
    /* 권한이 없거나 `read`가 없는 환경 — 평문으로 물러선다 */
  }
  if (!html && !plain) {
    try {
      plain = (await nav?.clipboard?.readText?.()) ?? '';
    } catch {
      return null;
    }
  }
  return parseTableClip(html, plain);
}
