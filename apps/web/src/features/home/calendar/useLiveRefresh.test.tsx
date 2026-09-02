// `useLiveRefresh` — 열어 둔 화면이 **다른 곳의 변경**을 잡는 두 계기(제보).
// 주기 쪽은 통합 테스트로 재기 어렵다(60초를 기다릴 수 없다) — 가짜 시간으로 본다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LIVE_REFRESH_MS, LIVE_REFRESH_THROTTLE_MS, useLiveRefresh } from './useLiveRefresh';

afterEach(cleanup);

function Probe({ enabled, fn }: { enabled: boolean; fn: () => void }) {
  useLiveRefresh(enabled, fn);
  return null;
}

/** 탭이 보이는가 — jsdom의 기본값은 'visible'이라 숨김만 흉내 낸다. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('useLiveRefresh', () => {
  it('보고 있는 동안에는 주기마다 묻고, 가려진 탭은 쉰다', () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const fn = vi.fn();
    render(<Probe enabled fn={fn} />);
    vi.advanceTimersByTime(LIVE_REFRESH_MS + 10);
    expect(fn).toHaveBeenCalledTimes(1);
    // 가려지면 쉰다 — 백그라운드 탭이 하루 종일 조회를 태우지 않는다.
    setVisibility('hidden');
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    expect(fn).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('탭 복귀·창 포커스·네트워크 복귀에 묻되, 연타는 스로틀이 거른다', () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const fn = vi.fn();
    render(<Probe enabled fn={fn} />);
    fireEvent(window, new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(1);
    // 포커스 + visibility가 함께 오는 것이 보통이다 — 한 번만 묻는다.
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('online'));
    expect(fn).toHaveBeenCalledTimes(1);
    // 스로틀이 지나면 다시 묻는다.
    vi.advanceTimersByTime(LIVE_REFRESH_THROTTLE_MS + 10);
    fireEvent(window, new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('꺼져 있으면 아무 계기도 걸지 않는다 — 대시보드는 위젯마다 이 훅을 지난다', () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const fn = vi.fn();
    render(<Probe enabled={false} fn={fn} />);
    fireEvent(window, new Event('focus'));
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 2);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
