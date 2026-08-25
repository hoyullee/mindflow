import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LoadingOverlay } from './LoadingOverlay';

afterEach(() => {
  cleanup();
});

/**
 * 로딩 표시는 앱 전체가 **한 모양**이다(요청) — 대시보드 런치·업데이트 적용과
 * 같은 회전 링. 예전의 dc 원본 "코어 + 가지" 애니메이션은 이 화면에만 있어
 * 같은 앱 안에서 로딩의 모양이 갈렸다.
 */
describe('LoadingOverlay', () => {
  it('회전 스피너 하나로 그린다(마인드맵 코어 애니메이션이 아니다)', () => {
    const { container } = render(<LoadingOverlay message="들어가는 중" />);
    const spinner = container.querySelector('[data-loader-spinner]') as HTMLElement;
    expect(spinner).toBeTruthy();
    expect(spinner.style.animation).toContain('mf-spin');
    expect(spinner.style.borderRadius).toBe('999px');
    // 기본은 브랜드 코럴 — 로그인은 아무 색도 넘기지 않는다
    expect(spinner.style.borderTopColor).toBe('rgb(240, 102, 63)');
    // 예전 애니메이션의 조각(가지 점 4개 + 줄기 4개)이 남아 있지 않다
    expect(container.querySelectorAll('div[style*="mf-core"], div[style*="mf-branch"], div[style*="mf-stem"]')).toHaveLength(0);
    expect(container.textContent).toContain('들어가는 중');
    expect(container.textContent).toContain('잠시만 기다려 주세요');
  });

  it('홈은 지금 테마의 강조색을 넘길 수 있다(대시보드 런치와 같은 색)', () => {
    const { container } = render(<LoadingOverlay message="여는 중" accent="var(--mf-accent)" accentSoft="var(--mf-accent-soft)" />);
    const spinner = container.querySelector('[data-loader-spinner]') as HTMLElement;
    expect(spinner.style.borderTopColor).toBe('var(--mf-accent)');
    // 연한 쪽(트랙)은 jsdom이 var()가 든 border-color를 통째로 버려 확인할 수 없다 —
    // 실브라우저 프로브가 계산색으로 확인한다.
  });
});
