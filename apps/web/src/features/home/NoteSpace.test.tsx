// 홈에서의 공책 — 스페이스의 **공책 구획**, 「새로 만들기」의 공책 탭, 카드 우클릭 메뉴.
//
// 공책 카드가 보드 카드와 통째로 다르게 그려지므로(썸네일이 아니라 표지 + 첫 줄)
// 이 파일은 그 **경계**를 지킨다: 공책이 공책 구획에만 서고, 보드 구획에는 서지 않는다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { mockMatchMedia } from '../../test/matchMedia';

const NOTE_DOC = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'note',
  pages: [
    {
      id: 'p1',
      title: '9월 3주 회의록',
      blocks: [
        { id: 'b1', kind: 'p', runs: [{ t: '릴리즈 범위를 다시 좁혔습니다.', b: false, c: null }] },
        { id: 'b2', kind: 'ck', items: [{ id: 'i1', runs: [{ t: '할 일', b: false, c: null }], done: true }, { id: 'i2', runs: [{ t: '또 할 일', b: false, c: null }] }] },
      ],
    },
    { id: 'p2', title: '주간 회고', blocks: [{ id: 'b3', kind: 'p', runs: [{ t: 'Keep', b: false, c: null }] }] },
  ],
  cover: { tag: '회의록' },
};

const MAP_DOC = { v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' };

function seed(): void {
  localStorage.setItem('mindflow_doc_nb1', JSON.stringify(NOTE_DOC));
  localStorage.setItem('mindflow_doc_mp1', JSON.stringify(MAP_DOC));
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [
        {
          id: 's1',
          name: '일반 공간',
          home: true,
          color: '#f0663f',
          maps: [
            { title: '제품 회의록', when: '방금', hue: '#f0663f', docId: 'nb1' },
            { title: '스프린트 맵', when: '어제', hue: '#f0663f', docId: 'mp1' },
          ],
          folders: [],
        },
      ],
      mapFolders: {},
    }),
  );
}

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

/** 구획을 이름으로 — `data-space-section`이 그 표식이다. */
function section(container: HTMLElement, label: string): HTMLElement | null {
  return container.querySelector(`[data-space-section="${label}"]`);
}

describe('스페이스의 공책 구획', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
    seed();
  });
  afterEach(cleanup);

  it('공책과 보드가 **다른 구획**에 선다', async () => {
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    const noteSec = section(container, '공책');
    const boardSec = section(container, '보드');
    expect(noteSec).toBeTruthy();
    expect(boardSec).toBeTruthy();
    // **표지는 공책 구획에만, 썸네일은 보드 구획에만** — 카드 생김새로 가른다
    // (제목 글자는 카드 안에서 여러 요소로 쪼개질 수 있어 근거로 삼지 않는다).
    expect(noteSec!.querySelectorAll('[data-note-cover]')).toHaveLength(1);
    expect(boardSec!.querySelectorAll('[data-note-cover]')).toHaveLength(0);
    expect(noteSec!.querySelectorAll('.map-thumb')).toHaveLength(0);
    expect(boardSec!.querySelectorAll('.map-thumb')).toHaveLength(1);
    // 구획 머리가 개수를 말한다(공책 1 · 보드 1).
    expect(within(noteSec!).getByText('1')).toBeTruthy();
    expect(within(boardSec!).getByText('1')).toBeTruthy();
  });

  it('공책 카드는 썸네일이 아니라 **표지 + 첫 줄**을 보여 준다', async () => {
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    const cover = container.querySelector('[data-note-cover]') as HTMLElement;
    // 첫 페이지 제목과 본문 첫 줄(공책 이름은 카드 아래에 따로 있다).
    expect(within(cover).getByText('9월 3주 회의록')).toBeTruthy();
    expect(within(cover).getByText('릴리즈 범위를 다시 좁혔습니다.')).toBeTruthy();
    // 태그 칩 · 페이지 수 · 체크 진행.
    expect(within(cover).getByText('회의록')).toBeTruthy();
    expect(within(cover).getByText('2페이지')).toBeTruthy();
    expect(within(cover).getByText('✓ 1/2')).toBeTruthy();
  });

  it('공책 구획 끝에 **공책 만들기** 타일이 있고, 누르면 갤러리가 공책 탭으로 열린다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-new-note-tile]')).toBeTruthy());

    await user.click(container.querySelector('[data-new-note-tile]') as HTMLElement);
    const tab = await waitFor(() => {
      const el = document.querySelector('[data-gallery-tab="공책"]') as HTMLElement;
      expect(el.getAttribute('aria-pressed')).toBe('true');
      return el;
    });
    expect(tab).toBeTruthy();
    // 공책 구획이 열려 있다 — 빈 공책과 템플릿 넷.
    expect(await screen.findByText('빈 공책')).toBeTruthy();
    expect(document.querySelector('[data-template="note-meeting"]')).toBeTruthy();
    expect(document.querySelector('[data-template="note-retro"]')).toBeTruthy();
  });

  it('공책 카드 메뉴에는 **태그·표지 꾸미기**가 있고, 그림 내보내기는 없다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    const card = container.querySelector('[data-note-cover]')!.closest('a, div[class*="gh-card"], *[data-map-card]') as HTMLElement;
    fireEvent.contextMenu(card ?? (container.querySelector('[data-note-cover]') as HTMLElement));

    expect(await screen.findByText('표지 꾸미기')).toBeTruthy();
    expect(screen.getByText('태그 · 회의록')).toBeTruthy();
    // 내보내기 하위에 그림 형식이 없다(그릴 캔버스가 없는 문서다 — 칸반과 같은 규칙).
    await user.hover(screen.getByText('내보내기'));
    await waitFor(() => expect(screen.queryByText('PNG 이미지')).toBeNull());
  });

  it('메뉴에서 표지 색을 고르면 **그 문서에** 쓰인다', async () => {
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('[data-note-cover]') as HTMLElement);
    fireEvent.click(await screen.findByText('표지 꾸미기'));
    fireEvent.click(await screen.findByText('숲'));

    await waitFor(() => {
      const raw = localStorage.getItem('mindflow_doc_nb1');
      expect(JSON.parse(raw || '{}').cover?.color).toBe('#2F7D57');
    });
  });
});

describe('새로 만들기 — 왼쪽 레일', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
    seed();
    vi.stubGlobal('requestIdleCallback', undefined);
  });
  afterEach(cleanup);

  it('종류 넷이 레일에 서고 기본은 마인드맵이다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);

    await waitFor(() => expect(document.querySelector('[data-gallery-tab="마인드맵"]')).toBeTruthy());
    for (const name of ['마인드맵', '화이트보드', '공책', '칸반 보드']) {
      expect(document.querySelector(`[data-gallery-tab="${name}"]`)).toBeTruthy();
    }
    // 기본은 마인드맵 — 눌린 탭이 그것 하나다.
    expect(document.querySelector('[data-gallery-tab="마인드맵"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-gallery-tab="공책"]')?.getAttribute('aria-pressed')).toBe('false');
    // 기본 탭 — 마인드맵 구획이 열려 있다.
    expect(await screen.findByText('빈 맵')).toBeTruthy();
    expect(screen.queryByText('빈 공책')).toBeNull();
  });

  it('구획마다 **바로 시작** 줄이 템플릿 위에 선다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);

    const blank = await screen.findByText('빈 맵');
    const row = blank.closest('[data-template="blank"]') as HTMLElement;
    expect(within(row).getByText('바로 시작')).toBeTruthy();
    // 그 아래에 '템플릿' 머리가 있다.
    expect(screen.getByText('템플릿')).toBeTruthy();
  });
});
