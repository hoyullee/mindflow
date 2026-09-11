import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { anyPeerBusy, canAutoApply, notifyPeersApplied, setUpdateChecker, startPeerResponder, startWakeChecks, useUpdateGate } from './updateGate';
import { consumeUpdateApplied, markUpdateApplied } from './updateApplied';
import { UpdateAppliedNotice } from './UpdateAppliedNotice';
import { UpdateOverlay } from './UpdateOverlay';
import { applyUpdate } from './applyUpdate';
import { publishUpdateStatus, setUpdateControls, setUpdateShellChecker } from './updateControl';
import { desktopBridge } from '../platform/desktopBridge';
import { checkShellUpdate } from '../platform/shellUpdate';

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
 * | `defer` | 홈·유휴 에디터 | 탭이 백그라운드일 때 적용 |
 * | `block` | 입력·편집 중 | 적용하지 않는다 |
 *
 * 그래서 대부분의 사용자는 아무것도 보지 않고 최신 버전이 되고, 실제로 끊기면
 * 곤란한 순간에는 **묻지 않고 기다린다**. 어떤 경로에서든 적용 전에 `prepare()`가
 * 돌아 미저장 변경을 먼저 저장한다 — 저장에 실패하면 리로드하지 않는다.
 *
 * **말을 거는 자리는 홈 LNB의 알림 하나다**(요청). 예전에는 화면 하단 토스트가
 * "새로고침할까요?"를 물었는데, 편집 중에 끼어드는 자리였고 알림 창구가 따로 생긴
 * 뒤로는 같은 소식이 두 곳에서 말해졌다. 이제 여기서는 **적용만** 하고, 대기 중인
 * 새 버전은 `updateControl`에 올려 두어 홈 LNB가 알리고 설정의 「버전 확인」이
 * 다룬다(에디터에는 표시가 없다 — 문서를 열려면 홈을 지나므로 적어도 한 번은 본다).
 *
 * 이 파일만 `virtual:pwa-register/react`(vite-plugin-pwa가 만들어 주는 가상 모듈)에
 * 의존한다. 그래서 정책 판단은 `updateGate`에, 화면이 읽는 상태는 `updateControl`에
 * 두어 테스트에서 가상 모듈 없이 그대로 다룰 수 있게 분리했다.
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
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 화면 진입(`useUpdateGuard`)마다 확인할 수 있게 등록 — 클라이언트 사이드 이동은
      // 페이지 로드가 아니라서 브라우저가 스스로 확인해 주지 않는다(`updateGate` 참고).
      setUpdateChecker(() => void registration.update());
      // 설정의 「버전 확인」 화면이 **직접** 물어볼 수 있게 같은 손잡이를 올려 둔다
      // (`updateGate`의 것은 화면 진입마다 도는 자동 확인이라 30초 스로틀이 걸려 있다).
      setUpdateControls({ check: () => void registration.update() });
      // **등록 직후 한 번 확인한다.** 등록 자체도 소프트 업데이트를 트리거하지만,
      // 이미 같은 SW가 등록돼 있으면 브라우저가 확인을 건너뛸 수 있다(제보: 배포
      // 됐는데 크롬에서 아무 반응이 없음 — 그 탭은 `waiting`도 `installing`도
      // 없었다). 여기서 명시적으로 물어보면 첫 화면에서 바로 잡힌다.
      void registration.update();
      // 장시간 열어 둔 편집 세션(브라우저가 스스로 확인하지 않을 수 있음) 대비.
      setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });

  const { risk, prepare } = useUpdateGate();
  const hidden = usePageHidden();
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
        // 편집 중인 탭이 있으면 미룬다 — 아래 재시도 타이머가 그 탭이 한가해질 때까지
        // 계속 노린다. 그동안 대기 중인 새 버전은 홈 LNB 알림이 들고 있으므로,
        // 기다리다 잊히는 대신 사용자가 직접 적용할 길이 열려 있다.
        if (auto && (await anyPeerBusy())) return;

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
        if (outcome === 'save-failed') setSaveBlocked(true); // 버전 화면·LNB가 사유를 알린다
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

  // 설정의 「버전 확인」 화면과 홈 LNB의 알림은 이 컴포넌트만 볼 수 있는 것(대기
  // 중인 새 버전·적용 진행·저장 실패)을 읽어야 한다 — 그 값을 모듈에 올려 둔다
  // (`updateControl`).
  useEffect(() => {
    publishUpdateStatus({ ready: needRefresh, applying, saveBlocked });
  }, [needRefresh, applying, saveBlocked]);

  // **껍데기(설치 파일)의 판도 여기서 확인한다.** 화면마다 확인하면 왕복이 그만큼
  // 늘고 두 화면이 서로 다른 답을 들 수 있다 — 한 번 물어 모듈에 올린다.
  // 브라우저·PWA에서는 셸이 없으므로 **버전 파일을 부르지도 않는다**.
  const checkShell = useCallback(() => {
    const b = desktopBridge();
    if (!b) return;
    publishUpdateStatus({ shell: { kind: 'checking' } });
    void checkShellUpdate(b.version).then((next) => publishUpdateStatus({ shell: next }));
  }, []);
  useEffect(() => {
    checkShell();
  }, [checkShell]);
  // 적용 손잡이 — 수동 적용은 피어를 묻지 않는다(본인 선택이므로 `auto: false`).
  useEffect(() => {
    setUpdateControls({ apply: () => apply(false) });
  }, [apply]);
  // 새 버전 확인에는 껍데기도 함께 태운다 — `지금 확인`은 사용자에게 **하나의
  // 동작**이다(버전 화면이 둘을 따로 부르지 않는다).
  useEffect(() => {
    setUpdateShellChecker(checkShell);
    return () => setUpdateShellChecker(null);
  }, [checkShell]);

  const canAutoLocally = !saveBlocked && canAutoApply(risk, hidden);

  useEffect(() => {
    // 자동 적용은 사용자가 무엇을 눌렀는지와 무관하게 **화면 위험도만** 본다.
    // 예전에 토스트의 X가 이 판단까지 걸어 잠갔을 때, 편집 중 한 번 닫은 장수 탭은
    // 이후의 **어떤 배포도** 스스로 적용하지 못했다(제보). 지금은 닫을 것이 없다 —
    // LNB 알림은 대기 중인 새 버전이 있으면 그냥 그 자리에 있다.
    if (!needRefresh || !canAutoLocally) return;
    void apply(true);
    // 다른 탭이 바빠 미뤄졌을 수 있다 — 그 탭이 한가해지는 대로 조용히 넘어가도록 재시도.
    const retry = window.setInterval(() => void apply(true), PEER_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [needRefresh, canAutoLocally, apply]);

  return (
    <>
      <UpdateOverlay visible={blocking} />
      <UpdateAppliedNotice visible={justUpdated} onDone={() => setJustUpdated(false)} />
    </>
  );
}
