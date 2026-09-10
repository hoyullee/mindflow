// 토스트의 X(닫기)와 자동 적용의 관계 — X는 "지금 묻지 마"일 뿐이다.
//
// 예전엔 X가 `dismissed`로 자동 적용까지 세션 내내 걸어 잠갔다: 편집 중 토스트를
// 한 번 닫은 장수 탭은 화면이 안전해져도(홈 유휴 등) 이후의 어떤 배포도 스스로
// 적용하지 못했고, 토스트도 다시 뜨지 않아 사용자는 탭을 닫았다 열어야 했다
// (제보: "업데이트 기능이 있는데 왜 수동으로?").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpdatePrompt } from './UpdatePrompt';
import { __resetUpdateGate, useUpdateGuard, type UpdateRisk } from './updateGate';
import { __resetUpdateControl, applyUpdateNow, checkForUpdateNow, currentUpdateStatus, updateControlsReady } from './updateControl';

const updateServiceWorker = vi.fn();
const setNeedRefresh = vi.fn();
/** 등록된 SW의 `update()` — "새 버전이 있나" 확인 요청. */
const swUpdate = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: { onRegisteredSW?: (url: string, reg: unknown) => void }) => {
    // 실제 훅은 등록이 끝나면 이 콜백을 부른다 — 그 자리에서 무엇을 하는지가
    // 이 파일의 검증 대상 중 하나다(등록 직후 즉시 확인).
    opts?.onRegisteredSW?.('/sw.js', { update: swUpdate });
    return { needRefresh: [true, setNeedRefresh], offlineReady: [false, vi.fn()], updateServiceWorker };
  },
}));

/** 화면 역할 — 게이트에 위험도를 신고한다(홈/에디터가 하는 일). */
function Guard({ risk }: { risk: UpdateRisk }) {
  useUpdateGuard(risk);
  return null;
}

beforeEach(() => {
  __resetUpdateGate();
  updateServiceWorker.mockClear();
  setNeedRefresh.mockClear();
  swUpdate.mockClear();
  __resetUpdateControl();
});
afterEach(() => cleanup());

describe('UpdatePrompt — 닫기(X)와 자동 적용', () => {
  it('토스트를 닫아도(block에서 X) 화면이 safe로 바뀌면 자동 적용된다(제보)', async () => {
    const { rerender } = render(
      <>
        <Guard risk="block" />
        <UpdatePrompt />
      </>,
    );
    // block: 자동 적용 없이 토스트가 뜬다 → 사용자가 X(나중에)로 닫는다.
    const dismiss = await screen.findByRole('button', { name: '나중에' });
    fireEvent.click(dismiss);
    expect(updateServiceWorker).not.toHaveBeenCalled();
    // X가 감지 플래그(needRefresh)까지 꺼 버리면 같은 버전은 다시 볼 근거가
    // 없다(같은 대기 SW로는 onNeedRefresh가 재발화하지 않는다) — 끄지 않는다.
    expect(setNeedRefresh).not.toHaveBeenCalled();

    // 화면이 안전해졌다(예: 편집을 마치고 홈으로) — X를 눌렀어도 조용히 적용된다.
    rerender(
      <>
        <Guard risk="safe" />
        <UpdatePrompt />
      </>,
    );
    // anyPeerBusy의 응답 대기(250ms)를 지나 skipWaiting까지 도달해야 한다.
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('등록되자마자 새 버전을 한 번 확인한다(제보: 배포됐는데 아무 반응이 없다)', () => {
    // 화면 가드(`useUpdateGuard`)는 화면 진입마다 따로 확인을 요청한다 — 그것과
    // 섞이지 않게 **가드 없이** 띄워서 등록 자체의 확인만 본다.
    render(<UpdatePrompt />);
    // 등록만으로도 브라우저가 소프트 업데이트를 돌리지만, 이미 같은 SW가 등록돼
    // 있으면 건너뛸 수 있다 — 첫 화면에서 우리가 직접 물어본다.
    expect(swUpdate).toHaveBeenCalled();
  });

  it('다른 탭 때문에 자동 적용이 미뤄지면 토스트로 알린다(조용히 멈춰 있지 않게)', async () => {
    // safe 화면은 원래 묻지 않고 조용히 적용한다 — 그런데 다른 탭이 편집 중이면
    // 적용이 계속 미뤄지면서 화면에는 아무 표시가 없었다(재시도만 20초마다).
    const channel = new BroadcastChannel('mf-update-gate');
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { t?: string; id?: string } | null;
      if (data?.t === 'poll') channel.postMessage({ t: 'busy', id: data.id });
    };
    try {
      render(
        <>
          <Guard risk="safe" />
          <UpdatePrompt />
        </>,
      );
      // 피어가 바쁘다고 답했으므로 적용은 미뤄지고, 대신 토스트가 뜬다.
      expect(await screen.findByRole('button', { name: '새로고침' }, { timeout: 3000 })).toBeTruthy();
      expect(updateServiceWorker).not.toHaveBeenCalled();
    } finally {
      channel.close();
    }
  });
});

// 설정의 「버전 확인」 화면은 이 컴포넌트만 볼 수 있는 것을 읽는다(가상 모듈에
// 닿을 수 있는 곳이 여기뿐이다) — 그 연결이 끊기면 그 화면은 영영 "확인할 수
// 없어요"만 말하고, 그것은 **빌드도 테스트도 통과하는** 종류의 고장이다.
describe('UpdatePrompt — 설정의 「버전 확인」에 상태·손잡이를 올린다', () => {
  it('확인·적용 손잡이가 서고, 대기 중인 새 버전을 상태로 알린다', async () => {
    render(
      <>
        <Guard risk="block" />
        <UpdatePrompt />
      </>,
    );
    await screen.findByRole('button', { name: '나중에' });

    // 손잡이가 있다 → 버전 화면이 버튼을 내줄 수 있다.
    expect(updateControlsReady()).toBe(true);
    // 대기 중인 새 버전(`needRefresh: true`)이 그대로 올라간다.
    await waitFor(() => expect(currentUpdateStatus().ready).toBe(true));

    // '지금 확인' — `updateGate`의 자동 확인(30초 스로틀)과 달리 즉시 물어본다.
    swUpdate.mockClear();
    checkForUpdateNow();
    expect(swUpdate).toHaveBeenCalledTimes(1);
    expect(currentUpdateStatus().checking).toBe(true);

    // '업데이트' — 수동 적용은 피어를 묻지 않고 곧바로 적용한다.
    // (약속을 기다리지 않는다: 정상 경로는 리로드로 페이지째 사라지므로 `applyUpdate`가
    //  리로드 감시 타이머까지 버틴 뒤에야 풀린다 — 우리가 볼 것은 skipWaiting이다.)
    void applyUpdateNow();
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true), { timeout: 3000 });
  });
});
