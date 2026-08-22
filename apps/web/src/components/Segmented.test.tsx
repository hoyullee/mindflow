// 세그먼트·라디오 카드의 계약 — 이 파일이 지키는 것은 **키보드**다.
//
// 예전에는 `<button aria-pressed>` 여러 개였다: 묶음 안에서 화살표가 통하지 않고
// Tab이 칸마다 멈췄으며, `aria-pressed`("눌린 버튼")는 "고른 값"과 뜻이 다르다.
// 지금은 `role="radiogroup"`/`role="radio"`이고 화살표로 **값이 바뀐다**.
//
// ⚠️ 화살표 선택은 우리가 직접 한다 — Radix의 자동 선택은 "직전에 화살표를
// 눌렀는가"를 `document` 리스너로 기억하는데, React 18이 이벤트를 루트 컨테이너에
// 위임하므로 초점 이동이 그 리스너보다 먼저 돌아 플래그가 늦게 선다(실브라우저
// 실측: 화살표는 초점만 옮기고 Space를 눌러야 선택됐다).

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RadioCards, Segmented } from './Segmented';

afterEach(cleanup);

describe('Segmented / RadioCards', () => {
  it('role은 radiogroup/radio이고, 화살표로 값이 바뀐다(순환)', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="m"
        onChange={onChange}
        label="글자 크기"
        items={[
          { value: 's', label: '작게', style: () => ({}) },
          { value: 'm', label: '보통', style: () => ({}) },
          { value: 'l', label: '크게', style: () => ({}) },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: '글자 크기' });
    const items = screen.getAllByRole('radio');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('l');
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('s');
    // 끝에서 한 칸 더 — 순환한다(초점이 있는 칸을 기준으로 센다).
    fireEvent.keyDown(items[2] as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('s');
    expect(group.contains(items[0] as HTMLElement)).toBe(true);
  });

  it('고른 칸을 다시 눌러도 해제되지 않는다 — 세그먼트는 늘 하나가 고른 상태다', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="a"
        onChange={onChange}
        label="보기"
        items={[
          { value: 'a', label: 'A', style: () => ({}) },
          { value: 'b', label: 'B', style: () => ({}) },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    expect(onChange).not.toHaveBeenCalled(); // 해제(빈 값) 무시
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('라디오 카드도 화살표로 값이 바뀐다', () => {
    const onChange = vi.fn();
    render(
      <RadioCards
        value="coral"
        onChange={onChange}
        label="색상 테마 선택"
        items={[
          { value: 'coral', label: '코랄', style: () => ({}), children: <span>코랄</span> },
          { value: 'ocean', label: '오션', style: () => ({}), children: <span>오션</span> },
        ]}
      />,
    );
    const items = screen.getAllByRole('radio');
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('ocean');
  });
});
