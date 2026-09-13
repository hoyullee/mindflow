// 알림 설정을 **계정에서** 받아 이 기기에 반영한다(제보: 앱에서는 알림이 오지 않았다).
//
// ## 왜 이 모듈이 생겼나
//
// 알림을 켤지 말지가 기기(localStorage)에만 있어서, 같은 계정으로 크롬과 설치형
// 앱에 함께 로그인하면 **한쪽에만 알림이 왔다**. 갈리는 자리가 둘이었다:
//
// 1. `mf_reminders_google`(구글 일정도 알림)은 **기본이 꺼짐**이라, 크롬에서 켠
//    사람도 앱에서는 꺼진 채였다 — 앱은 구글에 조회조차 하지 않는다.
// 2. 스케줄러가 보는 **캘린더 거울**(`mf_gcal_remind_cals`)은 홈이 캘린더 목록을
//    받았을 때만 적힌다. 앱에서 일정 화면·연동 설정을 한 번도 열지 않았다면 비어
//    있고, 그러면 구글 알림이 0건이다.
//
// 둘 다 "계정이 정할 일을 기기가 들고 있던" 것이다. 이제 정본은 워크스페이스
// 블롭이고 여기서 그것을 기기에 내려 준다.
//
// ## 한 세션에 한 번
//
// 홈은 하이드레이션에서 블롭을 이미 읽으므로 그 값을 `noteSyncedReminderPrefs`로
// 넘겨 준다(왕복 0회). 에디터로 곧장 들어온 탭(딥링크·새로고침)만 스스로 한 번
// 읽는다. 그래서 흔한 길에서는 요청이 늘지 않는다.

import type { SpaceStore, WorkspaceData } from '../../adapters/ports';
import {
  ensureGoogleToken,
  fetchCalendarList,
  isHolidayCalendarId,
  storeReminderCalendars,
} from '../home/calendar/googleCalendar';
import {
  applySyncedReminderPrefs,
  googleRemindersEnabled,
  onRemindersEnabledChange,
  type SyncedReminderPrefs,
} from './reminderPrefs';

type GooglePrefs = WorkspaceData['google'];

/** 이 탭에서 이미 계정 값을 받았는가 — 홈과 에디터가 따로 읽지 않게. */
let synced = false;
/** 마지막으로 본 계정의 구글 설정(캘린더 거울을 다시 만들 때 쓴다). */
let googlePrefs: GooglePrefs = undefined;
/** 캘린더 거울을 이번 세션에 이미 만들었는가(같은 목록을 되풀이해 묻지 않게). */
let calsDerived = false;

/** 테스트용 — 모듈 상태를 비운다. */
export function resetReminderSync(): void {
  synced = false;
  googlePrefs = undefined;
  calsDerived = false;
}

/**
 * 스케줄러가 볼 **캘린더 거울**을 계정 값에서 만든다.
 *
 * 담는 것은 계정이 "보여 준다"고 고른 캘린더다(`google.calendars`) — 화면과 같은
 * 목록이라야 알림과 달력이 어긋나지 않는다. 공휴일 캘린더는 종일이라 알림이 없어
 * 빼고(조회할 이유가 없다), `defaultMinutes`는 일정 응답에 없으므로 목록 조회로
 * 채운다(대부분의 일정이 `useDefault`라 이 값이 없으면 무엇을 띄울지 알 수 없다).
 *
 * 토큰은 **팝업 없이** 받는다 — 못 받으면 조용히 물러난다(알림 때문에 동의 창이
 * 저절로 뜨면 안 된다).
 */
async function deriveReminderCalendars(): Promise<void> {
  if (!googleRemindersEnabled()) return;
  const ids = (googlePrefs?.calendars ?? []).filter((id) => !isHolidayCalendarId(id));
  if (!ids.length) {
    storeReminderCalendars([]);
    calsDerived = true;
    return;
  }
  const got = await ensureGoogleToken();
  if (!('token' in got)) return;
  const list = await fetchCalendarList(got.token.accessToken);
  const byId = new Map(list.map((c) => [c.id, c]));
  storeReminderCalendars(
    ids.map((id) => {
      const meta = byId.get(id);
      return { id, ...(typeof meta?.defaultMinutes === 'number' ? { defaultMinutes: meta.defaultMinutes } : {}) };
    }),
  );
  calsDerived = true;
}

function maybeDeriveCalendars(): void {
  if (calsDerived || !googleRemindersEnabled()) return;
  // 조회 실패(권한 회수·네트워크)는 조용히 넘긴다 — 다음 기회에 다시 만든다.
  void deriveReminderCalendars().catch(() => undefined);
}

/**
 * 계정 값을 받았다고 알린다 — 홈의 하이드레이션이 부른다(블롭을 이미 읽었다).
 *
 * `reminders`가 없는 블롭은 "아직 고른 적 없음"이라 기기 값을 덮지 않는다
 * (`applySyncedReminderPrefs`가 없는 필드를 건드리지 않는다).
 */
export function noteSyncedReminderPrefs(prefs: SyncedReminderPrefs | undefined, google: GooglePrefs): void {
  synced = true;
  googlePrefs = google;
  applySyncedReminderPrefs(prefs);
  maybeDeriveCalendars();
}

/**
 * 계정 값을 직접 읽어 반영한다 — **에디터로 곧장 들어온 탭**이 부른다.
 * 홈이 이미 넘겨 주었으면 아무것도 하지 않는다(요청을 두 번 내지 않게).
 */
export async function syncRemindersFromAccount(store: SpaceStore): Promise<void> {
  if (synced) return;
  synced = true;
  try {
    const ws = await store.load();
    googlePrefs = ws?.google;
    applySyncedReminderPrefs(ws?.reminders);
    maybeDeriveCalendars();
  } catch {
    // 조회 실패 — 이 기기의 캐시로 그대로 돈다(알림이 통째로 멎지 않게).
  }
}

/**
 * 설정에서 "구글 일정도 알림"을 **나중에 켰을 때**도 거울을 만든다.
 *
 * 켜는 순간이 곧 그 목록이 필요해지는 순간이다 — 이 구독이 없으면 켠 뒤 홈의
 * 일정 화면을 한 번 열어야 알림이 오기 시작한다(그게 이 제보의 절반이었다).
 */
onRemindersEnabledChange(() => {
  maybeDeriveCalendars();
});
