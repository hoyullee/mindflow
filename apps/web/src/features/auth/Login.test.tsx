import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';

afterEach(() => {
  cleanup();
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login', () => {
  it('renders the welcome heading and login submit button on initial render', () => {
    renderLogin();

    expect(screen.getByText('MindFlow에 오신 것을 환영해요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
  });

  it('switches to signup mode and reveals the password-confirm field', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText('가입하기'));

    expect(screen.getByText('계정 만들기')).toBeTruthy();
    expect(screen.getByPlaceholderText('비밀번호 재입력')).toBeTruthy();
    expect(screen.getByRole('button', { name: '가입하기' })).toBeTruthy();
  });

  it('shows a validation error when submitting an invalid email', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(screen.getByText('올바른 이메일 주소를 입력해 주세요.')).toBeTruthy();
  });

  it('advances signup to the verify step and displays the demo code', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText('가입하기'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'demo@example.com');
    await user.type(screen.getByPlaceholderText('비밀번호 입력'), 'password123');
    await user.type(screen.getByPlaceholderText('비밀번호 재입력'), 'password123');
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    expect(screen.getByText('이메일 인증')).toBeTruthy();
    expect(screen.getByText(/데모 코드:/)).toBeTruthy();
    expect(screen.getByPlaceholderText('6자리 숫자')).toBeTruthy();
  });
});
