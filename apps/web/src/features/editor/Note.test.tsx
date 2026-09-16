// 공책 — 네 번째 문서 종류(`kind: 'note'`). 캔버스가 아니라 **페이지의 글**이고,
// 저장·공유는 문서 기반이라 기존 경로를 그대로 탄다.
//
// 이 파일이 지키는 것: 캔버스 UI가 **하나도** 뜨지 않는다 · 글이 문서에 저장된다 ·
// 블록 종류를 바꿔도 글을 잃지 않는다 · **열 것이 없어지지 않는다**(마지막 페이지).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const NOTE = {
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
        { id: 'b1', kind: 'p', runs: [{ t: '릴리즈 범위를 좁혔습니다.', b: false, c: null }] },
        { id: 'b2', kind: 'h2', runs: [{ t: '결정한 것', b: false, c: null }] },
        {
          id: 'b3',
          kind: 'ck',
          items: [
            { id: 'i1', runs: [{ t: '알림을 분리한다', b: false, c: null }], done: false },
            { id: 'i2', runs: [{ t: '위젯은 다음으로', b: false, c: null }], done: true },
          ],
        },
        { id: 'b4', kind: 'table', rows: [[[{ t: '할 일', b: false, c: null }], [{ t: '담당', b: false, c: null }]], [[{ t: '문구 검수', b: false, c: null }], [{ t: '나', b: false, c: null }]]] },
      ],
      updatedAt: '2026-09-16T00:00:00.000Z',
    },
    { id: 'p2', title: '주간 회고', blocks: [{ id: 'b9', kind: 'p', runs: [{ t: 'Keep', b: false, c: null }] }] },
  ],
  cover: { tag: '회의록' },
};

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

const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');

/** 편집 박스에 글을 넣는다 — `contentEditable`이라 `input` 이벤트로 알린다. */
function type(el: Element, html: string): void {
  (el as HTMLElement).innerHTML = html;
  fireEvent.input(el);
}

/** 지금 상태를 저장한다 — 자동 저장은 디바운스라 테스트 시간 안에 오지 않는다
 *  (칸반 테스트와 같은 처방: ⌘/Ctrl+S로 확정한다). */
function saveNow(): void {
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

describe('공책 에디터', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('페이지 목록과 본문이 그려지고, **캔버스 UI는 하나도 없다**', async () => {
    localStorage.setItem('mindflow_doc_nb1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb1&title=x');

    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());
    // 페이지 목록 — 두 장.
    expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(2);
    // 본문 — 블록 넷.
    expect(container.querySelectorAll('[data-note-block]')).toHaveLength(4);
    expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('9월 3주 회의록');
    // 캔버스가 아니다 — 팬 레이어·줌·그리기가 없다.
    expect(container.querySelector('[data-pan-layer]')).toBeNull();
    expect(container.querySelector('[data-zoom-cluster]')).toBeNull();
  });

  it('블록마다 제 모양으로 그려진다 — 체크·표·제목', async () => {
    localStorage.setItem('mindflow_doc_nb2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-block="b3"]')).toBeTruthy());

    expect(container.querySelector('[data-note-block="b2"]')?.getAttribute('data-note-kind')).toBe('h2');
    // 체크리스트 — 항목 둘, 하나는 켜져 있다.
    const checks = container.querySelectorAll('[data-note-check]');
    expect(checks).toHaveLength(2);
    expect(checks[0]!.getAttribute('aria-checked')).toBe('false');
    expect(checks[1]!.getAttribute('aria-checked')).toBe('true');
    // 표 — 머리 행 + 본문 행.
    const rows = container.querySelectorAll('[data-note-block="b4"] tr');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('할 일')).toBeTruthy();
  });

  it('글을 쓰면 **그 페이지에** 저장된다', async () => {
    localStorage.setItem('mindflow_doc_nb3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    type(container.querySelector('[data-note-line="b1"]')!, '범위를 다시 좁혔습니다');
    saveNow();
    await waitFor(() => {
      const doc = saved('nb3');
      expect(doc?.pages?.[0]?.blocks?.[0]?.runs?.[0]?.t).toBe('범위를 다시 좁혔습니다');
    });
  });

  it('체크를 누르면 켜지고 저장된다', async () => {
    localStorage.setItem('mindflow_doc_nb4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb4&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-check="i1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-check="i1"]')!);
    saveNow();
    await waitFor(() => expect(saved('nb4')?.pages?.[0]?.blocks?.[2]?.items?.[0]?.done).toBe(true));
  });

  it('페이지를 눌러 옮기고, 새 페이지를 만든다', async () => {
    localStorage.setItem('mindflow_doc_nb5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb5&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-page-row="p2"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-page-row="p2"]')!);
    await waitFor(() => expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('주간 회고'));

    fireEvent.click(container.querySelector('[data-note-new-page]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(3));
    // 새 장은 **지금 장 바로 뒤**에 들어간다(글의 흐름).
    saveNow();
    await waitFor(() => expect(saved('nb5')?.pages?.length).toBe(3));
    expect(saved('nb5').pages[1].id).toBe('p2');
  });

  it('**마지막 페이지는 지울 수 없다** — 버튼이 꺼진다', async () => {
    const one = { ...NOTE, pages: [NOTE.pages[0]] };
    localStorage.setItem('mindflow_doc_nb6', JSON.stringify(one));
    const { container } = renderEditor('/editor?map=nb6&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-del-page]')).toBeTruthy());

    const del = container.querySelector('[data-note-del-page]') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toContain('한 장 이상');
  });

  it('두 장이면 지워지고 남은 장으로 옮겨 간다', async () => {
    localStorage.setItem('mindflow_doc_nb7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb7&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-del-page]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-del-page]') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(1));
    expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('주간 회고');
  });

  it('블록 종류를 바꿔도 **글을 잃지 않는다**', async () => {
    localStorage.setItem('mindflow_doc_nb8', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb8&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    // 툴바는 **포커스가 온 줄**을 기억한다(선택이 접혀 있어도 대상을 잃지 않게).
    fireEvent.focus(container.querySelector('[data-note-line="b1"]')!);
    fireEvent.mouseDown(container.querySelector('[data-note-blocktype]')!);
    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    fireEvent.click(await screen.findByText('글머리 목록'));
    saveNow();

    await waitFor(() => {
      const block = saved('nb8')?.pages?.[0]?.blocks?.[0];
      expect(block?.kind).toBe('ul');
      expect(block?.items?.[0]?.runs?.[0]?.t).toBe('릴리즈 범위를 좁혔습니다.');
    });
  });

  it('페이지 제목과 태그를 고친다', async () => {
    localStorage.setItem('mindflow_doc_nb9', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb9&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-title]')).toBeTruthy());

    fireEvent.change(container.querySelector('[data-note-title]')!, { target: { value: '9월 4주 회의록' } });
    saveNow();
    await waitFor(() => expect(saved('nb9')?.pages?.[0]?.title).toBe('9월 4주 회의록'));

    fireEvent.click(container.querySelector('[data-note-tag-pick]')!);
    fireEvent.click(await screen.findByText('리서치'));
    saveNow();
    await waitFor(() => expect(saved('nb9')?.pages?.[0]?.tag).toBe('리서치'));
  });

  it('표지 색을 고르면 문서에 남는다(홈 카드가 읽는 그 값)', async () => {
    localStorage.setItem('mindflow_doc_nb10', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb10&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-cover-btn]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-cover-btn]')!);
    fireEvent.click(await screen.findByLabelText('숲'));
    saveNow();
    await waitFor(() => expect(saved('nb10')?.cover?.color).toBe('#2F7D57'));
    // 태그는 그대로 — 표지 색은 태그를 덮지 않는다(둘은 따로 고르는 값이다).
    expect(saved('nb10').cover.tag).toBe('회의록');
  });

  it('표에 행·열을 더한다', async () => {
    localStorage.setItem('mindflow_doc_nb11', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb11&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-table-row]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-table-row]')!);
    saveNow();
    await waitFor(() => expect(saved('nb11')?.pages?.[0]?.blocks?.[3]?.rows?.length).toBe(3));
    fireEvent.click(container.querySelector('[data-note-table-col]')!);
    saveNow();
    await waitFor(() => expect(saved('nb11')?.pages?.[0]?.blocks?.[3]?.rows?.[0]?.length).toBe(3));
  });

  it('보기 전용이면 툴바가 없고 본문을 고칠 수 없다', async () => {
    localStorage.setItem('mindflow_doc_nb12', JSON.stringify(NOTE));
    // 보기 전용은 URL이 아니라 **공유 행**이 정한다(`ReadOnly.interactions`와 같은 처방).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'nb12', email: 'me@example.com', role: 'view', createdAt: new Date().toISOString() }]));
    const { container } = renderEditor('/editor?map=nb12&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());

    await waitFor(() => expect(container.querySelector('[data-note-toolbar]')).toBeNull());
    expect(container.querySelector('[data-note-new-page]')).toBeNull();
    expect(container.querySelector('[data-note-line="b1"]')?.getAttribute('contenteditable')).toBe('false');
  });
});

describe('공책 2판 — 공책 안에서 찾기 · 고급 블록 · 협업', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('**이 공책에서 찾기** — 제목과 본문을 함께 훑고, 걸린 줄을 보여 준다', async () => {
    localStorage.setItem('mindflow_doc_ns1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    // 본문에만 있는 낱말 — 제목으로는 못 찾는 장이다.
    fireEvent.change(container.querySelector('[data-note-search]')!, { target: { value: 'Keep' } });
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(1));
    expect(container.querySelector('[data-note-page-row="p2"]')).toBeTruthy();

    // 제목으로 찾으면 그 장만 남는다.
    fireEvent.change(container.querySelector('[data-note-search]')!, { target: { value: '회의록' } });
    await waitFor(() => expect(container.querySelector('[data-note-page-row="p1"]')).toBeTruthy());
    expect(container.querySelector('[data-note-page-row="p2"]')).toBeNull();
  });

  it('맞는 장이 없으면 그렇게 말한다', async () => {
    localStorage.setItem('mindflow_doc_ns2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    fireEvent.change(container.querySelector('[data-note-search]')!, { target: { value: '없는낱말' } });
    await waitFor(() => expect(container.querySelector('[data-note-search-empty]')).toBeTruthy());
    expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(0);
  });

  it('주소의 `page=`로 **그 장을 열고** 연다(홈 검색의 내용 줄이 오는 길)', async () => {
    localStorage.setItem('mindflow_doc_ns3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns3&title=x&page=p2');
    await waitFor(() => expect(container.querySelector('[data-note-title]')).toBeTruthy());
    await waitFor(() => expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('주간 회고'));
  });

  it('빈 줄에서 `/`를 치면 블록 목록이 뜨고, 고르면 그 줄의 종류가 바뀐다', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_ns4', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=ns4&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    fireEvent.keyDown(container.querySelector('[data-note-line="b1"]')!, { key: '/' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-slash-item="callout"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns4')?.pages?.[0]?.blocks?.[0]?.kind).toBe('callout'));
  });

  it('**글자가 있는 줄에서는 `/`가 그냥 글자다** — 코드·주소를 적다 메뉴가 끼어들지 않게', async () => {
    localStorage.setItem('mindflow_doc_ns5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns5&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    fireEvent.keyDown(container.querySelector('[data-note-line="b1"]')!, { key: '/' });
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-note-slash]')).toBeNull();
  });

  it('콜아웃은 어조를 돌려 가며 고른다(주의 → 결정 → 질문)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: 't', blocks: [{ id: 'b1', kind: 'callout', tone: 'warn', runs: [{ t: '보세요', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_ns6', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ns6&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-tone="warn"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-tone="warn"]')!);
    await waitFor(() => expect(container.querySelector('[data-note-tone="decide"]')).toBeTruthy());
    saveNow();
    await waitFor(() => expect(saved('ns6')?.pages?.[0]?.blocks?.[0]?.tone).toBe('decide'));
  });

  it('토글은 접고 펴며, 그 상태가 **문서에 남는다**', async () => {
    const doc = {
      ...NOTE,
      pages: [{ id: 'p1', title: 't', blocks: [{ id: 'b1', kind: 'toggle', open: true, runs: [{ t: '더 보기', b: false, c: null }], items: [{ id: 'i1', runs: [{ t: '숨긴 내용', b: false, c: null }] }] }] }],
    };
    localStorage.setItem('mindflow_doc_ns7', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ns7&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-toggle="open"]')).toBeTruthy());
    expect(container.querySelector('[data-note-line="b1:body"]')).toBeTruthy();

    fireEvent.click(container.querySelector('[data-note-toggle="open"]')!);
    await waitFor(() => expect(container.querySelector('[data-note-toggle="closed"]')).toBeTruthy());
    // 접으면 본문 줄이 사라진다.
    expect(container.querySelector('[data-note-line="b1:body"]')).toBeNull();
    saveNow();
    await waitFor(() => expect(saved('ns7')?.pages?.[0]?.blocks?.[0]?.open).toBe(false));
  });

  it('문서 링크는 **주소가 아니라 문서를 고른다**', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ spaces: [{ id: 's1', name: '일반', home: true, color: '#f0663f', maps: [{ title: '스프린트 보드', when: '방금', hue: '#f0663f', docId: 'mp9' }], folders: [] }], mapFolders: {} }),
    );
    const doc = { ...NOTE, pages: [{ id: 'p1', title: 't', blocks: [{ id: 'b1', kind: 'link' }] }] };
    localStorage.setItem('mindflow_doc_ns8', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ns8&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-link-pick]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-link-pick]')!);
    await waitFor(() => expect(container.querySelector('[data-note-link-option="mp9"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-link-option="mp9"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns8')?.pages?.[0]?.blocks?.[0]?.docId).toBe('mp9'));
  });

  it('이미지 블록은 올리기 전에는 **자리만** 잡는다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: 't', blocks: [{ id: 'b1', kind: 'img' }] }] };
    localStorage.setItem('mindflow_doc_ns9', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ns9&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-image-pick]')).toBeTruthy());
    expect(container.querySelector('[data-note-image]')).toBeNull();
  });

  it('캔버스 전용 도구는 뜨지 않는다 — 스타일·삽입·맵 검색', async () => {
    localStorage.setItem('mindflow_doc_ns10', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns10&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-share]')).toBeTruthy());

    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    expect(screen.queryByRole('button', { name: '스타일' })).toBeNull();
    expect(screen.queryByRole('button', { name: '맵에서 검색' })).toBeNull();
    // 공유는 남는다(보기 권한으로 부르는 길 — 요청). GNB와 공책 상단 바 **둘 다**에
    // 있다(요청: "상단 바에 공유도 다시 넣어줘") — 그래서 하나만 찾으면 안 된다.
    expect(screen.getAllByRole('button', { name: '공유' }).length).toBeGreaterThanOrEqual(2);
  });
});

// ── 3판(제보: "공책 에디터 페이지의 UI가 모두 틀어져 있어") ─────────────────────
//
// 겉모습을 픽셀로 고정하지는 않는다 — 이 파일이 지키는 것은 **디자인이 요구한 자리**가
// 실제로 있고 동작한다는 것이다: 상단 바(문서 칩이 페이지 목록을 덮지 않는다) ·
// 목록의 정렬·태그 거르개 · 툴바의 넣기/정렬 · 본문 끝의 글 부피.
describe('공책 3판 — 디자인 이식', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('문서 칩이 **상단 바 안에** 선다 — 페이지 목록을 덮지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ns20', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns20&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-topbar]')).toBeTruthy());

    const chip = container.querySelector('[data-doc-chip]') as HTMLElement;
    // 겹침의 원인이던 `position: absolute`가 아니라 **줄 안에** 선다.
    expect(chip.style.position).not.toBe('absolute');
    expect(container.querySelector('[data-note-topbar]')!.contains(chip)).toBe(true);
    // 그래서 목록의 검색칸이 가려지지 않고 실제로 있다.
    expect(container.querySelector('[data-note-search]')).toBeTruthy();
    // 칩 안에 공책 이름과 저장 단추가 함께 있다(디자인의 알약 한 덩이).
    expect(chip.querySelector('[data-note-book-title]')).toBeTruthy();
    expect(chip.querySelector('[data-note-save]')).toBeTruthy();
  });

  it('목록의 정렬을 **제목순**으로 바꾸면 순서가 바뀐다', async () => {
    localStorage.setItem('mindflow_doc_ns21', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns21&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]').length).toBe(2));

    const titles = () => [...container.querySelectorAll('[data-note-page-row]')].map((el) => el.getAttribute('data-note-page-row'));
    // 수정순: 시각이 있는 p1이 먼저다.
    expect(titles()[0]).toBe('p1');
    fireEvent.click(container.querySelector('[data-note-sort="title"]')!);
    // 제목순: `9월 3주 회의록` < `주간 회고`(ko) — 숫자가 한글보다 앞선다.
    expect(titles()).toEqual(['p1', 'p2']);
    // 고른 쪽이 눌린 상태로 표시된다.
    expect(container.querySelector('[data-note-sort="title"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('태그 거르개는 **그 태그의 페이지만** 남긴다', async () => {
    const tagged = { ...NOTE, pages: [{ ...NOTE.pages[0], tag: '회의록' }, { ...NOTE.pages[1], tag: '회고' }] };
    localStorage.setItem('mindflow_doc_ns22', JSON.stringify(tagged));
    const { container } = renderEditor('/editor?map=ns22&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]').length).toBe(2));

    fireEvent.click(container.querySelector('[data-note-tag-filter="회고"]')!);
    const rows = [...container.querySelectorAll('[data-note-page-row]')];
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute('data-note-page-row')).toBe('p2');
    // `전체`로 돌아오면 다시 둘.
    fireEvent.click(container.querySelector('[data-note-tag-filter="전체"]')!);
    expect(container.querySelectorAll('[data-note-page-row]').length).toBe(2);
  });

  it('툴바의 **넣기**가 블록을 만든다 — 빈 문단이면 그 줄의 종류를 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_ns23', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns23&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-insert="table"]')).toBeTruthy());

    const before = container.querySelectorAll('[data-note-block]').length;
    fireEvent.click(container.querySelector('[data-note-insert="table"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-note-block]').length).toBe(before + 1));
    saveNow();
    await waitFor(() => expect(saved('ns23').pages[0].blocks.filter((b: { kind: string }) => b.kind === 'table').length).toBe(2));
  });

  it('툴바의 **정렬**이 그 블록에 걸리고, 기본값(왼쪽)은 문서에 적지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ns24', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns24&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-align="center"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-align="center"]')!);
    saveNow();
    // 캐럿을 두지 않았으면 **마지막 블록**에 걸린다(툴바를 먼저 누르는 사람도 쓸 수 있게).
    await waitFor(() => {
      const blocks = saved('ns24').pages[0].blocks as { align?: string }[];
      expect(blocks[blocks.length - 1]!.align).toBe('center');
    });
    fireEvent.click(container.querySelector('[data-note-align="left"]')!);
    saveNow();
    await waitFor(() => {
      const blocks = saved('ns24').pages[0].blocks as { align?: string }[];
      expect('align' in blocks[blocks.length - 1]!).toBe(false);
    });
  });

  it('**목록이 어둡고 본문이 밝다** — 디자인의 밝기 관계(제보: 뒤집혀 있었다)', async () => {
    localStorage.setItem('mindflow_doc_ns26', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns26&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());

    // 색은 상단 바와 본문을 **함께 감싸는 한 겹**에 깔린다(둘이 같은 팔레트를 봐야 한다).
    const surface = container.querySelector('[data-note-topbar]')!.parentElement as HTMLElement;
    expect(surface.style.getPropertyValue('--mf-panel')).toBeTruthy();
    // 디자인의 종이 값 — 목록은 크림, 면은 종이, 본문은 그 사이, 상단은 한 톤 짙다.
    expect(surface.style.getPropertyValue('--mf-panel')).toBe('#fbf7f1');
    expect(surface.style.getPropertyValue('--mf-card')).toBe('#fffdfb');
    expect(surface.style.getPropertyValue('--mf-note-body')).toBe('#fdfbf8');
    expect(surface.style.getPropertyValue('--mf-note-bar')).toBe('#f6f0e8');
    // 상단 바에는 14px 도트 무늬가 깔린다(제보: "배경 패턴").
    const bar = container.querySelector('[data-note-topbar]') as HTMLElement;
    expect(bar.style.backgroundImage).toContain('radial-gradient');
    expect(bar.style.backgroundSize).toBe('14px 14px');
  });

  it('상단 바에 **공유**가 있다(요청) — GNB의 것과 별개로', async () => {
    localStorage.setItem('mindflow_doc_ns27', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns27&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-topbar]')).toBeTruthy());

    const share = container.querySelector('[data-note-share]') as HTMLElement;
    expect(share).toBeTruthy();
    expect(container.querySelector('[data-note-topbar]')!.contains(share)).toBe(true);
    expect(container.querySelector('[data-note-tab="댓글"]')).toBeTruthy();
    expect(container.querySelector('[data-note-tab="기록"]')).toBeTruthy();
  });

  it('본문 끝에 **글의 부피**가 적힌다', async () => {
    localStorage.setItem('mindflow_doc_ns25', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns25&title=x');
    const stats = await waitFor(() => {
      const el = container.querySelector('[data-note-stats]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(stats.textContent).toMatch(/\d+자/);
    expect(stats.textContent).toMatch(/\d+단어/);
    expect(stats.textContent).toMatch(/읽기 \d+분/);
  });
});
