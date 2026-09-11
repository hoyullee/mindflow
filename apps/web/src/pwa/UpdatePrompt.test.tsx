// 자동 적용의 규칙과, 이 컴포넌트가 **모듈에 올려 두는 상태**.
//
// 말을 거는 자리는 홈 LNB 알림 하나다(요청) — 예전에는 화면 하단 토스트가 물었고,
// 그 X가 자동 적용까지 세션 내내 걸어 잠가서 편집 중 한 번 닫은 장수 탭은 이후의
// 어떤 배포도 스스로 적용하지 못했다(제보). 지금은 닫을 것이 없다: 위험도만 보고
// 적용하고, 대기 중인 새 버전은 여기서 상태로 올려 LNB가 알린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { UpdatePrompt } from './UpdatePrompt';
import { __resetUpdateGate, useUpdateGuard, type UpdateRisk } from './updateGate';
import { __resetUpdateControl, applyUpdateNow, checkForUpdateNow, currentUpdateStatus, updateControlsReady } from './updateControl';
import type { DesktopBridge } from '../platform/desktopBridge';

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

/** 설치형 셸 흉내 — preload가 심어 주는 창구 하나뿐이다. */
function installShell(version = '0.2.0'): void {
  (window as { geurio?: Partial<DesktopBridge> }).geurio = {
    desktop: true,
    version,
    platform: 'win32',
  };
}

beforeEach(() => {
  __resetUpdateGate();
  updateServiceWorker.mockClear();
  setNeedRefresh.mockClear();
  swUpdate.mockClear();
  __resetUpdateControl();
});
afterEach(() => {
  cleanup();
  delete (window as { geurio?: unknown }).geurio;
  vi.unstubAllGlobals();
});

describe('UpdatePrompt — 위험도만 보는 자동 적용', () => {
  it('block에서는 적용하지 않고, 화면이 safe로 바뀌면 조용히 적용된다', async () => {
    const { rerender } = render(
      <>
        <Guard risk="block" />
        <UpdatePrompt />
      </>,
    );
    // block(입력·편집 중): 아무것도 묻지 않고 아무것도 적용하지 않는다 — 화면에
    // 뜨는 것도 없다(말은 홈 LNB가 한다).
    await waitFor(() => expect(currentUpdateStatus().ready).toBe(true));
    expect(updateServiceWorker).not.toHaveBeenCalled();
    // 감지 플래그(needRefresh)를 끄는 것은 아무것도 없다 — 끄면 같은 대기 SW로는
    // onNeedRefresh가 재발화하지 않아 그 버전을 다시 볼 근거가 사라진다.
    expect(setNeedRefresh).not.toHaveBeenCalled();

    // 화면이 안전해졌다(예: 편집을 마치고 홈으로) — 그 순간 조용히 적용된다.
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

  it('다른 탭이 편집 중이면 미루되, 대기 중이라는 사실은 상태에 남는다', async () => {
    // safe 화면은 원래 묻지 않고 조용히 적용한다 — 그런데 다른 탭이 편집 중이면
    // 적용이 계속 미뤄진다(재시도 20초 주기). 그 시간대에도 `ready`가 서 있어야
    // 홈 LNB 알림이 "새 버전이 준비됐어요"를 들고 있을 수 있다 — 사용자가 직접
    // 적용할 길이 열려 있다(수동 적용은 피어를 묻지 않는다).
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
      await waitFor(() => expect(currentUpdateStatus().ready).toBe(true));
      // 피어가 바쁘다고 답했으므로 적용은 미뤄진다 — 250ms 왕복을 넉넉히 지나서.
      await new Promise((r) => setTimeout(r, 600));
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

// 껍데기(설치 파일)의 판도 이 컴포넌트가 **한 번** 물어 모듈에 올린다 — 설정의
// 「버전 확인」과 홈 LNB 알림이 그 값을 함께 읽는다. 각자 물으면 왕복이 그만큼 늘고,
// 두 화면이 서로 다른 답을 들 수 있다.
describe('UpdatePrompt — 껍데기(설치 파일)의 판', () => {
  it('설치형 앱에서는 버전 파일을 물어 상태로 올린다', async () => {
    installShell('0.2.0');
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: '0.3.0', url: 'https://example.test/r' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<UpdatePrompt />);

    await waitFor(() =>
      expect(currentUpdateStatus().shell).toEqual({ kind: 'available', version: '0.3.0', url: 'https://example.test/r' }),
    );
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/desktop-version.json');
  });

  it('브라우저·PWA에서는 부르지 않는다 — 받을 설치 파일이 없다', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<UpdatePrompt />);
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('desktop-version'))).toHaveLength(0);
    expect(currentUpdateStatus().shell).toBeNull();
  });
});
