// 구글 캘린더 겹치기(PR5) — 화면이 쓰는 한 덩어리.
//
// 세 가지를 함께 들고 있다: **연결 상태**(토큰), **캘린더 목록**(설정 화면),
// **보이는 달의 일정**(달력·위젯). 셋이 서로를 필요로 하므로(토큰 없으면 목록도
// 일정도 없다) 한 훅에 둔다.
//
// 조회 구간은 Geurio 일정과 **같은 월 격자 6주**(`gridRange`)다 — 두 원천이 다른
// 구간을 보면 같은 화면에 있으면서 어떤 날은 한쪽만 차 있게 된다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gridRange } from './model';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  ensureGoogleToken,
  fetchCalendarList,
  GOOGLE_RECONNECT_MSG,
  GOOGLE_SCOPE_DIRECTORY,
  GOOGLE_SCOPE_OTHER_CONTACTS,
  GOOGLE_SCOPE_ROOMS,
  scopeSet,
  fetchEvents,
  googleWriteError,
  onTokenChange,
  readStoredToken,
  requestGoogleToken,
  revokeGoogleToken,
  storeToken,
  updateGoogleEvent,
  type GoogleCalendarMeta,
  type GoogleEvent,
  type GoogleEventDraft,
} from './googleCalendar';
import { fetchRooms, searchPeople as searchPeopleApi, type DirectoryPerson, type MeetingRoom } from './googleDirectory';
import { readGoogleClientId } from '../../auth/googleIdentity';

export interface GoogleCalendarApi {
  /** 이 배포에 구글 클라이언트 ID가 있는가 — 없으면 설정에 구획 자체를 그리지 않는다. */
  available: boolean;
  /** 사용자가 연동을 켰는가(워크스페이스 블롭). */
  enabled: boolean;
  /** 이 탭이 지금 토큰을 들고 있는가. */
  connected: boolean;
  calendars: GoogleCalendarMeta[];
  /** 사용자가 고른 캘린더 id — 설정 화면의 체크 상태가 이 값이다. */
  pickedIds: string[];
  events: GoogleEvent[];
  loading: boolean;
  /** 마지막 오류 문구(설정 화면이 보여 준다). */
  error: string | null;
  /** 사용자가 직접 누른 연결 — 동의 창이 뜬다. */
  connect: () => Promise<void>;
  /** 연동 끄기 — 토큰을 버리고 설정도 지운다. */
  disconnect: () => Promise<void>;
  /** 그 캘린더를 보이기/감추기. */
  toggleCalendar: (id: string) => void;
  /**
   * 권한을 다시 받아야 하는가 — 스코프를 넓힌 뒤 옛 토큰이 남은 경우다. 켜져
   * 있는데 쓸 수 없는 상태를 **화면이 말해야** 한다(조용히 죽으면 "저장이 안 되는데
   * 이유를 모르는" 상태가 된다).
   */
  needsReauth: boolean;
  /** 쓸 수 있는 캘린더만 — 새 일정의 목적지로 내놓는 목록. */
  writableCalendars: GoogleCalendarMeta[];
  /** 구글에 새 일정. 성공하면 `null`, 실패하면 사람이 읽을 문장. */
  createEvent: (calendarId: string, draft: GoogleEventDraft) => Promise<string | null>;
  updateEvent: (ev: GoogleEvent, draft: GoogleEventDraft) => Promise<string | null>;
  deleteEvent: (ev: GoogleEvent) => Promise<string | null>;
  /**
   * 사람을 **이름으로** 찾을 수 있는가 — 선택 스코프(`directory.readonly` /
   * `contacts.other.readonly`)를 받았을 때만 참이다. 거짓이면 화면은 검색을 걸지
   * 않고 이메일 직접 입력으로 남는다.
   */
  canSearchPeople: boolean;
  searchPeople: (query: string) => Promise<DirectoryPerson[] | null>;
  /**
   * 회의실을 불러올 수 있는가 — Admin SDK 스코프를 받았고 조직이 허용할 때만.
   * 거짓이면 회의실 구획은 검색 상자 대신 **안내 한 줄**로 남는다(결과가 영영 비는
   * 상자를 두지 않는다 — 구획 자체는 늘 보인다, 요청).
   */
  canPickRooms: boolean;
  /** 조직 회의실 — 한 번 받아 두고 화면에서 좁힌다. */
  rooms: MeetingRoom[];
  /** 회의실 조회가 끝났는가(성공·거절 불문) — 거짓이면 "불러오는 중"이다. */
  roomsReady: boolean;
  /** 회의실 목록을 아직 안 받았으면 지금 받는다(필드가 열릴 때 부른다). */
  loadRooms: () => void;
}

export interface GoogleCalendarPrefs {
  /** 연동을 켰는가(블롭에 `google` 키가 있는가). */
  enabled: boolean;
  calendars: string[];
}

/**
 * **이 탭이 이미 받아 본 것**(제보 #21 — 화면에 들어올 때마다 일정이 잠깐 비었다가
 * 나중에 떴다). 원인은 두 걸음짜리 사슬이다: 마운트마다 캘린더 목록부터 새로 받고,
 * 그것이 도착해야 비로소 일정을 받는다 — 그동안 화면은 빈 달력이다.
 *
 * 그래서 **한 번 받은 것을 탭이 기억한다**: 다시 들어오면 그것을 곧바로 그리고,
 * 새 값이 도착하면 조용히 갈아 끼운다(stale-while-revalidate). 대가는 "그 사이
 * 구글에서 지운 일정이 한 번 더 보일 수 있다"이고, 새로고침·계정 전환이면 비워진다
 * (메모리에만 산다 — 저장소에 두면 구글이 정본이라는 규칙이 흐려진다).
 */
let listCache: GoogleCalendarMeta[] | null = null;
const eventCache = new Map<string, GoogleEvent[]>();

/**
 * 계정이 바뀌거나 연동을 끄면 기억도 버린다 — 남의 계정 일정이 비칠 자리를 없앤다.
 * (탭 하나가 한 세션이므로, 새 탭을 흉내 내는 테스트도 이걸로 앞의 기억을 지운다.)
 */
export function clearGoogleSessionCache(): void {
  listCache = null;
  eventCache.clear();
}

/**
 * 이 소비처가 무엇을 필요로 하는가 — 조회는 공짜가 아니다.
 * - `events` 달력·위젯: 캘린더 목록 + 보이는 달의 일정
 * - `list` 설정 화면(열려 있을 때만): 목록만 — 그릴 달이 없다
 * - `off` 그 밖(문서 위젯·설정이 닫힌 상태): 아무 요청도 하지 않는다
 */
export type GoogleCalendarMode = 'events' | 'list' | 'off';

/**
 * @param prefs 워크스페이스 블롭의 설정(홈 상태가 들고 있다).
 * @param onPrefs 설정이 바뀌면 홈에 알린다 — 저장은 홈의 기존 자동저장이 한다.
 * @param mode 이 소비처가 무엇을 필요로 하는가(위 `GoogleCalendarMode`). 대시보드는
 *   위젯마다 이 훅을 지나므로 끄지 않으면 위젯 수만큼 조회가 나간다.
 */
export function useGoogleCalendar(
  y: number,
  m: number,
  prefs: GoogleCalendarPrefs,
  onPrefs: (next: GoogleCalendarPrefs | null) => void,
  mode: GoogleCalendarMode = 'events',
): GoogleCalendarApi {
  const available = useMemo(() => !!readGoogleClientId(), []);
  // 이 달을 그리는 데 필요한 값들 — 상태보다 먼저 구해 둔다(첫 렌더가 기억을 찾는다).
  const { from, to } = gridRange(y, m);
  const enabled = prefs.enabled;
  // 고른 캘린더 id를 문자열로 굳혀 둔다 — 배열은 렌더마다 새 참조라 effect가 매번 돈다.
  const picked = prefs.calendars.join(',');
  const cacheKey = `${picked}|${from}|${to}`;
  const [connected, setConnected] = useState(() => !!readStoredToken());
  // 기억이 있으면 **첫 렌더부터** 그것을 그린다 — 빈 달력이 한 프레임도 나가지 않는다.
  const [calendars, setCalendars] = useState<GoogleCalendarMeta[]>(() => listCache ?? []);
  const [events, setEvents] = useState<GoogleEvent[]>(() => eventCache.get(cacheKey) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  // 쓰기가 끝나면 이 값을 올려 보이는 달을 다시 받는다 — 화면에 남는 것은 언제나
  // **구글이 돌려준 것**이지 우리가 보낸 것이 아니다(구글이 정본).
  const [reloadTick, setReloadTick] = useState(0);
  // 승인된 선택 스코프 — 사용자가 동의 화면에서 일부만 체크했을 수도 있다.
  const [granted, setGranted] = useState<Set<string>>(() => scopeSet(readStoredToken()?.scope));
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  // 회의실은 **한 번만** 받는다. `null`=아직, `false`=못 받았다(조직이 막았다).
  const roomsLoadedRef = useRef(false);
  const [roomsDenied, setRoomsDenied] = useState(false);
  // 회의실 조회가 **끝났는가**(성공·거절 불문) — 회의실 구획이 "불러오는 중"을 가른다.
  const [roomsReady, setRoomsReady] = useState(false);
  // 토큰이 바뀌면(다른 인스턴스의 연결·재연결 포함) 다시 조회한다 — 토큰은 탭
  // sessionStorage에 살아서, 설정 모달에서 다시 연결해도 이 인스턴스는 계기가 없어
  // **새로고침해야 보였다**(제보). 아래 목록 effect의 의존성에 실린다.
  const [tokenTick, setTokenTick] = useState(0);
  useEffect(
    () =>
      onTokenChange(() => {
        if (aliveRef.current) setTokenTick((n) => n + 1);
      }),
    [],
  );

  /**
   * 계정에 딸린 캐시를 버린다 — 연결을 끊거나 **다른 계정으로 새로 연결**할 때.
   * 예전에는 회의실·스코프가 훅 상태에 남아, A 계정을 끊고 B를 연결해도 새 일정
   * 팝업에 **A의 회의실**이 계속 떴다(제보). 회의실 목록·승인 스코프는 토큰(계정)의
   * 부속이므로 토큰과 수명이 같아야 한다.
   */
  const resetAccountCache = useCallback(() => {
    clearGoogleSessionCache();
    roomsLoadedRef.current = false;
    setRooms([]);
    setRoomsDenied(false);
    setRoomsReady(false);
    setGranted(new Set());
  }, []);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * 토큰을 꺼내 한 번 호출한다. 토큰이 없거나 401로 죽었으면 **새로 받지 않는다** —
   * GIS 토큰 요청은 조용한 갱신이라도 팝업을 열어서(googleCalendar.ts 머리 주석),
   * 화면을 여는 것만으로 구글 창이 뜨는 사고가 된다(제보: 재로그인 뒤 로그인 팝업).
   * 대신 `needsReauth`를 세워 화면이 "다시 연결" 버튼으로 말하게 한다.
   */
  const withToken = useCallback(async <T,>(run: (token: string) => Promise<T>): Promise<T | null> => {
    const first = ensureGoogleToken();
    if ('error' in first) {
      if (aliveRef.current) {
        setConnected(false);
        setNeedsReauth(true);
        setError(first.error);
      }
      return null;
    }
    if (aliveRef.current) setGranted(scopeSet(first.token.scope));
    try {
      return await run(first.token.accessToken);
    } catch (e) {
      // 401만 "토큰이 죽었다"다(만료·회수). 403은 **그 요청의 권한 문제**(그 캘린더에
      // 못 쓴다 등)라 연결을 끊을 이유가 없다 — 호출부가 문장으로 알린다.
      if ((e as { status?: number }).status !== 401) throw e;
      storeToken(null);
      if (aliveRef.current) {
        setConnected(false);
        setNeedsReauth(true);
        setError(GOOGLE_RECONNECT_MSG);
      }
      return null;
    }
  }, []);

  // ── 캘린더 목록 — 연동이 켜져 있으면 조용히 채운다(설정 화면이 바로 쓴다) ──
  useEffect(() => {
    if (!available || !enabled || mode === 'off') {
      setCalendars([]);
      setConnected(false);
      // 연동이 꺼졌다(다른 인스턴스의 disconnect 포함 — prefs는 블롭으로 공유된다).
      // 이 인스턴스가 들고 있던 계정 캐시(회의실·스코프)도 여기서 함께 버린다.
      resetAccountCache();
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await withToken((t) => fetchCalendarList(t)).catch(() => null);
      if (cancelled || !aliveRef.current) return;
      if (list) {
        listCache = list;
        setCalendars(list);
        setConnected(true);
        setNeedsReauth(false);
        setError(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, enabled, mode, withToken, resetAccountCache, tokenTick]);

  // ── 보이는 달의 일정 ────────────────────────────────────────────────────
  useEffect(() => {
    const ids = picked ? picked.split(',') : [];
    if (!available || !enabled || mode !== 'events' || ids.length === 0 || calendars.length === 0) {
      setEvents([]);
      return;
    }
    const metas = ids.map((id) => calendars.find((c) => c.id === id)).filter((c): c is GoogleCalendarMeta => !!c);
    if (metas.length === 0) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 받는 동안에는 **이 탭이 기억하는 것**을 그대로 둔다(#21) — 기억이 없을 때만 비운다.
    setEvents(eventCache.get(cacheKey) ?? []);
    void (async () => {
      const got = await withToken(async (t) => {
        // 캘린더 하나가 실패해도(권한 없음·삭제됨) 나머지는 그린다.
        const per = await Promise.all(metas.map((c) => fetchEvents(t, c, from, to).catch(() => [] as GoogleEvent[])));
        return per.flat();
      }).catch(() => null);
      if (cancelled || !aliveRef.current) return;
      // 조회가 실패하면(토큰 죽음 등) 기억한 것을 지우지 않는다 — 화면이 갑자기 비지 않게.
      if (got) eventCache.set(cacheKey, got);
      if (got) setEvents(got);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [available, enabled, mode, picked, calendars, from, to, cacheKey, reloadTick, withToken]);

  const connect = useCallback(async () => {
    setError(null);
    const res = await requestGoogleToken(true);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    // 새 연결은 **다른 계정일 수 있다** — 이전 계정의 회의실·스코프 캐시를 버리고
    // 이 토큰의 것으로 다시 시작한다(회의실은 다음에 필드가 열릴 때 다시 받는다).
    resetAccountCache();
    setConnected(true);
    setNeedsReauth(false);
    setGranted(scopeSet(res.token.scope));
    // 켜는 순간에는 **기본 캘린더 + 공휴일**만 고른다 — 캘린더가 스무 개인 사람에게
    // 전부 켜 주면 첫 화면이 남의 일정으로 뒤덮인다(직접 고르는 편이 낫다).
    try {
      const list = await fetchCalendarList(res.token.accessToken);
      if (!aliveRef.current) return;
      setCalendars(list);
      const seed = list.filter((c) => c.primary || c.holiday).map((c) => c.id);
      onPrefs({ enabled: true, calendars: seed });
    } catch {
      if (aliveRef.current) onPrefs({ enabled: true, calendars: [] });
    }
  }, [onPrefs, resetAccountCache]);

  const disconnect = useCallback(async () => {
    await revokeGoogleToken();
    if (!aliveRef.current) return;
    setConnected(false);
    setCalendars([]);
    setEvents([]);
    setError(null);
    // 이 계정의 회의실·스코프 캐시도 함께 — 다음 연결이 다른 계정일 수 있다(제보).
    resetAccountCache();
    onPrefs(null);
  }, [onPrefs, resetAccountCache]);

  /** 쓰기 하나 — 성공하면 보이는 달을 다시 받고 `null`, 실패하면 문장을 돌려준다. */
  const write = useCallback(
    async (run: (token: string) => Promise<void>): Promise<string | null> => {
      try {
        const done = await withToken(async (t) => {
          await run(t);
          return true as const;
        });
        if (!done) return '구글 권한이 없어요. 설정에서 다시 연결해 주세요.';
        if (aliveRef.current) setReloadTick((n) => n + 1);
        return null;
      } catch (e) {
        return googleWriteError(e);
      }
    },
    [withToken],
  );

  const createEvent = useCallback((calendarId: string, draft: GoogleEventDraft) => write((t) => createGoogleEvent(t, calendarId, draft)), [write]);
  const updateEvent = useCallback((ev: GoogleEvent, draft: GoogleEventDraft) => write((t) => updateGoogleEvent(t, ev, draft)), [write]);
  const deleteEvent = useCallback((ev: GoogleEvent) => write((t) => deleteGoogleEvent(t, ev)), [write]);

  const writableCalendars = useMemo(() => calendars.filter((c) => c.writable), [calendars]);

  // ── 선택 스코프로 열리는 두 기능 ─────────────────────────────────────────
  const canDirectory = granted.has(GOOGLE_SCOPE_DIRECTORY);
  const canOtherContacts = granted.has(GOOGLE_SCOPE_OTHER_CONTACTS);
  const canSearchPeople = canDirectory || canOtherContacts;

  const searchPeople = useCallback(
    async (query: string): Promise<DirectoryPerson[] | null> => {
      if (!canSearchPeople) return null;
      return withToken((t) => searchPeopleApi(t, query, { directory: canDirectory, otherContacts: canOtherContacts })).catch(() => null);
    },
    [canSearchPeople, canDirectory, canOtherContacts, withToken],
  );

  const loadRooms = useCallback(() => {
    if (roomsLoadedRef.current) return;
    if (!granted.has(GOOGLE_SCOPE_ROOMS)) {
      // 스코프가 없으면 기다릴 것도 없다 — 구획이 "불러오는 중"에 갇히지 않게 끝났다고 말한다.
      setRoomsReady(true);
      return;
    }
    roomsLoadedRef.current = true;
    setRoomsReady(false);
    void (async () => {
      const got = await withToken((t) => fetchRooms(t)).catch(() => null);
      if (!aliveRef.current) return;
      // `null`은 "물어볼 수 없다"(403·관리자 동의 필요) — 목록 없이 안내만 남는다.
      if (got === null) {
        console.warn('[geurio] 회의실 목록을 받지 못했어요 — Admin SDK API 사용 설정 또는 Workspace 관리자 승인이 필요할 수 있어요(backend.md §19)');
        setRoomsDenied(true);
      } else setRooms(got);
      setRoomsReady(true);
    })();
  }, [granted, withToken]);

  const toggleCalendar = useCallback(
    (id: string) => {
      const has = prefs.calendars.includes(id);
      onPrefs({ enabled: true, calendars: has ? prefs.calendars.filter((c) => c !== id) : [...prefs.calendars, id] });
    },
    [prefs.calendars, onPrefs],
  );

  return {
    available,
    enabled,
    connected,
    calendars,
    pickedIds: prefs.calendars,
    events,
    loading,
    error,
    connect,
    disconnect,
    toggleCalendar,
    needsReauth,
    writableCalendars,
    createEvent,
    updateEvent,
    deleteEvent,
    canSearchPeople,
    searchPeople,
    canPickRooms: granted.has(GOOGLE_SCOPE_ROOMS) && !roomsDenied,
    rooms,
    roomsReady,
    loadRooms,
  };
}
