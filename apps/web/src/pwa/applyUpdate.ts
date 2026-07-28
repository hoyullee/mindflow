/**
 * 새 버전 적용 절차 — 저장 → skipWaiting → 리로드까지의 한 판.
 *
 * `UpdatePrompt`에서 떼어낸 이유는 둘이다. 하나는 테스트(그쪽은
 * `virtual:pwa-register/react`에 묶여 있어 유닛 테스트에서 렌더할 수 없다).
 * 다른 하나는 **이 절차가 멈추면 토스트의 버튼이 죽는다**는 점 —
 * 여기서 일어날 수 있는 정지를 한 곳에 모아 전부 시간 제한을 건다.
 *
 * 제보된 증상: 에디터에서 토스트의 `새로고침`을 눌러도 아무 일도 일어나지 않고,
 * 그 뒤로는 몇 번을 눌러도 반응이 없다. 원인은 아래 두 정지 지점이었다.
 *
 * 1. **저장이 끝나지 않는다.** `prepare()`는 문서를 백엔드에 저장한다(에디터의
 *    `flushSave` → `DocStore.save` → 네트워크). 요청이 응답 없이 매달리면
 *    `await`가 영영 풀리지 않고, 호출부의 중복 실행 방지 플래그가 걸린 채로
 *    남아 이후 클릭이 전부 무시된다.
 * 2. **skipWaiting을 보냈는데 리로드가 오지 않는다.** 리로드는 vite-plugin-pwa가
 *    `controlling` 이벤트에 걸어 둔 핸들러가 한다. 그런데 대기 중이던 SW가 이미
 *    다른 탭의 적용으로 활성화돼 버렸다면 보낼 대상이 없어 그 이벤트가 오지
 *    않는다 — 토스트만 남고 버튼은 영영 무반응.
 *
 * 그래서 이 함수는 **반드시 끝난다**: 저장에 시간 제한을 두고, 리로드가 오지
 * 않으면 직접 리로드한다. 직접 리로드해도 안전한 이유는 여기까지 왔다는 게
 * 곧 `prepare()`가 "저장됐다"고 확인해 줬다는 뜻이기 때문이다.
 */

export type ApplyOutcome =
  /** skipWaiting을 보냈다 — 정상적으로는 이 시점에 페이지가 사라진다. */
  | 'applied'
  /** 저장이 실패했거나 제한 시간 안에 끝나지 않았다 — 리로드하지 않았다. */
  | 'save-failed';

export interface ApplyUpdateDeps {
  /** 미저장 변경을 저장하고 "리로드해도 안전한가"를 돌려준다(`updateGate.runPrepare`). */
  prepare: () => Promise<boolean>;
  /** 대기 중인 서비스워커를 활성화시킨다(`updateServiceWorker(true)`). */
  skipWaiting: () => void;
  /** 리로드가 오지 않을 때의 최후 수단. */
  reload: () => void;
  /** 저장을 기다려 주는 시간. 넘기면 실패로 본다. */
  prepareTimeoutMs?: number;
  /** skipWaiting 뒤 리로드를 기다리는 시간. 넘기면 직접 리로드한다. */
  reloadWatchdogMs?: number;
}

const PREPARE_TIMEOUT_MS = 8000;
const RELOAD_WATCHDOG_MS = 6000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function applyUpdate({
  prepare,
  skipWaiting,
  reload,
  prepareTimeoutMs = PREPARE_TIMEOUT_MS,
  reloadWatchdogMs = RELOAD_WATCHDOG_MS,
}: ApplyUpdateDeps): Promise<ApplyOutcome> {
  // 저장이 매달려도 절차 전체가 멈추지 않도록 — 시간이 넘으면 "저장 못 했다"로
  // 처리한다. 실패 쪽으로 기우는 게 맞다: 저장을 확인하지 못한 채 리로드하면
  // 편집분이 사라진다(로컬 복구본도 저장 성공 시에만 갱신된다).
  let saved: boolean;
  try {
    saved = await Promise.race([prepare(), wait(prepareTimeoutMs).then(() => false)]);
  } catch {
    saved = false;
  }
  if (!saved) return 'save-failed';

  skipWaiting();

  // 여기까지 오면 보통은 `controlling` 핸들러가 페이지를 갈아 끼워 아래 await는
  // 끝나지 않는다. 살아남았다면 그 이벤트가 오지 않은 것이므로 직접 리로드한다.
  await wait(reloadWatchdogMs);
  reload();
  return 'applied';
}
