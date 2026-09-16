// 설치형 앱에서 **이미 배너로 알린 멘션**의 기억.
//
// 왜 필요한가: 알림 목록은 여러 계기로 다시 읽힌다(실시간 신호·주기 확인·탭 복귀).
// 그때마다 같은 배열이 새 객체로 오므로, "이번에 새로 온 것"을 React 상태만으로
// 가르면 **같은 멘션이 되풀이해서 뜬다**. 그리고 앱을 껐다 켜도 기억이 남아야
// 한다 — 안 그러면 실행할 때마다 밀린 멘션이 우르르 뜬다.
//
// 그래서 `mf_reminded`(일정 알림)와 같은 꼴로 localStorage에 둔다. **기기의 기억**인
// 것도 같은 이유다: 배너는 기기마다 뜨므로 기억도 기기마다다.

/** 이미 알린 알림 id → 알린 시각(ms). */
const KEY = 'mf_mention_announced';
/** 기억을 비우는 나이 — 하루. 그보다 늙은 멘션은 배너 대상이 아니다(아래 호출부). */
const TTL_MS = 24 * 60 * 60_000;
/** 기억 상한(오래된 것부터 버린다) — 저장소를 무한히 먹지 않게. */
const MAX = 300;

function read(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 이미 알렸나. **띄우기 바로 앞에서 저장소를 새로 읽는다** — 창이 여럿이면
 * (설치형 앱 + 같은 계정의 브라우저 탭) 각자 목록을 들고 있으므로, 메모리 상태로
 * 판단하면 같은 배너가 두 번 뜬다(`wasReminderFired`와 같은 판단).
 */
export function wasMentionAnnounced(id: string): boolean {
  return id in read();
}

/** 알린 것으로 적어 둔다. 여러 건을 한 번에 적는다(한 회차에 여럿이 올 수 있다). */
export function markMentionsAnnounced(ids: string[], now = Date.now()): void {
  if (!ids.length) return;
  try {
    const cur = read();
    for (const id of ids) cur[id] = now;
    // 늙은 것부터 비운다 → 그래도 넘치면 오래된 순으로 잘라 낸다.
    const fresh = Object.entries(cur).filter(([, at]) => now - at < TTL_MS);
    fresh.sort((a, b) => b[1] - a[1]);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(fresh.slice(0, MAX))));
  } catch {
    /* 저장소가 막힌 환경 — 이번 세션 동안 같은 배너가 다시 뜰 수 있지만, 그게
       "배너가 아예 안 뜬다"보다는 낫다. */
  }
}

/** 테스트용 — 기억을 비운다. */
export function resetMentionAnnounced(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 지울 수 없으면 그대로 둔다 */
  }
}
