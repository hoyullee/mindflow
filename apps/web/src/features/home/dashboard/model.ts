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
  /** 대상 문서 id — **문서 위젯에만** 있다(캘린더 위젯은 가리킬 문서가 없다). */
  docId?: string;
  /** 문서가 아닌 위젯의 종류. 없으면 문서 위젯이다(옛 블롭 호환 — 그때는 모든
   *  위젯이 문서였다). */
  kind?: 'cal';
  /** 격자 크기 `"CxR"` (SIZES 중 하나). */
  size: string;
}

/** 위젯이 그리는 것 — 문서 세 종류 + 일정(문서가 아니다). */
export type DashWidgetKind = DocKindName | 'cal';

/** 이 위젯이 일정인가 — `kind`가 없으면 문서다(옛 블롭). */
export function isCalItem(it: Pick<DashboardItemData, 'kind'>): boolean {
  return it.kind === 'cal';
}

export interface DashboardData {
  id: string;
  name: string;
  /** 사용자가 고른 색(만들기 팝업의 여섯 중 하나) — LNB 행 글리프·히어로 점·다른
   *  대시보드 알약에 나타난다. 없으면 강조색(예전에 만든 대시보드). */
  color?: string;
  items: DashboardItemData[];
}

/** 한 대시보드에 올릴 수 있는 위젯 수 — 디자인 원본의 CAP. 넘치면 피커가 막는다. */
export const DASH_CAP = 10;

/** 격자: 4열 × 행 152px(디자인 원본). */
export const DASH_COLS = 4;
export const DASH_ROW_PX = 152;
/** 세로 최대 행 수 — 원본은 3행까지였고 요청으로 4행을 열었다(N×4). */
export const DASH_ROWS_MAX = 4;
/** 고르기 쉬운 **선택지**(피커·크기 순환·메뉴). 자유 리사이즈는 이 목록에 없는
 *  조합도 만들 수 있으므로 저장값 검증은 `isValidSize`가 맡는다. */
export const DASH_SIZES = ['1x1', '2x1', '1x2', '2x2', '3x2', '4x2', '1x4', '3x3', '4x3', '2x4', '3x4', '4x4'] as const;

/** 격자에 들어가는 크기인가 — 모서리 드래그가 만든 임의 조합(예: `2x3`)도 그대로
 *  저장·복원되어야 한다(예전엔 선택지 목록에 없으면 다음 로드에서 `2x2`로
 *  되돌아갔다). */
export function isValidSize(size: unknown): size is string {
  if (typeof size !== 'string') return false;
  const m = /^([1-9])x([1-9])$/.exec(size);
  return !!m && Number(m[1]) <= DASH_COLS && Number(m[2]) <= DASH_ROWS_MAX;
}

/** 크기 선택지 옆의 한 줄 힌트(피커) — 디자인 원본 문구. */
export const DASH_SIZE_NOTE: Record<string, string> = {
  '1x1': '이름과 요약만',
  '2x1': '가로로 넓게',
  '1x2': '세로로 길게',
  '1x4': '한 열로 아주 길게',
  '2x2': '내용까지 넉넉히',
  '3x2': '열 4개가 다 보여요',
  '4x2': '넓게, 날짜까지',
  '3x3': '열마다 카드를 더 많이',
  '4x3': '넓고 높게, 실제 보드처럼',
  '2x4': '세로로 아주 길게',
  '3x4': '높이까지 넉넉히',
  '4x4': '가장 크게, 화면을 채워요',
};

/** 종류별 최소 크기 — 실제 콘텐츠가 제대로 보이는 최소 단위(디자인 원본).
 * 칸반은 열 4개가 눕는 3×2 아래로는 내용이 읽히지 않는다. */
export const DASH_MIN_SIZE: Record<DashWidgetKind, [number, number]> = {
  kanban: [3, 2],
  map: [1, 1],
  board: [1, 1],
  // 일정은 1×1에서도 다가오는 마감 목록으로 뜻이 통한다(크기가 보기를 정한다).
  cal: [1, 1],
};

export const DASH_DEFAULT_SIZE: Record<DashWidgetKind, string> = {
  kanban: '3x2',
  map: '2x2',
  board: '2x2',
  // 기본은 주간 — 목록보다 정보가 많고 월간(4×3)만큼 자리를 차지하지 않는다.
  cal: '2x2',
};

/**
 * **크기가 보기를 정한다**(디자인 원본의 그 규칙) — 위젯 하나에 보기 셋.
 *
 * `4×3`+ = 월간(달력 + 옆 패널), `3×3`+ = 달력만, `1×3`+ = 마감 목록 + 미니 달력,
 * `2×2`+ = 주간(요일 일곱 줄), 그보다 작으면 목록. 고를 것을 따로 두지 않는 이유는
 * 크기가 이미 "얼마나 보여 줄까"를 말하기 때문이다.
 */
export type CalWidgetMode = 'month' | 'month-only' | 'week' | 'list' | 'list-mini';

export function calWidgetMode(cols: number, rows: number): CalWidgetMode {
  if (cols >= 4 && rows >= 3) return 'month';
  // 3열은 달력만 — 옆 패널까지 넣으면 달력 칸이 글자도 못 담을 만큼 좁아진다(요청).
  if (cols >= 3 && rows >= 3) return 'month-only';
  // 한 열 + 높이 — 위는 이번 주 마감, 아래는 일정 화면과 같은 미니 달력(요청).
  if (cols === 1 && rows >= 3) return 'list-mini';
  if (cols >= 2 && rows >= 2) return 'week';
  return 'list';
}

export function parseSize(size: string): [number, number] {
  const m = /^([1-9])x([1-9])$/.exec(size);
  if (!m) return [2, 2];
  return [Math.min(DASH_COLS, Number(m[1])), Math.min(DASH_ROWS_MAX, Number(m[2]))];
}

/** 이 종류가 놓일 수 있는 크기 목록(최소 크기 이상). */
export function sizesFor(kind: DashWidgetKind): string[] {
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
    const o = d as { id?: unknown; name?: unknown; color?: unknown; items?: unknown };
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') continue;
    const items: DashboardItemData[] = [];
    if (Array.isArray(o.items)) {
      for (const it of o.items) {
        if (!it || typeof it !== 'object') continue;
        const w = it as { id?: unknown; docId?: unknown; kind?: unknown; size?: unknown };
        if (typeof w.id !== 'string' || !w.id) continue;
        const size = isValidSize(w.size) ? w.size : '2x2';
        if (w.kind === 'cal') {
          items.push({ id: w.id, kind: 'cal', size });
          continue;
        }
        // `kind`가 없으면 문서 위젯 — 가리킬 문서가 없으면 버린다.
        if (typeof w.docId !== 'string' || !w.docId) continue;
        items.push({ id: w.id, docId: w.docId, size });
      }
    }
    out.push({ id: o.id, name: o.name, ...(typeof o.color === 'string' && o.color ? { color: o.color } : {}), items: items.slice(0, DASH_CAP) });
  }
  return out;
}

/** 목록 안에서 한 칸 이동(위/아래·드래그 공용). 범위를 벗어나면 그대로. */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
