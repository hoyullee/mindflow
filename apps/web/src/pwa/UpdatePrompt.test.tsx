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

const updateServiceWorker = vi.fn();
const setNeedRefresh = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  }),
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
});
