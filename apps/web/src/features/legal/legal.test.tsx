import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { PrivacyPolicy } from './PrivacyPolicy';
import { Terms } from './Terms';

afterEach(() => {
  cleanup();
});

describe('legal pages', () => {
  it('privacy policy renders its required sections (수집 항목·보유 기간·문의처)', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toBeTruthy();
    expect(screen.getByText('1. 수집하는 개인정보')).toBeTruthy();
    expect(screen.getByText('4. 보유 기간 및 파기')).toBeTruthy();
    expect(screen.getAllByText('ssasya2@gmail.com').length).toBeGreaterThan(0);
  });

  it('terms renders with the content-ownership clause', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '이용약관' })).toBeTruthy();
    expect(screen.getByText('3. 콘텐츠의 권리')).toBeTruthy();
  });
});

describe('legal routes (public, outside RequireAuth)', () => {
  // App owns its own BrowserRouter, so route testing goes through the real
  // history API instead of MemoryRouter initialEntries.
  function renderAppAt(path: string) {
    window.history.pushState({}, '', path);
    return render(<App />);
  }

  it('/privacy is reachable logged-out', () => {
    renderAppAt('/privacy');
    expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toBeTruthy();
  });

  it('/terms is reachable logged-out', () => {
    renderAppAt('/terms');
    expect(screen.getByRole('heading', { name: '이용약관' })).toBeTruthy();
  });
});
