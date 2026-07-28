import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateToast } from './UpdateToast';

afterEach(cleanup);

describe('UpdateToast (새 버전 안내)', () => {
  it('대기 중인 업데이트가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<UpdateToast visible={false} onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('업데이트가 대기 중이면 안내와 새로고침 버튼을 보여준다', () => {
    render(<UpdateToast visible onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('새 버전이 준비됐어요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '나중에' })).toBeTruthy();
  });

  it('새로고침을 누르면 적용 콜백만 호출한다(스스로 리로드하지 않음)', async () => {
    const onRefresh = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<UpdateToast visible onRefresh={onRefresh} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: '새로고침' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('나중에를 누르면 숨김 콜백만 호출한다', async () => {
    const onRefresh = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<UpdateToast visible onRefresh={onRefresh} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: '나중에' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('적용 직전 저장이 실패하면 이유를 알리고 재시도를 권한다', () => {
    render(<UpdateToast visible saveBlocked onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('변경사항을 저장하지 못했어요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    // 평소 문구가 남아 사용자를 헷갈리게 하지 않는다
    expect(screen.queryByText('새 버전이 준비됐어요')).toBeNull();
  });

  // 제보: 눌러도 화면이 그대로라 버튼이 고장 난 줄 알았다. 적용에는 저장(네트워크)이
  // 끼어 있어 몇 초 걸릴 수 있으므로, 진행 중임이 반드시 보여야 한다.
  it('적용 중에는 진행 상태를 보여주고 중복 클릭을 막는다', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(<UpdateToast visible applying onRefresh={onRefresh} onDismiss={vi.fn()} />);

    const btn = screen.getByRole('button', { name: '적용 중…' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await user.click(btn);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('평소에는 누를 수 있다 (적용 중 표시가 기본값이 아니다)', () => {
    render(<UpdateToast visible onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    const btn = screen.getByRole('button', { name: '새로고침' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('편집 중 포커스를 훔치지 않도록 polite status로 알린다', () => {
    render(<UpdateToast visible onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    // 모달이 아니다 — 뒤 화면 조작을 막지 않아야 한다(dialog/aria-modal 아님)
    expect(el.getAttribute('aria-modal')).toBeNull();
  });

  it('로딩 오버레이·모달보다 위에 떠서 어느 화면에서든 보인다', () => {
    render(<UpdateToast visible onRefresh={vi.fn()} onDismiss={vi.fn()} />);
    const el = screen.getByRole('status');
    // LoadingOverlay=200, 모달=220 → 그보다 커야 가려지지 않는다
    expect(Number(el.style.zIndex)).toBeGreaterThan(220);
    expect(el.style.position).toBe('fixed');
  });
});
