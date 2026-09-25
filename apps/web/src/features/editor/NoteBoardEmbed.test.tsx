// 공책 본문의 **보드 임베드** — 링크 한 줄이 아니라 "그 보드의 지금 상태"가 펴진다.
//
// 이 파일이 지키는 것: 종류마다 맞는 본문이 뜬다 · 보기 상태가 **문서에 남는다** ·
// 본문에서 되는 편집은 **칸반 열 이동 하나**뿐이다 · 없는 보드·권한 없는 보드도
// 말이 되게 보인다 · 임베드가 많아지면 여섯 번째부터 접어서 넣는다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const base = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
};

const KANBAN = {
  ...base,
  kind: 'kanban',
  columns: [
    { id: 'c1', title: '할 일' },
    { id: 'c2', title: '진행 중' },
    { id: 'c3', title: '완료' },
  ],
  cards: [
    { id: 'k1', col: 'c1', pos: 1, text: '문구 검수', owner: 'me@example.com' },
    { id: 'k2', col: 'c1', pos: 2, text: '아이콘 교체' },
    { id: 'k3', col: 'c2', pos: 1, text: '알림 분리' },
    { id: 'k4', col: 'c3', pos: 1, text: '배포 점검' },
  ],
};

const MAP = {
  ...base,
  nodes: {
    r: { id: 'r', text: '릴리즈', parent: null, children: ['a', 'b'], x: 0, y: 0 },
    a: { id: 'a', text: '알림', parent: 'r', children: ['a1'], x: 40, y: 0 },
    a1: { id: 'a1', text: '웹 푸시', parent: 'a', children: [], x: 80, y: 0 },
    b: { id: 'b', text: '위젯', parent: 'r', children: [], x: 40, y: 60 },
  },
};

/** 링크 블록 하나짜리 공책. */
function noteWith(blocks: unknown[]) {
  return { ...base, kind: 'note', pages: [{ id: 'p1', title: '회의록', blocks }] };
}

function seedSpace(maps: { title: string; docId: string }[]) {
  localStorage.setItem(
    'mf_spaces',
    JSON.stringify({
      spaces: [{ id: 's1', name: '일반', home: true, color: '#f0663f', maps: maps.map((m) => ({ ...m, when: '방금', hue: '#f0663f' })), folders: [] }],
      mapFolders: {},
    }),
  );
}

const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');
const saveNow = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('공책 본문 · 보드 임베드', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('칸반은 열 탭·진행률·카드 목록으로 펴지고, 배지는 「열 이동만」이다', async () => {
    seedSpace([{ title: '스프린트 보드', docId: 'kb1' }]);
    localStorage.setItem('mindflow_doc_kb1', JSON.stringify(KANBAN));
    localStorage.setItem('mindflow_doc_nb1', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb1' }])));
    const { container } = renderEditor('/editor?map=nb1&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-cards]')).toBeTruthy());
    expect(container.querySelector('[data-embed-kind="kanban"]')).toBeTruthy();
    expect(container.querySelector('[data-embed-rule]')?.textContent).toBe('열 이동만');
    expect(container.querySelector('[data-embed-title]')?.textContent).toBe('스프린트 보드');
    // 열 탭 셋 — 숫자는 그 열의 카드 수.
    const tabs = [...container.querySelectorAll('[data-embed-col]')].map((e) => e.textContent);
    expect(tabs).toEqual(['할 일2', '진행 중1', '완료1']);
    // 기본으로 선 자리는 **두 번째 열**(진행 중)이다.
    expect(container.querySelector('[data-embed-col][aria-pressed="true"]')?.textContent).toBe('진행 중1');
    // 진행률 글은 **원본 보드 머리의 그 글**이다(`boardProgress`) — 임베드가 따로
    // 세던 때는 `완료 1/4`였는데 보드는 `완료 1/4 · 진행 1`이었다(제보).
    expect(container.querySelector('[data-embed-done]')?.textContent).toBe('완료 1/4 · 진행 1');
    // 카드는 **원본 보드의 그 카드 얼굴**이다(제보) — 글 아래에 기한·댓글 수·담당이
    // 함께 온다(예전에는 임베드가 손으로 그린 네모라 글만 있었다).
    expect([...container.querySelectorAll('[data-embed-card-id]')].map((e) => e.textContent)).toEqual(['알림 분리날짜 없음0']);
  });

  it('열을 바꾸고 「내 카드만」을 켜면 그 상태가 **문서에 남는다**', async () => {
    seedSpace([{ title: '스프린트 보드', docId: 'kb2' }]);
    localStorage.setItem('mindflow_doc_kb2', JSON.stringify(KANBAN));
    localStorage.setItem('mindflow_doc_nb2', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb2' }])));
    const { container } = renderEditor('/editor?map=nb2&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-col="0"]')).toBeTruthy());

    const on = () => container.querySelector('[data-embed-col][aria-pressed="true"]')?.textContent;
    fireEvent.click(container.querySelector('[data-embed-col="0"]')!);
    await waitFor(() => expect(on()).toBe('할 일2'));
    fireEvent.click(container.querySelector('[data-embed-mine]')!);
    // 「내 카드만」은 탭의 수만 거른다 — 진행률은 보드 전체 그대로다.
    await waitFor(() => expect(on()).toBe('할 일1'));
    expect(container.querySelector('[data-embed-done]')?.textContent).toBe('완료 1/4 · 진행 1');

    saveNow();
    await waitFor(() => expect(saved('nb2')?.pages?.[0]?.blocks?.[0]?.embed?.kanban).toEqual({ col: 0, mine: true }));
  });

  it('접으면 한 줄 카드가 되고 그 크기도 문서에 남는다', async () => {
    seedSpace([{ title: '스프린트 보드', docId: 'kb3' }]);
    localStorage.setItem('mindflow_doc_kb3', JSON.stringify(KANBAN));
    localStorage.setItem('mindflow_doc_nb3', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb3' }])));
    const { container } = renderEditor('/editor?map=nb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-cards]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-embed-collapse]')!);
    await waitFor(() => expect(container.querySelector('[data-embed-size="sm"]')).toBeTruthy());
    expect(container.querySelector('[data-embed-expand]')).toBeTruthy();
    saveNow();
    await waitFor(() => expect(saved('nb3')?.pages?.[0]?.blocks?.[0]?.embed?.size).toBe('sm'));
  });

  it('마인드맵의 **개요**는 가지를 접었다 펼 수 있다(기본은 맵 — 요청으로 바뀌었다)', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mp1' }]);
    localStorage.setItem('mindflow_doc_mp1', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nb4', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mp1' }])));
    const { container } = renderEditor('/editor?map=nb4&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-mmview="outline"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-embed-mmview="outline"]')!);
    await waitFor(() => expect(container.querySelector('[data-embed-outline]')).toBeTruthy());
    expect(container.querySelector('[data-embed-kind="map"]')).toBeTruthy();
    expect(container.querySelector('[data-embed-rule]')).toBeNull();
    expect(container.querySelector('[data-embed-outline-root]')?.textContent).toContain('릴리즈');
    const rows = [...container.querySelectorAll('[data-embed-branch]')].map((e) => e.getAttribute('data-embed-branch'));
    expect(rows).toEqual(['0', '1']);
    // 기본으로 앞의 두 가지가 펼쳐져 있다 — 자식이 보인다.
    expect(container.querySelector('[data-embed-child]')?.textContent).toContain('웹 푸시');

    fireEvent.click(container.querySelector('[data-embed-branch="0"]')!);
    await waitFor(() => expect(container.querySelector('[data-embed-child]')).toBeNull());
  });

  it('없는 보드는 사정을 적고 링크를 뺄 길을 준다', async () => {
    seedSpace([{ title: '지워진 보드', docId: 'gone' }]);
    localStorage.setItem('mindflow_doc_nb5', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'gone' }])));
    const { container } = renderEditor('/editor?map=nb5&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-state]')).toBeTruthy());
    expect(container.querySelector('[data-embed-state]')?.textContent).toContain('이 보드는 삭제됐어요');
    // 종류를 모르는 문서를 **마인드맵이라고 적지 않는다**(기본값이 그것이라서 그렇게 보였다).
    expect(container.querySelector('[data-embed-meta]')?.textContent).toBe('문서 · 일반');
    fireEvent.click(container.querySelector('[data-embed-state-act]')!);
    await waitFor(() => expect(container.querySelector('[data-note-kind="link"]')).toBeNull());
  });

  it('카드를 열 탭에 끌어 놓으면 **보드 원본**이 바뀐다 — 공책이 아니라', async () => {
    seedSpace([{ title: '스프린트 보드', docId: 'kb4' }]);
    localStorage.setItem('mindflow_doc_kb4', JSON.stringify(KANBAN));
    localStorage.setItem('mindflow_doc_nb7', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb4' }])));
    const { container } = renderEditor('/editor?map=nb7&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-card-id="k3"]')).toBeTruthy());

    // 떨어뜨릴 자리는 좌표로 찾는다(`elementFromPoint`) — jsdom에는 배치가 없어 대신 답한다.
    const target = container.querySelector('[data-embed-col="2"]') as HTMLElement;
    const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
    const prev = doc.elementFromPoint;
    doc.elementFromPoint = () => target;
    try {
      const card = container.querySelector('[data-embed-card-id="k3"]') as HTMLElement;
      fireEvent.pointerDown(card, { button: 0 });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
      // 보드 문서가 바뀐다 — 공책은 그대로다(보기 상태만 드는 것이 임베드의 규칙).
      await waitFor(() => expect(saved('kb4')?.cards?.find((c: { id: string }) => c.id === 'k3')?.col).toBe('c3'));
      expect(saved('nb7')?.pages?.[0]?.blocks?.[0]?.docId).toBe('kb4');
      expect(saved('nb7')?.pages?.[0]?.blocks?.[0]?.cards).toBeUndefined();
    } finally {
      if (prev) doc.elementFromPoint = prev;
      else delete doc.elementFromPoint;
    }
  });

  it('빈 문단에 보드 주소를 붙여넣으면 임베드로 바뀐다', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mp2' }]);
    localStorage.setItem('mindflow_doc_mp2', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nb8', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [] }])));
    const { container } = renderEditor('/editor?map=nb8&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    line.focus();
    fireEvent.paste(line, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? '/editor?map=mp2' : ''), types: ['text/plain'] } });

    await waitFor(() => expect(container.querySelector('[data-embed-minimap]')).toBeTruthy());
    saveNow();
    await waitFor(() => expect(saved('nb8')?.pages?.[0]?.blocks?.[0]).toMatchObject({ kind: 'link', docId: 'mp2' }));
  });

  it('여섯 번째 임베드부터는 접어서 넣는다 — 한 페이지가 보드를 여러 벌 받지 않게', async () => {
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    seedSpace(ids.map((id) => ({ title: id, docId: id })));
    ids.forEach((id) => localStorage.setItem(`mindflow_doc_${id}`, JSON.stringify(MAP)));
    const blocks = ids.slice(0, 5).map((id, i) => ({ id: `b${i}`, kind: 'link', docId: id }));
    localStorage.setItem('mindflow_doc_nb6', JSON.stringify(noteWith([...blocks, { id: 'bx', kind: 'link' }])));
    const { container } = renderEditor('/editor?map=nb6&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-link-pick]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-link-pick]')!);
    await waitFor(() => expect(container.querySelector('[data-note-link-option="m6"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-link-option="m6"]')!);
    saveNow();
    await waitFor(() => expect(saved('nb6')?.pages?.[0]?.blocks?.[5]?.embed?.size).toBe('sm'));
  });
});

/**
 * 이번 라운드(제보 3·4·5·6·7) — 임베드가 **원본 보드와 같은 것**을 보여 주는가,
 * 다시 들어왔을 때 **자리가 흔들리지 않는가**, 그리고 **끌어 옮길 수 있는가**.
 */
describe('공책 본문 · 보드 임베드 2판 — 원본 충실도 · 깜빡임 · 끌어 옮기기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('카드의 **분류 색은 그 보드의 분류 색**이다 — 임베드가 강조색으로 칠하지 않는다(제보 3)', async () => {
    const doc = {
      ...KANBAN,
      tags: [{ id: 't1', name: '디자인', color: '#2f7d68' }],
      cards: [{ id: 'k1', col: 'c2', pos: 1, text: '표지 시안', tag: '디자인' }],
    };
    seedSpace([{ title: '색 보드', docId: 'kb9' }]);
    localStorage.setItem('mindflow_doc_kb9', JSON.stringify(doc));
    localStorage.setItem('mindflow_doc_nb9', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb9' }])));
    const { container } = renderEditor('/editor?map=nb9&title=x');

    const badge = (await waitFor(() => {
      const el = container.querySelector('[data-card-tag="디자인"]');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLElement;
    // 문서에 적힌 색(`#2f7d68` = rgb(47,125,104))이 배지의 바탕이다.
    expect(badge.style.background).toContain('47, 125, 104');
  });

  it('카드가 놓이는 자리는 **그 보드의 면**이다 — 바닥 < 열 두 층(제보 3: 배경색이 다르다)', async () => {
    seedSpace([{ title: '면 보드', docId: 'kb10' }]);
    localStorage.setItem('mindflow_doc_kb10', JSON.stringify(KANBAN));
    localStorage.setItem('mindflow_doc_nb10', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'kb10' }])));
    const { container } = renderEditor('/editor?map=nb10&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-field]')).toBeTruthy());
    const field = container.querySelector('[data-embed-field]') as HTMLElement;
    const cards = container.querySelector('[data-embed-cards]') as HTMLElement;
    // 두 면은 서로 다르다 — 한 층이 빠지면 원본과 달라 보인다.
    expect(field.style.background).toBeTruthy();
    expect(cards.style.background).toBeTruthy();
    expect(field.style.background).not.toBe(cards.style.background);
  });

  it('개요는 **자손을 전부** 편다 — `+n`으로 접지 않는다(제보 4)', async () => {
    // 「알림」 아래로 두 단계를 더 판다 — 예전에는 손자부터 `+n`으로 접혔다.
    const deep = {
      ...MAP,
      nodes: {
        ...MAP.nodes,
        a1: { id: 'a1', text: '웹 푸시', parent: 'a', children: ['a2'], x: 80, y: 0 },
        a2: { id: 'a2', text: '조용한 시간', parent: 'a1', children: [], x: 120, y: 0 },
      },
    };
    seedSpace([{ title: '릴리즈 맵', docId: 'mp9' }]);
    localStorage.setItem('mindflow_doc_mp9', JSON.stringify(deep));
    localStorage.setItem('mindflow_doc_nb11', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mp9' }])));
    const { container } = renderEditor('/editor?map=nb11&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-mmview="outline"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-embed-mmview="outline"]')!);
    await waitFor(() => expect(container.querySelector('[data-embed-outline]')).toBeTruthy());
    // 가지(알림) 아래의 자식과 **손자**가 깊이를 달고 한 줄씩 서 있다.
    const kids = [...container.querySelectorAll('[data-embed-depth]')].map((e) => `${e.getAttribute('data-embed-depth')}:${e.textContent}`);
    expect(kids).toContain('1:웹 푸시');
    expect(kids).toContain('2:조용한 시간');
    // 접어 세던 `+n` 줄은 더 이상 없다.
    expect(container.querySelector('[data-embed-outline]')?.textContent).not.toContain('+1');
  });

  it('내용은 **떠오르며** 들어온다 — 뼈대에서 내용으로 넘어가는 순간을 덮는다(제보 6)', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mp10' }]);
    localStorage.setItem('mindflow_doc_mp10', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nb12', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mp10' }])));
    const { container } = renderEditor('/editor?map=nb12&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-minimap]')).toBeTruthy());
    expect(container.querySelector('.mf-embed-in')).toBeTruthy();
  });

  it('임베드 판을 **끌어 다른 줄로** 옮긴다 — 그림과 같은 규칙이다(요청 7)', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mp11' }]);
    localStorage.setItem('mindflow_doc_mp11', JSON.stringify(MAP));
    localStorage.setItem(
      'mindflow_doc_nb13',
      JSON.stringify(noteWith([
        { id: 'b1', kind: 'link', docId: 'mp11' },
        { id: 'b2', kind: 'p', runs: [{ t: '아래 문단' }] },
      ])),
    );
    const { container } = renderEditor('/editor?map=nb13&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-minimap]')).toBeTruthy());

    // jsdom은 사각형이 전부 0이라 떨어질 자리를 잴 수 없다 — 두 블록의 상자만 세워 준다.
    const rect = (top: number, height: number) => () =>
      ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const wraps = [...container.querySelectorAll('[data-note-blockwrap]')] as HTMLElement[];
    expect(wraps.length).toBe(2);
    wraps[0]!.getBoundingClientRect = rect(0, 200);
    wraps[1]!.getBoundingClientRect = rect(200, 40);

    // 판의 빈 자리를 눌러 문단 아래(y=230)로 끈다.
    const panel = container.querySelector('[data-embed-card]') as HTMLElement;
    fireEvent.pointerDown(panel, { button: 0, clientX: 10, clientY: 10 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 230 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 230 }));

    saveNow();
    await waitFor(() => expect(saved('nb13')?.pages?.[0]?.blocks?.map((b: { id: string }) => b.id)).toEqual(['b2', 'b1']));
  });
});

/**
 * 설치형 앱(윈도) 테스트에서 온 임베드 손질 — 메뉴·기본 보기·배경·문구·단추 자리.
 */
describe('공책 본문 · 보드 임베드 3판 — 메뉴와 보기 손질(제보 5건)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('삽입한 문서의 우클릭 메뉴는 **그 블록이 할 수 있는 일만** 담는다(요청 1)', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mx1' }]);
    localStorage.setItem('mindflow_doc_mx1', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nx1', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mx1' }])));
    const { container } = renderEditor('/editor?map=nx1&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-card]')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('[data-embed-card]')!, { clientX: 40, clientY: 40 });
    const menu = (await waitFor(() => {
      const el = container.querySelector('[data-note-block-menu]');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLElement;
    expect([...menu.querySelectorAll('[data-note-ctx]')].map((e) => e.getAttribute('data-note-ctx'))).toEqual([
      'cut', 'copy', 'paste', 'paste-plain', 'open', 'embed-size', 'hr', 'del',
    ]);
    // 글꼴·링크·댓글처럼 **누를 수 없던 줄**은 없다.
    expect(menu.querySelector('[data-note-ctx="font"]')).toBeNull();
    expect(menu.querySelector('[data-note-ctx="link"]')).toBeNull();
    expect(menu.querySelector('[data-note-ctx="comment"]')).toBeNull();
    // 삭제가 무엇을 지우는지 한 줄로 말한다 — 원본 보드가 아니다.
    expect(menu.textContent).toContain('원본 문서는 그대로예요');
  });

  it('마인드맵은 **맵**으로 열린다(요청 2) — 개요는 골라서 본다', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mx2' }]);
    localStorage.setItem('mindflow_doc_mx2', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nx2', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mx2' }])));
    const { container } = renderEditor('/editor?map=nx2&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-minimap]')).toBeTruthy());
    expect(container.querySelector('[data-embed-mmview="map"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-embed-outline]')).toBeNull();
    // 배경에는 원본 캔버스와 같은 **도트 격자**가 깔린다(요청 3).
    expect((container.querySelector('[data-embed-minimap-dots]') as HTMLElement)?.style.backgroundImage).toContain('radial-gradient');
  });

  it('맵·화이트보드 아래의 「보기 전용」 안내 줄은 걷었다(요청 4)', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mx3' }, { title: '스케치판', docId: 'wx3' }]);
    localStorage.setItem('mindflow_doc_mx3', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_wx3', JSON.stringify({ ...base, kind: 'board', strokes: [], floats: [] }));
    localStorage.setItem(
      'mindflow_doc_nx3',
      JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mx3' }, { id: 'b2', kind: 'link', docId: 'wx3' }])),
    );
    const { container } = renderEditor('/editor?map=nx3&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-canvas]')).toBeTruthy());

    const bodies = [...container.querySelectorAll('[data-note-block][data-note-kind="link"]')].map((e) => e.textContent ?? '');
    expect(bodies.some((t) => t.includes('주제를 고치려면'))).toBe(false);
    expect(bodies.some((t) => t.includes('끌어서 움직이고'))).toBe(false);
  });

  it('화이트보드의 크기 단추는 **판 위**에 선다(요청 5)', async () => {
    seedSpace([{ title: '스케치판', docId: 'wx4' }]);
    localStorage.setItem('mindflow_doc_wx4', JSON.stringify({ ...base, kind: 'board', strokes: [], floats: [] }));
    localStorage.setItem('mindflow_doc_nx4', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'wx4' }])));
    const { container } = renderEditor('/editor?map=nx4&title=x');
    await waitFor(() => expect(container.querySelector('[data-embed-canvas]')).toBeTruthy());

    const seg = container.querySelector('[data-embed-wbheight]') as HTMLElement;
    const canvas = container.querySelector('[data-embed-canvas]') as HTMLElement;
    // jsdom에는 좌표가 없으므로(F1) **문서 순서**로 본다 — 앞에 서면 위에 그려진다.
    expect(seg.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
