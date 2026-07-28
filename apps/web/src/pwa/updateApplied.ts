/**
 * "새 버전이 적용됐다"를 **리로드 너머로** 전달하는 표식.
 *
 * 적용은 곧 페이지 리로드다 — 그래서 "적용됐어요"를 적용한 쪽에서 바로 띄울 수가
 * 없다(띄우는 순간 사라진다). 적용 직전에 표식을 남기고, 새로 뜬 페이지가 그걸
 * 소비해서 알린다. 조용히 적용됐든 토스트에서 눌러 적용됐든 경로와 무관하게 같다.
 *
 * `sessionStorage`를 쓰는 이유: 리로드는 넘기지만 탭을 닫으면 사라진다 — 하루 뒤에
 * 다시 열었을 때 "업데이트됐어요"가 뜨는 일이 없다.
 */

const KEY = 'mf_update_applied_at';
/** 표식이 이보다 오래됐으면 무시한다 — 적용이 어긋나 리로드가 안 온 경우의 유령 알림 방지
 *  (적용 경로는 늦어도 6초 안에 리로드한다, `applyUpdate`의 워치독 참고). */
const FRESH_MS = 60 * 1000;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // 스토리지 차단(프라이버시 모드 등) — 알림만 못 뜨고 적용은 정상
  }
}

/** 적용(=리로드) 직전에 호출. */
export function markUpdateApplied(now = Date.now()): void {
  try {
    store()?.setItem(KEY, String(now));
  } catch {
    /* 용량 초과 등 — 알림은 포기하고 적용은 계속한다 */
  }
}

/** 새로 뜬 페이지에서 한 번만 true. 읽는 즉시 지운다(다음 리로드에 또 뜨지 않게). */
export function consumeUpdateApplied(now = Date.now()): boolean {
  const s = store();
  if (!s) return false;
  const raw = s.getItem(KEY);
  if (!raw) return false;
  try {
    s.removeItem(KEY);
  } catch {
    /* 못 지워도 아래 신선도 검사가 결국 걸러낸다 */
  }
  const at = Number(raw);
  return Number.isFinite(at) && now - at >= 0 && now - at < FRESH_MS;
}
