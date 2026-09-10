// 새 버전의 **상태와 조작**을 화면이 쓸 수 있게 내주는 자리.
//
// `UpdatePrompt`만 `virtual:pwa-register/react`(vite-plugin-pwa의 가상 모듈)에
// 닿을 수 있어서, 설정의 「버전 확인」 화면은 그 컴포넌트가 여기에 올려 두는 값을
// 읽는다. 상태를 컨텍스트가 아니라 모듈에 둔 이유는 소비처가 서로 멀고(토스트는
// 앱 루트, 버전 화면은 설정 모달 안) 값이 **탭 하나에 하나**이기 때문이다 —
// 프로바이더를 얹으면 그 사실이 오히려 흐려진다.
//
// 자동 적용 정책은 그대로 `updateGate`가 맡는다. 여기 있는 것은 **사용자가 직접**
// 확인하고 적용하는 손잡이뿐이다(요청: 수동으로 업데이트할 수 있게).

export interface UpdateStatus {
  /** 새 버전이 받아져 **대기 중**인가(적용하면 곧 리로드된다). */
  ready: boolean;
  /** 지금 확인하는 중인가. */
  checking: boolean;
  /** 적용 절차가 도는 중인가. */
  applying: boolean;
  /** 저장에 실패해 적용을 멈춘 상태 — 리로드하면 편집분이 사라진다. */
  saveBlocked: boolean;
}

const EMPTY: UpdateStatus = { ready: false, checking: false, applying: false, saveBlocked: false };

let status: UpdateStatus = EMPTY;
const listeners = new Set<() => void>();
/** 새 버전을 물어보는 함수(서비스워커 등록이 생기면 `UpdatePrompt`가 심는다). */
let checker: (() => void) | null = null;
/** 대기 중인 새 버전을 적용하는 함수 — 같은 컴포넌트가 심는다. */
let applier: (() => Promise<void> | void) | null = null;

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function currentUpdateStatus(): UpdateStatus {
  return status;
}

export function onUpdateStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** `UpdatePrompt`가 자기 상태를 올려 보낸다 — 바뀐 것이 없으면 알리지 않는다. */
export function publishUpdateStatus(patch: Partial<UpdateStatus>): void {
  const next = { ...status, ...patch };
  if (next.ready === status.ready && next.checking === status.checking && next.applying === status.applying && next.saveBlocked === status.saveBlocked) return;
  status = next;
  emit();
}

export function setUpdateControls(next: { check?: (() => void) | null; apply?: (() => Promise<void> | void) | null }): void {
  if ('check' in next) checker = next.check ?? null;
  if ('apply' in next) applier = next.apply ?? null;
}

/** 이 배포에서 새 버전을 다룰 수 있는가 — 서비스워커가 없는 환경(개발 서버)에서는 없다. */
export function updateControlsReady(): boolean {
  return checker !== null;
}

/**
 * **지금 확인한다.** `updateGate`의 `requestUpdateCheck`는 화면 진입마다 도는
 * 자동 확인이라 30초 스로틀이 걸려 있는데, 사용자가 직접 누른 것은 미룰 이유가 없다.
 */
export function checkForUpdateNow(): void {
  if (!checker) return;
  publishUpdateStatus({ checking: true });
  checker();
  // 새 버전이 **없으면** 아무 통지도 오지 않는다(SW는 변화가 있을 때만 알린다).
  // 그래서 확인이 끝났다는 사실은 시간으로 판단한다 — 스피너가 영영 도는 것보다
  // "최신입니다"를 한 번 말하는 편이 정직하다.
  window.setTimeout(() => publishUpdateStatus({ checking: false }), 1500);
}

/** 대기 중인 새 버전을 적용한다(곧 리로드된다). */
export async function applyUpdateNow(): Promise<void> {
  if (!applier) return;
  await applier();
}

/** 테스트 전용 — 모듈에 남은 것을 비운다. */
export function __resetUpdateControl(): void {
  status = EMPTY;
  listeners.clear();
  checker = null;
  applier = null;
}
