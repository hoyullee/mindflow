import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { UpdateToast } from './UpdateToast';
import { anyPeerBusy, canAutoApply, notifyPeersApplied, setUpdateChecker, startPeerResponder, startWakeChecks, useUpdateGate } from './updateGate';
import { consumeUpdateApplied, markUpdateApplied } from './updateApplied';
import { UpdateAppliedNotice } from './UpdateAppliedNotice';
import { UpdateOverlay } from './UpdateOverlay';
import { applyUpdate } from './applyUpdate';

/**
 * 서비스워커 업데이트를 감시해 **적용 시점을 고르는** 연결층.
 *
 * 배경: 앱 셸(JS/CSS/HTML)이 SW에 프리캐시되므로, 새로 배포해도 이미 방문한
 * 브라우저는 **옛 번들**을 계속 실행한다. `registerType: 'prompt'`(vite.config)로
 * 새 SW를 대기 상태로 두고, 여기서 언제 갈아끼울지 정한다.
 *
 * 정책은 화면이 {@link useUpdateGuard}로 신고하는 위험도를 따른다:
 *
 * | 위험도 | 언제 | 동작 |
 * | --- | --- | --- |
 * | `safe` | 랜딩·약관·빈 로그인 폼 | 즉시 조용히 적용 |
 * | `defer` | 홈·유휴 에디터 | 탭이 백그라운드일 때 적용, 보고 있으면 토스트 |
 * | `block` | 입력·편집 중 | 토스트만 |
 *
 * 그래서 대부분의 사용자는 토스트를 보지 않고 최신 버전이 되고, 실제로 끊기면
 * 곤란한 순간에만 물어본다. 어떤 경로에서든 적용 전에 `prepare()`가 돌아
 * 미저장 변경을 먼저 저장한다 — 저장에 실패하면 리로드하지 않는다.
 *
 * 이 파일만 `virtual:pwa-register/react`(vite-plugin-pwa가 만들어 주는 가상 모듈)에
 * 의존한다. 그래서 화면 로직은 `UpdateToast`에, 정책 판단은 `updateGate`에 두어
 * 테스트에서 가상 모듈 없이 그대로 다룰 수 있게 분리했다.
 */

/**
 * 열어 둔 탭에서도 배포를 놓치지 않도록 주기적으로 새 버전을 확인.
 * 원래 1시간이었는데 화면 이동 없이 머무는 탭이 배포를 한참 몰랐다(제보) — 확인
 * 비용은 sw.js 몇 KB fetch(변경 없으면 304)뿐이라 5분으로 줄였다. 탭 복귀 순간의
 * 즉시 확인은 `startWakeChecks`가 따로 맡는다.
 */
const UPDATE_CHECK_MS = 5 * 60 * 1000;

/** 다른 탭이 바빠 자동 적용을 미뤘을 때 다시 물어보는 주기. */
const PEER_RETRY_MS = 20 * 1000;

/** 탭이 백그라운드인지 — `defer` 화면을 사용자 몰래 갈아끼울 수 있는 타이밍. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
}

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 화면 진입(`useUpdateGuard`)마다 확인할 수 있게 등록 — 클라이언트 사이드 이동은
      // 페이지 로드가 아니라서 브라우저가 스스로 확인해 주지 않는다(`updateGate` 참고).
      setUpdateChecker(() => void registration.update());
      // 장시간 열어 둔 편집 세션(브라우저가 스스로 확인하지 않을 수 있음) 대비.
      setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });

  const { risk, prepare } = useUpdateGate();
  const hidden = usePageHidden();
  const [dismissed, setDismissed] = useState(false);
  /** `prepare()`가 저장 실패를 보고한 상태 — 리로드하면 편집분이 사라지므로 멈춘다. */
  const [saveBlocked, setSaveBlocked] = useState(false);

  // 다른 탭의 "지금 적용해도 되나?" 질문에 답한다(모든 탭에 이 컴포넌트가 하나씩 있다).
  useEffect(() => startPeerResponder(), []);
  // 탭 복귀·포커스·네트워크 복귀 순간 새 버전을 확인 — 배포 후 앱으로 돌아오는
  // 바로 그 순간 잡히게(제보: 반응이 너무 늦다).
  useEffect(() => startWakeChecks(), []);

  /** 적용이 진행 중 — 버튼에 그대로 비춘다(누른 게 먹었는지 보이지 않으면 고장으로 읽힌다). */
  const [applying, setApplying] = useState(false);
  /** 전체 화면 dim(요청) — 실제 적용 절차(저장→skipWaiting→리로드)가 도는 동안만.
   * `applying`과 따로인 이유: 자동 적용은 피어(다른 탭) 확인에서 일찍 물러날 수
   * 있는데, 그 짧은 왕복까지 dim을 켰다 끄면 화면이 깜빡인다. */
  const [blocking, setBlocking] = useState(false);
  /** 직전 로드가 "새 버전 적용"이었는지 — 표식은 마운트 때 한 번만 소비한다. */
  const [justUpdated, setJustUpdated] = useState(false);
  useEffect(() => {
    if (consumeUpdateApplied()) setJustUpdated(true);
  }, []);

  // 자동 적용 이펙트와 토스트 버튼이 동시에 들어올 수 있어 중복 실행만 막는다.
  // ⚠️ 반드시 `finally`에서 풀어야 한다 — 예전엔 한 번 걸리면 안 풀리는 빗장이라,
  // 저장이 매달리거나 리로드가 오지 않으면 그 뒤 클릭이 전부 무시됐다(제보된
  // "새로고침이 안 눌린다"). 정지 지점 자체는 `applyUpdate`가 시간 제한으로 막는다.
  const applyingRef = useRef(false);
  const apply = useCallback(
    async (auto: boolean) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      setApplying(true);
      try {
        // 적용은 이 탭만의 일이 아니다 — skipWaiting이 다른 탭까지 리로드시킨다.
        // 그래서 **자동** 적용은 편집 중인 탭이 없는지 먼저 확인한다(사용자가 직접
        // 누른 경우는 본인 선택이므로 묻지 않는다).
        if (auto && (await anyPeerBusy())) return; // 아래 재시도 타이머가 다시 노린다

        setSaveBlocked(false);
        setBlocking(true); // 여기서부터 진짜 적용 — 화면을 덮어 클릭을 막는다
        const outcome = await applyUpdate({
          prepare,
          skipWaiting: () => {
            // 적용은 곧 리로드 — "적용됐어요"는 이 순간 띄울 수 없으므로 표식만 남기고
            // 새로 뜬 페이지가 알린다(`updateApplied`). 다른 탭도 함께 리로드되므로
            // 같이 알려 준다.
            markUpdateApplied();
            notifyPeersApplied();
            void updateServiceWorker(true);
          },
          reload: () => window.location.reload(),
        });
        if (outcome === 'save-failed') setSaveBlocked(true); // 토스트로 내려가 알린다
      } finally {
        applyingRef.current = false;
        setApplying(false);
        // 정상 경로는 리로드로 페이지째 사라진다 — 여기 도달 = 저장 실패로 멈췄거나
        // 리로드가 늦는 경우이므로 화면을 되돌려 준다.
        setBlocking(false);
      }
    },
    [prepare, updateServiceWorker],
  );

  const canAutoLocally = !saveBlocked && canAutoApply(risk, hidden);

  useEffect(() => {
    if (!needRefresh || dismissed || !canAutoLocally) return;
    void apply(true);
    // 다른 탭이 바빠 미뤄졌을 수 있다 — 그 탭이 한가해지는 대로 조용히 넘어가도록 재시도.
    const retry = window.setInterval(() => void apply(true), PEER_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [needRefresh, dismissed, canAutoLocally, apply]);

  return (
    <>
      <UpdateOverlay visible={blocking} />
      <UpdateAppliedNotice visible={justUpdated} onDone={() => setJustUpdated(false)} />
      <UpdateToast
      // 자동으로 적용될 상황이면 굳이 묻지 않는다 — 곧 조용히 갈아끼워진다.
      visible={needRefresh && !dismissed && !canAutoLocally}
      saveBlocked={saveBlocked}
      applying={applying}
      onRefresh={() => void apply(false)}
        onDismiss={() => {
          setDismissed(true);
          setNeedRefresh(false);
        }}
      />
    </>
  );
}
