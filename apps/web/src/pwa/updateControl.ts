import { useSyncExternalStore } from 'react';
import { mergedUpdateState, type MergedUpdate, type ShellUpdateState } from '../platform/shellUpdate';

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
//
// **껍데기(설치 파일)의 판도 여기 실린다.** 확인은 `UpdatePrompt`가 한 번만 하고
// 소비처 둘이 이 값을 읽는다 — 설정의 「버전 확인」 화면과 홈 LNB의 알림. 확인을
// 화면마다 하면 왕복이 그만큼 늘고, 두 화면이 서로 다른 답을 들 수 있다.

export interface UpdateStatus {
  /** 새 버전이 받아져 **대기 중**인가(적용하면 곧 리로드된다). */
  ready: boolean;
  /** 지금 확인하는 중인가. */
  checking: boolean;
  /** 적용 절차가 도는 중인가. */
  applying: boolean;
  /** 저장에 실패해 적용을 멈춘 상태 — 리로드하면 편집분이 사라진다. */
  saveBlocked: boolean;
  /**
   * 껍데기(설치 파일)의 판 — 설치형 앱에서만 채워진다. 브라우저·PWA에서는 `null`
   * 이고 그때는 아무도 버전 파일을 부르지 않는다.
   */
  shell: ShellUpdateState | null;
}

const EMPTY: UpdateStatus = { ready: false, checking: false, applying: false, saveBlocked: false, shell: null };

let status: UpdateStatus = EMPTY;
const listeners = new Set<() => void>();
/** 새 버전을 물어보는 함수(서비스워커 등록이 생기면 `UpdatePrompt`가 심는다). */
let checker: (() => void) | null = null;
/** 대기 중인 새 버전을 적용하는 함수 — 같은 컴포넌트가 심는다. */
let applier: (() => Promise<void> | void) | null = null;
/** 껍데기(설치 파일)의 판을 다시 묻는 함수 — 설치형 앱에서만 심긴다. */
let shellChecker: (() => void) | null = null;

/** 같은 상태인가 — 객체 신원이 아니라 **값**으로 견준다(매 확인마다 새 객체가 온다). */
function sameShell(a: ShellUpdateState | null, b: ShellUpdateState | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'available' && b.kind === 'available') return a.version === b.version && a.url === b.url;
  return true;
}

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function currentUpdateStatus(): UpdateStatus {
  return status;
}

/** 화면이 이 상태를 구독하는 관용구 — 소비처 둘이 같은 세 인자를 되풀이하지 않게. */
export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(onUpdateStatus, currentUpdateStatus, currentUpdateStatus);
}

/**
 * **화면과 껍데기를 합친 한 상태** — 소비처 둘(설정의 「버전 확인」, 홈 LNB 알림)이
 * 같은 답을 들게 이 자리에서 한 번 계산한다. 각자 합치면 한쪽만 고쳐진다.
 *
 * `status.shell`은 설치형 앱에서만 채워진다(`UpdatePrompt`가 셸이 없으면 묻지
 * 않는다) — 그래서 브라우저·PWA에서는 그대로 `null`이고 웹 쪽만 본다.
 */
export function useMergedUpdate(): MergedUpdate {
  const status = useUpdateStatus();
  return mergedUpdateState(status, updateControlsReady(), status.shell);
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
  if (
    next.ready === status.ready &&
    next.checking === status.checking &&
    next.applying === status.applying &&
    next.saveBlocked === status.saveBlocked &&
    sameShell(next.shell, status.shell)
  ) {
    return;
  }
  status = next;
  emit();
}

export function setUpdateShellChecker(fn: (() => void) | null): void {
  shellChecker = fn;
}

/**
 * 껍데기(설치 파일)의 판만 다시 묻는다 — 설정의 「버전 확인」 화면이 열릴 때.
 *
 * 웹 번들은 스스로 신선하다(서비스워커 등록·5분 주기·탭 복귀 확인). 껍데기는 그런
 * 고리가 없어서 앱 시작 때 한 번 물은 값이 며칠 묵을 수 있다 — 그 화면을 여는 것이
 * 곧 "확인해 달라"는 뜻이므로 이쪽만 다시 묻는다.
 */
export function checkShellUpdateNow(): void {
  shellChecker?.();
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
  // 껍데기는 서비스워커와 무관하게 확인할 수 있다 — `checker`가 없는 환경에서도
  // 이쪽은 물어본다(설치형 앱에서만 심겨 있다).
  shellChecker?.();
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
  shellChecker = null;
}
