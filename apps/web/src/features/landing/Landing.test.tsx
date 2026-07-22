import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { Landing } from './Landing';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Landing', () => {
  // Google 브랜드 인증이 홈페이지에서 확인하는 3요소: 앱 이름 · 목적 설명 ·
  // 개인정보처리방침 도달 가능성. 이 테스트가 그 계약을 지킨다.
  it('shows the app name, a purpose description, and reachable legal links', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(screen.getByText('Geurio')).toBeTruthy();
    expect(screen.getByText('마인드맵 서비스')).toBeTruthy();
    expect(screen.getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: '이용약관' }).getAttribute('href')).toBe('/terms');
  });

  it('routes anonymous visitors to /login from the CTA', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '무료로 시작하기' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login');
  });

  it('routes a signed-in visitor to /home instead', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }));
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '내 문서로' })).toBeTruthy());
    expect(screen.getByRole('link', { name: '무료로 시작하기' }).getAttribute('href')).toBe('/home');
  });

  it('serves the landing (not a redirect to /login) at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('link', { name: '무료로 시작하기' })).toBeTruthy();
  });
});
