import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InstallHint } from './InstallHint';

afterEach(() => cleanup());

describe('InstallHint', () => {
  it('모드가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<InstallHint mode={null} onInstall={() => {}} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('iOS: 공유 시트 절차를 안내하고 설치 버튼은 없다(브라우저가 안 준다)', () => {
    render(<InstallHint mode="ios" onInstall={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('홈 화면에 추가하면 앱처럼 열려요')).toBeTruthy();
    expect(screen.getByText(/공유 → ‘홈 화면에 추가’/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull();
  });

  it('안드로이드: 추가 버튼이 설치 프롬프트를 부른다', () => {
    const onInstall = vi.fn();
    render(<InstallHint mode="prompt" onInstall={onInstall} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('닫기는 다시 보지 않기로 이어진다', () => {
    const onDismiss = vi.fn();
    render(<InstallHint mode="ios" onInstall={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '안내 닫기' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
