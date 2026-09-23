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
    expect(container.querySelector('[data-embed-done]')?.textContent).toBe('완료 1/4');
    expect([...container.querySelectorAll('[data-embed-card-id]')].map((e) => e.textContent)).toContain('알림 분리');
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
    expect(container.querySelector('[data-embed-done]')?.textContent).toBe('완료 1/4');

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

  it('마인드맵은 개요로 펴지고 가지를 접었다 펼 수 있다', async () => {
    seedSpace([{ title: '릴리즈 맵', docId: 'mp1' }]);
    localStorage.setItem('mindflow_doc_mp1', JSON.stringify(MAP));
    localStorage.setItem('mindflow_doc_nb4', JSON.stringify(noteWith([{ id: 'b1', kind: 'link', docId: 'mp1' }])));
    const { container } = renderEditor('/editor?map=nb4&title=x');

    await waitFor(() => expect(container.querySelector('[data-embed-outline]')).toBeTruthy());
    expect(container.querySelector('[data-embed-kind="map"]')).toBeTruthy();
    expect(container.querySelector('[data-embed-rule]')?.textContent).toBe('보기 전용');
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

    await waitFor(() => expect(container.querySelector('[data-embed-outline]')).toBeTruthy());
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
