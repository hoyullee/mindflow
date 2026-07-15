import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Home', () => {
  it('renders the sidebar and the main map sections', () => {
    const { container } = renderHome();
    const sidebar = within(container.querySelector('aside') as HTMLElement);

    // sidebar
    expect(sidebar.getByText('스페이스')).toBeTruthy();
    expect(sidebar.getByText('Google Drive')).toBeTruthy();
    expect(sidebar.getByText('즐겨찾기')).toBeTruthy();
    expect(sidebar.getByText('휴지통')).toBeTruthy();
    expect(sidebar.getByText('일반 공간')).toBeTruthy();

    // toolbar / main
    expect(screen.getByPlaceholderText('파일 검색')).toBeTruthy();
    expect(screen.getByText('＋ 새로 만들기')).toBeTruthy();

    // seeded default maps render as cards
    expect(screen.getByText('따라잡기')).toBeTruthy();
    expect(screen.getByText('무상 비즈머니 지급')).toBeTruthy();
  });

  it('shows the loading overlay then navigates to /editor after clicking "새로 만들기"', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByText('＋ 새로 만들기'));

    expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
  });

  it('filters the map grid as the search box is typed into', async () => {
    const user = userEvent.setup();
    renderHome();

    expect(screen.getByText('따라잡기')).toBeTruthy();
    expect(screen.getByText('무상 비즈머니 지급')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('파일 검색'), '따라잡기');

    expect(screen.getByText('따라잡기')).toBeTruthy();
    expect(screen.queryByText('무상 비즈머니 지급')).toBeNull();
  });

  it('logs out (via the confirm dialog) and navigates to /login', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: /로그아웃/ }));
    expect(screen.getByText('로그아웃하시겠습니까?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
  });
});
