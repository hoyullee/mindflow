// 공책 2판 — 홈 검색이 **공책과 페이지 내용**까지 찾고(요청 7), 검색으로 들어갈 때
// 최근 항목이 **지워지지 않고 접힌다**(요청 6).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
      blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '릴리즈 범위를 다시 좁혔습니다.', b: false, c: null }] }],
    },
    {
      id: 'p2',
      title: '주간 회고',
      blocks: [{ id: 'b2', kind: 'ck', items: [{ id: 'i1', runs: [{ t: '알림 정리를 먼저 끝낸다', b: false, c: null }] }] }],
    },
  ],
  cover: { tag: '회의록' },
};

const MAP_DOC = {
  v: 1,
  nodes: { root: { id: 'root', text: '스프린트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

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
      recent: ['제품 회의록', '스프린트 맵'],
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

async function search(user: ReturnType<typeof userEvent.setup>, q: string) {
  const box = await screen.findByPlaceholderText(/찾기|검색/);
  await user.click(box);
  await user.keyboard(q);
}

describe('홈 검색 — 공책과 페이지 내용', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
    seed();
  });
  afterEach(cleanup);

  it('**페이지 본문에만 있는 낱말**로 공책을 찾는다(제목에는 없다)', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    await search(user, '알림 정리');
    await waitFor(() => expect(container.querySelector('[data-search-results]')).toBeTruthy());
    // 공책 카드가 결과에 선다 — 제목 '제품 회의록'에는 그 낱말이 없다.
    expect(container.querySelectorAll('[data-note-cover]').length).toBeGreaterThan(0);
  });

  it('**어디서 걸렸는지**를 종류 칩과 함께 보여 준다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    await search(user, '알림 정리');
    const hits = await waitFor(() => {
      const el = container.querySelector('[data-search-hits]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const row = hits.querySelector('[data-search-hit="본문"]');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText(/알림 정리를 먼저 끝낸다/)).toBeTruthy();
    // 그 장으로 바로 가는 주소다(문서만 열고 다시 찾게 하지 않는다).
    expect((row as HTMLAnchorElement).getAttribute('href')).toContain('page=p2');
  });

  it('페이지 제목으로 걸리면 `페이지` 칩이 붙는다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    await search(user, '주간 회고');
    await waitFor(() => expect(container.querySelector('[data-search-hit="페이지"]')).toBeTruthy());
  });

  it('맵의 주제도 같은 목록에 선다 — 공책 전용 기능이 아니다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-note-cover]')).toBeTruthy());

    await search(user, '스프린트');
    await waitFor(() => expect(container.querySelector('[data-search-hit="주제"]')).toBeTruthy());
  });
});

describe('검색으로 들어갈 때 최근 항목은 **접힌다**(지워지지 않는다)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
    seed();
  });
  afterEach(cleanup);

  it('평소에는 펼쳐져 있고, 검색하면 접힌 채 **자리에 남는다**', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    const strip = await waitFor(() => {
      const el = container.querySelector('[data-recent-collapse]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(strip.getAttribute('data-recent-collapse')).toBe('0');

    await search(user, '회의록');
    await waitFor(() => expect(container.querySelector('[data-recent-collapse]')?.getAttribute('data-recent-collapse')).toBe('1'));

    // **지워지지 않는다** — 같은 요소가 그대로 있어야 전환이 이어져 보인다.
    const after = container.querySelector('[data-recent-collapse]') as HTMLElement;
    expect(after).toBeTruthy();
    expect(['0', '0px']).toContain(after.style.maxHeight); // React는 0에 단위를 붙이지 않는다
    expect(after.style.opacity).toBe('0');
    // 접힌 동안에는 키보드 초점도 들어가지 않는다.
    expect(after.getAttribute('aria-hidden')).toBe('true');
    expect(after.hasAttribute('inert')).toBe(true);
  });

  it('검색을 지우면 다시 펼쳐진다', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector('[data-recent-collapse]')).toBeTruthy());

    await search(user, '회의록');
    await waitFor(() => expect(container.querySelector('[data-recent-collapse]')?.getAttribute('data-recent-collapse')).toBe('1'));

    await user.clear(await screen.findByPlaceholderText(/찾기|검색/));
    await waitFor(() => expect(container.querySelector('[data-recent-collapse]')?.getAttribute('data-recent-collapse')).toBe('0'));
  });
});
