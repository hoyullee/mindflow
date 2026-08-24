/**
 * 대시보드 모델 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 상수·규칙을 옮겼다.
 *
 * 대시보드는 **문서가 아니라 배치**다: 위젯 하나는 (어느 문서를, 어떤 크기로)
 * 두 가지만 기억하고, 내용은 그 문서의 썸네일 본문(`previewDocs`)에서 그때그때
 * 읽는다. 그래서 문서를 고쳐도 대시보드 데이터는 바뀌지 않고, 문서가 지워지면
 * 위젯이 스스로 "찾을 수 없음"으로 표시된다(참조 무결성을 강제하지 않는다 —
 * 휴지통에서 복원하면 위젯도 되살아난다).
 *
 * 저장은 스페이스·최근 항목과 같은 per-user 워크스페이스 블롭에 얹는다(기기 간
 * 동기화). 예전 블롭에는 이 필드가 없으므로 전부 선택적이고, 없는 값은 "대시보드
 * 없음"으로 읽는다.
 */

import type { DocKindName } from '../viewModel';

export interface DashboardItemData {
  /** 위젯 인스턴스 id — 같은 문서를 두 대시보드에 올려도 서로 구별된다. */
  id: string;
  /** 대상 문서 id. */
  docId: string;
  /** 격자 크기 `"CxR"` (SIZES 중 하나). */
  size: string;
}

export interface DashboardData {
  id: string;
  name: string;
  items: DashboardItemData[];
}

/** 한 대시보드에 올릴 수 있는 위젯 수 — 디자인 원본의 CAP. 넘치면 피커가 막는다. */
export const DASH_CAP = 10;

/** 격자: 4열 × 행 152px(디자인 원본). 크기 선택지도 원본 그대로. */
export const DASH_COLS = 4;
export const DASH_ROW_PX = 152;
export const DASH_SIZES = ['1x1', '2x1', '1x2', '2x2', '3x2', '4x2', '3x3', '4x3'] as const;

/** 크기 선택지 옆의 한 줄 힌트(피커) — 디자인 원본 문구. */
export const DASH_SIZE_NOTE: Record<string, string> = {
  '1x1': '이름과 요약만',
  '2x1': '가로로 넓게',
  '1x2': '세로로 길게',
  '2x2': '내용까지 넉넉히',
  '3x2': '열 4개가 다 보여요',
  '4x2': '넓게, 날짜까지',
  '3x3': '열마다 카드를 더 많이',
  '4x3': '가장 크게, 실제 보드처럼',
};

/** 종류별 최소 크기 — 실제 콘텐츠가 제대로 보이는 최소 단위(디자인 원본).
 * 칸반은 열 4개가 눕는 3×2 아래로는 내용이 읽히지 않는다. */
export const DASH_MIN_SIZE: Record<DocKindName, [number, number]> = {
  kanban: [3, 2],
  map: [1, 1],
  board: [1, 1],
};

export const DASH_DEFAULT_SIZE: Record<DocKindName, string> = {
  kanban: '3x2',
  map: '2x2',
  board: '2x2',
};

export function parseSize(size: string): [number, number] {
  const m = /^([1-9])x([1-9])$/.exec(size);
  if (!m) return [2, 2];
  return [Math.min(DASH_COLS, Number(m[1])), Math.min(3, Number(m[2]))];
}

/** 이 종류가 놓일 수 있는 크기 목록(최소 크기 이상). */
export function sizesFor(kind: DocKindName): string[] {
  const [minC, minR] = DASH_MIN_SIZE[kind];
  return DASH_SIZES.filter((s) => {
    const [c, r] = parseSize(s);
    return c >= minC && r >= minR;
  });
}

/** 저장 블롭에서 읽은 값 검증 — 모양이 어긋난 항목은 조용히 버린다(스페이스의
 * `coerceSpaces`와 같은 태도: 깨진 블롭 하나가 홈 전체를 무너뜨리면 안 된다). */
export function coerceDashboards(raw: unknown): DashboardData[] {
  if (!Array.isArray(raw)) return [];
  const out: DashboardData[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const o = d as { id?: unknown; name?: unknown; items?: unknown };
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') continue;
    const items: DashboardItemData[] = [];
    if (Array.isArray(o.items)) {
      for (const it of o.items) {
        if (!it || typeof it !== 'object') continue;
        const w = it as { id?: unknown; docId?: unknown; size?: unknown };
        if (typeof w.id !== 'string' || !w.id || typeof w.docId !== 'string' || !w.docId) continue;
        const size = typeof w.size === 'string' && DASH_SIZES.includes(w.size as (typeof DASH_SIZES)[number]) ? w.size : '2x2';
        items.push({ id: w.id, docId: w.docId, size });
      }
    }
    out.push({ id: o.id, name: o.name, items: items.slice(0, DASH_CAP) });
  }
  return out;
}

/** 새 대시보드 이름 — "대시보드", "대시보드 2", … 겹치지 않는 첫 번호. */
export function nextDashName(existing: DashboardData[]): string {
  const names = new Set(existing.map((d) => d.name));
  if (!names.has('대시보드')) return '대시보드';
  for (let i = 2; ; i++) {
    const name = `대시보드 ${i}`;
    if (!names.has(name)) return name;
  }
}

/** 목록 안에서 한 칸 이동(위/아래·드래그 공용). 범위를 벗어나면 그대로. */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
