// 공책이 보는 **일정** — 일정 블록(스펙 2절)과 우측 「일정」 탭(5절)이 함께 쓰는 원천.
//
// ## 왜 홈의 훅을 그대로 못 쓰나
//
// 일정 화면은 `useCalendarEntries(state)`로 칸반 마감까지 모으는데, 그 훅은 **홈 상태**
// (스페이스·공유받은 맵·썸네일 본문)를 먹는다. 에디터 라우트에는 그 상태가 없다 —
// 만들려면 홈이 하는 프리페치를 통째로 옮겨야 한다.
//
// 그래서 여기서는 **두 원천만** 든다(사용자 결정): 그리오 일정(0033)과 구글 캘린더.
// 칸반 마감은 다음 일이다 — 필요해지면 이 함수에 세 번째 배열을 더하면 되고, 그때
// 넘겨야 할 것은 "어느 보드를 볼 것인가"다.
//
// ## 구글 설정은 어디서 오나
//
// 홈은 `state.google`에 들고 있지만 에디터에는 그 상태가 없으므로 **워크스페이스 블롭을
// 직접 한 번 읽는다**(`SpaceStore.load`). 읽은 값은 모듈에 캐시해 둔다 — 공책을 여닫을
// 때마다 같은 블롭을 다시 받을 이유가 없고, 설정이 바뀌는 자리는 홈뿐이라 이 탭이 사는
// 동안은 변하지 않는다(바뀌었다면 홈을 지나온 것이고, 그때는 새로고침이 따른다).

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEntry } from '../home/calendar/entries';
import { eventEntries, googleEntries, holidayMap } from '../home/calendar/entries';
import type { HolidayInfo } from '../home/calendar/entries';
import { addDays, compareInDay, entriesOn, gridRange, partsOf, weekEndISO, weekStartISO } from '../home/calendar/model';
import { useCalendarEvents, type CalendarEventsApi } from '../home/calendar/useCalendarEvents';
import { googlePrefsOf, useGoogleCalendar, type GoogleCalendarApi, type GoogleCalendarPrefs } from '../home/calendar/useGoogleCalendar';
import { useSpaceStore } from '../../adapters/BackendContext';
import type { DocStore, ShareStore, SpaceStore } from '../../adapters/ports';
import { useDocStore, useShareStore } from '../../adapters/BackendContext';
import { calendarEntries, type CalendarSource } from '../home/calendar/entries';
import { coerceSpaces } from '../home/storage';

type GooglePrefBlob = { calendars: string[]; extra?: { id: string; name: string }[]; holiday?: string } | null;

/** 이 탭이 이미 읽어 둔 구글 설정 — 같은 블롭을 공책마다 다시 받지 않는다. */
let prefCache: { at: Promise<GooglePrefBlob> } | null = null;

/**
 * 칸반 마감을 훑기 위해 받아 둔 **보드 본문** — 이 탭이 사는 동안 한 번만 받는다.
 *
 * 값이 비싸다(문서 수만큼의 본문 조회). 그래서 ① 일정이 **실제로 필요할 때만**
 * 부르고(`enabled`) ② 탭 단위로 기억한다. 일정 화면도 같은 값을 프리페치해 쓰므로
 * (`previewDocs`) 새로운 비용의 종류는 아니다 — 새로운 것은 **공책에서도** 치른다는
 * 점이다.
 */
let boardCache: { at: Promise<{ sources: CalendarSource[]; bodies: Record<string, string> }> } | null = null;

/** 테스트가 탭 캐시를 비운다(`clearGoogleSessionCache`와 같은 자리). */
export function clearNoteAgendaPrefCache(): void {
  prefCache = null;
  boardCache = null;
}

/**
 * 칸반 **마감·기간**을 훑을 보드와 그 본문 — 일정 화면이 `state.previewDocs`로
 * 들고 있는 것과 같은 값을 공책 쪽에서 직접 모은다(제보: 공책의 날짜 칩 팝오버에
 * 종일 일정이 안 뜬다 — 그 둘은 칸반 카드의 마감이었다).
 *
 * 내 스페이스의 보드 + **공유받은 보드**를 함께 본다: 일정 화면이 그렇게 세므로
 * 여기만 빼면 두 화면의 「일정 N개」가 달라진다.
 */
function loadBoards(spaceStore: SpaceStore, docStore: DocStore, shareStore: ShareStore) {
  if (!boardCache) {
    boardCache = {
      at: (async () => {
        const [ws, shared] = await Promise.all([spaceStore.load().catch(() => null), shareStore.listSharedWithMe().catch(() => [])]);
        const sources: CalendarSource[] = [];
        for (const sp of coerceSpaces(Array.isArray(ws?.spaces) ? ws.spaces : [])) {
          if (sp.id === 'drive') continue; // Drive 데모에는 우리 문서가 없다
          for (const mp of Array.isArray(sp.maps) ? sp.maps : []) {
            if (mp.docId) sources.push({ docId: mp.docId, boardName: mp.title, spaceName: sp.name });
          }
        }
        for (const sm of shared) {
          sources.push({ docId: sm.documentId, boardName: '', spaceName: '공유받음', ...(sm.role === 'view' ? { readOnly: true } : {}) });
        }
        const bodies: Record<string, string> = {};
        // 하나가 실패해도 나머지는 그린다 — 빠진 보드의 마감만 빠진다.
        await Promise.all(
          sources.map(async (s) => {
            const raw = await docStore.loadPreview(s.docId).catch(() => null);
            if (raw) bodies[s.docId] = raw;
          }),
        );
        return { sources, bodies };
      })(),
    };
  }
  return boardCache.at;
}

function loadGooglePrefs(store: SpaceStore): Promise<GooglePrefBlob> {
  if (!prefCache) {
    prefCache = {
      at: store
        .load()
        .then((ws) => (ws?.google ?? null) as GooglePrefBlob)
        .catch(() => null),
    };
  }
  return prefCache.at;
}

export interface NoteAgenda {
  /** 이 달(격자 6주)의 일정 — 그리오 + 구글을 한 모양으로 합쳤다. */
  entries: CalendarEntry[];
  /** 공휴일(구글) — 날짜 색을 큰 달력과 같게 하려면 필요하다. */
  holidays: Record<string, HolidayInfo>;
  /**
   * 아직 **두 원천이 다 오지 않았는가** — 빈 목록과 "아직 모름"을 가른다.
   *
   * 구글까지 세는 이유(제보: 칩 팝오버가 깜빡인다): 예전에는 그리오 조회만 봤다.
   * 그러면 구글이 아직 오는 중인데도 `loading: false`가 되어 화면이 **다 받은 듯한
   * 목록**을 그리고(「일정 2개」), 곧 구글 것이 끼어들며 개수와 줄이 바뀐다. 구글에
   * 일정을 몰아 둔 사람에게는 "없다 → 있다"로 보이고, 그 사이에 팝오버를 닫으면
   * **종일 일정이 아예 없는 것처럼** 읽힌다(그 제보와 같은 뿌리다).
   *
   * 설정을 읽는 동안(`prefsReady` 전)도 아직 모르는 상태다 — 연동 여부 자체를
   * 모르므로 "연동 안 함"으로 단정하면 안 된다.
   */
  loading: boolean;
  /**
   * 두 원천의 **API 자체** — 목록만으로는 할 수 없는 일(상세를 고치고, 새 일정을
   * 만들고, 지우기)을 공책 안에서 하려면 필요하다(요청 5·6: 일정 페이지의 그 팝업을
   * 공책에서도).
   *
   * 훅을 한 번 더 부르지 않고 **여기서 내보내는** 이유: 조회가 두 벌이 되면 같은 달을
   * 두 번 받는다. 팝업 host는 팝업이 열렸을 때만 `enabled`로 켠다.
   */
  events: CalendarEventsApi;
  google: GoogleCalendarApi;
}

/**
 * 공책이 볼 **그 달**의 일정.
 *
 * @param enabled 블록도 탭도 없으면 끈다 — 공책을 열기만 해도 일정 왕복이 나가면
 *   글만 쓰는 사람이 매번 그 비용을 낸다.
 */
export function useNoteAgenda(y: number, m: number, enabled = true): NoteAgenda {
  const spaceStore = useSpaceStore();
  const docStore = useDocStore();
  const shareStore = useShareStore();
  const [prefs, setPrefs] = useState<GoogleCalendarPrefs>(() => googlePrefsOf(null));
  const [prefsReady, setPrefsReady] = useState(false);
  /** 칸반 마감의 원천 — 받아 오기 전에는 `null`("아직 모름")이다. */
  const [boards, setBoards] = useState<{ sources: CalendarSource[]; bodies: Record<string, string> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadGooglePrefs(spaceStore).then((g) => {
      if (!alive) return;
      setPrefs(googlePrefsOf(g));
      setPrefsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, spaceStore]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadBoards(spaceStore, docStore, shareStore).then((got) => {
      if (alive) setBoards(got);
    });
    return () => {
      alive = false;
    };
  }, [enabled, spaceStore, docStore, shareStore]);

  const events = useCalendarEvents(y, m, enabled);
  // 설정을 읽기 전에는 **끈 상태로** 돈다 — `enabled: false`인 prefs를 넘기면 훅이
  // 아무것도 부르지 않는다(연동하지 않은 계정과 같은 길).
  const google = useGoogleCalendar(y, m, enabled && prefsReady ? prefs : googlePrefsOf(null), () => {});

  const entries = useMemo(() => {
    if (!enabled) return [];
    const evs = eventEntries(events.events, gridRange(y, m));
    const gs = googleEntries(google.events);
    // 칸반 카드의 **마감·기간** — 일정 화면의 첫 번째 원천이다(제보: 공책에는 그것이
    // 빠져 있어 「3/3일째」·종일 항목이 통째로 보이지 않았다).
    const ks = boards ? calendarEntries(boards.sources, boards.bodies) : [];
    return [...ks, ...evs, ...gs].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : a.title < b.title ? -1 : 1));
  }, [enabled, events.events, google.events, boards, y, m]);

  const holidays = useMemo(() => holidayMap(google.events), [google.events]);

  /**
   * 구글을 기다리는가 — **`loading`이 아니라 `eventsServed`를 본다**(제보: 그리오
   * 일정이 먼저 뜬 뒤 스켈레톤으로 되돌아갔다가 둘이 함께 뜬다).
   *
   * `loading`은 `false`로 시작한다: 조회 효과가 돌기 전 한 프레임이 "다 받았다"로
   * 읽혀 그리오만 든 목록이 한 번 그려지고, 곧 `loading`이 참이 되며 스켈레톤으로
   * 되돌아갔다. `eventsServed`는 **그 달이 기억에 들어왔는가**라 그 틈이 없다.
   *
   * 설정을 읽기 전(`prefsReady` 전)도 아직 모르는 상태다 — 연동 여부 자체를 모르므로
   * "연동 안 함"으로 단정하면 안 된다.
   */
  const waitingGoogle = !prefsReady || !google.eventsServed;
  // 칸반도 기다린다 — 세 원천이 다 와야 「일정 N개」가 진실이다.
  return { entries, holidays, loading: enabled && (events.loading || waitingGoogle || boards === null), events, google };
}

// ── 일정 블록이 무엇을 보여 주는가(스펙 2-3) ───────────────────────────────

/** 블록이 든 보기 — `NoteBlock.sched`와 같은 네 값. */
export type SchedKind = 'today' | 'week' | 'month' | 'next';

export const SCHED_KINDS: { key: SchedKind; name: string; desc: string }[] = [
  { key: 'today', name: '오늘 일정', desc: '오늘 하루의 일정을 시간순으로' },
  { key: 'week', name: '이번 주 일정', desc: '일요일부터 토요일까지 날짜별로' },
  { key: 'month', name: '달력', desc: '이번 달 미니 달력 + 고른 날 일정' },
  { key: 'next', name: '다가오는 일정', desc: '오늘부터 가까운 일정 6개' },
];

/** 다가오는 보기가 담는 최대 개수(2-3의 "최대 6개"). */
export const SCHED_NEXT_MAX = 6;

export interface SchedDay {
  iso: string;
  entries: CalendarEntry[];
}

/**
 * 그 보기가 그리는 **날짜 줄들**(스펙 2-3의 「종류별 포함 규칙」).
 *
 * - `today` — 오늘 한 줄. 비어도 그린다(`일정 없음`이 뜬다)
 * - `week` — 오늘이 속한 주의 일~토. **빈 날은 건너뛰되 오늘은 비어도 남긴다**
 * - `next` — 오늘부터 앞으로, 일정을 최대 6개까지 담고 날짜별로 묶는다
 * - `month` — 고른 날 한 줄(달력은 화면이 따로 그린다)
 *
 * 한 날짜 안의 정렬은 `entriesOn`이 이미 한다(기간·종일이 위, 그다음 시각순).
 */
export function schedDays(kind: SchedKind, entries: readonly CalendarEntry[], today: string, selected?: string): SchedDay[] {
  if (kind === 'today') return [{ iso: today, entries: entriesOn(entries, today) }];
  if (kind === 'month') {
    const iso = selected || today;
    return [{ iso, entries: entriesOn(entries, iso) }];
  }
  if (kind === 'week') {
    const start = weekStartISO(today);
    const out: SchedDay[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(start, i);
      const day = entriesOn(entries, iso);
      if (day.length || iso === today) out.push({ iso, entries: day });
    }
    return out;
  }
  // `next` — 앞으로의 일정을 **개수로** 자른다(날짜로가 아니라). 기간 일정은 시작한
  // 날에 한 번만 센다(그 날 이후로도 덮지만, 목록에 같은 것이 여러 날 뜨면 6개가
  // 하나의 일정으로 채워진다).
  const ahead = entries
    .filter((e) => (e.start ?? e.due) >= today || e.due >= today)
    .map((e) => ({ e, at: (e.start ?? e.due) >= today ? (e.start ?? e.due) : today }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : compareInDay(a.e, b.e)))
    .slice(0, SCHED_NEXT_MAX);
  const byDay = new Map<string, CalendarEntry[]>();
  ahead.forEach(({ e, at }) => byDay.set(at, [...(byDay.get(at) ?? []), e]));
  return [...byDay.entries()].map(([iso, list]) => ({ iso, entries: list.sort(compareInDay) }));
}

/** 머리의 제목(2-3의 2). */
export function schedTitle(kind: SchedKind, today: string): string {
  if (kind === 'month') {
    const at = partsOf(today);
    return at ? `${at.m}월 달력` : '달력';
  }
  return kind === 'today' ? '오늘 일정' : kind === 'week' ? '이번 주 일정' : '다가오는 일정';
}

/** 머리의 부제(2-3의 3) — 무엇을 세었는지까지 밝힌다. */
export function schedSubtitle(kind: SchedKind, entries: readonly CalendarEntry[], today: string): string {
  const at = partsOf(today);
  if (kind === 'today') {
    const n = entriesOn(entries, today).length;
    return at ? `${at.m}월 ${at.d}일 · ${n}개` : `${n}개`;
  }
  if (kind === 'week') {
    const a = partsOf(weekStartISO(today));
    const b = partsOf(weekEndISO(today));
    const n = schedDays('week', entries, today).reduce((s, d) => s + d.entries.length, 0);
    return a && b ? `${a.m}.${a.d} – ${b.m}.${b.d} · ${n}개` : `${n}개`;
  }
  if (kind === 'month') {
    const n = at ? entries.filter((e) => e.due.startsWith(`${at.y}-${String(at.m).padStart(2, '0')}`)).length : 0;
    return at ? `${at.y}년 ${at.m}월 · ${n}개` : `${n}개`;
  }
  const n = schedDays('next', entries, today).reduce((s, d) => s + d.entries.length, 0);
  return `오늘부터 가까운 ${n}개`;
}
