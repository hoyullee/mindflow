import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UpdateOverlay } from './UpdateOverlay';

// 업데이트 적용 중 전체 화면 dim(요청) — 화면을 덮어 클릭을 막고 중앙에 로딩을 보여 준다.

afterEach(() => cleanup());

describe('UpdateOverlay', () => {
  it('visible=false면 아무것도 그리지 않는다', () => {
    const { container } = render(<UpdateOverlay visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true면 전체 화면을 덮는 dim + 중앙 로딩 문구가 뜬다', () => {
    render(<UpdateOverlay visible={true} />);
    const overlay = screen.getByRole('alert', { name: '업데이트 적용 중' });
    expect(overlay.style.position).toBe('fixed');
    expect(overlay.style.inset).toBe('0'); // jsdom은 단위 없는 0을 그대로 둔다
    expect(Number(overlay.style.zIndex)).toBeGreaterThanOrEqual(1000); // 모든 모달(≤400) 위
    expect(overlay.textContent).toContain('새 버전을 적용하고 있어요');
  });
});
