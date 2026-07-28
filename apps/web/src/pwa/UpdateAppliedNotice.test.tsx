import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UpdateAppliedNotice } from './UpdateAppliedNotice';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UpdateAppliedNotice (적용 완료 알림)', () => {
  it('숨김 상태에서는 아무것도 그리지 않는다', () => {
    const { container } = render(<UpdateAppliedNotice visible={false} onDone={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });

  it('적용됐다는 사실을 알린다', () => {
    render(<UpdateAppliedNotice visible onDone={vi.fn()} />);
    expect(screen.getByText('최신 버전으로 업데이트됐어요')).toBeTruthy();
  });

  it('물어보는 게 아니라 알리는 것이므로 버튼이 없다', () => {
    render(<UpdateAppliedNotice visible onDone={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('스스로 사라진다 (사용자 조작을 요구하지 않는다)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<UpdateAppliedNotice visible onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4100);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('편집 중 포커스를 훔치지 않도록 polite status로 알린다', () => {
    render(<UpdateAppliedNotice visible onDone={vi.fn()} />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    // 새 버전 토스트와 같은 자리·같은 층에 뜬다(둘이 어긋나 보이지 않게)
    expect(el.style.position).toBe('fixed');
    expect(Number(el.style.zIndex)).toBeGreaterThan(220);
  });
});
