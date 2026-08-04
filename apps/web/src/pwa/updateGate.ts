import { useEffect, useRef, useSyncExternalStore } from 'react';
import { markUpdateApplied } from './updateApplied';

/**
 * 새 배포(대기 중인 서비스워커)를 **언제 적용할지** 화면이 스스로 신고하는 레지스트리.
 *
 * 배경: 예전엔 업데이트가 잡히면 어느 화면이든 무조건 "새 버전이 준비됐어요"
 * 토스트를 띄웠다(App 루트에 하나). 그런데 토스트의 존재 이유는 **"에디터가 열린 채
 * 리로드되면 편집이 끊긴다"** 하나뿐이라, 랜딩·약관처럼 잃을 게 없는 화면까지
 * 사용자에게 물어보고 있었다. 그래서 화면이 자기 위험도를 신고하고, 안전하면
 * 조용히 갈아끼운다.
 *
 * 라우트 경로로 판단하지 않는 이유: 같은 화면도 상태에 따라 위험도가 다르다
 * (로그인 = 빈 폼이면 안전 / 인증 코드 입력 중이면 위험). 그래서 경로가 아니라
 * **컴포넌트가 자기 상태로** 신고한다 — 라우터 의존도 없어진다.
 */

/** 지금 이 화면에서 리로드가 얼마나 위험한지. */
export type UpdateRisk =
  /** 잃을 게 없다 — 보고 있는 중이라도 즉시 적용. (랜딩·약관·빈 로그인 폼) */
  | 'safe'
  /** 눈에 띄지 않을 때만 — 탭이 백그라운드로 가면 적용, 보고 있으면 토스트. (홈·유휴 에디터) */
  | 'defer'
  /** 절대 자동 적용하지 않는다 — 토스트로만. (입력/편집 중) */
  | 'block';

/**
 * 적용 직전에 실행되는 정리 훅. **리로드해도 안전한가**를 돌려준다 —
 * `false`면 적용을 멈춘다(예: 저장에 실패해 리로드하면 편집분이 사라지는 경우).
 * `void`/`true`는 진행해도 좋다는 뜻.
 */
export type UpdatePrepare = () => Promise<boolean | void> | boolean | void;

interface Entry {
  risk: UpdateRisk;
  /** ref로 들고 있어야 호출부가 `useCallback`으로 감싸지 않아도 최신 클로저를 쓴다. */
  prepareRef: { current: UpdatePrepare | undefined };
}

const entries = new Set<Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

const SEVERITY: Record<UpdateRisk, number> = { safe: 0, defer: 1, block: 2 };

/**
 * 아무도 신고하지 않았을 때의 값. 보수적으로 `defer` — 신고를 깜빡한 새 화면이
 * 사용자가 보고 있는 도중 제멋대로 리로드되는 일은 없어야 한다.
 */
export const DEFAULT_RISK: UpdateRisk = 'defer';

/** 등록된 것 중 **가장 위험한** 값. 라우트 전환 중 두 화면이 겹쳐 등록된 순간에도 안전. */
export function currentRisk(): UpdateRisk {
  let worst: UpdateRisk | null = null;
  for (const entry of entries) {
    if (!worst || SEVERITY[entry.risk] > SEVERITY[worst]) worst = entry.risk;
  }
  return worst ?? DEFAULT_RISK;
}

/**
 * 등록된 모든 정리 훅을 실행하고 "전부 리로드해도 안전한가"를 돌려준다.
 * 하나라도 `false`를 돌려주거나 던지면 `false` — 판단이 안 서면 멈추는 쪽.
 */
export async function runPrepare(): Promise<boolean> {
  let ok = true;
  // 순회 중 등록이 바뀔 수 있으니 스냅샷으로 돈다.
  for (const entry of [...entries]) {
    try {
      if ((await entry.prepareRef.current?.()) === false) ok = false;
    } catch {
      ok = false; // 정리 중 예외 = 저장 여부 불명 → 리로드하지 않는다
    }
  }
  return ok;
}

/**
 * 지금 이 탭을 **묻지 않고** 리로드해도 되는지. 자동 적용 판단의 유일한 정의 —
 * 내 화면을 판단할 때도, 다른 탭의 질문에 답할 때도 같은 함수를 쓴다.
 */
export function canAutoApply(risk: UpdateRisk, hidden: boolean): boolean {
  if (risk === 'block') return false;
  if (risk === 'defer') return hidden; // 보고 있지 않을 때만 몰래 갈아끼운다
  return true;
}

// ---- 탭 간 조율 ----------------------------------------------------------
//
// 한 탭이 적용하면 `skipWaiting` → 새 SW가 기존 클라이언트를 넘겨받고, 업데이트를
// 대기 중이던 **모든 탭**이 `controlling` 이벤트로 리로드된다(vite-plugin-pwa의
// register.js). 즉 랜딩 탭이 조용히 자동 적용하면 옆 탭에서 편집 중이던 사람까지
// 리로드된다. 사용자가 직접 누른 경우는 본인 선택이니 그대로 두고, **자동** 적용만
// 다른 탭에 먼저 물어본다.

const CHANNEL_NAME = 'mf-update-gate';
/** 응답을 기다리는 시간. 같은 브라우저 안의 메시지라 왕복은 밀리초 단위다. */
const POLL_TIMEOUT_MS = 250;

function openChannel(): BroadcastChannel | null {
  // 미지원 브라우저(구형 Safari)·테스트 환경 → 조율 없이 단일 탭으로 간주.
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** 다른 탭의 "지금 적용해도 되나?" 질문에 답하기 시작한다. 정리 함수를 돌려준다. */
export function startPeerResponder(): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { t?: string; id?: string } | null;
    // 다른 탭이 적용했다 = 이 탭도 곧 강제로 리로드된다(skipWaiting → controlling).
    // 그 리로드 뒤에도 "적용됐어요"를 볼 수 있게 표식을 남긴다 — 이 탭은 적용을
    // 요청한 적이 없으니 오히려 더 알려 줘야 한다.
    if (data?.t === 'applied') {
      markUpdateApplied();
      return;
    }
    if (data?.t !== 'poll' || !data.id) return;
    // 괜찮으면 침묵한다 — 바쁜 탭만 손을 든다(응답이 없으면 곧 진행).
    if (canAutoApply(currentRisk(), document.visibilityState === 'hidden')) return;
    channel.postMessage({ t: 'busy', id: data.id });
  };
  return () => channel.close();
}

/** 적용한다고 다른 탭에 알린다 — 그 탭들도 곧 리로드되므로 표식을 남겨야 한다. */
export function notifyPeersApplied(): void {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage({ t: 'applied' });
  } catch {
    return; // 채널이 이미 닫힘 등 — 알림만 못 뜨고 적용은 정상
  }
  // 바로 닫지 않는다 — 구현에 따라 큐에 남은 메시지가 유실될 수 있고, 이 메시지는
  // 곧 강제 리로드될 다른 탭이 "왜 리로드됐는지" 알 수 있는 유일한 근거다.
  // (이 탭도 곧 사라지므로 지연 close는 사실상 정리 목적이다.)
  window.setTimeout(() => channel.close(), 1000);
}

/**
 * 다른 탭 중 하나라도 "지금은 곤란하다"고 답하는지. 자동 적용 직전에만 부른다.
 * BroadcastChannel은 보낸 객체 자신에게는 배달되지 않으므로 내 답을 내가 받는 일은 없다.
 */
export function anyPeerBusy(timeoutMs = POLL_TIMEOUT_MS): Promise<boolean> {
  const channel = openChannel();
  if (!channel) return Promise.resolve(false);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (busy: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.close();
      resolve(busy);
    };
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { t?: string; id?: string } | null;
      if (data?.t === 'busy' && data.id === id) finish(true);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    channel.postMessage({ t: 'poll', id });
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- 화면 진입 시 새 버전 확인 -------------------------------------------
//
// 서비스워커 확인은 **최초 페이지 로드**와 1시간 주기뿐이었다. 로그인 → 홈 → 에디터는
// 모두 클라이언트 사이드 이동이라, 그 사이에 배포가 나가도 최대 1시간 동안 눈치채지
// 못했다(제보: 홈·에디터 진입 때 새 버전이 있으면 알려 달라).
//
// 그래서 화면이 위험도를 신고할 때(= 그 화면에 들어올 때) 확인도 같이 요청한다.
// 발견 후 **적용 시점은 기존 정책이 그대로** 정한다 — 홈은 조용히 적용, 에디터는 토스트.

/** 실제 확인은 서비스워커 등록을 쥔 `UpdatePrompt`가 넣어 준다. */
let checker: (() => void) | null = null;
let lastCheckAt = 0;
/** 화면을 빠르게 오갈 때(그리고 StrictMode의 이중 마운트) 확인이 연달아 나가지 않게. */
const CHECK_THROTTLE_MS = 30 * 1000;

export function setUpdateChecker(fn: (() => void) | null): void {
  checker = fn;
}

/** 화면 진입 시 호출 — 스로틀 안이면 조용히 무시한다(`now`는 테스트에서 주입). */
export function requestUpdateCheck(now = Date.now()): boolean {
  if (!checker || now - lastCheckAt < CHECK_THROTTLE_MS) return false;
  lastCheckAt = now;
  try {
    checker();
  } catch {
    /* 확인 실패(오프라인 등)는 조용히 넘긴다 — 다음 진입이나 주기에 다시 시도한다 */
  }
  return true;
}

/**
 * 탭이 "다시 살아나는" 순간마다 새 버전을 확인한다 — 다른 탭에 갔다 돌아옴
 * (`visibilitychange`), 창 포커스 복귀(`focus`), 네트워크 복귀(`online`).
 *
 * 배경(제보: 새 배포 반응이 너무 늦다): 확인 시점이 페이지 로드·화면 진입·주기
 * 폴링뿐이라, 화면 이동 없이 머무는 탭은 다음 폴링까지 배포를 몰랐다. 배포를
 * 확인하러 **앱 탭으로 돌아오는 바로 그 순간**이 가장 자연스러운 확인 타이밍인데
 * 브라우저는 이때 스스로 확인해 주지 않는다. 연타(포커스가 visibility와 함께
 * 오는 경우 등)는 `requestUpdateCheck`의 스로틀이 거른다.
 */
export function startWakeChecks(): () => void {
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') requestUpdateCheck();
  };
  const onWake = (): void => {
    requestUpdateCheck();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onWake);
  };
}

/**
 * 이 컴포넌트가 떠 있는 동안의 리로드 위험도를 신고한다.
 *
 * @param risk 지금 상태 기준 위험도 — 상태가 바뀌면 그대로 다시 넘기면 된다.
 * @param prepare 적용 직전 정리(미저장 변경 flush 등). `false` 반환 시 적용 취소.
 */
export function useUpdateGuard(risk: UpdateRisk, prepare?: UpdatePrepare): void {
  const prepareRef = useRef<UpdatePrepare | undefined>(prepare);
  prepareRef.current = prepare;

  const entryRef = useRef<Entry | undefined>(undefined);
  if (!entryRef.current) entryRef.current = { risk, prepareRef };

  useEffect(() => {
    // 이 화면에 들어왔다 = 새 버전을 확인할 좋은 타이밍(위 `requestUpdateCheck` 참고).
    requestUpdateCheck();
    const entry = entryRef.current!;
    entries.add(entry);
    notify();
    return () => {
      entries.delete(entry);
      notify();
    };
  }, []);

  useEffect(() => {
    const entry = entryRef.current!;
    if (entry.risk === risk) return;
    entry.risk = risk;
    notify();
  }, [risk]);
}

/** 게이트를 읽는 쪽(`UpdatePrompt`)용. 위험도가 바뀌면 리렌더된다. */
export function useUpdateGate(): { risk: UpdateRisk; prepare: () => Promise<boolean> } {
  const risk = useSyncExternalStore(subscribe, currentRisk, () => DEFAULT_RISK);
  return { risk, prepare: runPrepare };
}

/** 테스트 전용 — 모듈 전역 레지스트리를 비운다. */
export function __resetUpdateGate(): void {
  entries.clear();
  checker = null;
  lastCheckAt = 0;
  notify();
}
