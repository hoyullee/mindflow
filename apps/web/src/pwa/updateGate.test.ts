import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import {
  DEFAULT_RISK,
  anyPeerBusy,
  canAutoApply,
  currentRisk,
  runPrepare,
  startPeerResponder,
  useUpdateGuard,
  __resetUpdateGate,
  type UpdatePrepare,
  type UpdateRisk,
} from './updateGate';

afterEach(() => {
  cleanup();
  __resetUpdateGate();
});

/** 위험도를 신고하기만 하는 최소 화면. */
function Screen({ risk, prepare }: { risk: UpdateRisk; prepare?: UpdatePrepare }) {
  useUpdateGuard(risk, prepare);
  return null;
}

describe('updateGate (새 버전 적용 게이트)', () => {
  it('아무도 신고하지 않으면 보수적으로 defer — 신고를 깜빡한 화면이 제멋대로 리로드되지 않는다', () => {
    expect(currentRisk()).toBe('defer');
    expect(DEFAULT_RISK).toBe('defer');
  });

  it('화면이 신고한 위험도를 그대로 노출하고, 언마운트되면 되돌린다', () => {
    const { unmount } = render(createElement(Screen, { risk: 'safe' }));
    expect(currentRisk()).toBe('safe');
    unmount();
    expect(currentRisk()).toBe('defer');
  });

  it('상태가 바뀌어 위험도를 다시 신고하면 반영된다 (빈 폼 → 입력 시작)', () => {
    const { rerender } = render(createElement(Screen, { risk: 'safe' }));
    expect(currentRisk()).toBe('safe');
    rerender(createElement(Screen, { risk: 'block' }));
    expect(currentRisk()).toBe('block');
  });

  it('라우트 전환 중 두 화면이 겹쳐 등록되면 더 위험한 쪽을 택한다', () => {
    render(createElement(Screen, { risk: 'safe' }));
    render(createElement(Screen, { risk: 'block' }));
    expect(currentRisk()).toBe('block');
  });

  it('적용 직전 등록된 정리 훅을 실행한다 (미저장 변경 저장)', async () => {
    const prepare = vi.fn(async () => true);
    render(createElement(Screen, { risk: 'defer', prepare }));

    await act(async () => {
      expect(await runPrepare()).toBe(true);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('정리 훅이 false를 돌려주면(저장 실패) 적용해도 안전하지 않다고 보고한다', async () => {
    render(createElement(Screen, { risk: 'defer', prepare: async () => false }));
    await act(async () => {
      expect(await runPrepare()).toBe(false);
    });
  });

  it('정리 훅이 던져도 전파하지 않고, 판단이 안 서므로 멈추는 쪽으로 보고한다', async () => {
    render(
      createElement(Screen, {
        risk: 'defer',
        prepare: () => {
          throw new Error('storage unavailable');
        },
      }),
    );
    await act(async () => {
      expect(await runPrepare()).toBe(false);
    });
  });

  it('정리 훅이 없으면(잃을 게 없는 화면) 그냥 통과한다', async () => {
    render(createElement(Screen, { risk: 'safe' }));
    await act(async () => {
      expect(await runPrepare()).toBe(true);
    });
  });

  it('자동 적용 조건: safe는 항상, defer는 탭이 숨었을 때만, block은 절대', () => {
    expect(canAutoApply('safe', false)).toBe(true);
    expect(canAutoApply('safe', true)).toBe(true);
    expect(canAutoApply('defer', false)).toBe(false); // 보고 있는 중 → 물어본다
    expect(canAutoApply('defer', true)).toBe(true);
    expect(canAutoApply('block', false)).toBe(false);
    expect(canAutoApply('block', true)).toBe(false); // 숨어 있어도 미확정 입력은 못 지킨다
  });

  it('정리 훅은 useCallback 없이도 최신 클로저를 쓴다 (ref 경유)', async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);
    const { rerender } = render(createElement(Screen, { risk: 'defer', prepare: first }));
    rerender(createElement(Screen, { risk: 'defer', prepare: second }));

    await act(async () => {
      await runPrepare();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/**
 * 탭 간 조율. 한 탭이 적용하면 skipWaiting이 **다른 탭까지** 리로드시키므로
 * (vite-plugin-pwa register.js의 `controlling` 핸들러), 자동 적용 전에 물어봐야 한다.
 * 여기서는 한 프로세스 안에서 응답자와 질문자를 따로 띄워 그 왕복을 검증한다
 * (BroadcastChannel은 보낸 객체 자신에게는 배달하지 않는다).
 */
describe('updateGate 탭 간 조율', () => {
  it('편집 중인 탭이 있으면 자동 적용을 미룬다', async () => {
    render(createElement(Screen, { risk: 'block' }));
    const stop = startPeerResponder();
    try {
      expect(await anyPeerBusy(300)).toBe(true);
    } finally {
      stop();
    }
  });

  it('다른 탭이 모두 한가하면 그냥 진행한다', async () => {
    render(createElement(Screen, { risk: 'safe' }));
    const stop = startPeerResponder();
    try {
      expect(await anyPeerBusy(300)).toBe(false);
    } finally {
      stop();
    }
  });

  it('응답할 탭이 아예 없으면(단일 탭) 기다리다 진행한다', async () => {
    expect(await anyPeerBusy(150)).toBe(false);
  });
});
