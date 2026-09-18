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
    // 표 — 머리 행 + 본문 행(맨 위의 열 손잡이 줄은 글이 아니라 조작이라 뺀다).
    const rows = container.querySelectorAll('[data-note-block="b4"] tr:not(.mf-note-thandle-row)');
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

  // 페이지 조작은 **목록 행의 우클릭**에 있다(요청으로 본문 머리에서 옮겼다).
  it('**마지막 페이지는 지울 수 없다** — 메뉴 항목이 꺼진다', async () => {
    const one = { ...NOTE, pages: [NOTE.pages[0]] };
    localStorage.setItem('mindflow_doc_nb6', JSON.stringify(one));
    const { container } = renderEditor('/editor?map=nb6&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-page-row]')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('[data-note-page-row]')!);
    const del = (await waitFor(() => container.querySelector('[data-note-page-del]'))) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toContain('한 장 이상');
  });

  it('두 장이면 지워지고 남은 장으로 옮겨 간다', async () => {
    localStorage.setItem('mindflow_doc_nb7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb7&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-page-row]')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('[data-note-page-row]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-page-del]'))) as HTMLButtonElement);
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
    // 블록 메뉴는 **글의 종류**만 담는다(디자인) — 인용으로 바꿔도 글은 그대로다.
    fireEvent.click(await screen.findByText('인용'));
    saveNow();

    await waitFor(() => {
      const block = saved('nb8')?.pages?.[0]?.blocks?.[0];
      expect(block?.kind).toBe('q');
      expect(block?.runs?.[0]?.t).toBe('릴리즈 범위를 좁혔습니다.');
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

  it('표에 행·열을 더한다 — 메뉴의 `아래에 행 추가`·`오른쪽에 열 추가`', async () => {
    localStorage.setItem('mindflow_doc_nb11', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb11&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    let menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-row"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="row-below"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('nb11')?.pages?.[0]?.blocks?.[3]?.rows?.length).toBe(3));

    fireEvent.contextMenu(cell);
    menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-col"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="col-right"]'))) as HTMLElement);
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
    // 공유는 남는다(보기 권한으로 부르는 길 — 요청). 공책에서는 **GNB를 띄우지 않으므로**
    // (요청) 상단 바의 하나뿐이다.
    expect(screen.getAllByRole('button', { name: '공유' })).toHaveLength(1);
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
    // 상단 바는 **평평하고**(한때 한 톤 짙은 면에 14px 도트를 깔았다) 아래 툴바와
    // 같은 면을 쓴다 — 둘이 한 장으로 이어지고, 갈리는 것은 선뿐이다(요청·시안).
    const bar = container.querySelector('[data-note-topbar]') as HTMLElement;
    expect(bar.style.backgroundImage).toBe('');
    expect(bar.style.background).toBe('var(--mf-card)');
    expect(bar.style.borderBottom).toBe('1px solid var(--mf-border-soft)');
    // 문서 칸은 **아래 목록과 같은 폭**이라 그 오른쪽 선이 목록의 경계선으로 이어진다.
    const chip = container.querySelector('[data-doc-chip]') as HTMLElement;
    expect(chip.style.flex).toBe('0 0 292px');
    expect(chip.style.borderRight).toBe('1px solid var(--mf-border-soft)');
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
    // `읽기 n분`은 뺐다(요청) — 한 장짜리 페이지에서 말해 주는 것이 거의 없었다.
    expect(stats.textContent).not.toMatch(/읽기/);
  });
});

// ── 4판(제보 15건 중 1판: 팝업 위치·닫힘과 작은 수정) ────────────────────────
describe('공책 4판 — 팝업이 잘리지 않고, 바깥을 누르면 닫힌다', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('공책 전환 팝업은 **화면 좌표**로 뜬다 — 본문 상자에 잘리지 않게', async () => {
    localStorage.setItem('mindflow_doc_ns30', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns30&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-book-switch]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-book-switch]')!);
    const menu = (await waitFor(() => container.querySelector('[data-note-book-menu]'))) as HTMLElement;
    // `absolute`면 `overflow:hidden`인 조상(상단 바·본문)에 잘린다 — 그게 제보였다.
    expect(menu.style.position).toBe('fixed');
  });

  it('바깥을 누르면 닫힌다 — 모든 팝업에 같은 규칙', async () => {
    localStorage.setItem('mindflow_doc_ns31', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns31&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-blocktype]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    await waitFor(() => expect(container.querySelector('[data-note-blocktype-menu]')).toBeTruthy());
    // 바깥 아무 곳이나 누르면 닫힌다(Esc도 같은 길).
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(container.querySelector('[data-note-blocktype-menu]')).toBeNull());

    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    await waitFor(() => expect(container.querySelector('[data-note-blocktype-menu]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-blocktype-menu]')).toBeNull());
  });

  it('`/` 목록은 **누른 단추**를 기준으로 뜬다 — 본문 맨 아래가 아니라', async () => {
    localStorage.setItem('mindflow_doc_ns32', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns32&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-slash-btn]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-slash-btn]')!);
    const pop = (await waitFor(() => container.querySelector('[data-note-slash] > div'))) as HTMLElement;
    expect(pop.style.position).toBe('fixed');
  });

  it('태그를 안 고른 페이지는 목록에 **태그 없음**으로 선다', async () => {
    const noTag = { ...NOTE, pages: [{ ...NOTE.pages[0], tag: undefined }, NOTE.pages[1]] };
    localStorage.setItem('mindflow_doc_ns33', JSON.stringify(noTag));
    const { container } = renderEditor('/editor?map=ns33&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-page-tag]')).toBeTruthy());

    // 자리를 비우지 않는다 — 빈 자리는 "안 정했다"인지 "줄이 없다"인지 말해 주지 않는다.
    expect(container.querySelector('[data-note-page-tag]')!.textContent).toContain('태그 없음');
  });

  it('머리와 본문 사이에 구분선이 있다', async () => {
    localStorage.setItem('mindflow_doc_ns34', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns34&title=x');
    const head = await waitFor(() => container.querySelector('.mf-note-head') as HTMLElement);
    const line = head.nextElementSibling as HTMLElement;
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(line.style.height).toBe('1px');
  });
});

// ── 5판(15건 중 2판: 편집 동작) ──────────────────────────────────────────────
describe('공책 5판 — 편집 동작', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('블록 메뉴는 **여덟**이다 — 글의 종류만(요청·시안)', async () => {
    localStorage.setItem('mindflow_doc_ns40', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns40&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-blocktype]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    const menu = (await waitFor(() => container.querySelector('[data-note-blocktype-menu]'))) as HTMLElement;
    expect([...menu.querySelectorAll('[data-note-blocktype-item]')].map((b) => b.getAttribute('data-note-blocktype-item'))).toEqual([
      'p', 'h1', 'h2', 'h3', 'q', 'callout', 'toggle', 'code',
    ]);
    // 단추는 **폭이 고정**이라 이름이 길어져도(`코드 블록`) 오른쪽 단추들이 밀리지 않는다.
    expect((container.querySelector('[data-note-blocktype]') as HTMLElement).style.width).toBe('118px');
  });

  it('첫 줄 안내는 **페이지가 통째로 빌 때만** 뜬다', async () => {
    localStorage.setItem('mindflow_doc_ns41', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns41&title=x');
    const first = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 아래에 글이 남아 있으므로, 첫 줄을 비워도 안내가 나오지 않는다(제보).
    type(first, '');
    await waitFor(() => expect(first.getAttribute('data-placeholder')).toBe(''));
  });

  it('끝낸 체크 항목에는 **취소선**이 그어진다', async () => {
    localStorage.setItem('mindflow_doc_ns42', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns42&title=x');
    // NOTE의 i2가 done: true다.
    const done = (await waitFor(() => container.querySelector('[data-note-line="b3:i2"]'))) as HTMLElement;
    expect(done.style.textDecoration).toContain('line-through');
    const open = container.querySelector('[data-note-line="b3:i1"]') as HTMLElement;
    expect(open.style.textDecoration).not.toContain('line-through');
  });

  it('굵은 글에 캐럿을 두면 **굵게 단추가 켜진다**', async () => {
    const bold = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '굵은 글', b: true, c: null }] }] }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ns43', JSON.stringify(bold));
    const { container } = renderEditor('/editor?map=ns43&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 그 줄 전체를 고른다 — 툴바는 `selectionchange`를 듣는다.
    const range = document.createRange();
    range.selectNodeContents(line);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    await waitFor(() => expect(container.querySelector('[data-note-mark="b"]')!.getAttribute('aria-pressed')).toBe('true'));
    expect(container.querySelector('[data-note-mark="i"]')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('공책 6판 — 페이지 메뉴와 표', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 페이지 줄을 우클릭해 메뉴를 연다. */
  async function openPageMenu(container: HTMLElement, pageId: string): Promise<HTMLElement> {
    const row = (await waitFor(() => container.querySelector(`[data-note-page-row="${pageId}"]`))) as HTMLElement;
    fireEvent.contextMenu(row);
    return (await waitFor(() => row.querySelector('[data-note-page-menu]'))) as HTMLElement;
  }

  it('페이지 우클릭 메뉴가 **그 페이지의 것**임을 이름으로 말하고, 항목 여섯을 준다', async () => {
    localStorage.setItem('mindflow_doc_ns50', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns50&title=x');
    const menu = await openPageMenu(container, 'p1');

    expect(within(menu).getByText('9월 3주 회의록')).toBeTruthy();
    for (const mark of ['rename-open', 'dup', 'up', 'down', 'move', 'del']) {
      expect(menu.querySelector(`[data-note-page-${mark}]`)).toBeTruthy();
    }
    // 첫 장이라 `위로`는 꺼져 있고, 두 장뿐이라 `아래로`는 살아 있다.
    expect((menu.querySelector('[data-note-page-up]') as HTMLButtonElement).disabled).toBe(true);
    expect((menu.querySelector('[data-note-page-down]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('`이름 바꾸기`는 **그 자리에서** 고치고 Enter로 확정한다', async () => {
    localStorage.setItem('mindflow_doc_ns51', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns51&title=x');
    const menu = await openPageMenu(container, 'p1');

    fireEvent.click(menu.querySelector('[data-note-page-rename-open]')!);
    const input = (await waitFor(() => container.querySelector('[data-note-page-rename="p1"]'))) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9월 4주 회의록' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('ns51').pages[0].title).toBe('9월 4주 회의록'));
  });

  it('`아래로`가 페이지 순서를 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_ns52', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns52&title=x');
    const menu = await openPageMenu(container, 'p1');

    fireEvent.click(menu.querySelector('[data-note-page-down]')!);
    saveNow();

    await waitFor(() => expect(saved('ns52').pages.map((p: { id: string }) => p.id)).toEqual(['p2', 'p1']));
  });

  it('`다른 공책으로 이동`은 **받는 쪽에 쓴 뒤에만** 이쪽에서 뺀다', async () => {
    localStorage.setItem('mindflow_doc_ns53', JSON.stringify(NOTE));
    // 받는 공책 — 페이지 한 장짜리.
    localStorage.setItem(
      'mindflow_doc_ns54',
      JSON.stringify({ ...NOTE, pages: [{ id: 'q1', title: '설계 노트', blocks: [{ id: 'c1', kind: 'p', runs: [{ t: '초안', b: false, c: null }] }] }] }),
    );
    localStorage.setItem('mindflow_doc_meta_ns54', JSON.stringify({ title: '설계 공책', kind: 'note' }));
    // 옮겨 갈 후보는 **워크스페이스 목록**에서 온다(`linkTargets`) — 홈이 카드를
    // 그리는 그 목록이라, 여기 없는 문서는 고를 수도 없다.
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [{ name: '일반 공간', maps: [{ title: '회의 공책', docId: 'ns53' }, { title: '설계 공책', docId: 'ns54' }] }],
        mapFolders: {},
        recent: [],
      }),
    );
    const { container } = renderEditor('/editor?map=ns53&title=x');
    const menu = await openPageMenu(container, 'p1');

    fireEvent.click(menu.querySelector('[data-note-page-move]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-page-move-menu]'))) as HTMLElement;
    const target = (await waitFor(() => wing.querySelector('[data-note-page-move-to="ns54"]'))) as HTMLElement;
    fireEvent.click(target);

    // 받는 쪽에 붙었다.
    await waitFor(() => expect(saved('ns54').pages).toHaveLength(2));
    expect(saved('ns54').pages[1].title).toBe('9월 3주 회의록');
    // id는 새로 찍는다 — 같은 id가 두 공책에 있으면 한쪽을 고칠 때 다른 쪽이 따라 바뀐다.
    expect(saved('ns54').pages[1].id).not.toBe('p1');
    // 그리고 이쪽에서 빠졌다.
    saveNow();
    await waitFor(() => expect(saved('ns53').pages.map((p: { id: string }) => p.id)).toEqual(['p2']));
  });

  it('마지막 한 장은 옮기지도 지우지도 못한다', async () => {
    localStorage.setItem('mindflow_doc_ns55', JSON.stringify({ ...NOTE, pages: [NOTE.pages[0]] }));
    const { container } = renderEditor('/editor?map=ns55&title=x');
    const menu = await openPageMenu(container, 'p1');

    expect((menu.querySelector('[data-note-page-move]') as HTMLButtonElement).disabled).toBe(true);
    expect((menu.querySelector('[data-note-page-del]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('표 — 칸을 고르면 표시되고, 우클릭 메뉴가 디자인대로 선다', async () => {
    localStorage.setItem('mindflow_doc_ns56', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns56&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    // 칸 여백에서 누르면 그 칸이 골라진다(글 위에서 누르면 캐럿만 — 아래 14판).
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(cell.getAttribute('data-picked')).toBe('1'));

    fireEvent.contextMenu(cell);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    // 머리 — 무엇을 골랐는지. **좌표(A1·B열)는 쓰지 않는다**(스펙 §1).
    expect(menu.textContent).toContain('표 · 칸 선택');
    expect(menu.textContent).not.toMatch(/표 · [A-Z]/);
    for (const act of ['t-cut', 't-copy', 't-paste', 't-pick', 't-row', 't-col', 't-align', 't-fill', 't-head', 't-dup', 't-csv', 't-del']) {
      expect(menu.querySelector(`[data-note-ctx="${act}"]`)).toBeTruthy();
    }
  });

  it('표 — 행 지우기·열 지우기가 그 줄만 뺀다', async () => {
    localStorage.setItem('mindflow_doc_ns57', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns57&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    let menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-col"]')!);
    let wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="열"]'))) as HTMLElement;
    fireEvent.click(wing.querySelector('[data-note-ctx="col-del"]')!);
    saveNow();
    await waitFor(() => {
      const rows = saved('ns57').pages[0].blocks[3].rows as unknown[][];
      expect(rows.every((r) => r.length === 1)).toBe(true);
    });
    // 남은 열은 첫 번째다 — 지운 것은 고른 칸의 열(둘째).
    expect(saved('ns57').pages[0].blocks[3].rows[0][0][0].t).toBe('할 일');

    const left = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    fireEvent.contextMenu(left);
    menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-row"]')!);
    wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="행"]'))) as HTMLElement;
    fireEvent.click(wing.querySelector('[data-note-ctx="row-del"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns57').pages[0].blocks[3].rows).toHaveLength(1));
    expect(saved('ns57').pages[0].blocks[3].rows[0][0][0].t).toBe('할 일');
  });

  it('표 — 손잡이로 연 메뉴도 같은 메뉴고, 열을 그 자리에 넣는다', async () => {
    localStorage.setItem('mindflow_doc_ns58', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns58&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;

    // 한 번은 고르기, 한 번 더가 메뉴다(스펙 3-2).
    fireEvent.click(handle);
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();
    fireEvent.click(handle);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-col"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="열"]'))) as HTMLElement;
    fireEvent.click(wing.querySelector('[data-note-ctx="col-left"]')!);
    saveNow();

    await waitFor(() => {
      const rows = saved('ns58').pages[0].blocks[3].rows as { t: string }[][][];
      expect(rows[0]).toHaveLength(3);
      // 새 칸이 맨 앞에 들어갔다 — `할 일`은 한 칸 밀린다.
      expect(rows[0]![1]![0]!.t).toBe('할 일');
    });
  });

  it('표 — 열 정렬과 머리글 행 끄기가 문서에 남는다', async () => {
    localStorage.setItem('mindflow_doc_ns58b', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns58b&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    let menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-align"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="정렬"]'))) as HTMLElement;
    fireEvent.click(wing.querySelector('[data-note-ctx="align-center"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns58b').pages[0].blocks[3].colAlign).toEqual(['left', 'center']));

    fireEvent.contextMenu(cell);
    menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    // 켜짐이 기본이라 **끌 때만** 문서에 적힌다.
    fireEvent.click(menu.querySelector('[data-note-ctx="t-head"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns58b').pages[0].blocks[3].head).toBe(false));
  });

  it('마지막 한 행·한 열은 지우지 못한다', async () => {
    const one = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: [{ id: 'b4', kind: 'table', rows: [[[{ t: '하나', b: false, c: null }]]] }] }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ns59', JSON.stringify(one));
    const { container } = renderEditor('/editor?map=ns59&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-row"]')!);
    const rowWing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="행"]'))) as HTMLElement;
    expect((rowWing.querySelector('[data-note-ctx="row-del"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(menu.querySelector('[data-note-ctx="t-col"]')!);
    const colWing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="열"]'))) as HTMLElement;
    expect((colWing.querySelector('[data-note-ctx="col-del"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('공책 7판 — 본문 우클릭 메뉴', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 본문의 한 블록에서 우클릭해 메뉴를 연다. */
  async function openCtx(container: HTMLElement, blockId: string): Promise<HTMLElement> {
    const line = (await waitFor(() => container.querySelector(`[data-note-line="${blockId}"]`))) as HTMLElement;
    fireEvent.contextMenu(line, { bubbles: true });
    return (await waitFor(() => container.querySelector('[data-note-block-menu]'))) as HTMLElement;
  }

  it('블록 메뉴가 **네 묶음 열둘**을 준다(디자인)', async () => {
    localStorage.setItem('mindflow_doc_ns60', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns60&title=x');
    const menu = await openCtx(container, 'b1');

    for (const mark of ['cut', 'copy', 'paste', 'paste-plain', 'style', 'font', 'link', 'dup', 'comment', 'todo', 'hr', 'del']) {
      expect(menu.querySelector(`[data-note-ctx="${mark}"]`)).toBeTruthy();
    }
  });

  it('`문단 스타일`이 그 블록의 종류를 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_ns61', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns61&title=x');
    const menu = await openCtx(container, 'b1');

    fireEvent.click(menu.querySelector('[data-note-ctx="style"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="문단 스타일"]'))) as HTMLElement;
    fireEvent.click(wing.querySelector('[data-note-ctx="style-ck"]')!);
    saveNow();

    await waitFor(() => expect(saved('ns61').pages[0].blocks[0].kind).toBe('ck'));
  });

  it('`블록 복제`·`아래에 구분선`·`블록 삭제`', async () => {
    localStorage.setItem('mindflow_doc_ns62', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns62&title=x');

    let menu = await openCtx(container, 'b1');
    fireEvent.click(menu.querySelector('[data-note-ctx="dup"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns62').pages[0].blocks).toHaveLength(5));
    // 복제본은 **바로 아래**에 서고 글은 같다(id는 새로 찍는다).
    expect(saved('ns62').pages[0].blocks[1].runs[0].t).toBe('릴리즈 범위를 좁혔습니다.');
    expect(saved('ns62').pages[0].blocks[1].id).not.toBe('b1');

    menu = await openCtx(container, 'b1');
    fireEvent.click(menu.querySelector('[data-note-ctx="hr"]')!);
    saveNow();
    await waitFor(() => expect(saved('ns62').pages[0].blocks[1].kind).toBe('hr'));

    menu = await openCtx(container, 'b1');
    fireEvent.click(menu.querySelector('[data-note-ctx="del"]')!);
    saveNow();
    await waitFor(() => expect((saved('ns62').pages[0].blocks as { id: string }[]).some((b) => b.id === 'b1')).toBe(false));
  });

  it('`할 일로 보내기`가 **그 보드의 첫 열**에 카드를 만든다', async () => {
    localStorage.setItem('mindflow_doc_ns63', JSON.stringify(NOTE));
    localStorage.setItem(
      'mindflow_doc_kb1',
      JSON.stringify({
        v: 1,
        nodes: {},
        floats: [],
        lines: [],
        zones: [],
        layoutMode: 'right',
        themeKey: 'white',
        kind: 'kanban',
        columns: [{ id: 'c1', title: '할 일' }, { id: 'c2', title: '완료' }],
        cards: [],
      }),
    );
    localStorage.setItem('mindflow_doc_meta_kb1', JSON.stringify({ title: '스프린트 보드', version: 1, updatedAt: '2026-09-16T00:00:00.000Z' }));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [{ name: '일반 공간', maps: [{ title: '회의 공책', docId: 'ns63' }, { title: '스프린트 보드', docId: 'kb1' }] }],
        mapFolders: {},
        recent: [],
      }),
    );
    const { container } = renderEditor('/editor?map=ns63&title=x');
    const menu = await openCtx(container, 'b1');

    fireEvent.click(menu.querySelector('[data-note-ctx="todo"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="할 일로 보내기"]'))) as HTMLElement;
    const pick = (await waitFor(() => wing.querySelector('[data-note-todo-to="kb1"]'))) as HTMLElement;
    fireEvent.click(pick);

    await waitFor(() => expect(saved('kb1').cards).toHaveLength(1));
    expect(saved('kb1').cards[0].col).toBe('c1');
    expect(saved('kb1').cards[0].text).toBe('릴리즈 범위를 좁혔습니다.');
  });
});

describe('공책 8판 — 태그 색 고르기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 태그 칩을 눌러 팝업을 열고 `태그 만들기`까지 편다. */
  async function openNewTag(container: HTMLElement): Promise<HTMLElement> {
    const chip = (await waitFor(() => container.querySelector('[data-note-tag-pick]'))) as HTMLElement;
    fireEvent.click(chip);
    const menu = (await waitFor(() => container.querySelector('[data-note-tag-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-tag-add]')!);
    await waitFor(() => expect(menu.querySelector('[data-note-tag-new]')).toBeTruthy());
    return menu;
  }

  it('새 태그를 만들 때 **점 색을 고를 수 있고**, 고른 값이 문서에 남는다', async () => {
    localStorage.setItem('mindflow_doc_ns70', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns70&title=x');
    const menu = await openNewTag(container);

    // 고를 수 있는 색 여덟(해시 팔레트와 같은 목록).
    expect(menu.querySelectorAll('[data-note-tag-hue]')).toHaveLength(8);
    fireEvent.click(menu.querySelector('[data-note-tag-hue="#7C9BD8"]')!);
    // 입력 줄의 점이 고른 색으로 바뀐다 — 넣기 전에 결과가 보인다.
    await waitFor(() => expect((menu.querySelector('[data-note-tag-newdot]') as HTMLElement).style.background).toBe('rgb(124, 155, 216)'));

    const input = menu.querySelector('[data-note-tag-new]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '스프린트' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('ns70').pages[0].tag).toBe('스프린트'));
    expect(saved('ns70').tagColors).toEqual({ 스프린트: '#7C9BD8' });
  });

  it('색을 고르지 않으면 이름에서 정해진다 — 문서에 칸이 생기지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ns71', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns71&title=x');
    const menu = await openNewTag(container);

    const input = menu.querySelector('[data-note-tag-new]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '릴리즈' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('ns71').pages[0].tag).toBe('릴리즈'));
    expect(saved('ns71').tagColors).toBeUndefined();
  });

  it('고른 색은 **목록과 칩에도** 그대로 쓰인다', async () => {
    const picked = {
      ...NOTE,
      tagColors: { 회의록: '#69B08A' },
      pages: [{ ...NOTE.pages[0], tag: '회의록' }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ns72', JSON.stringify(picked));
    const { container } = renderEditor('/editor?map=ns72&title=x');

    const chip = (await waitFor(() => container.querySelector('[data-note-tag-pick]'))) as HTMLElement;
    // 칩의 점 — 기본 자두(#C98BB4)가 아니라 고른 초록이다.
    const dot = chip.querySelector('span') as HTMLElement;
    expect(dot.style.background).toBe('rgb(105, 176, 138)');
    // 페이지 목록의 태그 점도 같은 색.
    const row = container.querySelector('[data-note-page-row="p1"] [data-note-page-tag] span') as HTMLElement;
    expect(row.style.background).toBe('rgb(105, 176, 138)');
  });
});

describe('공책 9판 — 블록을 가로지르는 **글자** 선택', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 문단에서 눌러 다른 줄까지 끌고 간다(좌표는 jsdom에서 0이라 `elementFromPoint`를 세운다). */
  function dragOver(container: HTMLElement, fromId: string, toId: string): void {
    const col = container.querySelector(`[data-note-blockwrap="${fromId}"]`)!.parentElement as HTMLElement;
    const from = container.querySelector(`[data-note-line="${fromId}"]`) as HTMLElement;
    const to = (container.querySelector(`[data-note-line="${toId}"]`) ?? container.querySelector(`[data-note-block="${toId}"]`)) as HTMLElement;
    fireEvent.pointerDown(from, { bubbles: true });
    const real = document.elementFromPoint;
    document.elementFromPoint = () => to;
    try {
      fireEvent.pointerMove(col, { buttons: 1, clientX: 10, clientY: 200 });
    } finally {
      document.elementFromPoint = real;
    }
    fireEvent.pointerUp(col);
  }

  it('블록 경계를 넘으면 그 사이 줄들이 한 덩이로 골라진다', async () => {
    localStorage.setItem('mindflow_doc_ns80', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns80&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    dragOver(container, 'b1', 'b2');
    const picked = await waitFor(() => {
      const els = [...container.querySelectorAll('[data-note-blockwrap][data-selected]')];
      expect(els.length).toBeGreaterThan(1);
      return els.map((el) => el.getAttribute('data-note-blockwrap'));
    });
    // 지나온 줄들이 한 덩이로 골라진다(문서 순서). 칠하기(`CSS.highlights`)가 없는
    // 하네스에서는 그 표시가 블록 면으로 물러선다 — 골라진 범위는 같다.
    expect(picked).toEqual(['b1', 'b2']);
  });

  it('고른 글자는 ⌫로 지우고 Esc로 놓는다 — 첫 줄과 마지막 줄이 이어 붙는다', async () => {
    localStorage.setItem('mindflow_doc_ns81', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns81&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    dragOver(container, 'b1', 'b2');
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(0));

    dragOver(container, 'b1', 'b2');
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'Backspace' });
    saveNow();
    await waitFor(() => {
      const ids = (saved('ns81').pages[0].blocks as { id: string }[]).map((b) => b.id);
      // 글자를 지운 것이지 블록을 지운 것이 아니다 — 첫 줄은 **남고**(비었다), 그
      // 뒤의 줄만 빠진다(메모장에서 두 줄을 골라 지운 것과 같은 결과).
      expect(ids).toEqual(['b1', 'b3', 'b4']);
    });
    expect(saved('ns81').pages[0].blocks[0].runs[0].t).toBe('');
  });

  it('한 블록 안에서는 브라우저의 선택 그대로다 — 면을 깔지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ns82', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns82&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    fireEvent.pointerDown(line, { bubbles: true });
    fireEvent.pointerMove(line, { buttons: 1, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(line);

    expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(0);
  });
});

describe('공책 10판 — 태그·툴바·새 페이지', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('`블록 넣기` 목록은 **바깥을 누르면 닫힌다**(제보)', async () => {
    localStorage.setItem('mindflow_doc_ns90', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns90&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-slash-btn]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-slash-btn]')!);
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());
  });

  it('새 페이지는 **목록 위의 띠**다 — 눌러서 한 장 더한다(요청·시안)', async () => {
    localStorage.setItem('mindflow_doc_ns91', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns91&title=x');
    const band = (await waitFor(() => container.querySelector('[data-note-new-page]'))) as HTMLElement;

    expect(band.textContent).toContain('새 페이지');
    expect(band.style.border).toContain('dashed');
    fireEvent.click(band);
    saveNow();
    await waitFor(() => expect(saved('ns91').pages).toHaveLength(3));
  });

  it('태그 칩은 종이 면 + 테두리이고, 안내문은 없다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ns92', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns92&title=x');
    const chip = (await waitFor(() => container.querySelector('[data-note-tag-pick]'))) as HTMLElement;

    expect(chip.style.background).toBe('var(--mf-panel)');
    fireEvent.click(chip);
    const menu = (await waitFor(() => container.querySelector('[data-note-tag-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-tag-add]')!);
    await waitFor(() => expect(menu.querySelector('[data-note-tag-new]')).toBeTruthy());
    // 색 고르개는 남고 안내문만 뺐다.
    expect(menu.querySelectorAll('[data-note-tag-hue]')).toHaveLength(8);
    expect(menu.textContent).not.toContain('Esc로 취소');
  });
});

describe('공책 11판 — `/`는 글자로 남는다', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 그 줄에 글을 넣고 `/`를 친 상태로 만든다(브라우저가 글자를 넣는 자리를 흉내). */
  function typeSlash(container: HTMLElement, key: string, text: string): HTMLElement {
    const line = container.querySelector(`[data-note-line="${key}"]`) as HTMLElement;
    fireEvent.keyDown(line, { key: '/' });
    type(line, text);
    return line;
  }

  it('`/`는 본문에 남고, 목록은 **이어 친 글자**로 좁혀진다', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_nsA0', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=nsA0&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    typeSlash(container, 'b1', '/인용');
    await waitFor(() => expect(container.querySelector('[data-note-slash-q]')?.textContent).toBe('인용'));
    // 좁혀진 목록에는 그 하나만 남는다.
    expect([...container.querySelectorAll('[data-note-slash-item]')].map((b) => b.getAttribute('data-note-slash-item'))).toEqual(['q']);
    // 그리고 글자는 본문에 그대로 있다.
    saveNow();
    await waitFor(() => expect(saved('nsA0').pages[0].blocks[0].runs[0].t).toBe('/인용'));
  });

  it('고르면 `/질의`가 지워지고 그 줄의 종류가 바뀐다', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_nsA1', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=nsA1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    typeSlash(container, 'b1', '/콜아웃');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="callout"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-item="callout"]')!);
    saveNow();

    await waitFor(() => expect(saved('nsA1').pages[0].blocks[0].kind).toBe('callout'));
    expect(runsOf(saved('nsA1').pages[0].blocks[0])).toBe('');
  });

  it('Esc로 닫으면 **친 글자가 그대로 남는다**(제보·노션과 같은 동작)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_nsA2', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=nsA2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    typeSlash(container, 'b1', '/글머리 목록');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());

    saveNow();
    await waitFor(() => expect(saved('nsA2').pages[0].blocks[0].runs[0].t).toBe('/글머리 목록'));
    // 종류도 그대로다 — 취소는 아무것도 바꾸지 않는다.
    expect(saved('nsA2').pages[0].blocks[0].kind).toBe('p');
  });
});

describe('공책 12판 — `/`는 어느 줄에서나, 태그 메뉴 정돈', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('`/`가 **목록 항목**에서도 열리고 그 줄의 글로 좁혀진다(제보)', async () => {
    localStorage.setItem('mindflow_doc_nsB0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nsB0&title=x');
    // NOTE의 b3은 체크리스트 — 첫 항목 줄에서 친다.
    const line = (await waitFor(() => container.querySelector('[data-note-line="b3:i1"]'))) as HTMLElement;

    // 낱말의 시작에서만 열린다 — 글 끝에 빈칸을 두고 `/`를 친다(사람이 치는 순서).
    type(line, '알림을 멘션과 시스템으로 분리한다 ');
    fireEvent.keyDown(line, { key: '/' });
    type(line, '알림을 멘션과 시스템으로 분리한다 /인용');
    await waitFor(() => expect(container.querySelector('[data-note-slash-q]')?.textContent).toBe('인용'));
    expect([...container.querySelectorAll('[data-note-slash-item]')].map((b) => b.getAttribute('data-note-slash-item'))).toEqual(['q']);
  });

  it('캐럿을 옮기면(←·→) 목록만 접히고 글자는 남는다(요청)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_nsB1', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=nsB1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    fireEvent.keyDown(line, { key: '/' });
    type(line, '/인용');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());

    saveNow();
    await waitFor(() => expect(saved('nsB1').pages[0].blocks[0].runs[0].t).toBe('/인용'));
  });

  it('태그 메뉴 — `태그 없음`이 **목록의 마지막 줄**이다(요청)', async () => {
    const tagged = { ...NOTE, pages: [{ ...NOTE.pages[0], tag: '회의록' }, NOTE.pages[1]] };
    localStorage.setItem('mindflow_doc_nsB2', JSON.stringify(tagged));
    const { container } = renderEditor('/editor?map=nsB2&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-tag-pick]'))) as HTMLElement);
    const menu = (await waitFor(() => container.querySelector('[data-note-tag-menu]'))) as HTMLElement;

    const names = [...menu.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(names.slice(-2)).toEqual(['태그 없음', '태그 만들기']);
  });
});

describe('공책 13판 — 표 스펙(선택 5종 · 경계 링 · 채움 키 · 두 번 눌러 메뉴)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** NOTE의 b4가 2×2 표다. 칸 여백에서 누르면 그 칸이 골라진다. */
  const pickCell = (el: HTMLElement) => {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.mouseUp(el);
  };

  it('칸을 고르면 칩이 이름과 개수를 **따로** 말하고 ✕로 놓인다', async () => {
    localStorage.setItem('mindflow_doc_ntb0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb0&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();

    pickCell(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-chip]')).toBeTruthy());
    expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('칸 선택');
    expect(container.querySelector('[data-note-table-count]')?.textContent).toBe('1칸');
    expect(cell.getAttribute('data-picked')).toBe('1');

    fireEvent.click(container.querySelector('[data-note-table-unpick]')!);
    await waitFor(() => expect(container.querySelector('[data-note-table-chip]')).toBeNull());
  });

  it('칸을 가로질러 끌면 **범위**가 되고 칩이 `2×2`를 센다', async () => {
    localStorage.setItem('mindflow_doc_ntb1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb1&title=x');
    const from = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const to = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;

    fireEvent.mouseDown(from, { button: 0 });
    fireEvent.mouseEnter(to);
    fireEvent.mouseUp(to);
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('범위 선택'));
    expect(container.querySelector('[data-note-table-count]')?.textContent).toBe('2×2');
    expect(container.querySelectorAll('[data-note-table-cell][data-picked]')).toHaveLength(4);
  });

  it('머리글 행을 고르면 칩이 `머리글 행`이라고 말한다', async () => {
    localStorage.setItem('mindflow_doc_ntb2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb2&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement);

    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('머리글 행'));
    expect(container.querySelector('[data-note-table-count]')?.textContent).toBe('2칸');
  });

  it('선택 링은 **바깥 경계에만** 그려진다', async () => {
    localStorage.setItem('mindflow_doc_ntb3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb3&title=x');
    const from = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    fireEvent.mouseDown(from, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-cell="0:1"]') as HTMLElement);
    fireEvent.mouseUp(container.querySelector('[data-note-table-cell="0:1"]') as HTMLElement);

    await waitFor(() => expect(from.style.boxShadow).toBeTruthy());
    // 왼쪽 칸 — 오른쪽 이웃이 선택에 들었으므로 그 변에는 링이 없다.
    expect(from.style.boxShadow).toContain('inset 1.5px 0 0 0');
    expect(from.style.boxShadow).not.toContain('inset -1.5px 0 0 0');
    const right = container.querySelector('[data-note-table-cell="0:1"]') as HTMLElement;
    expect(right.style.boxShadow).toContain('inset -1.5px 0 0 0');
    expect(right.style.boxShadow).not.toContain('inset 1.5px 0 0 0');
  });

  it('손잡이는 한 번은 고르기, 한 번 더가 메뉴다', async () => {
    localStorage.setItem('mindflow_doc_ntb4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb4&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-colhandle="1"]'))) as HTMLElement;

    fireEvent.click(handle);
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('열 선택'));
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();
    expect(container.querySelector('[data-note-table-cell="0:1"]')?.getAttribute('data-picked')).toBe('1');
    expect(container.querySelector('[data-note-table-cell="0:0"]')?.getAttribute('data-picked')).toBeNull();

    fireEvent.click(handle);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
  });

  it('좌상단 코너는 표 전체를 고르고, 한 번 더 누르면 표 메뉴다', async () => {
    localStorage.setItem('mindflow_doc_ntb5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb5&title=x');
    const corner = (await waitFor(() => container.querySelector('[data-note-table-corner]'))) as HTMLElement;

    fireEvent.click(corner);
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('표 전체'));
    expect(container.querySelector('[data-note-table-count]')?.textContent).toBe('2×2');
    expect(container.querySelectorAll('[data-note-table-cell][data-picked]')).toHaveLength(4);

    fireEvent.click(corner);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
  });

  it('행을 칠하면 **키 하나**(`r0`)로 남고, 칠한 뒤 선택이 풀린다', async () => {
    localStorage.setItem('mindflow_doc_ntb6', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb6&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-fill]'))) as HTMLElement);
    const swatch = (await waitFor(() => container.querySelector('[data-note-table-fill-color]'))) as HTMLElement;
    const hex = swatch.getAttribute('data-note-table-fill-color')!;
    fireEvent.click(swatch);
    saveNow();

    await waitFor(() => expect(saved('ntb6').pages[0].blocks[3].fills).toEqual({ r1: hex }));
    // 칠하고 나면 면이 색을 가리지 않도록 선택을 놓는다(스펙 3-2).
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();
  });

  it('범위를 칠하면 그 칸들만 `c행:열` 키로 적힌다', async () => {
    localStorage.setItem('mindflow_doc_ntb7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb7&title=x');
    const from = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    fireEvent.mouseDown(from, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement);
    fireEvent.mouseUp(container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement);

    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-fill]'))) as HTMLElement);
    const swatch = (await waitFor(() => container.querySelector('[data-note-table-fill-color]'))) as HTMLElement;
    const hex = swatch.getAttribute('data-note-table-fill-color')!;
    fireEvent.click(swatch);
    saveNow();
    await waitFor(() => expect(saved('ntb7').pages[0].blocks[3].fills).toEqual({ 'c0:0': hex, 'c1:0': hex }));
  });

  it('우클릭 메뉴의 `색 채우기`는 **열 때의 선택**에 칠한다', async () => {
    localStorage.setItem('mindflow_doc_ntb8', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb8&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-pick"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-pick-all"]'))) as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('표 전체'));

    fireEvent.contextMenu(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-ctx="t-fill"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing="표 전체 색"]'))) as HTMLElement;
    const swatch = wing.querySelector('[data-note-ctx^="fill-#"]') as HTMLElement;
    fireEvent.click(swatch);
    saveNow();
    // 표 전체는 키 하나다 — 칸마다 풀어 적지 않는다.
    await waitFor(() => expect(Object.keys(saved('ntb8').pages[0].blocks[3].fills)).toEqual(['all']));
  });

  it('행을 지우면 그 행의 색도 함께 사라지고 아래가 당겨진다', async () => {
    const filled = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, fills: { r0: '#FBEEE4', r1: '#EAF0F9' } } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ntb9', JSON.stringify(filled));
    const { container } = renderEditor('/editor?map=ntb9&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-ctx="t-row"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="row-del"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('ntb9').pages[0].blocks[3].fills).toEqual({ r0: '#EAF0F9' }));
  });

  it('`행 복제`는 글과 색을 함께 하나 더 만든다', async () => {
    const filled = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, fills: { r1: '#EAF0F9' } } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ntc0', JSON.stringify(filled));
    const { container } = renderEditor('/editor?map=ntc0&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-ctx="t-row"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="row-dup"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('ntc0').pages[0].blocks[3].rows).toHaveLength(3));
    expect(saved('ntc0').pages[0].blocks[3].rows[2][0][0].t).toBe('문구 검수');
    expect(saved('ntc0').pages[0].blocks[3].fills).toEqual({ r1: '#EAF0F9', r2: '#EAF0F9' });
  });

  it('Tab은 다음 칸으로 간다 — 글을 고치는 중에도', async () => {
    localStorage.setItem('mindflow_doc_ntc2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntc2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;

    fireEvent.keyDown(line, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b4:r0c1'));
    // 줄 끝에서는 다음 **행**의 첫 칸으로 넘어간다.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b4:r1c0'));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b4:r0c1'));
  });

  it('⌥↓는 그 아래에 행을, ⌥→는 그 오른쪽에 열을 넣는다', async () => {
    localStorage.setItem('mindflow_doc_ntc3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntc3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;

    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);
    fireEvent.keyDown(line, { key: 'ArrowDown', altKey: true });
    saveNow();
    await waitFor(() => expect(saved('ntc3').pages[0].blocks[3].rows).toHaveLength(3));
    fireEvent.keyDown(line, { key: 'ArrowRight', altKey: true });
    saveNow();
    await waitFor(() => expect(saved('ntc3').pages[0].blocks[3].rows[0]).toHaveLength(3));
  });

  it('표에 포커스가 있을 때 Shift+화살표가 구간을 늘리고 ⌫가 그 행을 지운다', async () => {
    localStorage.setItem('mindflow_doc_ntc4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntc4&title=x');
    const box = (await waitFor(() => container.querySelector('[data-note-table-box]'))) as HTMLElement;
    const cell = container.querySelector('[data-note-table-cell="0:0"]') as HTMLElement;

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('칸 선택'));

    fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(container.querySelector('[data-note-table-name]')?.textContent).toBe('범위 선택'));
    expect(container.querySelector('[data-note-table-count]')?.textContent).toBe('2×1');

    // 행을 고른 상태의 ⌫는 그 행을 지운다.
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);
    fireEvent.keyDown(box, { key: 'Backspace' });
    saveNow();
    await waitFor(() => expect(saved('ntc4').pages[0].blocks[3].rows).toHaveLength(1));
  });

  it('표 밖을 누르면 선택이 풀린다 — 단 방금 고른 것은 제 클릭으로 풀리지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ntc1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntc1&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-note-table-chip]')).toBeTruthy());

    // 400ms 가드 — 고른 직후의 document 클릭은 무시한다.
    fireEvent.click(document.body);
    expect(container.querySelector('[data-note-table-chip]')).toBeTruthy();
  });
});

describe('공책 15판 — 표 제보 6건(＋의 자리 · 끝 추가 · 테두리 · 커서 · 두 번 눌러 편집)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('＋는 **손잡이마다 그 앞쪽**에 있고, 끝에도 둘 있다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntd0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd0&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-table-colhandle="0"]')).toBeTruthy());

    // 2×2 표 → 열 둘 + 행 둘 + 끝 둘 = 여섯.
    expect(container.querySelectorAll('.mf-note-tplus')).toHaveLength(6);
    expect(container.querySelectorAll('.mf-note-tplus-end')).toHaveLength(2);
    // 두 번째 열의 ＋는 그 열 **왼쪽**에 넣는다(앞쪽).
    const before = (container.querySelector('[data-note-table-colrail]') as HTMLElement).querySelectorAll('.mf-note-tplus');
    expect(before[1]?.getAttribute('title')).toBe('2번째 열 왼쪽에 열 넣기');
  });

  it('레일의 두 번째 열 ＋를 누르면 그 자리에 열이 들어간다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntd0b', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd0b&title=x');
    const rail = (await waitFor(() => container.querySelector('[data-note-table-colrail]'))) as HTMLElement;

    fireEvent.click(rail.querySelectorAll('.mf-note-tplus')[1]!);
    saveNow();
    await waitFor(() => expect(saved('ntd0b').pages[0].blocks[3].rows[0]).toHaveLength(3));
    // `할 일`은 그대로 첫 칸, 새 칸이 그 오른쪽(둘째)에 들어간다.
    expect(saved('ntd0b').pages[0].blocks[3].rows[0][0][0].t).toBe('할 일');
    expect(saved('ntd0b').pages[0].blocks[3].rows[0][2][0].t).toBe('담당');
  });

  it('손잡이 hover는 **그 손잡이만** 물들인다 — 레일 전체가 아니다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd0c', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd0c&title=x');
    const h0 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;
    const h1 = container.querySelector('[data-note-table-colhandle="1"]') as HTMLElement;
    const bar = (el: HTMLElement) => (el.firstElementChild as HTMLElement).style.background;

    expect(bar(h0)).toBe('var(--mf-th)');
    fireEvent.mouseEnter(h1);
    await waitFor(() => expect(bar(h1)).toBe('var(--mf-accent-mute)'));
    // 옆 손잡이는 가만히 있다 — 예전에는 레일 전체가 함께 물들었다.
    expect(bar(h0)).toBe('var(--mf-th)');

    fireEvent.mouseLeave(h1);
    await waitFor(() => expect(bar(h1)).toBe('var(--mf-th)'));
  });

  it('오른쪽 끝·아래쪽 끝의 ＋가 열과 행을 하나 더 붙인다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd1&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-append="col"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('ntd1').pages[0].blocks[3].rows[0]).toHaveLength(3));

    fireEvent.click(container.querySelector('[data-note-table-append="row"]')!);
    saveNow();
    await waitFor(() => expect(saved('ntd1').pages[0].blocks[3].rows).toHaveLength(3));
  });

  it('행을 고르면 **왼쪽·오른쪽 끝에도** 링이 그려진다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd2&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);

    const left = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    const right = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;
    // 표 밖의 이웃을 "선택됨"으로 보면 이 두 변이 빠진다 — 그게 제보였다.
    await waitFor(() => expect(left.style.boxShadow).toContain('inset 1.5px 0 0 0'));
    expect(right.style.boxShadow).toContain('inset -1.5px 0 0 0');
    // 가로 변은 행 전체가 골라졌으니 위·아래 모두 그려진다.
    expect(left.style.boxShadow).toContain('inset 0 1.5px 0 0');
    expect(left.style.boxShadow).toContain('inset 0 -1.5px 0 0');
  });

  it('열을 고르면 **위·아래 끝에도** 링이 그려진다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-colhandle="1"]'))) as HTMLElement);

    const top = (await waitFor(() => container.querySelector('[data-note-table-cell="0:1"]'))) as HTMLElement;
    const bottom = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;
    await waitFor(() => expect(top.style.boxShadow).toContain('inset 0 1.5px 0 0'));
    expect(bottom.style.boxShadow).toContain('inset 0 -1.5px 0 0');
  });

  it('표 전체를 고르면 네 모서리에 테두리가 돈다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd4&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-corner]'))) as HTMLElement);

    const tl = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const br = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;
    // 예전에는 모든 이웃이 "선택됨"이라 **한 변도** 그려지지 않았다.
    await waitFor(() => expect(tl.style.boxShadow).toContain('inset 0 1.5px 0 0'));
    expect(tl.style.boxShadow).toContain('inset 1.5px 0 0 0');
    expect(br.style.boxShadow).toContain('inset 0 -1.5px 0 0');
    expect(br.style.boxShadow).toContain('inset -1.5px 0 0 0');
  });

  it('칸 위의 커서는 `cell`이고, 글을 열면 `text`가 된다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    expect(cell.style.cursor).toBe('cell');

    fireEvent.doubleClick(cell);
    await waitFor(() => expect(cell.style.cursor).toBe('text'));
  });

  it('한 번 누르면 칸 선택, 두 번 누르면 편집이다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ntd6', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd6&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    const line = container.querySelector('[data-note-line="b4:r1c0"]') as HTMLElement;
    // 평소에는 글을 고칠 수 없다 — 한 번의 누름이 선택이기 때문이다.
    expect(line.getAttribute('contenteditable')).toBe('false');

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(cell.getAttribute('data-picked')).toBe('1'));
    expect(line.getAttribute('contenteditable')).toBe('false');

    fireEvent.doubleClick(cell);
    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('true'));
    // 편집을 열면 선택은 놓는다 — 링과 캐럿이 함께 있으면 무엇이 대상인지 흐려진다.
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();

    // Esc로 닫으면 다시 읽기 전용이다.
    fireEvent.keyDown(container.querySelector('[data-note-line="b4:r1c0"]')!, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('false'));
  });
});

describe('공책 14판 — 얹으면 반응하고, 목록은 이 스페이스의 것이다', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('구분선은 `새 페이지` **위**에 있고 아래에는 없다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nh0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nh0&title=x');
    const add = (await waitFor(() => container.querySelector('[data-note-new-page]'))) as HTMLElement;

    // 앞 형제는 1px 선, 뒤 형제는 곧바로 목록이다.
    expect((add.previousElementSibling as HTMLElement).style.height).toBe('1px');
    expect((add.nextElementSibling as HTMLElement).className).toContain('lnb-scroll');
  });

  it('페이지 줄·태그 칩·탭에 hover를 받을 클래스가 붙는다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nh1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nh1&title=x');
    const row = (await waitFor(() => container.querySelector('[data-note-page-row="p1"]'))) as HTMLElement;

    // 인라인으로 면을 박으면 클래스의 `:hover`가 죽는다 — 기본 면은 CSS가 쥔다.
    expect(row.className).toContain('mf-note-row');
    expect(row.style.background).toBe('');
    const tab = (await waitFor(() => container.querySelector('[data-note-tab="댓글"]'))) as HTMLElement;
    expect(tab.className).toContain('mf-note-crumb');
    expect(tab.style.background).toBe('');
    const chip = container.querySelector('[data-note-tag-filter="전체"]') as HTMLElement | null;
    if (chip) {
      expect(chip.className).toContain('mf-note-chip');
      expect(chip.style.background).toBe('');
    }
  });

  it('혼자 보고 있어도 `공유` 옆에 내 얼굴이 선다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nh2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nh2&title=x');
    const faces = (await waitFor(() => container.querySelector('[data-presence-avatars]'))) as HTMLElement;

    expect(faces.getAttribute('aria-label')).toBe('1명 접속 중');
    // 단추의 이름은 얼굴에 물들지 않는다.
    expect(screen.getAllByRole('button', { name: '공유' })).toHaveLength(1);
  });

  it('`공책 이동` 목록은 **지금 스페이스**의 공책만 보여 준다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nh3', JSON.stringify(NOTE));
    localStorage.setItem('mindflow_doc_meta_nh3', JSON.stringify({ title: 'A 공책', kind: 'note' }));
    localStorage.setItem('mindflow_doc_nh4', JSON.stringify(NOTE));
    localStorage.setItem('mindflow_doc_meta_nh4', JSON.stringify({ title: 'A 옆 공책', kind: 'note' }));
    localStorage.setItem('mindflow_doc_nh5', JSON.stringify(NOTE));
    localStorage.setItem('mindflow_doc_meta_nh5', JSON.stringify({ title: 'B 공책', kind: 'note' }));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [
          { name: 'A 스페이스', maps: [{ title: 'A 공책', docId: 'nh3' }, { title: 'A 옆 공책', docId: 'nh4' }] },
          { name: 'B 스페이스', maps: [{ title: 'B 공책', docId: 'nh5' }] },
        ],
        mapFolders: {},
        recent: [],
      }),
    );
    const { container } = renderEditor('/editor?map=nh3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-book-switch]'))) as HTMLElement);
    const menu = (await waitFor(() => container.querySelector('[data-note-book-menu]'))) as HTMLElement;

    await waitFor(() => expect(menu.querySelector('[data-note-book-item="nh4"]')).toBeTruthy());
    // 지금 보는 공책은 남고(`보는 중`), 다른 스페이스의 것은 오지 않는다.
    expect(menu.querySelector('[data-note-book-item="nh3"]')).toBeTruthy();
    expect(menu.querySelector('[data-note-book-item="nh5"]')).toBeNull();
  });
});

/** 저장본 블록의 글자 — 런이 없으면 빈 문자열. */
function runsOf(block: { runs?: { t: string }[] }): string {
  return (block.runs ?? []).map((r) => r.t).join('');
}
