// 공책 — 네 번째 문서 종류(`kind: 'note'`). 캔버스가 아니라 **페이지의 글**이고,
// 저장·공유는 문서 기반이라 기존 경로를 그대로 탄다.
//
// 이 파일이 지키는 것: 캔버스 UI가 **하나도** 뜨지 않는다 · 글이 문서에 저장된다 ·
// 블록 종류를 바꿔도 글을 잃지 않는다 · **열 것이 없어지지 않는다**(마지막 페이지).

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';
import { NOTE_LIST_MAX_INDENT } from '@mindflow/mindmap-core';
import { linearize, setLinearSelection } from './richtextDom';
import { applyNoteFormatRange } from './noteRichDom';

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

/**
 * 편집 박스에 글을 넣는다 — `contentEditable`이라 `input` 이벤트로 알린다.
 *
 * **캐럿도 글 끝에 둔다**: 마크다운 단축(`- `)은 "표식 **바로 뒤**에 캐럿이 있는가"로
 * 가르므로(줄 앞에 글이 남아 있어도 걸리게 하려고) 캐럿 없이 글만 넣으면 실제로
 * 치는 것과 달라진다.
 */
function type(el: Element, html: string): void {
  const box = el as HTMLElement;
  box.innerHTML = html;
  box.focus();
  try {
    const text = document.createTreeWalker(box, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, (text.nodeValue ?? '').length);
    else range.setStart(box, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* 캐럿을 못 놓는 환경 — 글만 넣는다 */
  }
  fireEvent.input(el);
}

/** 지금 고른 표의 칸들 — 떠 있던 선택 칩을 걷은 뒤로 선택의 정본은 **칠해진 칸**이다. */
function picked(c: HTMLElement): (string | null)[] {
  return [...c.querySelectorAll('[data-note-table-cell][data-picked="1"]')].map((e) => e.getAttribute('data-note-table-cell'));
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
    // 본문만 **거의 중립**으로 내렸다(제보: 종이가 주황으로 보인다) — 상단 바 <
    // 본문 < 면이라는 밝기 관계는 그대로다.
    expect(surface.style.getPropertyValue('--mf-note-body')).toBe('#fcfcfb');
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

  it('글의 부피는 **태그 줄의 오른끝**에 적힌다(요청 — 본문 아래 띠는 걷었다)', async () => {
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
    // 머리의 태그 줄 **안**에, 그 줄의 **마지막**으로.
    expect(stats.closest('[data-note-page-head]')).toBeTruthy();
    expect(stats.parentElement?.lastElementChild).toBe(stats);
    // 본문 아래의 고정 띠와 그 구분선은 사라졌다 — `NN 전 수정`은 이 줄에 이미 있다.
    expect(container.querySelector('[data-note-stats-rule]')).toBeNull();
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

  // 한때 **여덟**이었다(시안을 따라 목록 셋을 뺐다). 2026-09-21에 사용자가 "여기 무엇이
  // 들어가야 하나"를 다시 물어 **열하나**로 확정했다 — 목록 줄에서 단추 라벨과 메뉴가
  // 어긋나던 값이 시안을 따르는 값보다 컸다(경위는 `BLOCK_TYPES` 주석).
  it('블록 메뉴는 **줄의 종류 열하나**다 — 넣기 넷은 들어오지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ns40', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ns40&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-blocktype]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    const menu = (await waitFor(() => container.querySelector('[data-note-blocktype-menu]'))) as HTMLElement;
    expect([...menu.querySelectorAll('[data-note-blocktype-item]')].map((b) => b.getAttribute('data-note-blocktype-item'))).toEqual([
      'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'ck', 'q', 'callout', 'toggle', 'code',
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
    for (const act of ['t-cut', 't-copy', 't-paste', 't-pick', 't-row', 't-col', 't-align', 't-fill', 't-dup', 't-csv', 't-del']) {
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

    // 좌클릭은 **고르기뿐**이고(요청), 메뉴는 우클릭이다.
    fireEvent.click(handle);
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();
    fireEvent.contextMenu(handle);
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

    // 머리글 행 개념은 없앴다(요청) — 그 항목도 메뉴에 없다.
    fireEvent.contextMenu(cell);
    menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    expect(menu.querySelector('[data-note-ctx="t-head"]')).toBeNull();
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
    // 좁혀진 목록에는 그 하나만 남는다(친 글자는 어디에도 다시 그리지 않는다 — 제보).
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="q"]')).toBeTruthy());
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

    typeSlash(container, 'b1', '/글머리 기호');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());

    saveNow();
    await waitFor(() => expect(saved('nsA2').pages[0].blocks[0].runs[0].t).toBe('/글머리 기호'));
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
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="q"]')).toBeTruthy());
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

  it('칸을 고르면 **그 칸만** 칠해지고 Esc로 놓인다(칩은 걷었다 — 요청)', async () => {
    localStorage.setItem('mindflow_doc_ntb0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb0&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;
    expect(picked(container)).toEqual([]);
    // 떠 있던 "칸 선택 · 1칸 · 색 채우기" 칩은 이제 없다.
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();

    pickCell(cell);
    await waitFor(() => expect(picked(container)).toEqual(['1:1']));
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();

    fireEvent.keyDown(container.querySelector('[data-note-block="b4"]')!, { key: 'Escape' });
    await waitFor(() => expect(picked(container)).toEqual([]));
  });

  it('칸을 가로질러 끌면 **범위**가 되고 칩이 `2×2`를 센다', async () => {
    localStorage.setItem('mindflow_doc_ntb1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb1&title=x');
    const from = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const to = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;

    fireEvent.mouseDown(from, { button: 0 });
    fireEvent.mouseEnter(to);
    fireEvent.mouseUp(to);
    await waitFor(() => expect(picked(container)).toHaveLength(4));
    expect(picked(container)).toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('첫 행도 **보통 행**이다 — 머리글이라는 개념이 없다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntb2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb2&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement);

    await waitFor(() => expect(picked(container)).toEqual(['0:0', '0:1']));
    // 첫 칸과 둘째 행의 칸이 **같은 글꼴**이다(예전에는 11.5px/800 보조 잉크였다).
    const head = container.querySelector('[data-note-table-cell="0:0"]') as HTMLElement;
    const body = container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement;
    expect(head.style.fontWeight).toBe(body.style.fontWeight);
    expect(head.style.fontSize).toBe(body.style.fontSize);
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

  it('손잡이 좌클릭은 **고르기뿐**이고, 메뉴는 우클릭이다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntb4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb4&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-colhandle="1"]'))) as HTMLElement;

    fireEvent.click(handle);
    await waitFor(() => expect(picked(container)).toEqual(['0:1', '1:1']));
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();
    expect(container.querySelector('[data-note-table-cell="0:1"]')?.getAttribute('data-picked')).toBe('1');
    expect(container.querySelector('[data-note-table-cell="0:0"]')?.getAttribute('data-picked')).toBeNull();

    // **다시 좌클릭해도 메뉴는 뜨지 않는다**(제보) — 고른 것을 다시 눌러 확인하는
    // 흔한 동작에서 메뉴가 튀어나왔다.
    fireEvent.click(handle);
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();

    fireEvent.contextMenu(handle);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
  });

  it('표 전체는 **우클릭 메뉴**로 고른다 — 좌상단의 작은 점은 걷었다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntb5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    // 9×9짜리 점은 겨냥하기 어려웠고 레일에 마우스를 얹으면 어차피 숨었다.
    expect(container.querySelector('[data-note-table-corner]')).toBeNull();

    fireEvent.contextMenu(cell);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    fireEvent.click(menu.querySelector('[data-note-ctx="t-pick"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-pick-all"]'))) as HTMLElement);

    await waitFor(() => expect(picked(container)).toHaveLength(4));
  });

  it('행을 칠하면 **키 하나**(`r0`)로 남고, 칠한 뒤 선택이 풀린다', async () => {
    localStorage.setItem('mindflow_doc_ntb6', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb6&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement;
    fireEvent.click(handle);
    fireEvent.contextMenu(handle);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-fill"]'))) as HTMLElement);
    const swatch = (await waitFor(() => container.querySelector('[data-note-ctx-wing] [data-note-ctx^="fill-#"]'))) as HTMLElement;
    const hex = swatch.getAttribute('data-note-ctx')!.slice('fill-'.length);
    fireEvent.click(swatch);
    saveNow();

    await waitFor(() => expect(saved('ntb6').pages[0].blocks[3].fills).toEqual({ r1: hex }));
    // 칠하고 나면 면이 색을 가리지 않도록 선택을 놓는다(스펙 3-2).
    expect(picked(container)).toEqual([]);
  });

  it('범위를 칠하면 그 칸들만 `c행:열` 키로 적힌다', async () => {
    localStorage.setItem('mindflow_doc_ntb7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntb7&title=x');
    const from = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    fireEvent.mouseDown(from, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement);
    fireEvent.mouseUp(container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement);

    fireEvent.contextMenu(from);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-fill"]'))) as HTMLElement);
    const swatch = (await waitFor(() => container.querySelector('[data-note-ctx-wing] [data-note-ctx^="fill-#"]'))) as HTMLElement;
    const hex = swatch.getAttribute('data-note-ctx')!.slice('fill-'.length);
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
    await waitFor(() => expect(picked(container)).toHaveLength(4));

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
    await waitFor(() => expect(picked(container)).toEqual(['0:0']));

    fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(picked(container)).toEqual(['0:0', '1:0']));

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
    await waitFor(() => expect(picked(container)).toEqual(['1:0', '1:1']));

    // 400ms 가드 — 고른 직후의 document 클릭은 무시한다.
    fireEvent.click(document.body);
    expect(picked(container)).toEqual(['1:0', '1:1']);
  });
});

describe('공책 15판 — 표 제보 6건(＋의 자리 · 끝 추가 · 테두리 · 커서 · 두 번 눌러 편집)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('＋는 **얹은 손잡이 하나**의 앞쪽에만 보인다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntd0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd0&title=x');
    const rail = (await waitFor(() => container.querySelector('[data-note-table-colrail]'))) as HTMLElement;
    const pluses = rail.querySelectorAll<HTMLElement>('.mf-note-tplus');

    // 2×2 표 → 열 손잡이마다 하나씩(둘). 끝의 점선 띠는 레일 밖에 따로 있다.
    expect(pluses).toHaveLength(2);
    expect(pluses[1]?.getAttribute('title')).toBe('2번째 열 왼쪽에 열 넣기');
    // 아무 손잡이에도 얹지 않았으면 전부 숨어 있다.
    expect(pluses[0]?.style.opacity).toBe('0');
    expect(pluses[1]?.style.opacity).toBe('0');

    // 두 번째 열에 얹으면 **그 하나만** 뜬다.
    fireEvent.mouseEnter(pluses[1]!.parentElement!);
    await waitFor(() => expect(pluses[1]?.style.opacity).toBe('1'));
    expect(pluses[0]?.style.opacity).toBe('0');

    fireEvent.mouseLeave(pluses[1]!.parentElement!);
    await waitFor(() => expect(pluses[1]?.style.opacity).toBe('0'));
  });

  it('끝의 열·행 추가는 표를 두르는 **점선 띠**다(요청·시안)', async () => {
    localStorage.setItem('mindflow_doc_ntd0d', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntd0d&title=x');
    const band = (await waitFor(() => container.querySelector('[data-note-table-append="col"]'))) as HTMLElement;

    expect(container.querySelectorAll('.mf-note-tplus-end')).toHaveLength(2);
    expect(band.style.border).toContain('dashed');
    // 표의 높이·너비를 그대로 두른다 — 동그라미 하나가 아니라 띠다. 자리는
    // **상자 바깥**이라 페이지 폭을 먹지 않는다(요청).
    expect(band.style.top).toBe('0px');
    expect(band.style.bottom).toBe('0px');
    const rowBand = container.querySelector<HTMLElement>('[data-note-table-append="row"]');
    expect(rowBand?.style.left).toBe('0px');
    expect(rowBand?.style.right).toBe('0px');
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
    const first = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    fireEvent.contextMenu(first);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-pick"]'))) as HTMLElement);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-pick-all"]'))) as HTMLElement);

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
    // 건드리지 않은 칸은 글을 고칠 수 없다 — 한 번의 누름이 선택이기 때문이다.
    expect(line.getAttribute('contenteditable')).toBe('false');

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    // **고른 칸은 키를 받는다**(한글 첫 글자부터 — 아래 20판) — 그래서 고른 뒤에는
    // 편집 가능하지만, 아직 고른 상태다(글자가 통째로 골라져 있어 치면 덮어쓴다).
    await waitFor(() => expect(cell.getAttribute('data-picked')).toBe('1'));
    expect(line.getAttribute('contenteditable')).toBe('true');

    fireEvent.doubleClick(cell);
    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('true'));
    // 편집을 열면 선택은 놓는다 — 링과 캐럿이 함께 있으면 무엇이 대상인지 흐려진다.
    expect(container.querySelector('[data-note-table-chip]')).toBeNull();

    // Esc로 닫으면 다시 읽기 전용이다.
    fireEvent.keyDown(container.querySelector('[data-note-line="b4:r1c0"]')!, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('false'));
  });
});

describe('공책 16판 — 표 크기 조절 · 행열 삭제 · Enter로 닫기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('손으로 정한 열 너비가 문서에 남고 `colgroup`으로 그려진다(요청)', async () => {
    const sized = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, colW: [120, 260] } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ntz0', JSON.stringify(sized));
    const { container } = renderEditor('/editor?map=ntz0&title=x');
    const table = (await waitFor(() => container.querySelector('[data-note-table-box] table'))) as HTMLElement;

    // 너비를 정한 순간부터 고정 레이아웃이다 — 아니면 브라우저가 글에 맞춰 다시 나눈다.
    expect(table.style.tableLayout).toBe('fixed');
    const cols = table.querySelectorAll('col');
    expect(cols).toHaveLength(2);
    expect((cols[0] as HTMLElement).style.width).toBe('120px');
    expect((cols[1] as HTMLElement).style.width).toBe('260px');
  });

  it('행 높이는 `tr`에 걸리고, 열을 지우면 너비도 함께 당겨진다(요청)', async () => {
    const sized = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, colW: [120, 260], rowH: [40, 90] } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ntz1', JSON.stringify(sized));
    const { container } = renderEditor('/editor?map=ntz1&title=x');
    const rowsEl = (await waitFor(() => container.querySelectorAll('[data-note-table-box] tr'))) as NodeListOf<HTMLElement>;
    expect(rowsEl[1]?.style.height).toBe('90px');

    // 첫 열을 지우면 그 너비도 사라지고 뒤가 당겨진다.
    const cell = container.querySelector('[data-note-table-cell="0:0"]') as HTMLElement;
    fireEvent.contextMenu(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-ctx="t-col"]')!);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="col-del"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('ntz1').pages[0].blocks[3].colW).toEqual([260]));
  });

  it('고른 행을 **우클릭 메뉴**로 지운다 — 떠 있던 칩은 걷었다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntz2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntz2&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement;
    fireEvent.click(handle);
    fireEvent.contextMenu(handle);

    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-row"]'))) as HTMLElement);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="row-del"]'))) as HTMLElement);
    saveNow();
    await waitFor(() => expect(saved('ntz2').pages[0].blocks[3].rows).toHaveLength(1));
    // 지우고 나면 선택도 함께 놓는다 — 없어진 줄을 가리킨 표식이 남으면 거짓말이다.
    expect(picked(container)).toEqual([]);
  });

  it('마지막 한 행·한 열은 메뉴에서도 지우지 못한다', async () => {
    const one = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: [{ id: 'b4', kind: 'table', rows: [[[{ t: '하나', b: false, c: null }]]] }] }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_ntz3', JSON.stringify(one));
    const { container } = renderEditor('/editor?map=ntz3&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement;
    fireEvent.click(handle);
    fireEvent.contextMenu(handle);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-ctx="t-row"]'))) as HTMLElement);

    const del = (await waitFor(() => container.querySelector('[data-note-ctx="row-del"]'))) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it('칸 편집 중 Enter는 **편집을 닫고** 그 칸을 고른다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntz4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntz4&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.doubleClick(cell);
    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('true'));

    fireEvent.keyDown(container.querySelector('[data-note-line="b4:r1c0"]')!, { key: 'Enter' });
    // 편집이 닫히고 **그 칸이 골라진다**(고른 칸은 계속 키를 받으므로 편집 가능은 유지).
    await waitFor(() => expect(picked(container)).toEqual(['1:0']));
    // 닫고 나면 그 칸이 골라져 있다 — 다음 동작(색·삭제)이 바로 이어진다.
    expect(cell.getAttribute('data-picked')).toBe('1');
  });

  it('Shift+Enter는 줄을 바꾸고 편집을 이어 간다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ntz5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ntz5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.doubleClick(cell);
    const line = (await waitFor(() => container.querySelector('[data-note-line="b4:r1c0"]'))) as HTMLElement;
    fireEvent.keyDown(line, { key: 'Enter', shiftKey: true });
    // 편집은 그대로다 — 줄바꿈은 브라우저가 넣는다(`NoteLine`이 막지 않는다).
    expect(line.getAttribute('contenteditable')).toBe('true');

    // 줄바꿈이 든 글은 `\n`으로 저장된다(`<br>` → `\n`).
    line.innerHTML = '문구 검수<br>둘째 줄';
    fireEvent.input(line);
    saveNow();
    await waitFor(() => expect((saved('ntz5').pages[0].blocks[3].rows[1][0] as { t: string }[]).map((r) => r.t).join('')).toBe('문구 검수\n둘째 줄'));
  });
});

describe('공책 17판 — 표 제보 7건(메뉴 범위 · 레일 클릭 · 타이핑 · 머리글 · 닫힘 · 끝 행 · 레일 어긋남)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const ctxOf = (el: Element) => [...el.querySelectorAll('[data-note-ctx]')].map((b) => b.getAttribute('data-note-ctx'));

  it('행을 고르면 **행 항목만** 뜬다 — 열·정렬·클립보드는 없다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_nu0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu0&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);
    fireEvent.contextMenu(container.querySelector('[data-note-table-rowhandle="1"]')!);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;

    const items = ctxOf(menu);
    expect(items).toContain('t-row');
    // 행 선택에서 `열 ›`은 늘 1열을, `정렬 ›`은 `colAlign[0]`을 건드렸다 — 대상이 다르다.
    expect(items).not.toContain('t-col');
    expect(items).not.toContain('t-align');
    // 클립보드 셋은 칸 하나만 읽고 쓴다 — 행에는 뜻이 없다.
    expect(items).not.toContain('t-cut');
    expect(items).not.toContain('t-copy');
    expect(items).not.toContain('t-paste');
    // 표 자신이 대상인 것들은 남는다.
    expect(items).toEqual(expect.arrayContaining(['t-pick', 't-fill', 't-dup', 't-csv', 't-del']));
  });

  it('열을 고르면 **열·정렬만** 뜨고, 칸을 고르면 전부 뜬다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_nu1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu1&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-colhandle="1"]'))) as HTMLElement);
    fireEvent.contextMenu(container.querySelector('[data-note-table-colhandle="1"]')!);
    let menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    expect(ctxOf(menu)).toContain('t-col');
    expect(ctxOf(menu)).toContain('t-align');
    expect(ctxOf(menu)).not.toContain('t-row');

    fireEvent.contextMenu(container.querySelector('[data-note-table-cell="1:0"]')!);
    menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;
    expect(ctxOf(menu)).toEqual(expect.arrayContaining(['t-cut', 't-row', 't-col', 't-align']));
  });

  it('고른 레일을 다시 좌클릭해도 메뉴가 뜨지 않는다(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_nu2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu2&title=x');
    const handle = (await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement;

    fireEvent.click(handle);
    fireEvent.click(handle);
    fireEvent.click(handle);
    expect(container.querySelector('[data-note-table-menu]')).toBeNull();
    // 선택은 그대로 살아 있다.
    expect(picked(container)).toEqual(['0:0', '0:1']);
  });

  it('칸을 고른 채 글자를 치면 그 칸에 들어가고 **기존 내용을 덮는다**(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_nu3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu3&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(cell.getAttribute('data-picked')).toBe('1'));

    // 숨은 입력이 글자를 받는다 — `[data-note-table-box]`는 IME의 목적지가 못 된다.
    const keys = container.querySelector('[data-note-table-keys]') as HTMLInputElement;
    expect(keys).toBeTruthy();
    fireEvent.change(keys, { target: { value: '가' } });

    await waitFor(() => expect(container.querySelector('[data-note-line="b4:r1c0"]')?.getAttribute('contenteditable')).toBe('true'));
    saveNow();
    await waitFor(() => expect((saved('nu3').pages[0].blocks[3].rows[1][0] as { t: string }[]).map((r) => r.t).join('')).toBe('가'));
  });

  it('행을 고른 채 글자를 치면 **첫 칸**에 들어간다 — 그때는 숨은 상자가 받는다', async () => {
    localStorage.setItem('mindflow_doc_nu4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu4&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement);
    const keys = (await waitFor(() => container.querySelector('[data-note-table-keys]'))) as HTMLInputElement;

    // 행·열·표 전체는 옮겨 적을 칸이 하나로 정해지지 않아 숨은 상자가 조합을 돌린다.
    fireEvent.compositionStart(keys);
    keys.value = '가';
    fireEvent.compositionEnd(keys, { data: '가' });
    saveNow();
    await waitFor(() => expect((saved('nu4').pages[0].blocks[3].rows[0][0] as { t: string }[]).map((r) => r.t).join('')).toBe('가'));
  });

  it('우클릭 메뉴는 **표 안의 다른 곳**을 눌러도 닫힌다(제보 5)', async () => {
    localStorage.setItem('mindflow_doc_nu5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    fireEvent.contextMenu(cell);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeTruthy());
    // 표 루트가 전파를 끊어 `useAnchored`의 버블 리스너는 여기까지 오지 못한다 —
    // 캡처 단계로 따로 듣는다.
    fireEvent.pointerDown(container.querySelector('[data-note-table-cell="1:1"]')!);
    await waitFor(() => expect(container.querySelector('[data-note-table-menu]')).toBeNull());
  });

  it('메뉴와 그 날개를 누를 때는 닫히지 않는다(제보 5의 반대편)', async () => {
    localStorage.setItem('mindflow_doc_nu6', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu6&title=x');
    fireEvent.contextMenu((await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement);
    const menu = (await waitFor(() => container.querySelector('[data-note-table-menu]'))) as HTMLElement;

    fireEvent.pointerDown(menu.querySelector('[data-note-ctx="t-fill"]')!);
    expect(container.querySelector('[data-note-table-menu]')).toBeTruthy();
    fireEvent.click(menu.querySelector('[data-note-ctx="t-fill"]')!);
    const wing = (await waitFor(() => container.querySelector('[data-note-ctx-wing]'))) as HTMLElement;
    // 날개는 메뉴의 **형제**라 메뉴 선택자만으로는 면제되지 않는다 — 빠뜨리면 색 칸을
    // 누르는 순간 메뉴가 사라져 click이 닿지 않는다.
    fireEvent.pointerDown(wing.querySelector('[data-note-ctx^="fill-"]')!);
    expect(container.querySelector('[data-note-table-menu]')).toBeTruthy();
  });

  it('**마지막 행·열에도** 크기 그립이 있다(제보 6)', async () => {
    const sized = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, colW: [120, 260], rowH: [40, 90] } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_nu7', JSON.stringify(sized));
    const { container } = renderEditor('/editor?map=nu7&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-table-box] table')).toBeTruthy());

    // jsdom은 치수를 0으로 재 `geom`이 서지 않으므로 그립 자체가 없다 —
    // 대신 **표 너비가 합으로 못박혔는지**로 마지막 열을 줄일 수 있음을 확인한다.
    const table = container.querySelector('[data-note-table-box] table') as HTMLElement;
    expect(table.style.width).toBe('380px');
  });

  it('열 레일이 표의 가로 스크롤을 따라간다(제보 7)', async () => {
    localStorage.setItem('mindflow_doc_nu8', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nu8&title=x');
    const rail = (await waitFor(() => container.querySelector('[data-note-table-colrail]'))) as HTMLElement;

    // 바깥은 **클립 뷰포트**이자 상자 바깥에 뜬 판이다(요청: 페이지 자리를 먹지 않게).
    expect(rail.style.overflow).toBe('hidden');
    expect(rail.style.position).toBe('absolute');
    expect(rail.style.bottom).toBe('100%');
    // 손잡이의 원점은 **안쪽 트랙**이라 바깥이 positioned여도 좌표가 밀리지 않는다.
    const track = rail.firstElementChild as HTMLElement;
    expect(track.style.position).toBe('relative');

    const scroller = container.querySelector('[data-note-table-scroll]') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: 120, configurable: true });
    fireEvent.scroll(scroller);
    await waitFor(() => expect((rail.firstElementChild as HTMLElement).style.transform).toBe('translateX(-120px)'));
  });
});

describe('공책 18판 — 되돌리기가 공책을 비우지 못한다(제보: 빈 화면)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('⌘Z를 바닥까지 눌러도 페이지가 남는다 — 에디터가 사라지지 않는다', async () => {
    localStorage.setItem('mindflow_doc_nv0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nv0&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 한 번 고쳐 되돌리기 스택에 한 칸을 쌓는다.
    type(line, '고친 글');
    saveNow();
    await waitFor(() => expect(saved('nv0').pages[0].blocks[0].runs[0].t).toBe('고친 글'));

    // 바닥까지 되돌린다. **바닥이 빈 문서면** 페이지가 0장이 되고 본문이 통째로
    // 사라졌다(제보) — 서버에서 본문을 받는 동안 바닥을 찍었기 때문이다.
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());
    expect(container.querySelectorAll('[data-note-page-row]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-note-save-state]')?.textContent).toContain('2쪽');
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

describe('공책 19판 — `/` 블록 넣기 스펙', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 빈 문단 하나짜리 공책을 깔고 연다. */
  async function openEmpty(id: string): Promise<HTMLElement> {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem(`mindflow_doc_${id}`, JSON.stringify(empty));
    const { container } = renderEditor(`/editor?map=${id}&title=x`);
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    return container;
  }

  /** `/`를 치고 이어 친 글자까지 — 브라우저가 글자를 넣는 자리를 흉내. */
  function slash(container: HTMLElement, text: string): HTMLElement {
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    fireEvent.keyDown(line, { key: '/' });
    type(line, text);
    return line;
  }

  const items = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll('[data-note-slash-item]')].map((b) => b.getAttribute('data-note-slash-item'));
  const activeItem = (c: HTMLElement): string | null => c.querySelector('[data-note-slash-item][aria-selected="true"]')?.getAttribute('data-note-slash-item') ?? null;

  it('앵커는 **하나**다 — 칩만 `fixed`이고 패널은 그 안의 `absolute` 자식이다(스펙 §3)', async () => {
    const c = await openEmpty('nq0');
    slash(c, '/');
    const wrap = (await waitFor(() => c.querySelector('[data-note-slash-anchor]'))) as HTMLElement;
    expect(wrap.style.position).toBe('fixed');

    const panel = wrap.querySelector('[data-note-slash-panel]') as HTMLElement;
    expect(panel).toBeTruthy();
    // 패널을 따로 `fixed`로 두면 화면 밖 clamp가 따로 돌아 칩과 떨어진다.
    expect(panel.style.position).toBe('absolute');
    expect(panel.parentElement).toBe(wrap);
    expect(panel.style.width).toBe('306px');
  });

  it('친 글자를 **어디에도 다시 그리지 않는다** — 본문에 그대로 있다(제보)', async () => {
    const c = await openEmpty('nq1');
    slash(c, '/인용');
    await waitFor(() => expect(c.querySelector('[data-note-slash-item="q"]')).toBeTruthy());

    // 머리는 이름뿐이고, 앵커에도 칩이 없다 — 본문의 `/인용`이 유일한 표시다.
    const head = c.querySelector('[data-note-slash-panel]')!.firstElementChild as HTMLElement;
    expect(head.textContent).toBe('블록 넣기');
    expect(c.querySelector('[data-note-slash-chip]')).toBeNull();
    // 앵커에는 패널 말고 아무것도 없다 — 20px 자리만 잡는다.
    const kids = [...c.querySelector('[data-note-slash-anchor]')!.children];
    expect(kids.length).toBe(1);
    expect(kids[0]!.hasAttribute('data-note-slash-panel')).toBe(true);
    // 안내 한 줄은 **검색어가 비어 있을 때만** 나온다.
    expect(c.querySelector('[data-note-slash-panel]')!.textContent).not.toContain('블록 이름을 이어서 입력하세요');
  });

  it('↑↓는 끝에서 멈추지 않고 **돈다**(스펙 §5의 모듈러 순환)', async () => {
    const c = await openEmpty('nq2');
    slash(c, '/');
    await waitFor(() => expect(c.querySelector('[data-note-slash-panel]')).toBeTruthy());
    expect(activeItem(c)).toBe('p');

    fireEvent.keyDown(document, { key: 'ArrowUp' });
    await waitFor(() => expect(activeItem(c)).toBe('hr')); // 첫 줄에서 위 → 마지막 줄
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await waitFor(() => expect(activeItem(c)).toBe('p')); // 마지막에서 아래 → 첫 줄
  });

  it('Tab으로도 넣는다(스펙 §5)', async () => {
    const c = await openEmpty('nq3');
    slash(c, '/콜아웃');
    await waitFor(() => expect(items(c)).toEqual(['callout']));

    fireEvent.keyDown(document, { key: 'Tab' });
    saveNow();
    await waitFor(() => expect(saved('nq3').pages[0].blocks[0].kind).toBe('callout'));
  });

  it('**조합 중의 Enter는 가로채지 않는다** — 한글을 확정하는 그 Enter다(스펙 §5)', async () => {
    const c = await openEmpty('nq4');
    slash(c, '/인용');
    await waitFor(() => expect(items(c)).toEqual(['q']));

    fireEvent.keyDown(document, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(document, { key: 'Enter', isComposing: true });
    await new Promise((r) => setTimeout(r, 30));
    // 목록은 그대로 열려 있고 종류도 그대로다 — 확정용 Enter를 먹지 않았다.
    expect(c.querySelector('[data-note-slash]')).toBeTruthy();
    saveNow();
    await waitFor(() => expect(saved('nq4').pages[0].blocks[0].kind).toBe('p'));

    // 조합이 끝난 Enter는 넣는다.
    fireEvent.keyDown(document, { key: 'Enter' });
    saveNow();
    await waitFor(() => expect(saved('nq4').pages[0].blocks[0].kind).toBe('q'));
  });

  it('맞는 것이 없어도 **닫지 않는다** — 빈 상태로 기다린다(스펙 §8)', async () => {
    const c = await openEmpty('nq5');
    slash(c, '/zzzz');
    await waitFor(() => expect(c.querySelector('[data-note-slash-panel]')!.textContent).toContain('맞는 블록이 없어요'));

    expect(c.querySelector('[data-note-slash-panel]')!.textContent).toContain('⌫ 로 글자를 지워 보세요');
    expect(items(c)).toEqual([]);
  });

  it('연속 공백이면 접히고 **친 글자는 남는다**(스펙 §4·§8)', async () => {
    const c = await openEmpty('nq6');
    const line = c.querySelector('[data-note-line="b1"]') as HTMLElement;
    fireEvent.keyDown(line, { key: '/' });
    await waitFor(() => expect(c.querySelector('[data-note-slash]')).toBeTruthy());

    type(line, '/메모  하나');
    await waitFor(() => expect(c.querySelector('[data-note-slash]')).toBeNull());
    saveNow();
    await waitFor(() => expect(saved('nq6').pages[0].blocks[0].runs[0].t).toBe('/메모  하나'));
  });

  it('**공백이 든 이름**을 끝까지 쳐도 목록이 남는다 — `글머리 기호`', async () => {
    const c = await openEmpty('nq7');
    slash(c, '/글머리 기호');
    await waitFor(() => expect(items(c)).toEqual(['ul']));
  });

  it('마우스를 얹으면 **키보드 활성도 그리로** 옮겨 간다(스펙 §7)', async () => {
    const c = await openEmpty('nq8');
    slash(c, '/');
    await waitFor(() => expect(c.querySelector('[data-note-slash-item="code"]')).toBeTruthy());

    // **움직여서** 얹어야 한다(제보 5) — 목록이 캐럿 아래 뜨므로 포인터가 가만히
    // 있는데도 `mouseenter`가 오는 일이 잦고, 그것이 방향키와 겹쳤다.
    fireEvent.mouseMove(c.querySelector('[data-note-slash-item="code"]')!);
    await waitFor(() => expect(activeItem(c)).toBe('code'));
    // 그래서 Enter가 넣는 것도 손으로 가리킨 그 줄이다.
    fireEvent.keyDown(document, { key: 'Enter' });
    saveNow();
    await waitFor(() => expect(saved('nq8').pages[0].blocks[0].kind).toBe('code'));
  });

  it('푸터가 쓸 수 있는 키 셋을 적어 둔다(스펙 §7)', async () => {
    const c = await openEmpty('nq9');
    slash(c, '/');
    const panel = (await waitFor(() => c.querySelector('[data-note-slash-panel]'))) as HTMLElement;

    expect(panel.textContent).toContain('고르기');
    expect(panel.textContent).toContain('넣기');
    expect(panel.textContent).toContain('닫기');
  });
});

describe('공책 20판 — 표 모양 6건(칩·코너·한 줄 테두리·끝 띠·끝 그립·폭)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 행·열 수를 정해 표 하나만 든 공책. */
  function tableDoc(rows: number, cols: number) {
    return {
      ...NOTE,
      pages: [
        {
          ...NOTE.pages[0],
          blocks: [{ id: 'b4', kind: 'table', rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => [{ t: `${r}${c}`, b: false, c: null }])) }],
        },
        NOTE.pages[1],
      ],
    };
  }

  it('**행이 하나뿐**인 표도 네 귀퉁이가 둥글다(제보: 테두리가 깨진다)', async () => {
    localStorage.setItem('mindflow_doc_nv0', JSON.stringify(tableDoc(1, 2)));
    const { container } = renderEditor('/editor?map=nv0&title=x');
    const left = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const right = container.querySelector('[data-note-table-cell="0:1"]') as HTMLElement;

    // 예전에는 "첫 행이면서 첫 열"에서 멈춰 **위쪽 두 귀퉁이만** 둥글었고, 아래가
    // 각져 상자의 12px 곡선 밖으로 삐져나왔다.
    expect(left.style.borderRadius).toBe('12px 0px 0px 12px');
    expect(right.style.borderRadius).toBe('0px 12px 12px 0px');
  });

  it('**열이 하나뿐**인 표도 마찬가지다', async () => {
    localStorage.setItem('mindflow_doc_nv1', JSON.stringify(tableDoc(2, 1)));
    const { container } = renderEditor('/editor?map=nv1&title=x');
    const top = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const bottom = container.querySelector('[data-note-table-cell="1:0"]') as HTMLElement;

    expect(top.style.borderRadius).toBe('12px 12px 0px 0px');
    expect(bottom.style.borderRadius).toBe('0px 0px 12px 12px');
  });

  it('칸이 하나뿐이면 네 귀퉁이가 모두 둥글다', async () => {
    localStorage.setItem('mindflow_doc_nv2', JSON.stringify(tableDoc(1, 1)));
    const { container } = renderEditor('/editor?map=nv2&title=x');
    const only = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    expect(only.style.borderRadius).toBe('12px 12px 12px 12px');
  });

  it('끝의 열·행 추가 띠가 **24px**이다(제보: 너무 좁다)', async () => {
    localStorage.setItem('mindflow_doc_nv3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nv3&title=x');
    const col = (await waitFor(() => container.querySelector('[data-note-table-append="col"]'))) as HTMLElement;
    const grid = col.parentElement as HTMLElement;

    // 그리드 칸이 아니라 **상자 바깥에 뜬다**(요청: 페이지 자리를 먹지 않게).
    expect(col.style.position).toBe('absolute');
    expect(col.style.left).toBe('100%');
    expect(col.style.width).toBe('20px');
    const row = grid.querySelector('[data-note-table-append="row"]') as HTMLElement;
    expect(row.style.position).toBe('absolute');
    expect(row.style.top).toBe('100%');
    expect(row.style.height).toBe('20px');
  });

  it('너비를 손으로 정한 표는 **그 합만큼만** 자리를 차지한다(제보: 열을 지워도 넓이가 그대로)', async () => {
    const sized = {
      ...NOTE,
      pages: [{ ...NOTE.pages[0], blocks: NOTE.pages[0]!.blocks.map((b: { id: string }) => (b.id === 'b4' ? { ...b, colW: [160, 200] } : b)) }, NOTE.pages[1]],
    };
    localStorage.setItem('mindflow_doc_nv4', JSON.stringify(sized));
    const { container } = renderEditor('/editor?map=nv4&title=x');
    const scroller = (await waitFor(() => container.querySelector('[data-note-table-scroll]'))) as HTMLElement;
    const grid = scroller.parentElement as HTMLElement;

    // 늘 가로를 다 쓰면 표만 줄고 오른쪽이 빈칸으로 남는다.
    expect(grid.style.width).toBe('fit-content');
    expect(grid.style.maxWidth).toBe('100%');
    // 테두리를 두른 상자는 제 폭만큼만 — 막대는 그 **바깥 아래**에 선다.
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('max-content');
  });

  it('크기를 손대지 않은 표는 예전처럼 가로를 다 쓴다(무회귀)', async () => {
    localStorage.setItem('mindflow_doc_nv5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nv5&title=x');
    const box = (await waitFor(() => container.querySelector('[data-note-table-box]'))) as HTMLElement;
    const grid = box.parentElement as HTMLElement;

    expect(grid.style.width).toBe('');
  });
});

describe('공책 21판 — 표 동작 2건(표 밖으로 끌기 · 고른 칸이 키를 받는다)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('고른 칸이 **스스로 키를 받는다** — 포커스가 그 칸에 가고 글자가 통째로 골라진다(제보)', async () => {
    localStorage.setItem('mindflow_doc_nw0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nw0&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);

    // 숨은 `<input>`이 아니라 **그 칸**이 받는다 — 거기서 조합을 돌려야 한글이
    // 첫 글자부터 보인다(예전에는 두 번째 글자를 칠 때 첫 글자가 나타났다).
    const line = container.querySelector('[data-note-line="b4:r1c0"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(line.getAttribute('contenteditable')).toBe('true');
    // 글자가 통째로 골라져 있어 치면 덮어쓴다(스프레드시트의 관례).
    expect(cell.style.userSelect).toBe('text');
  });

  it('고른 칸에 글자가 들어오면 **편집으로 넘어간다** — 선택은 풀린다', async () => {
    localStorage.setItem('mindflow_doc_nw1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nw1&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(picked(container)).toEqual(['1:0']));

    const line = container.querySelector('[data-note-line="b4:r1c0"]') as HTMLElement;
    line.innerHTML = '새 값';
    fireEvent.input(line);

    await waitFor(() => expect(picked(container)).toEqual([]));
    saveNow();
    await waitFor(() => expect((saved('nw1').pages[0].blocks[3].rows[1][0] as { t: string }[]).map((r) => r.t).join('')).toBe('새 값'));
  });

  it('**다른 곳을 누르는 것만으로는** 편집이 열리지 않는다 — 포커스를 잃을 때의 커밋과 갈린다', async () => {
    localStorage.setItem('mindflow_doc_nw2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nw2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(picked(container)).toEqual(['1:0']));

    // `NoteLine`은 blur에서도 커밋한다 — 글이 그대로면 편집으로 넘어가지 않아야 한다.
    fireEvent.blur(container.querySelector('[data-note-line="b4:r1c0"]')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(picked(container)).toEqual(['1:0']);
  });

  it('고른 칸에서 ⌫는 **글자를 지우지 않는다** — 고르기만 해 둔 상태다', async () => {
    localStorage.setItem('mindflow_doc_nw3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nw3&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(picked(container)).toEqual(['1:0']));

    const ev = createEvent.keyDown(container.querySelector('[data-note-block="b4"]')!, { key: 'Backspace' });
    fireEvent(container.querySelector('[data-note-block="b4"]')!, ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('공책 22판 — 본문 6건(통계 띠·지우고 올라가는 커서·간격·슬래시·가위·본문 폭)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('빈 줄에서 ⌫를 누르면 그 줄이 사라지고 **캐럿이 앞 줄 끝으로** 간다(제보)', async () => {
    const doc = {
      ...NOTE,
      pages: [
        {
          id: 'p1',
          title: '빈 장',
          blocks: [
            { id: 'b1', kind: 'p', runs: [{ t: '앞 줄', b: false, c: null }] },
            { id: 'b2', kind: 'p', runs: [{ t: '', b: false, c: null }] },
          ],
        },
      ],
    };
    localStorage.setItem('mindflow_doc_nx1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=nx1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    line.focus();
    fireEvent.keyDown(line, { key: 'Backspace' });

    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')).toBeNull());
    // 캐럿이 갈 자리는 **앞 줄**이다 — 예전에는 줄만 사라지고 포커스를 잃었다.
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('태그 영역과 아래 구분선 사이가 **18px**이다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nx2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nx2&title=x');
    const head = (await waitFor(() => container.querySelector('[data-note-page-head]'))) as HTMLElement;
    const rule = head.nextElementSibling as HTMLElement;

    // 단의 기본 틈이 9px이라 9를 더해 18이 된다.
    expect(rule.style.marginTop).toBe('9px');
    expect((head.parentElement as HTMLElement).style.gap).toBe('9px');
  });

  it('`/` 뒤에 **공백 + 일곱 글자**면 접히고 친 글자는 남는다(요청)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_nx3', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=nx3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    fireEvent.keyDown(line, { key: '/' });
    // 여섯 글자(`글머리 기호`)까지는 남는다 — 가장 긴 블록 이름이다.
    type(line, '/글머리 기호');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());

    type(line, '/글머리 기호입니다');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());
    saveNow();
    await waitFor(() => expect(saved('nx3').pages[0].blocks[0].runs[0].t).toBe('/글머리 기호입니다'));
  });

  it('우클릭 메뉴의 `잘라내기`는 **평범한 가위**다(제보)', async () => {
    localStorage.setItem('mindflow_doc_nx4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nx4&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    fireEvent.contextMenu(line);

    const cut = (await waitFor(() => container.querySelector('[data-note-ctx="cut"]'))) as HTMLElement;
    // 손잡이가 **닫힌 원** 둘이다 — 예전의 반원 두 개는 16px에서 고리로 보였다.
    expect(cut.querySelectorAll('circle')).toHaveLength(2);
  });

  it('본문 폭을 **창 너비에 맞춤**으로 바꾸면 단의 상한이 풀린다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nx5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nx5&title=x');
    const head = (await waitFor(() => container.querySelector('[data-note-page-head]'))) as HTMLElement;
    const col = head.parentElement as HTMLElement;
    expect(col.style.maxWidth).toBe('700px');

    fireEvent.click(container.querySelector('[data-note-width]')!);
    await waitFor(() => expect((container.querySelector('[data-note-page-head]')!.parentElement as HTMLElement).style.maxWidth).toBe(''));
    // 값은 **공책 한 권**에 남는다(`cover.wide`).
    saveNow();
    await waitFor(() => expect(saved('nx5').cover.wide).toBe(true));
  });
});

describe('공책 23판 — 표 레이아웃 4건(스크롤·분리·자리·얹은 줄만)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('표 상자는 **세로로 스크롤하지 않는다** — 가로 막대가 깜빡이던 되먹임을 끊는다(제보)', async () => {
    localStorage.setItem('mindflow_doc_ny0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ny0&title=x');
    const scroller = (await waitFor(() => container.querySelector('[data-note-table-scroll]'))) as HTMLElement;

    // `overflow-x: auto`만 주면 세로도 `auto`가 되어, 1px만 넘쳐도
    // 세로 막대 → 가로가 좁아짐 → 가로 막대 → … 하며 끄는 동안 깜빡인다.
    expect(scroller.style.overflowX).toBe('auto');
    expect(scroller.style.overflowY).toBe('hidden');
    // 테두리·둥근 모서리는 **안쪽** 상자가 갖는다 — 막대가 그것을 가로지르지 않는다.
    const box = scroller.firstElementChild as HTMLElement;
    expect(box.getAttribute('data-note-table-box')).not.toBeNull();
    expect(box.style.borderRadius).toBe('12px');
  });

  it('레일과 끝의 ＋는 **흐름 밖**이라 페이지 자리를 먹지 않는다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ny1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ny1&title=x');
    const scroller = (await waitFor(() => container.querySelector('[data-note-table-scroll]'))) as HTMLElement;
    const wrap = scroller.parentElement as HTMLElement;

    // 감싸는 판의 **흐름 안 자식은 스크롤 판 하나뿐**이다(나머지 넷은 absolute).
    const inFlow = [...wrap.children].filter((el) => (el as HTMLElement).style.position !== 'absolute');
    expect(inFlow).toEqual([scroller]);
    expect((container.querySelector('[data-note-table-colrail]') as HTMLElement).style.position).toBe('absolute');
    expect((container.querySelector('[data-note-table-rowrail]') as HTMLElement).style.position).toBe('absolute');
  });

  it('**마우스가 얹힌 칸의 열·행 손잡이만** 보인다(요청)', async () => {
    localStorage.setItem('mindflow_doc_ny2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ny2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;
    const slot = (axis: 'col' | 'row', i: number) => (container.querySelector(`[data-note-table-${axis}slot="${i}"]`) as HTMLElement).style.opacity;

    // 아무 데도 얹지 않았으면 손잡이는 전부 숨어 있다.
    expect(slot('col', 0)).toBe('0');
    expect(slot('row', 0)).toBe('0');

    fireEvent.mouseEnter(cell);
    // `1:0` → 0열과 1행만.
    await waitFor(() => expect(slot('col', 0)).toBe('1'));
    expect(slot('row', 1)).toBe('1');
    expect(slot('col', 1)).toBe('0');
    expect(slot('row', 0)).toBe('0');
  });

  it('고른 줄의 손잡이는 마우스를 떼도 남는다 — 무엇을 골랐는지 보여야 한다', async () => {
    localStorage.setItem('mindflow_doc_ny3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=ny3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-table-rowhandle="1"]'))) as HTMLElement);

    await waitFor(() => expect((container.querySelector('[data-note-table-rowslot="1"]') as HTMLElement).style.opacity).toBe('1'));
    expect((container.querySelector('[data-note-table-rowslot="0"]') as HTMLElement).style.opacity).toBe('0');
  });
});

describe('공책 24판 — 고른 칸의 캐럿·잘라내기 가위·블록 이름', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('고른 칸은 **캐럿을 그리지 않는다** — 키는 받지만 글을 고치는 중은 아니다(제보)', async () => {
    localStorage.setItem('mindflow_doc_nz0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nz0&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="1:0"]'))) as HTMLElement;

    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(cell);
    // CSS가 이 표식을 보고 캐럿과 선택 표시를 지운다.
    await waitFor(() => expect(cell.getAttribute('data-armed')).toBe('1'));
    expect(document.activeElement).toBe(container.querySelector('[data-note-line="b4:r1c0"]'));

    // 글자가 들어와 편집으로 넘어가면 표식이 사라져 캐럿이 돌아온다.
    const line = container.querySelector('[data-note-line="b4:r1c0"]') as HTMLElement;
    line.innerHTML = '값';
    fireEvent.input(line);
    await waitFor(() => expect(cell.getAttribute('data-armed')).toBeNull());

    // Enter는 편집을 닫고 **고른 칸으로 되돌린다**(캐럿 없는 상태).
    fireEvent.keyDown(line, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-note-table-cell="1:0"]')?.getAttribute('data-armed')).toBe('1'));
  });

  it('잘라내기 가위가 **맵·보드 에디터의 그것과 같다**(제보)', async () => {
    localStorage.setItem('mindflow_doc_nz1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nz1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    fireEvent.contextMenu(line);

    const cut = (await waitFor(() => container.querySelector('[data-note-ctx="cut"]'))) as HTMLElement;
    // 손잡이 둘이 **아래에** 있고 날이 위로 벌어진다(`ContextMenu.tsx`의 `CutIcon`).
    const cys = [...cut.querySelectorAll('circle')].map((c) => c.getAttribute('cy'));
    expect(cys).toEqual(['18', '18']);
    expect([...cut.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(['M8.1 15.9 19 3', 'M15.9 15.9 5 3']);
  });

  it('블록 이름 — `글머리 기호` · `번호 매기기`(요청)', async () => {
    localStorage.setItem('mindflow_doc_nz2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nz2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-slash-btn]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-btn]')!);

    const panel = (await waitFor(() => container.querySelector('[data-note-slash-panel]'))) as HTMLElement;
    expect(panel.querySelector('[data-note-slash-item="ul"]')?.textContent).toContain('글머리 기호');
    expect(panel.querySelector('[data-note-slash-item="ol"]')?.textContent).toContain('번호 매기기');
    expect(panel.textContent).not.toContain('글머리 목록');
    expect(panel.textContent).not.toContain('번호 목록');
  });
});

describe('공책 25판 — 본문 4건(구분선·방향키·마크다운 단축·선택 배경)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 캐럿을 그 줄의 끝(또는 처음)에 놓는다 — 방향키가 줄을 넘는 조건이다. */
  function caretTo(el: HTMLElement, end: boolean): void {
    // **텍스트 노드**에 놓아야 한다 — `NoteLine`은 첫/마지막 텍스트 노드의 끝인지로
    // "줄을 넘을 때인가"를 가른다(요소에 걸면 그 판정이 서지 않는다).
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    let last = node;
    while (node) {
      last = node;
      node = walker.nextNode();
    }
    const target = end ? last : (document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() ?? el);
    // **포커스를 먼저** 준다 — jsdom은 `focus()`에서 선택을 그 요소의 처음으로
    // 되돌려, 순서가 뒤집히면 캐럿이 늘 줄 머리에 앉는다.
    el.focus();
    const range = document.createRange();
    if (target && target.nodeType === 3) range.setStart(target, end ? (target.nodeValue ?? '').length : 0);
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('↓는 다음 줄로, ↑는 이전 줄로 간다(제보: 방향키로 이동되지 않는다)', async () => {
    localStorage.setItem('mindflow_doc_o1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=o1&title=x');
    const b1 = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretTo(b1, true);
    fireEvent.keyDown(b1, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b2'));

    const b2 = container.querySelector('[data-note-line="b2"]') as HTMLElement;
    caretTo(b2, false);
    fireEvent.keyDown(b2, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('`- ` + 띄어쓰기는 **글머리 기호**가 된다(요청)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_o2', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=o2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(line, '- ');
    saveNow();
    await waitFor(() => expect(saved('o2').pages[0].blocks[0].kind).toBe('ul'));
    // 친 글자는 남지 않는다 — 마커가 그 자리를 대신한다.
    expect(saved('o2').pages[0].blocks[0].items[0].runs.map((r: { t: string }) => r.t).join('')).toBe('');
  });

  it('`3. ` + 띄어쓰기는 **3번부터** 번호 매기기가 된다(요청)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_o3', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=o3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(line, '3. ');
    saveNow();
    await waitFor(() => expect(saved('o3').pages[0].blocks[0].kind).toBe('ol'));
    expect(saved('o3').pages[0].blocks[0].start).toBe(3);
    // 화면의 마커도 3부터다.
    await waitFor(() => expect(container.querySelector('[data-note-block="b1"]')?.textContent).toContain('3.'));
  });

  it('`1. `은 **기본값이라 문서에 적지 않는다**', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_o4', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=o4&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(line, '1. ');
    saveNow();
    await waitFor(() => expect(saved('o4').pages[0].blocks[0].kind).toBe('ol'));
    expect(saved('o4').pages[0].blocks[0].start).toBeUndefined();
  });

  it('**글 중간의 `- `는 그냥 글이다** — 문단 전체가 그 글자일 때만 건다', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_o5', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=o5&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(line, '범위는 3 - 5 ');
    saveNow();
    await waitFor(() => expect(saved('o5').pages[0].blocks[0].runs[0].t).toBe('범위는 3 - 5 '));
    expect(saved('o5').pages[0].blocks[0].kind).toBe('p');
  });
});

describe('공책 26판 — 표 5건(선택 배경·행 레일·레일 영역·세로 맞춤·바깥 스크롤)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('**행 레일 쪽의 틈이 레일의 몸이다** — 가는 길에 사라지지 않게(제보)', async () => {
    localStorage.setItem('mindflow_doc_p0', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=p0&title=x');
    const rail = (await waitFor(() => container.querySelector('[data-note-table-rowrail]'))) as HTMLElement;

    // 4px을 **여백이 아니라 패딩**으로 준다 — 여백이면 그 틈이 어느 요소에도 속하지
    // 않아, 칸에서 레일로 가는 찰나에 블록 밖으로 나갔다 들어오며 레일이 숨는다.
    expect(rail.style.marginRight).toBe('0px');
    expect(rail.style.paddingRight).toBe('4px');
    expect(rail.style.boxSizing).toBe('content-box');
  });

  it('**레일 띠에 마우스를 얹으면** 그 축의 손잡이가 모두 보인다(요청)', async () => {
    localStorage.setItem('mindflow_doc_p1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=p1&title=x');
    const rail = (await waitFor(() => container.querySelector('[data-note-table-rowrail]'))) as HTMLElement;
    const slot = (i: number) => (container.querySelector(`[data-note-table-rowslot="${i}"]`) as HTMLElement).style.opacity;

    expect(slot(0)).toBe('0');
    fireEvent.mouseEnter(rail);
    await waitFor(() => expect(slot(0)).toBe('1'));
    expect(slot(1)).toBe('1');
    // 열 손잡이는 그대로 숨어 있다 — 얹은 축만 켠다.
    expect((container.querySelector('[data-note-table-colslot="0"]') as HTMLElement).style.opacity).toBe('0');

    fireEvent.mouseLeave(rail);
    await waitFor(() => expect(slot(0)).toBe('0'));
  });

  it('칸의 글은 **세로 가운데**에 선다(요청)', async () => {
    localStorage.setItem('mindflow_doc_p2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=p2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    expect(cell.style.verticalAlign).toBe('middle');
  });

  it('가로 막대는 **표 테두리 바깥**에 선다 — 마지막 줄을 가로지르지 않게(제보)', async () => {
    localStorage.setItem('mindflow_doc_p3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=p3&title=x');
    const scroller = (await waitFor(() => container.querySelector('[data-note-table-scroll]'))) as HTMLElement;
    const box = scroller.firstElementChild as HTMLElement;

    // 넘침은 바깥 판이 받고, 테두리·둥근 모서리는 안쪽 상자가 갖는다.
    expect(scroller.style.overflowX).toBe('auto');
    expect(scroller.style.border).toBe('');
    expect(box.getAttribute('data-note-table-box')).not.toBeNull();
    expect(box.style.border).toContain('1px solid');
    expect(box.style.borderRadius).toBe('12px');
    expect(box.style.overflowX).toBe('');
  });
});

describe('공책 27판 — 본문 편집 3건(Enter로 가르기·방향키·목록 뒤 포커스)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 캐럿을 그 줄의 n번째 글자 앞에 놓는다. */
  function caretAtChar(el: HTMLElement, at: number): void {
    el.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange();
    if (node) range.setStart(node, Math.min(at, (node.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('문장 **가운데**에서 Enter를 치면 뒤쪽 글이 새 줄로 내려간다(요청)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '앞부분뒷부분', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_q0', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=q0&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAtChar(line, 3); // `앞부분` 뒤
    fireEvent.keyDown(line, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('q0').pages[0].blocks).toHaveLength(2));
    expect(runsOf(saved('q0').pages[0].blocks[0])).toBe('앞부분');
    expect(runsOf(saved('q0').pages[0].blocks[1])).toBe('뒷부분');
  });

  it('글 **끝**에서 Enter는 예전처럼 빈 줄을 더한다(무회귀)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '한 줄', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_q1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=q1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAtChar(line, 99);
    fireEvent.keyDown(line, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('q1').pages[0].blocks).toHaveLength(2));
    expect(runsOf(saved('q1').pages[0].blocks[0])).toBe('한 줄');
    expect(runsOf(saved('q1').pages[0].blocks[1])).toBe('');
  });

  it('**제목을 가르면 뒤쪽은 문단**이다 — 제목 둘이 되지 않게', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'h2', runs: [{ t: '제목앞제목뒤', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_q2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=q2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAtChar(line, 3);
    fireEvent.keyDown(line, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('q2').pages[0].blocks).toHaveLength(2));
    expect(saved('q2').pages[0].blocks[0].kind).toBe('h2');
    expect(saved('q2').pages[0].blocks[1].kind).toBe('p');
    expect(runsOf(saved('q2').pages[0].blocks[1])).toBe('제목뒤');
  });

  it('목록으로 바뀌면 캐럿이 **그 항목**에 남는다(제보: 포커스가 풀린다)', async () => {
    const empty = { ...NOTE, pages: [{ id: 'p1', title: '빈 장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_q3', JSON.stringify(empty));
    const { container } = renderEditor('/editor?map=q3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(line, '- ');

    // 새 항목의 편집 박스가 포커스를 받는다 — 블록 id로는 갈 수 없는 자리다.
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')?.startsWith('b1:')).toBe(true));
  });
});

describe('공책 28판 — 구분선 고르기와 단축키(서식·찾기·도움말)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 이 줄의 글 전체를 고른다 — 서식 단축키는 **고른 글**에 걸린다. */
  function selectAll(el: HTMLElement): void {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('구분선은 **초점을 받는 칸**이다 — 누르면 고를 수 있다(제보: 지울 방법이 없다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '위', b: false, c: null }] }, { id: 'b2', kind: 'hr' }] }] };
    localStorage.setItem('mindflow_doc_r0', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=r0&title=x');
    const hr = (await waitFor(() => container.querySelector('[data-note-hr="b2"]'))) as HTMLElement;
    expect(hr.getAttribute('tabindex')).toBe('0');

    hr.focus();
    expect(document.activeElement).toBe(hr);
  });

  it('고른 구분선에서 Backspace = 그 구분선을 지운다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '위', b: false, c: null }] }, { id: 'b2', kind: 'hr' }] }] };
    localStorage.setItem('mindflow_doc_r1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=r1&title=x');
    const hr = (await waitFor(() => container.querySelector('[data-note-hr="b2"]'))) as HTMLElement;

    hr.focus();
    fireEvent.keyDown(hr, { key: 'Backspace' });
    saveNow();

    await waitFor(() => expect(saved('r1').pages[0].blocks).toHaveLength(1));
    expect(saved('r1').pages[0].blocks[0].id).toBe('b1');
  });

  it('↓ 방향키가 **구분선 위에 선다** — 지나가 버리면 고를 수가 없다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '위', b: false, c: null }] }, { id: 'b2', kind: 'hr' }] }] };
    localStorage.setItem('mindflow_doc_r2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=r2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 캐럿을 **마지막 글자 뒤**에 둔다 — 포커스가 먼저다(jsdom의 `focus()`가 선택을
    // 되돌린다), 그리고 요소가 아니라 **텍스트 노드**에 놓아야 한다(좌표를 못 재는
    // 환경에서는 "마지막 텍스트 노드의 끝인가"로 가른다).
    line.focus();
    const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, (text.nodeValue ?? '').length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(line, { key: 'ArrowDown' });

    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-hr')).toBe('b2'));
  });

  it('⌘B = 고른 글을 굵게(요청: 공책에서도 단축키를 다 쓰게)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '굵게', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_r3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=r3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    selectAll(line);
    fireEvent.keyDown(line, { key: 'b', code: 'KeyB', metaKey: true });
    saveNow();

    await waitFor(() => expect(saved('r3').pages[0].blocks[0].runs.every((r: { b: boolean }) => r.b)).toBe(true));
  });

  it('⌘⇧S = 취소선 · ⌘U = 밑줄', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '지움', b: false, c: null }] }, { id: 'b2', kind: 'p', runs: [{ t: '밑줄', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_r4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=r4&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    selectAll(one);
    fireEvent.keyDown(one, { key: 'S', code: 'KeyS', metaKey: true, shiftKey: true });

    const two = container.querySelector('[data-note-line="b2"]') as HTMLElement;
    selectAll(two);
    fireEvent.keyDown(two, { key: 'u', code: 'KeyU', metaKey: true });
    saveNow();

    await waitFor(() => expect(saved('r4').pages[0].blocks[0].runs.every((r: { s?: boolean }) => r.s)).toBe(true));
    expect(saved('r4').pages[0].blocks[1].runs.every((r: { u?: boolean }) => r.u)).toBe(true);
  });

  it('⌘F = **이 공책에서 찾기** 칸으로 초점(맵 검색 바는 공책에 없다)', async () => {
    localStorage.setItem('mindflow_doc_r5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=r5&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', metaKey: true });

    await waitFor(() => expect(document.activeElement?.hasAttribute('data-note-search')).toBe(true));
  });

  it('도움말은 **공책 구획**을 보여 주고 캔버스 구획(선택·이동)은 감춘다', async () => {
    localStorage.setItem('mindflow_doc_r6', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=r6&title=x');
    const keys = (await waitFor(() => container.querySelector('[data-note-keys]'))) as HTMLElement;

    fireEvent.click(keys);

    await screen.findByText('공책');
    expect(screen.queryByText('선택·이동')).toBeNull();
    expect(screen.getByText('이 공책에서 찾기')).toBeTruthy();
  });
});

describe('공책 29판 — 한글 조합 중 방향키 · 칸의 세로 맞춤', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /**
   * 캐럿을 그 줄의 **맨 앞**에 둔다(포커스가 먼저다 — jsdom 함정).
   *
   * 왜 끝이 아니라 앞인가: jsdom은 좌표를 재지 못해 `caretOnEdgeLine`이 **글자 기준**
   * 으로 물러선다(↑는 "첫 글자인가"). 글 끝에서 ↑를 한 번에 넘기는 것은 좌표가 있는
   * 브라우저의 몫이라 실브라우저 프로브가 본다 — 여기서 보는 것은 **조합 중이어도
   * 넘어가는가**이고, 그 판정은 캐럿 자리와 무관하게 같은 길을 지난다.
   */
  function caretAtStart(el: HTMLElement): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, 0);
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('**조합 중에 누른 ↑도 한 번에** 윗줄로 간다(제보: 두 번 눌러야 넘어간다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_s0', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=s0&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    caretAtStart(two);
    // 한글의 마지막 글자는 **조합 중**인 채로 남는다 — 그 상태의 keydown이다.
    fireEvent.keyDown(two, { key: 'ArrowUp', isComposing: true });

    // 조합을 끝내는 것은 브라우저의 몫이라 우리는 **그 다음 차례**에 건너뛴다.
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('조합이 끝난 뒤의 ↑는 예전 그대로(무회귀)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_s1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=s1&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    caretAtStart(two);
    fireEvent.keyDown(two, { key: 'ArrowUp' });

    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('표의 칸은 **줄 높이만큼만** 차지한다 — 남는 틈이 아래로 몰려 글이 위로 떴다(제보)', async () => {
    localStorage.setItem('mindflow_doc_s2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=s2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;

    // 줄 높이(16px)와 같은 `minHeight` — 기본값 `1.6em`(20.8px)이면 4.8px이 전부
    // 아래에 깔려 `vertical-align: middle`이 글을 3px 위로 올려놓는다.
    expect(cell.style.minHeight).toBe('16px');
    expect(cell.style.lineHeight).toBe('16px');
    const td = cell.closest('td') as HTMLElement;
    expect(td.style.verticalAlign).toBe('middle');
  });
});

describe('공책 30판 — 목록 Tab · 앞 줄에 잇기 · 지운 뒤 커서', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 캐럿을 그 줄의 **맨 앞**에 둔다(포커스가 먼저다 — jsdom 함정). */
  function caretAtHead(el: HTMLElement): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, 0);
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  const LIST = (id: string) => ({
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [{ id, kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
    ] }] }],
  });

  it('Tab = 그 항목만 한 단계 들어간다(요청) · Shift+Tab으로 나온다', async () => {
    localStorage.setItem('mindflow_doc_t0', JSON.stringify(LIST('b1')));
    const { container } = renderEditor('/editor?map=t0&title=x');
    const second = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    saveNow();
    await waitFor(() => expect(saved('t0').pages[0].blocks[0].items[1].indent).toBe(1));
    // 첫 항목은 그대로다 — 목록 전체가 아니라 **그 항목**만 움직인다.
    expect(saved('t0').pages[0].blocks[0].items[0].indent).toBeUndefined();
    // 표식도 단계를 따른다(`•` → `◦`).
    expect(container.querySelectorAll('[data-note-bullet]')[1]?.getAttribute('data-note-bullet')).toBe('◦');

    fireEvent.keyDown(second, { key: 'Tab', shiftKey: true });
    saveNow();
    await waitFor(() => expect(saved('t0').pages[0].blocks[0].items[1].indent).toBeUndefined());
  });

  it('들여쓴 항목의 맨 앞 Backspace는 **먼저 한 단계 나온다**', async () => {
    localStorage.setItem('mindflow_doc_t1', JSON.stringify(LIST('b1')));
    const { container } = renderEditor('/editor?map=t1&title=x');
    const second = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    caretAtHead(second);
    fireEvent.keyDown(second, { key: 'Backspace' });
    saveNow();

    await waitFor(() => expect(saved('t1').pages[0].blocks[0].items[1].indent).toBeUndefined());
    // 글은 그대로 남는다 — 지우는 것이 아니라 나오는 것이다.
    expect(saved('t1').pages[0].blocks[0].items).toHaveLength(2);
  });

  it('빈 항목에서 Backspace는 **그 줄의 표식만** 걷고, 한 번 더 누르면 앞 항목에 잇는다(요청 6)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_t2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t2&title=x');
    const second = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    caretAtHead(second);
    fireEvent.keyDown(second, { key: 'Backspace' });

    // 줄은 남고 목록만 풀린다 — 항목 하나짜리 목록 + 빈 문단.
    const para = (await waitFor(() => {
      const el = [...container.querySelectorAll('[data-note-block]')].find((b) => b.getAttribute('data-note-kind') === 'p');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    })) as HTMLElement;
    expect(container.querySelector('[data-note-line="b1:i1"]')).toBeTruthy();
    expect(container.querySelector('[data-note-line="b1:i2"]')).toBeFalsy();

    // 그다음 Backspace가 앞 항목과 잇는다(문단의 규칙을 그대로 탄다).
    const line = para.querySelector('[data-note-line]') as HTMLElement;
    caretAtHead(line);
    fireEvent.keyDown(line, { key: 'Backspace' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1:i1'));
  });

  it('마지막 항목까지 지우면 문단으로 돌아가고 **그 문단**에 커서가 남는다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_t3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t3&title=x');
    const only = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    caretAtHead(only);
    fireEvent.keyDown(only, { key: 'Backspace' });

    await waitFor(() => expect(saved('t3') && true).toBe(true));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('글이 있는 줄의 맨 앞 Backspace = **앞 줄에 잇는다**(제보)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '앞줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '뒷줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_t4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t4&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    caretAtHead(two);
    fireEvent.keyDown(two, { key: 'Backspace' });
    saveNow();

    await waitFor(() => expect(saved('t4').pages[0].blocks).toHaveLength(1));
    expect(runsOf(saved('t4').pages[0].blocks[0])).toBe('앞줄뒷줄');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
  });

  it('앞이 **표**면 잇지 않는다 — 표 안으로 문단을 밀어 넣지 않는다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'table', rows: [[[{ t: 'ㄱ', b: false, c: null }], [{ t: 'ㄴ', b: false, c: null }]]] },
      { id: 'b2', kind: 'p', runs: [{ t: '뒷줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_t5', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t5&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    caretAtHead(two);
    fireEvent.keyDown(two, { key: 'Backspace' });
    saveNow();

    expect(saved('t5').pages[0].blocks).toHaveLength(2);
  });
});

describe('공책 31판 — 목록 여러 줄 끌어 지우기 · 조합 중 방향키(3회차)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /**
   * 두 줄에 걸쳐 끈다 — jsdom에는 좌표→캐럿이 없어 **줄 통째로**가 걸린다
   * (`buildSelection`의 폴백: 시작 줄은 머리부터, 끝 줄은 끝까지).
   */
  function dragOver(container: HTMLElement, fromKey: string, toKey: string): void {
    const col = container.querySelector('[data-note-page] > div') as HTMLElement;
    const a = container.querySelector(`[data-note-line="${fromKey}"]`) as HTMLElement;
    const b = container.querySelector(`[data-note-line="${toKey}"]`) as HTMLElement;
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(b, { clientX: 0, clientY: 0 });
    expect(col).toBeTruthy();
  }

  it('번호 매기기 여러 줄을 끌어 지우면 **그 줄들이 사라진다**(제보: 첫 줄 글자만 지워졌다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ol', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
      { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_u0', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=u0&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i3"]')).toBeTruthy());

    dragOver(container, 'b1:i1', 'b1:i3');
    fireEvent.keyDown(document, { key: 'Backspace' });
    // 저장은 **화면이 바뀐 뒤에** — `saveNow`는 지금 문서를 그대로 적는데, 커밋은
    // 리액트가 다음 차례에 반영한다(먼저 저장하면 옛 문서가 남는다).
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i3"]')).toBeNull());
    saveNow();

    await waitFor(() => expect(saved('u0').pages[0].blocks[0].items).toHaveLength(1));
    expect(runsOf({ runs: saved('u0').pages[0].blocks[0].items[0].runs })).toBe('');
    // 목록 자체는 남는다 — 지운 것은 줄이지 블록의 종류가 아니다.
    expect(saved('u0').pages[0].blocks[0].kind).toBe('ol');
  });

  it('가운데 줄들만 끌면 **뒤의 항목은 남는다**', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
      { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_u1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=u1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i2"]')).toBeTruthy());

    dragOver(container, 'b1:i1', 'b1:i2');
    fireEvent.keyDown(document, { key: 'Backspace' });
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i2"]')).toBeNull());
    saveNow();

    await waitFor(() => expect(saved('u1').pages[0].blocks[0].items).toHaveLength(2));
    expect(saved('u1').pages[0].blocks[0].items.map((i: { runs: { t: string }[] }) => i.runs.map((r) => r.t).join(''))).toEqual(['', '셋']);
  });

  it('문단에서 목록 가운데까지 끌면 **블록을 넘어서도** 지워진다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b0', kind: 'p', runs: [{ t: '문단', b: false, c: null }] },
      { id: 'b1', kind: 'ul', items: [
        { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
        { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
        { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
      ] },
    ] }] };
    localStorage.setItem('mindflow_doc_u2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=u2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i2"]')).toBeTruthy());

    dragOver(container, 'b0', 'b1:i2');
    fireEvent.keyDown(document, { key: 'Backspace' });
    await waitFor(() => expect(container.querySelector('[data-note-line="b1:i2"]')).toBeNull());
    saveNow();

    await waitFor(() => expect(runsOf(saved('u2').pages[0].blocks[0])).toBe(''));
    expect(runsOf(saved('u2').pages[0].blocks[0])).toBe('');
    expect(saved('u2').pages[0].blocks[1].items.map((i: { runs: { t: string }[] }) => i.runs.map((r) => r.t).join(''))).toEqual(['셋']);
  });

  it('**조합 중이라 캐럿이 접혀 있지 않아도** 방향키는 한 번에 이웃 줄로(제보 3회차)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
      { id: 'b3', kind: 'p', runs: [{ t: '셋째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_u3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=u3&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    /**
     * IME가 조합 글자를 **골라 둔** 모양 — `isCollapsed`가 거짓이다(실측한 그 상태).
     * 캐럿은 그 범위의 **끝**(focus)에 있으므로 조합 글자가 줄 끝에 있는 상태를
     * 만든다: 마지막 글자를 골라 두고 ↓를 누른다. jsdom은 좌표를 못 재 가장자리
     * 판정이 **글자 자리**로 물러서므로(감긴 줄을 구분하지 못한다) 끝에서 ↓가
     * 그 길을 그대로 지난다 — 조합 중의 ↑는 실브라우저 프로브가 본다.
     */
    two.focus();
    const text = document.createTreeWalker(two, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const len = (text.nodeValue ?? '').length;
    const range = document.createRange();
    range.setStart(text, len - 1);
    range.setEnd(text, len);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(sel?.isCollapsed).toBe(false);

    fireEvent.keyDown(two, { key: 'ArrowDown', isComposing: true });

    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b3'));
  });
});

describe('공책 32판 — 줄을 넘는 캐럿(←·→·Enter 뒤 자리)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const THREE = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '안녕하세요', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '반갑습니다', b: false, c: null }] },
    ] }],
  };

  /** 그 줄의 n번째 글자 앞에 캐럿을 둔다(포커스가 먼저다 — jsdom 함정). */
  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  /** 지금 캐럿의 (줄, 글자 자리). */
  function where(): { line: string | null; off: number } {
    const el = document.activeElement as HTMLElement | null;
    const sel = window.getSelection();
    let off = -1;
    if (el && sel?.focusNode) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node = walk.nextNode();
      while (node) {
        if (node === sel.focusNode) {
          off = seen + sel.focusOffset;
          break;
        }
        seen += (node.nodeValue ?? '').length;
        node = walk.nextNode();
      }
    }
    return { line: el?.getAttribute?.('data-note-line') ?? null, off };
  }

  it('문장 **끝에서 →** 면 다음 줄 맨 앞으로(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_v0', JSON.stringify(THREE));
    const { container } = renderEditor('/editor?map=v0&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 5); // `안녕하세요` 뒤
    fireEvent.keyDown(one, { key: 'ArrowRight' });

    await waitFor(() => expect(where()).toEqual({ line: 'b2', off: 0 }));
  });

  it('문장 **앞에서 ←** 면 앞 줄 맨 끝으로', async () => {
    localStorage.setItem('mindflow_doc_v1', JSON.stringify(THREE));
    const { container } = renderEditor('/editor?map=v1&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    caretAt(two, 0);
    fireEvent.keyDown(two, { key: 'ArrowLeft' });

    await waitFor(() => expect(where()).toEqual({ line: 'b1', off: 5 }));
  });

  it('글 가운데에서는 ←·→가 **브라우저의 것**이다(줄을 넘지 않는다)', async () => {
    localStorage.setItem('mindflow_doc_v2', JSON.stringify(THREE));
    const { container } = renderEditor('/editor?map=v2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 2);
    fireEvent.keyDown(one, { key: 'ArrowRight' });

    expect(where().line).toBe('b1');
  });

  it('⌘·⌥가 붙은 방향키는 가로채지 않는다(줄·낱말 단위 이동은 브라우저의 것)', async () => {
    localStorage.setItem('mindflow_doc_v3', JSON.stringify(THREE));
    const { container } = renderEditor('/editor?map=v3&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 5);
    fireEvent.keyDown(one, { key: 'ArrowRight', metaKey: true });
    expect(where().line).toBe('b1');
    fireEvent.keyDown(one, { key: 'ArrowDown', altKey: true });
    expect(where().line).toBe('b1');
  });

  it('문장 가운데 Enter — 커서가 **내려간 글의 앞**에 선다(제보 3)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '안녕하세요', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_v4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=v4&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 2); // `안녕` 뒤
    fireEvent.keyDown(one, { key: 'Enter' });

    await waitFor(() => expect(document.activeElement?.textContent).toBe('하세요'));
    // 캐럿은 **마운트 뒤** 다음 프레임에 앞으로 옮겨진다(새 줄의 `autoFocus`는 끝에 둔다).
    await waitFor(() => expect(where().off).toBe(0));
  });
});

describe('공책 33판 — 목록의 Enter·Tab·선택(제보 5건)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  const LIST = (kind: 'ul' | 'ol') => ({
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind, items: [
      { id: 'i1', runs: [{ t: '안녕하세요', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '반갑습니다', b: false, c: null }] },
    ] }] }],
  });

  it('항목 가운데 Enter — **뒤쪽 글이 새 항목으로** 따라 내려간다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_w0', JSON.stringify(LIST('ol')));
    const { container } = renderEditor('/editor?map=w0&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    caretAt(one, 2); // `안녕` 뒤
    fireEvent.keyDown(one, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('w0').pages[0].blocks[0].items).toHaveLength(3));
    const texts = saved('w0').pages[0].blocks[0].items.map((i: { runs: { t: string }[] }) => i.runs.map((r) => r.t).join(''));
    expect(texts).toEqual(['안녕', '하세요', '반갑습니다']);
    // 커서는 내려간 글의 **앞**에 선다(문단과 같은 규칙).
    await waitFor(() => expect(document.activeElement?.textContent).toBe('하세요'));
  });

  it('들여쓴 항목에서 Enter — 새 항목이 **그 단계를 물려받는다**(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_w1', JSON.stringify(LIST('ul')));
    const { container } = renderEditor('/editor?map=w1&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    two.focus();
    fireEvent.keyDown(two, { key: 'Tab' });
    await waitFor(() => expect(saved('w1') && true).toBe(true));
    caretAt(two, 5); // 글 끝
    fireEvent.keyDown(two, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('w1').pages[0].blocks[0].items).toHaveLength(3));
    expect(saved('w1').pages[0].blocks[0].items[2].indent).toBe(1);
  });

  it('Tab을 **연달아 두 번** 눌러도 두 단계 들어간다(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_w2', JSON.stringify(LIST('ol')));
    const { container } = renderEditor('/editor?map=w2&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    two.focus();
    fireEvent.keyDown(two, { key: 'Tab' });
    fireEvent.keyDown(two, { key: 'Tab' });
    saveNow();

    await waitFor(() => expect(saved('w2').pages[0].blocks[0].items[1].indent).toBe(2));
    // 첫 항목도 들어간다 — 이웃을 따지지 않는다.
    const one = container.querySelector('[data-note-line="b1:i1"]') as HTMLElement;
    one.focus();
    fireEvent.keyDown(one, { key: 'Tab' });
    saveNow();
    await waitFor(() => expect(saved('w2').pages[0].blocks[0].items[0].indent).toBe(1));
  });

  it('Tab은 **언제나 목록이 받는다** — 초점이 밖으로 새지 않는다', async () => {
    localStorage.setItem('mindflow_doc_w3', JSON.stringify(LIST('ul')));
    const { container } = renderEditor('/editor?map=w3&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    two.focus();
    // 가장 깊은 단계까지 넣고, 그 뒤의 Tab도 막혀야 한다(기본 동작 = 초점 이동).
    for (let i = 0; i < NOTE_LIST_MAX_INDENT + 2; i += 1) {
      const ev = createEvent.keyDown(two, { key: 'Tab' });
      fireEvent(two, ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    saveNow();
    await waitFor(() => expect(saved('w3').pages[0].blocks[0].items[1].indent).toBe(NOTE_LIST_MAX_INDENT));
  });

  it('빈 항목에는 **안내 글자가 없다**(제보 5)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_w4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=w4&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    expect(one.getAttribute('data-placeholder')).toBe('');
  });

  it('빈 항목에서 Enter — **들여쓴 항목은 한 단계 나온다**(목록은 유지)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ul', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '', b: false, c: null }], indent: 1 },
    ] }] }] };
    localStorage.setItem('mindflow_doc_w5', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=w5&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    two.focus();
    fireEvent.keyDown(two, { key: 'Enter' });
    saveNow();

    await waitFor(() => expect(saved('w5').pages[0].blocks[0].items[1].indent).toBeUndefined());
    expect(saved('w5').pages[0].blocks).toHaveLength(1); // 목록은 그대로다
  });

  it('Shift+↓ 로 **줄을 넘어 고른다**(제보 4 — 문단도 목록도)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_w6', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=w6&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 99); // jsdom은 좌표를 못 재 **글 끝**이라야 가장자리로 본다
    fireEvent.keyDown(one, { key: 'ArrowDown', shiftKey: true });

    // 두 블록이 **고른 것**으로 표시된다(드래그 선택과 같은 그림).
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
  });

  it('고른 상태에서 **수정 키 없는 방향키**는 선택을 접고 캐럿을 남긴다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_w7', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=w7&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    caretAt(one, 99);
    fireEvent.keyDown(one, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    fireEvent.keyDown(document, { key: 'ArrowDown' });

    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(0));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b2'));
  });
});

describe('공책 34판 — 줄 밖 클릭·드래그 · ⌘A 두 번 · 앞에서 만드는 목록', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  const TWO = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '안녕하세요', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '반갑습니다', b: false, c: null }] },
    ] }],
  };

  it('줄 **밖**(줄 사이·좌우 여백)을 눌러도 캐럿이 가장 가까운 줄에 선다(제보 1·2)', async () => {
    localStorage.setItem('mindflow_doc_x0', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x0&title=x');
    const page = (await waitFor(() => container.querySelector('[data-note-page]'))) as HTMLElement;

    // 줄이 아닌 자리(본문 판)를 누른다 — jsdom은 좌표가 모두 0이라 첫 줄이 가장 가깝다.
    fireEvent.pointerDown(page, { clientX: 5, clientY: 5 });

    expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1');
  });

  it('줄 밖의 **누름은 기본 동작을 막는다** — 브라우저가 캐럿을 거두지 않게', async () => {
    localStorage.setItem('mindflow_doc_x1', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x1&title=x');
    const page = (await waitFor(() => container.querySelector('[data-note-page]'))) as HTMLElement;

    const outside = createEvent.mouseDown(page, { bubbles: true, cancelable: true });
    fireEvent(page, outside);
    expect(outside.defaultPrevented).toBe(true);

    // 줄 위에서는 그대로 둔다(글자 선택은 브라우저의 일이다).
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    const inside = createEvent.mouseDown(line, { bubbles: true, cancelable: true });
    fireEvent(line, inside);
    expect(inside.defaultPrevented).toBe(false);
  });

  it('⌘A를 **한 번 더** 누르면 본문 전체가 골라진다(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_x2', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 그 줄이 통째로 골라진 상태(브라우저의 첫 ⌘A가 만든 모습)를 만든다.
    one.focus();
    const range = document.createRange();
    range.selectNodeContents(one);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(one, { key: 'a', metaKey: true });

    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
  });

  it('글이 있는 줄의 **맨 앞**에서 `- `를 쳐도 글머리 기호가 된다(제보 4)', async () => {
    localStorage.setItem('mindflow_doc_x3', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x3&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // `안녕하세요` 앞에 `- `를 친 모습 — 캐럿은 표식 바로 뒤(2)다.
    one.innerHTML = '- 안녕하세요';
    caretAt(one, 2);
    fireEvent.input(one);
    saveNow();

    await waitFor(() => expect(saved('x3').pages[0].blocks[0].kind).toBe('ul'));
    expect(saved('x3').pages[0].blocks[0].items[0].runs.map((r: { t: string }) => r.t).join('')).toBe('안녕하세요');
  });

  it('`3. ` + 글도 3번부터 매겨지고, 표식만 걷힌다', async () => {
    localStorage.setItem('mindflow_doc_x4', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x4&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    one.innerHTML = '3. 안녕하세요';
    caretAt(one, 3);
    fireEvent.input(one);
    saveNow();

    await waitFor(() => expect(saved('x4').pages[0].blocks[0].kind).toBe('ol'));
    expect(saved('x4').pages[0].blocks[0].start).toBe(3);
    expect(saved('x4').pages[0].blocks[0].items[0].runs.map((r: { t: string }) => r.t).join('')).toBe('안녕하세요');
  });

  it('캐럿이 표식 뒤가 **아니면** 목록으로 바꾸지 않는다(그냥 쓴 `- `)', async () => {
    localStorage.setItem('mindflow_doc_x5', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=x5&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    one.innerHTML = '- 안녕하세요';
    caretAt(one, 7); // 글 끝에서 계속 쓰던 중
    fireEvent.input(one);
    saveNow();

    await waitFor(() => expect(saved('x5').pages[0].blocks[0].kind).toBe('p'));
  });
});

describe('공책 35판 — 목록 풀기와 고른 줄 위에 덮어쓰기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  function dragOver(container: HTMLElement, fromKey: string, toKey: string): void {
    const a = container.querySelector(`[data-note-line="${fromKey}"]`) as HTMLElement;
    const b = container.querySelector(`[data-note-line="${toKey}"]`) as HTMLElement;
    fireEvent.pointerDown(a, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(b, { clientX: 0, clientY: 0 });
  }

  it('**첫 항목 맨 앞의 Backspace는 목록을 푼다** — 윗줄로 올라가지 않는다(제보 1)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b0', kind: 'p', runs: [{ t: '윗줄입니다', b: false, c: null }] },
      { id: 'b1', kind: 'ul', items: [
        { id: 'i1', runs: [{ t: '첫째 항목', b: false, c: null }] },
        { id: 'i2', runs: [{ t: '둘째 항목', b: false, c: null }] },
      ] },
    ] }] };
    localStorage.setItem('mindflow_doc_y0', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=y0&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    caretAt(one, 0);
    fireEvent.keyDown(one, { key: 'Backspace' });
    saveNow();

    await waitFor(() => expect(saved('y0').pages[0].blocks).toHaveLength(3));
    const blocks = saved('y0').pages[0].blocks;
    expect(blocks[0].runs.map((r: { t: string }) => r.t).join('')).toBe('윗줄입니다'); // 윗줄은 그대로다
    expect(blocks[1].kind).toBe('p'); // 마커만 걷혔다
    expect(runsOf(blocks[1])).toBe('첫째 항목');
    expect(blocks[2].kind).toBe('ul'); // 나머지 항목은 목록으로 남는다
    expect(blocks[2].items).toHaveLength(1);
  });

  it('풀린 문단에서 **한 번 더** Backspace를 치면 그때 윗줄과 이어진다', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b0', kind: 'p', runs: [{ t: '윗줄', b: false, c: null }] },
      { id: 'b1', kind: 'ol', items: [{ id: 'i1', runs: [{ t: '항목', b: false, c: null }] }] },
    ] }] };
    localStorage.setItem('mindflow_doc_y1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=y1&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    caretAt(one, 0);
    fireEvent.keyDown(one, { key: 'Backspace' }); // ① 목록을 푼다(같은 블록 id)
    const now = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    caretAt(now, 0);
    fireEvent.keyDown(now, { key: 'Backspace' }); // ② 이제 윗줄과 잇는다
    saveNow();

    await waitFor(() => expect(saved('y1').pages[0].blocks).toHaveLength(1));
    expect(runsOf(saved('y1').pages[0].blocks[0])).toBe('윗줄항목');
  });

  it('고른 여러 줄 위에 **글자를 치면 덮어쓴다**(제보 2)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_y2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=y2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')).toBeTruthy());

    dragOver(container, 'b1', 'b2');
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    // 글자 키 — 우리가 막지 않고(브라우저가 넣는다) 고른 것만 걷어 낸다.
    const ev = createEvent.keyDown(document, { key: '가' });
    fireEvent(document, ev);
    expect(ev.defaultPrevented).toBe(false);

    // 고른 줄들이 사라지고 **이을 자리에 캐럿**이 선다.
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap]')).toHaveLength(1));
    expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1');
    saveNow();
    await waitFor(() => expect(runsOf(saved('y2').pages[0].blocks[0])).toBe(''));
  });

  it('⌘·Alt가 붙은 키는 덮어쓰기로 보지 않는다(복사·잘라내기가 살아 있다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_y3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=y3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')).toBeTruthy());

    dragOver(container, 'b1', 'b2');
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    fireEvent.keyDown(document, { key: 'c', metaKey: true });

    // 고른 것은 그대로 남는다(복사는 지우지 않는다).
    expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2);
  });
});

describe('공책 36판 — 빈 저장 막기 · 되돌리기 · 선택 유지', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const TWO = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄입니다', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄입니다', b: false, c: null }] },
    ], updatedAt: '2026-01-01T00:00:00.000Z' }],
  };

  it('**커서만 옮기면 문서가 바뀌지 않는다**(제보 3: 저장이 걸린다)', async () => {
    localStorage.setItem('mindflow_doc_z0', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=z0&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b2"]') as HTMLElement;

    // 줄을 오가며 포커스를 옮긴다 — 편집 박스는 떠날 때마다 커밋한다(`onBlur`).
    one.focus();
    fireEvent.blur(one);
    two.focus();
    fireEvent.blur(two);
    saveNow();

    // 글이 그대로면 페이지의 수정 시각도 그대로다(= 저장할 것이 없다).
    await waitFor(() => expect(saved('z0')).toBeTruthy());
    expect(saved('z0').pages[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('글을 **한 글자라도 고치면** 그때는 바뀐 것으로 본다(무회귀)', async () => {
    localStorage.setItem('mindflow_doc_z1', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=z1&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(one, '고친 글');
    saveNow();

    await waitFor(() => expect(runsOf(saved('z1').pages[0].blocks[0])).toBe('고친 글'));
    expect(saved('z1').pages[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('⌘Z가 **화면의 글자까지** 되돌린다(제보 5: 모델만 돌아가고 화면은 그대로였다)', async () => {
    localStorage.setItem('mindflow_doc_z2', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=z2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    type(one, '고친 글');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('고친 글'));

    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    // 본문이 다시 그려지며 옛 글이 화면에 돌아온다(`docEpoch`).
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('첫째 줄입니다'));
  });

  it('여러 줄을 고르는 동안 **초점은 첫 줄에 남는다**(한글 조합의 목적지)', async () => {
    localStorage.setItem('mindflow_doc_z3', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=z3&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 글 끝에 캐럿을 두고 Shift+↓ — jsdom은 좌표를 못 재 **글 끝**이라야 가장자리다.
    one.focus();
    const text = document.createTreeWalker(one, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, (text.nodeValue ?? '').length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.keyDown(one, { key: 'ArrowDown', shiftKey: true });

    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
    // 초점이 남아 있어야 IME가 첫 자모를 흘리지 않는다.
    expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1');
  });

  it('고르는 동안 줄 부품은 **키를 놓아 준다** — 문서 리스너가 맡는다', async () => {
    localStorage.setItem('mindflow_doc_z4', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=z4&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    one.focus();
    const text = document.createTreeWalker(one, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, (text.nodeValue ?? '').length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.keyDown(one, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    // 줄 부품이 받았다면 Enter가 블록을 하나 더 만든다 — 칠해진 동안에는 아니다.
    const ev = createEvent.keyDown(one, { key: 'Enter' });
    fireEvent(one, ev);
    expect(container.querySelectorAll('[data-note-blockwrap]')).toHaveLength(2);
  });
});

/** 저장본 블록의 글자 — 런이 없으면 빈 문자열. */
function runsOf(block: { runs?: { t: string }[] }): string {
  return (block.runs ?? []).map((r) => r.t).join('');
}

describe('공책 37판 — 목록 복사·붙여넣기와 칸 안의 목록', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const LIST = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'b0', kind: 'p', runs: [{ t: '', b: false, c: null }] },
          {
            id: 'b1',
            kind: 'ul',
            items: [
              { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
              { id: 'i2', runs: [{ t: '둘', b: false, c: null }], indent: 1 },
            ],
          },
        ],
      },
    ],
  };

  /** jsdom엔 실 클립보드가 없다 — `paste` 이벤트에 `clipboardData`만 심어 던진다. */
  function pasteInto(el: HTMLElement, text: string): void {
    const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => text }, configurable: true });
    el.dispatchEvent(e);
  }
  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('목록을 고르면 클립보드에 **표식도 함께** 간다(제보 2)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    localStorage.setItem('mindflow_doc_w1', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=w1&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b1:i2"]') as HTMLElement;

    fireEvent.pointerDown(one, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(two, { clientX: 0, clientY: 0 });
    // 칠해진 것이 화면에 보이면 문서 리스너도 붙어 있다.
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(1));
    fireEvent.keyDown(document, { key: 'c', metaKey: true });

    // 들여쓴 단계는 공백 둘 — `parseNoteText`가 다시 읽는 그 모양이다.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('- 하나\n  - 둘'));
  });

  it('붙여넣은 `- `·`1. `이 **목록 블록**으로 선다(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_w2', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=w2&title=x');
    const zero = (await waitFor(() => container.querySelector('[data-note-line="b0"]'))) as HTMLElement;

    caretAt(zero, 0);
    pasteInto(zero, '- 가\n- 나\n  - 다');
    saveNow();

    await waitFor(() => expect(saved('w2').pages[0].blocks[0].kind).toBe('ul'));
    const made = saved('w2').pages[0].blocks[0];
    expect(made.items.map((x: { runs: { t: string }[] }) => runsOf(x))).toEqual(['가', '나', '다']);
    expect(made.items.map((x: { indent?: number }) => x.indent ?? 0)).toEqual([0, 0, 1]);
    // 원래 있던 목록은 그대로 뒤에 남는다.
    expect(saved('w2').pages[0].blocks[1].id).toBe('b1');
  });

  it('목록 항목 안에 같은 종류를 붙이면 **그 목록에 이어진다**', async () => {
    localStorage.setItem('mindflow_doc_w3', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=w3&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;

    caretAt(one, 2); // '하나' 끝
    pasteInto(one, '- 가\n- 나');
    saveNow();

    await waitFor(() => expect(saved('w3').pages[0].blocks[1].items).toHaveLength(3));
    expect(saved('w3').pages[0].blocks[1].items.map((x: { runs: { t: string }[] }) => runsOf(x))).toEqual(['하나- 가', '나', '둘']);
  });

  it('칠해 둔 여러 줄 위에 붙여넣으면 **먼저 지우고** 그 자리에 선다', async () => {
    localStorage.setItem('mindflow_doc_w8', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=w8&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b1:i2"]') as HTMLElement;

    fireEvent.pointerDown(one, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(two, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(1));
    pasteInto(document.body, '- 가\n- 나');

    // 지우기와 붙이기는 **한 프레임 건너** 일어난다 — 화면이 먼저 말해 준다.
    await waitFor(() =>
      expect([...container.querySelectorAll('[data-note-block="b1"] [data-note-line]')].map((e) => e.textContent)).toEqual(['가', '나']),
    );
    saveNow();
    await waitFor(() => expect(saved('w8').pages[0].blocks[1].items.map((x: { runs: { t: string }[] }) => runsOf(x))).toEqual(['가', '나']));
  });

  it('표식도 줄바꿈도 없는 한 줄도 **우리가 넣는다**(제보: 붙여넣은 글의 크기가 나중에 달라진다)', async () => {
    localStorage.setItem('mindflow_doc_w4', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=w4&title=x');
    const zero = (await waitFor(() => container.querySelector('[data-note-line="b0"]'))) as HTMLElement;

    caretAt(zero, 0);
    const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '그냥 글' }, configurable: true });
    zero.dispatchEvent(e);
    /**
     * 계약이 뒤집힌 자리다. 예전에는 여기서 **막지 않았다**("되돌리기가 자연스럽다") —
     * 그런데 브라우저의 기본 붙여넣기는 원본 앱의 `font-size`·`font-family`를 인라인
     * 으로 심고, 모델은 그것을 담지 않아 **화면에만 남는 유령**이 된다. 나중에 서식을
     * 걸면 `runsToHtml`이 모델에서 다시 그려 그 유령이 사라지므로 "서식을 걸었다
     * 풀면 글자 크기가 달라진다"가 됐다. 이제 우리가 값으로 넣고 바로 다시 그린다.
     */
    expect(e.defaultPrevented).toBe(true);
    expect(zero.textContent?.startsWith('그냥 글')).toBe(true);
  });

  it('표의 칸에서도 `- `가 글머리 기호가 된다(요청 3)', async () => {
    localStorage.setItem('mindflow_doc_w5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=w5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;

    type(cell, '- ');
    await waitFor(() => expect(cell.textContent).toBe('• '));
    saveNow();
    await waitFor(() => expect(saved('w5').pages[0].blocks[3].rows[0][0][0].t).toBe('• '));
  });


  it('표 위아래에 레일 몫의 숨이 있다(요청 4)', async () => {
    localStorage.setItem('mindflow_doc_w7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=w7&title=x');
    const table = (await waitFor(() => container.querySelector('[data-note-kind="table"]'))) as HTMLElement;

    // 열 레일은 표 위 18px, 행 추가 띠는 표 아래 — 둘 다 흐름 밖이라 여백이 필요하다.
    expect(table.style.marginTop).toBe('16px');
    expect(table.style.marginBottom).toBe('16px');
  });
});

describe('공책 38판 — 표의 목록·여백·열 너비와 여러 줄 Tab', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const FLAT = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          {
            id: 'b1',
            kind: 'ul',
            items: [
              { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
              { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
            ],
          },
        ],
      },
    ],
  };

  /** 그 칸을 **글 고치는 자리**로 연다(두 번 누르기와 같은 길). */
  async function openCell(container: HTMLElement, key: string): Promise<HTMLElement> {
    const cell = (await waitFor(() => container.querySelector(`[data-note-line="${key}"]`))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    return cell;
  }

  it('표는 **언제나 고정 레이아웃**이다 — 칸 끝에서 줄이 바뀐다(제보 5)', async () => {
    localStorage.setItem('mindflow_doc_v1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=v1&title=x');
    const table = (await waitFor(() => container.querySelector('[data-note-kind="table"] table'))) as HTMLElement;

    // 자동 레이아웃은 글의 최대 폭으로 열을 나눠, 칸 끝까지 쓰지 않았는데도 열이 넓어진다.
    expect(table.style.tableLayout).toBe('fixed');
    expect(table.style.width).toBe('100%');
    // 열이 너무 좁아지지 않게 바닥을 둔다(열 수 × 84px) — 넘치면 가로로 스크롤한다.
    expect(table.style.minWidth).toBe('168px');
  });

  it('고른 칸에서 Enter는 **편집을 연다**(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_v2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=v2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    const td = cell.closest('td') as HTMLElement;

    fireEvent.mouseDown(td);
    fireEvent.mouseUp(td);
    await waitFor(() => expect(td.getAttribute('data-armed')).toBe('1'));

    fireEvent.keyDown(cell, { key: 'Enter' });
    // 편집으로 넘어가면 `armed`가 풀린다(둘은 배타적이다).
    await waitFor(() => expect(td.getAttribute('data-armed')).toBe(null));
    expect(td.style.cursor).toBe('text');
  });

  it('칸의 목록 마커는 **본문과 같은 스팬**으로 그려진다(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_v3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=v3&title=x');
    const cell = await openCell(container, 'b4:r0c0');

    type(cell, '- 사과');

    // 글자로 남는 것이 아니라 마커 스팬이다 — 색·글꼴은 `editor.css`가 본문과 맞춘다.
    const mark = await waitFor(() => cell.querySelector('[data-list-marker]'));
    expect(mark?.textContent).toBe('• ');
    expect(mark?.getAttribute('data-list-kind')).toBe('ul');
    expect(cell.textContent).toBe('• 사과');
  });

  it('칸에서 Shift+Enter는 표식을 잇고, Tab은 **들여쓴다**(제보 4)', async () => {
    localStorage.setItem('mindflow_doc_v4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=v4&title=x');
    const cell = await openCell(container, 'b4:r0c0');

    type(cell, '1. 하나');
    await waitFor(() => expect(cell.querySelector('[data-list-marker]')).toBeTruthy());

    fireEvent.keyDown(cell, { key: 'Enter', shiftKey: true });
    // 번호는 하나 올라간다.
    await waitFor(() => expect([...cell.querySelectorAll('[data-list-marker]')].map((e) => e.textContent)).toEqual(['1. ', '2. ']));

    fireEvent.keyDown(cell, { key: 'Tab' });
    // 한 단계 들어가면 표기도 그 단계의 것으로 바뀐다(`1.` → `a.`).
    await waitFor(() => expect([...cell.querySelectorAll('[data-list-marker]')].map((e) => e.textContent?.trimStart())).toEqual(['1. ', 'a. ']));

    fireEvent.keyDown(cell, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect([...cell.querySelectorAll('[data-list-marker]')].map((e) => e.textContent)).toEqual(['1. ', '2. ']));
    // 들여쓰기는 **칸 이동이 아니다** — 초점이 그 칸에 남는다.
    expect(document.activeElement?.getAttribute('data-note-line')).toBe('b4:r0c0');
  });

  it('목록이 아닌 칸에서 Tab은 그대로 **다음 칸**으로 간다', async () => {
    localStorage.setItem('mindflow_doc_v5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=v5&title=x');
    const cell = await openCell(container, 'b4:r0c0');

    fireEvent.keyDown(cell, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b4:r0c1'));
  });

  it('본문에서 **여러 줄을 골라 Tab**하면 함께 들여쓰인다(제보 6)', async () => {
    localStorage.setItem('mindflow_doc_v6', JSON.stringify(FLAT));
    const { container } = renderEditor('/editor?map=v6&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1:i1"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b1:i2"]') as HTMLElement;

    fireEvent.pointerDown(one, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(two, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(1));

    fireEvent.keyDown(document, { key: 'Tab' });
    saveNow();
    // 둘 다 0단계였으므로 **나란히** 한 단계씩(한쪽이 다른 쪽의 딸림이 아니다).
    await waitFor(() => expect(saved('v6').pages[0].blocks[0].items.map((x: { indent?: number }) => x.indent ?? 0)).toEqual([1, 1]));

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    saveNow();
    await waitFor(() => expect(saved('v6').pages[0].blocks[0].items.map((x: { indent?: number }) => x.indent ?? 0)).toEqual([0, 0]));
  });
});

describe('공책 39판 — 표의 ⌘A · 가로 스크롤 · 칸 캐럿 · 칠하는 동안의 커서', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('고른 칸에서 ⌘A는 **표 전체**를 고른다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_u1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=u1&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    const td = cell.closest('td') as HTMLElement;

    fireEvent.mouseDown(td);
    fireEvent.mouseUp(td);
    await waitFor(() => expect(picked(container)).toEqual(['0:0']));

    fireEvent.keyDown(cell, { key: 'a', ctrlKey: true });
    await waitFor(() => expect(picked(container)).toEqual(['0:0', '0:1', '1:0', '1:1']));
  });

  it('글을 고치는 중의 ⌘A는 **칸 안의 글자**다 — 표를 고르지 않는다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_u2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=u2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    await waitFor(() => expect(picked(container)).toEqual([]));

    fireEvent.keyDown(cell, { key: 'a', ctrlKey: true });
    // 표를 고르지 않는다 = 그 키는 칸 안의 글자에 남는다.
    // (`defaultPrevented`로는 가를 수 없다 — jsdom은 `isContentEditable`을 모르는
    //  탓에 전역 ⌘A 가드가 이 하네스에서만 지나간다.)
    expect(picked(container)).toEqual([]);
  });

  it('본문 판은 **가로로 스크롤하지 않는다**(제보 2 — 막대가 깜빡이던 되먹임)', async () => {
    localStorage.setItem('mindflow_doc_u3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=u3&title=x');
    const pane = (await waitFor(() => container.querySelector('[data-note-page]'))) as HTMLElement;

    // `overflow-y: auto`만 주면 `overflow-x`가 `auto`로 계산되어 세로↔가로가 서로를 부른다.
    expect(pane.style.overflowX).toBe('hidden');
    expect(pane.style.overflowY).toBe('auto');
    // 세로 막대가 생겼다 사라져도 **폭이 변하지 않아야** 한다 — 변하면 표가 함께
    // 좁아졌다 넓어지고, 표 자신의 가로 막대가 그 박자로 깜빡인다(제보 2회차).
    expect(pane.style.scrollbarGutter).toBe('stable');
  });

  it('칸에서 마커를 만들면 캐럿이 **글자 자리**에 남는다(제보 4)', async () => {
    localStorage.setItem('mindflow_doc_u4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=u4&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);

    type(cell, '- ');
    await waitFor(() => expect(cell.querySelector('[data-list-marker]')).toBeTruthy());

    // 요소 경계에 놓인 캐럿은 그려지지 않는다 — 텍스트 노드 안이라야 한다.
    const sel = window.getSelection();
    expect(sel?.focusNode?.nodeType).toBe(3);
    expect(cell.contains(sel?.focusNode ?? null)).toBe(true);
  });

  it('여러 줄을 칠하는 동안 **브라우저 캐럿을 감춘다**(제보 5)', async () => {
    localStorage.setItem('mindflow_doc_u5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=u5&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b2"]') as HTMLElement;
    const pane = container.querySelector('[data-note-page]') as HTMLElement;

    expect(pane.getAttribute('data-note-painting')).toBe(null);
    fireEvent.pointerDown(one, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(two, { clientX: 0, clientY: 0 });

    // 초점·캐럿은 첫 줄에 **일부러** 남겨 둔다(한글 조합) — 색만 지운다.
    await waitFor(() => expect(pane.getAttribute('data-note-painting')).toBe('1'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(pane.getAttribute('data-note-painting')).toBe(null));
  });
});

describe('공책 41판 — 이미지 바로 넣기 · 마커 선택 · Shift+좌우 · 제목 바', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const TWO_LINES = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'b1', kind: 'p', runs: [{ t: '첫 줄입니다', b: false, c: null }] },
          { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄입니다', b: false, c: null }] },
        ],
      },
    ],
  };

  it('이미지는 **고르개부터** 연다 — 빈 자리를 먼저 만들지 않는다(제보 1)', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    localStorage.setItem('mindflow_doc_s1', JSON.stringify(TWO_LINES));
    const { container } = renderEditor('/editor?map=s1&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    one.focus();

    // 툴바의 넣기 — 이미지는 종류 바꾸기 메뉴가 아니라 이쪽에 있다(글을 담지 않는다).
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-insert="img"]'))) as HTMLElement);

    // 파일 고르개는 열리고
    expect(click).toHaveBeenCalled();
    // 문서에는 **아무것도 생기지 않는다**(고르지 않고 닫으면 빈 자리가 남지 않는다).
    saveNow();
    await waitFor(() => expect(saved('s1').pages[0].blocks.map((b: { kind: string }) => b.kind)).toEqual(['p', 'p']));
    click.mockRestore();
  });

  it('문장 끝에서 Shift+→가 **다음 줄로 이어진다**(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_s2', JSON.stringify(TWO_LINES));
    const { container } = renderEditor('/editor?map=s2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 글 끝에 캐럿(하네스는 좌표를 못 재므로 글자 자리로 가른다).
    one.focus();
    const text = document.createTreeWalker(one, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, (text.nodeValue ?? '').length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(one, { key: 'ArrowRight', shiftKey: true });

    // 두 블록이 칠해진다 = 선택이 줄을 넘었다.
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
  });

  it('문장 앞에서 Shift+←가 **앞 줄로 이어진다**(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_s3', JSON.stringify(TWO_LINES));
    const { container } = renderEditor('/editor?map=s3&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b2"]'))) as HTMLElement;

    two.focus();
    const text = document.createTreeWalker(two, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.keyDown(two, { key: 'ArrowLeft', shiftKey: true });

    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
  });

  it('제목의 위쪽 숨은 **줄의 상자**가 진다 — 세로 바가 글과 어긋나지 않게(제보 4)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'h', kind: 'h2', runs: [{ t: '제목입니다', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_s4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=s4&title=x');
    const wrap = (await waitFor(() => container.querySelector('[data-note-kind="h2"]'))) as HTMLElement;
    const line = wrap.querySelector('[data-note-line="h"]') as HTMLElement;

    // 마진이 편집 박스에 붙어 있으면 `align-items: center`가 **마진 상자**를 기준으로
    // 맞춰 글만 내려간다 — 그래서 바깥 줄이 그 마진을 진다.
    expect(wrap.style.marginTop).toBe('12px');
    expect(line.style.marginTop).toBe('');
    expect(wrap.style.alignItems).toBe('center');
  });
});

describe('공책 42판 — 칸의 방향키를 본문과 한 정책으로(제보 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 칸 하나에 목록 두 줄 — 값은 `• 가나\n• 다라`(마커가 곧 글자다). */
  const CELLS = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'b4', kind: 'table', rows: [[[{ t: '- 가나\n- 다라', b: false, c: null }], [{ t: '옆', b: false, c: null }]], [[{ t: 'x', b: false, c: null }], [{ t: 'y', b: false, c: null }]]] },
        ],
      },
    ],
  };

  async function openCell(container: HTMLElement): Promise<HTMLElement> {
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    await waitFor(() => expect(cell.querySelectorAll('[data-list-marker]')).toHaveLength(2));
    return cell;
  }

  /** 캐럿의 **값 좌표** — 마커도 글자이므로 `• 가나\n• 다라`에서 센다. */
  function caret(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    const r = sel.getRangeAt(0);
    return linearize(el, [{ container: r.startContainer, offset: r.startOffset }]).pos[0] ?? -1;
  }
  /** 캐럿이 마커 스팬 **안**인가 — 거기에 친 글자는 줄바꿈되지 않아 칸을 뚫는다. */
  function inMarker(): boolean {
    const r = window.getSelection()?.getRangeAt(0);
    const host = r && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as Element));
    return !!host?.closest?.('[data-list-marker]');
  }

  it('← 한 번이면 **앞 줄 끝**으로 — 문장 첫머리에 갇히지 않는다(증상 2)', async () => {
    localStorage.setItem('mindflow_doc_c1', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=c1&title=x');
    const cell = await openCell(container);

    setLinearSelection(cell, 7, 7); // 둘째 줄 내용 시작(`• 가나\n• ` 뒤)
    fireEvent.keyDown(cell, { key: 'ArrowLeft' });

    expect(caret(cell)).toBe(4); // 앞 줄 끝(`• 가나`)
    expect(inMarker()).toBe(false);
  });

  it('마커 구역에 떨어진 캐럿은 **누르는 그 순간** 걷어낸다 — 길게 눌러도(증상 1)', async () => {
    localStorage.setItem('mindflow_doc_c2', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=c2&title=x');
    const cell = await openCell(container);

    // 길게 누르면 `keyup`이 오지 않는다 — 예전에는 그 스냅 하나뿐이라 캐럿이
    // 마커 위를 훑고 지나갔다. 이제 keydown에서 먼저 걷고 ←는 마커를 통째로 건넌다.
    for (const at of [5, 6]) {
      setLinearSelection(cell, at, at);
      fireEvent.keyDown(cell, { key: 'ArrowLeft' });
      expect(caret(cell)).toBe(4);
      expect(inMarker()).toBe(false);
    }
  });

  it('↑ · ↓ 로 칸 안의 줄을 오르내린다 — [마커|내용] 행을 크롬은 못 건넌다(증상 3)', async () => {
    localStorage.setItem('mindflow_doc_c3', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=c3&title=x');
    const cell = await openCell(container);

    setLinearSelection(cell, 8, 8); // 둘째 줄 `다|라`
    fireEvent.keyDown(cell, { key: 'ArrowUp' });
    expect(caret(cell)).toBe(3); // 첫 줄의 같은 열(`가|나`)
    expect(inMarker()).toBe(false);

    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    expect(caret(cell)).toBe(8);
  });

  it('칸을 **고르기만** 한 상태에서 방향키는 여전히 표의 것이다', async () => {
    localStorage.setItem('mindflow_doc_c4', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=c4&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    const td = cell.closest('td') as HTMLElement;
    fireEvent.mouseDown(td);
    fireEvent.mouseUp(td);
    await waitFor(() => expect(td.getAttribute('data-armed')).toBe('1'));

    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    await waitFor(() => expect(picked(container)).toEqual(['0:1']));
  });
});

describe('공책 43판 — 링크 · 체크리스트 · 문서 링크 팝업 · 줄 종류 · 우클릭 메뉴', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 글머리 목록 네 줄 + 앞뒤 문단 한 장. */
  const LIST = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'b1', kind: 'p', runs: [{ t: '첫 줄입니다', b: false, c: null }] },
          {
            id: 'bl',
            kind: 'ul',
            items: [
              { id: 'i1', runs: [{ t: '가', b: false, c: null }] },
              { id: 'i2', runs: [{ t: '나', b: false, c: null }] },
              { id: 'i3', runs: [{ t: '다', b: false, c: null }] },
              { id: 'i4', runs: [{ t: '라', b: false, c: null }] },
            ],
          },
        ],
      },
    ],
  };

  /** 그 박스에 캐럿(또는 구간)을 둔다 — 툴바는 **눌리기 전의 선택**을 기억한다. */
  function select(el: HTMLElement, a: number, b = a): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) {
      range.setStart(text, Math.min(a, (text.nodeValue ?? '').length));
      range.setEnd(text, Math.min(b, (text.nodeValue ?? '').length));
    } else range.setStart(el, 0);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('링크는 **앱 안의 판**으로 받는다 — 고른 글이 없어도 걸린다(제보 1)', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    localStorage.setItem('mindflow_doc_k1', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    select(line, 2);

    const btn = container.querySelector('[data-note-link-btn]') as HTMLElement;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    const pop = (await waitFor(() => container.querySelector('[data-note-link-pop]'))) as HTMLElement;
    // 브라우저의 `prompt`는 부르지 않는다 — 설치형 앱에서는 아예 뜨지 않는다.
    expect(prompt).not.toHaveBeenCalled();

    fireEvent.change(pop.querySelector('[data-note-link-url]') as HTMLElement, { target: { value: 'https://a.test' } });
    fireEvent.change(pop.querySelector('[data-note-link-text]') as HTMLElement, { target: { value: '여기' } });
    fireEvent.click(pop.querySelector('[data-note-link-apply]') as HTMLElement);

    await waitFor(() => expect(line.innerHTML).toContain('여기'));
    expect(line.innerHTML).toContain('a.test');
    prompt.mockRestore();
  });

  it('고른 글이 있으면 **그 글에** 건다(「보일 글」칸은 뜨지 않는다)', async () => {
    localStorage.setItem('mindflow_doc_k2', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    select(line, 0, 2);

    const btn = container.querySelector('[data-note-link-btn]') as HTMLElement;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    const pop = (await waitFor(() => container.querySelector('[data-note-link-pop]'))) as HTMLElement;
    expect(pop.querySelector('[data-note-link-text]')).toBeNull();

    fireEvent.change(pop.querySelector('[data-note-link-url]') as HTMLElement, { target: { value: 'https://b.test' } });
    fireEvent.click(pop.querySelector('[data-note-link-apply]') as HTMLElement);
    await waitFor(() => expect(line.innerHTML).toContain('b.test'));
    // 글자는 늘지 않았다 — 고른 글에 주소만 걸렸다.
    expect(line.textContent).toBe('첫 줄입니다');
  });

  it('목록 한 줄에 체크리스트를 걸면 **그 줄만** 바뀐다(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_k3', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k3&title=x');
    const third = (await waitFor(() => container.querySelector('[data-note-line="bl:i3"]'))) as HTMLElement;
    select(third, 1);

    const btn = container.querySelector('[data-note-insert="ck"]') as HTMLElement;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);

    await waitFor(() => expect([...container.querySelectorAll('[data-note-block]')].map((e) => e.getAttribute('data-note-kind'))).toEqual(['p', 'ul', 'ck', 'ul']));
    // 네 줄이 다 살아 있다(예전에는 빈 체크리스트가 **하나 더** 생겼다).
    saveNow();
    await waitFor(() => expect(saved('k3').pages[0].blocks.map((b: { kind: string }) => b.kind)).toEqual(['p', 'ul', 'ck', 'ul']));
    expect([...container.querySelectorAll('[data-note-line]')].map((e) => e.textContent)).toEqual(['첫 줄입니다', '가', '나', '다', '라']);
  });

  it('줄 종류 메뉴도 **그 줄만** 바꾼다 — 목록 가운데서 제목으로(제보 2·4)', async () => {
    localStorage.setItem('mindflow_doc_k4', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k4&title=x');
    const second = (await waitFor(() => container.querySelector('[data-note-line="bl:i2"]'))) as HTMLElement;
    select(second, 1);

    fireEvent.mouseDown(container.querySelector('[data-note-blocktype]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-note-blocktype]') as HTMLElement);
    const item = (await waitFor(() => container.querySelector('[data-note-blocktype-item="h2"]'))) as HTMLElement;
    fireEvent.click(item);

    await waitFor(() => expect([...container.querySelectorAll('[data-note-block]')].map((e) => e.getAttribute('data-note-kind'))).toEqual(['p', 'ul', 'h2', 'ul']));
    expect([...container.querySelectorAll('[data-note-line]')].map((e) => e.textContent)).toEqual(['첫 줄입니다', '가', '나', '다', '라']);
  });

  it('문서 링크는 **고르개부터** 연다 — 고르지 않으면 자리를 만들지 않는다(요청 3)', async () => {
    localStorage.setItem('mindflow_doc_k5', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k5&title=x');
    await waitFor(() => container.querySelector('[data-note-line="b1"]'));

    const btn = container.querySelector('[data-note-insert="link"]') as HTMLElement;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);

    await waitFor(() => expect(container.querySelector('[data-note-docpick]')).toBeTruthy());
    // 아직 본문에는 아무것도 없다(예전에는 빈 「문서 고르기」 블록이 먼저 섰다).
    expect(container.querySelector('[data-note-kind="link"]')).toBeNull();

    fireEvent.pointerDown(container.querySelector('[data-note-docpick-back]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-note-docpick]')).toBeNull());
    saveNow();
    await waitFor(() => expect(saved('k5').pages[0].blocks.map((b: { kind: string }) => b.kind)).toEqual(['p', 'ul']));
  });

  it('우클릭 메뉴는 **화면 아래를 넘지 않는다**(제보 5)', async () => {
    localStorage.setItem('mindflow_doc_k6', JSON.stringify(LIST));
    const { container } = renderEditor('/editor?map=k6&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // 창 바닥 가까이에서 연다 — 예전에는 어림 높이(430)를 넘는 만큼 잘려 나갔다.
    fireEvent.contextMenu(line, { bubbles: true, clientX: 300, clientY: window.innerHeight - 20 });
    const menu = (await waitFor(() => container.querySelector('[data-note-block-menu]'))) as HTMLElement;

    const top = parseFloat(menu.style.top);
    const height = parseFloat(String(menu.style.maxHeight || '430'));
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight - 8);
  });
});

describe('공책 44판 — 링크 클릭 · 블록 선택 · 종류 목록 · 캐럿 서식 · 되돌아온 드래그', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const DOC = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'lk', kind: 'p', runs: [{ t: '앞 ', b: false, c: null }, { t: '링크', b: false, c: null, href: 'https://example.com/go' }, { t: ' 뒤', b: false, c: null }] },
          { id: 'bd', kind: 'p', runs: [{ t: '보통 ', b: false, c: null }, { t: '굵은글', b: true, c: null }] },
          { id: 'A', kind: 'p', runs: [{ t: '에이', b: false, c: null }] },
          { id: 'B', kind: 'p', runs: [{ t: '비이', b: false, c: null }] },
          { id: 'C', kind: 'p', runs: [{ t: '씨이', b: false, c: null }] },
          { id: 'ul', kind: 'ul', items: [{ id: 'u1', runs: [{ t: '하나', b: false, c: null }] }, { id: 'u2', runs: [{ t: '둘', b: false, c: null }] }] },
        ],
      },
    ],
  };

  /** 그 줄의 **글자 자리**에 캐럿을 두고 툴바에 알린다(서식 스팬을 넘나든다). */
  function caretIn(host: HTMLElement, at: number): void {
    const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node = walk.nextNode() as Text | null;
    let spot: { node: Text; offset: number } | null = null;
    while (node) {
      const len = (node.nodeValue ?? '').length;
      if (seen + len >= at) {
        spot = { node, offset: at - seen };
        break;
      }
      seen += len;
      node = walk.nextNode() as Text | null;
    }
    if (!spot) return;
    const range = document.createRange();
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('링크 글자를 **그냥 누르면** 열린다 — ⌥와 함께면 캐럿만(제보 6)', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.setItem('mindflow_doc_m1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m1&title=x');
    const link = (await waitFor(() => container.querySelector('[data-note-line="lk"] [data-href]'))) as HTMLElement;

    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith('https://example.com/go', '_blank', 'noopener,noreferrer');

    open.mockClear();
    fireEvent.click(link, { altKey: true });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('굵은 글 **안에 캐럿만** 두어도 단추가 켜진다(제보 9)', async () => {
    localStorage.setItem('mindflow_doc_m2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="bd"]'))) as HTMLElement;

    // `보통 굵은글` — 4번째 글자는 굵은 구간 안이다.
    caretIn(line, 4);
    await waitFor(() => expect(container.querySelector('[data-note-mark="b"]')?.getAttribute('aria-pressed')).toBe('true'));

    // 보통 글로 옮기면 꺼진다 — "고른 글 전부가 그 서식일 때만"이라는 규칙 그대로.
    caretIn(line, 1);
    await waitFor(() => expect(container.querySelector('[data-note-mark="b"]')?.getAttribute('aria-pressed')).toBe('false'));
  });

  it('굵은 글이 캐럿 **뒤**에 있어도 켜진다 — 그 자리도 그 서식의 자리다(제보 1)', async () => {
    localStorage.setItem('mindflow_doc_m2b', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m2b&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="bd"]'))) as HTMLElement;

    // `보통 굵은글` — 3번째 자리는 굵은 구간의 **머리**다(앞은 보통, 뒤는 굵다).
    // 예전에는 앞 글자만 봐서 꺼져 있었다.
    caretIn(line, 3);
    await waitFor(() => expect(container.querySelector('[data-note-mark="b"]')?.getAttribute('aria-pressed')).toBe('true'));

    // 줄 맨 앞(뒤가 보통 글)은 그대로 꺼져 있다 — 아무 데서나 켜지는 것이 아니다.
    caretIn(line, 0);
    await waitFor(() => expect(container.querySelector('[data-note-mark="b"]')?.getAttribute('aria-pressed')).toBe('false'));
  });

  it('툴바의 블록 종류가 **캐럿을 따라 즉시** 바뀐다(제보 2)', async () => {
    localStorage.setItem('mindflow_doc_m3b', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m3b&title=x');
    const label = () => container.querySelector('[data-note-blocktype] span')?.textContent;

    // 목록 항목에 캐럿을 두면 `글머리 목록`.
    const item = (await waitFor(() => container.querySelector('[data-note-line="ul:u1"]'))) as HTMLElement;
    caretIn(item, 0);
    await waitFor(() => expect(label()).toBe('글머리 기호'));

    // 본문 줄로 옮기면 **그 자리에서** `본문`으로 바뀐다(예전에는 앞의 것이 남았다).
    caretIn(container.querySelector('[data-note-line="A"]') as HTMLElement, 0);
    await waitFor(() => expect(label()).toBe('본문'));
  });

  it('블록 종류 목록은 **줄의 종류 열하나** — 목록 셋이 빠져 있었다(질문 8)', async () => {
    localStorage.setItem('mindflow_doc_m3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-blocktype]'))) as HTMLElement);

    const items = [...container.querySelectorAll('[data-note-blocktype-item]')].map((e) => e.getAttribute('data-note-blocktype-item'));
    expect(items).toEqual(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'ck', 'q', 'callout', 'toggle', 'code']);
    // 넣기 넷(표·이미지·구분선·문서 링크)은 **줄의 종류가 아니다** — 툴바 아이콘과 `/`의 몫.
    for (const kind of ['table', 'img', 'hr', 'link']) expect(container.querySelector(`[data-note-blocktype-item="${kind}"]`)).toBeNull();
  });

  /**
   * **Esc는 글을 고르지 않는다**(제보 6·7 — 걷어냈다).
   *
   * 한동안 Esc가 "그 블록을 통째로 고르기"였는데(요청으로 들어왔던 기능), 쓰는 동안에는
   * 쓰던 자리를 잃는 동작이었다: `/` 목록을 Esc로 닫으면 그 줄이 통째로 칠해져 다음
   * 글자가 그것을 덮었다. 지금은 Esc가 아무것도 고르지 않고 **캐럿이 그대로** 있다.
   */
  it('Esc는 **아무것도 고르지 않고** 캐럿을 그대로 둔다(제보 7)', async () => {
    localStorage.setItem('mindflow_doc_m4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m4&title=x');
    const first = (await waitFor(() => container.querySelector('[data-note-line="ul:u1"]'))) as HTMLElement;
    first.focus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(0);
    // 쓰던 자리를 잃지 않는다 — 초점이 그 줄에 남아 있다.
    expect(document.activeElement).toBe(first);
  });

  it('`/` 목록을 Esc로 닫아도 **글이 칠해지지 않는다**(제보 6)', async () => {
    localStorage.setItem('mindflow_doc_m4b', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m4b&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="ul:u1"]'))) as HTMLElement;

    line.focus();
    fireEvent.keyDown(line, { key: '/' });
    type(line, '가/');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());
    expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(0);
    expect(document.activeElement).toBe(line);
  });

  it('B→C로 끌었다가 **B로 돌아오면** 그 줄만 남는다(제보 10)', async () => {
    localStorage.setItem('mindflow_doc_m5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=m5&title=x');
    const b = (await waitFor(() => container.querySelector('[data-note-line="B"]'))) as HTMLElement;
    const c = container.querySelector('[data-note-line="C"]') as HTMLElement;

    fireEvent.pointerDown(b, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(c, { clientX: 0, clientY: 0 });
    await waitFor(() => expect([...container.querySelectorAll('[data-note-blockwrap][data-selected]')].map((e) => e.getAttribute('data-note-blockwrap'))).toEqual(['B', 'C']));

    // 예전에는 여기서 그림이 얼어붙었다 — 브라우저의 선택은 비워 둔 뒤라 맡길 상대가 없었다.
    fireEvent.pointerMove(b, { clientX: 0, clientY: 0 });
    await waitFor(() => expect([...container.querySelectorAll('[data-note-blockwrap][data-selected]')].map((e) => e.getAttribute('data-note-blockwrap'))).toEqual(['B']));
  });
});

describe('공책 45판 — 이미지 크기·확대 · 여러 줄 서식 · 칸의 제한', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const DOC = {
    ...NOTE,
    pages: [
      {
        id: 'p1',
        title: '장',
        blocks: [
          { id: 'im', kind: 'img', src: PIX },
          { id: 'A', kind: 'p', runs: [{ t: '에이', b: false, c: null }] },
          { id: 'B', kind: 'p', runs: [{ t: '비이', b: false, c: null }] },
          { id: 'tb', kind: 'table', rows: [[[{ t: '칸1', b: false, c: null }], [{ t: '칸2', b: false, c: null }]], [[{ t: 'x', b: false, c: null }], [{ t: 'y', b: false, c: null }]]] },
        ],
      },
    ],
  };

  it('이미지를 누르면 **배율로 보는 판**이 뜬다(요청 1 · 8판에서 배율로 바뀌었다)', async () => {
    localStorage.setItem('mindflow_doc_g1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=g1&title=x');
    const img = (await waitFor(() => container.querySelector('[data-note-image]'))) as HTMLElement;

    fireEvent.click(img);
    const zoom = (await waitFor(() => container.querySelector('[data-note-image-zoom]'))) as HTMLElement;
    // 「화면에 맞춤 ↔ 원본 크기」 토글은 걷었다(요청 8) — 그 자리에 배율 막대가 선다.
    expect(zoom.querySelector('[data-note-image-full]')).toBeNull();
    expect(zoom.querySelector('[data-note-image-bar]')).toBeTruthy();
    // 열자마자는 **맞춤** — 그보다 작게 줄일 수 없으므로 축소가 꺼져 있다.
    expect((zoom.querySelector('[data-note-image-zoom-key="out"]') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(container.querySelector('[data-note-image-close]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-note-image-zoom]')).toBeNull());
  });

  it('이미지 크기 손잡이 — 두 번 누르면 **단 폭**으로 돌아온다(요청 1)', async () => {
    localStorage.setItem('mindflow_doc_g2', JSON.stringify({ ...DOC, pages: [{ ...DOC.pages[0], blocks: [{ id: 'im', kind: 'img', src: PIX, imgW: 240 }] }] }));
    const { container } = renderEditor('/editor?map=g2&title=x');
    const grip = (await waitFor(() => container.querySelector('[data-note-image-grip]'))) as HTMLElement;
    const wrap = grip.parentElement as HTMLElement;
    expect(wrap.style.width).toBe('240px');

    fireEvent.doubleClick(grip);
    saveNow();
    await waitFor(() => expect(saved('g2').pages[0].blocks[0].imgW).toBeUndefined());
    await waitFor(() => expect((container.querySelector('[data-note-image-grip]')?.parentElement as HTMLElement).style.width).toBe('fit-content'));
  });

  it('**여러 줄을 칠해 두고** 굵게를 누르면 그 줄들이 다 굵어진다(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_g3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=g3&title=x');
    const a = (await waitFor(() => container.querySelector('[data-note-line="A"]'))) as HTMLElement;
    const b = container.querySelector('[data-note-line="B"]') as HTMLElement;

    fireEvent.pointerDown(a, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(b, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    const bold = container.querySelector('[data-note-mark="b"]') as HTMLElement;
    fireEvent.mouseDown(bold);
    fireEvent.click(bold);

    saveNow();
    await waitFor(() => {
      const blocks = saved('g3').pages[0].blocks as { id: string; runs?: { b?: boolean }[] }[];
      expect(blocks.find((x) => x.id === 'A')?.runs?.every((r) => r.b)).toBe(true);
      expect(blocks.find((x) => x.id === 'B')?.runs?.some((r) => r.b)).toBe(true);
    });
  });

  it('표의 칸에서는 **담을 수 없는 것들**이 꺼진다(요청 5)', async () => {
    localStorage.setItem('mindflow_doc_g4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=g4&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="tb:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    cell.focus();
    // 툴바는 **선택이 바뀔 때** 다시 읽는다.
    const text = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    const off = (sel: string): boolean => !!container.querySelector(sel)?.hasAttribute('disabled');
    await waitFor(() => expect(off('[data-note-slash-btn]')).toBe(true));
    for (const kind of ['ck', 'table', 'hr', 'img', 'link']) {
      expect(off(`[data-note-insert="${kind}"]`)).toBe(true);
    }
    // 글머리·번호는 칸에서도 된다(`noteCellList`) — 끄지 않는다.
    expect(off('[data-note-insert="ul"]')).toBe(false);
    expect(off('[data-note-insert="ol"]')).toBe(false);
    // 칸은 줄이 아니라 값이라 **블록 종류**도 닿지 않는다(표 전체가 바뀌던 자리).
    expect(off('[data-note-blocktype]')).toBe(true);
  });

  it('표의 칸에서 친 `/`로는 **블록 넣기가 열리지 않는다**(요청 4)', async () => {
    localStorage.setItem('mindflow_doc_g5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=g5&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="tb:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    cell.focus();

    fireEvent.keyDown(cell, { key: '/' });
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-note-slash-panel]')).toBeNull();

    // 본문 줄에서는 그대로 열린다 — 막은 것은 칸뿐이다.
    const line = container.querySelector('[data-note-line="A"]') as HTMLElement;
    line.focus();
    const t = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const r = document.createRange();
    r.setStart(t, 0);
    r.collapse(true);
    const s2 = window.getSelection();
    s2?.removeAllRanges();
    s2?.addRange(r);
    fireEvent.keyDown(line, { key: '/' });
    await waitFor(() => expect(container.querySelector('[data-note-slash-panel]')).toBeTruthy());
  });
});

describe('공책 46판 — 서식의 길을 하나로 · 목록 Enter·Backspace · 조합 중 방향키', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  function caretAt(el: HTMLElement, at: number): void {
    el.focus();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  function selectAll(el: HTMLElement): void {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  const TWO = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '첫째 줄', b: false, c: null }] },
      { id: 'b2', kind: 'p', runs: [{ t: '둘째 줄', b: false, c: null }] },
      { id: 'b3', kind: 'p', runs: [{ t: '셋째 줄', b: false, c: null }] },
    ] }],
  };

  it('⌘B는 **칠해 둔 여러 줄 전부**에 걸린다(제보 3: 감긴 줄만 되고 Enter로 내린 줄은 안 됐다)', async () => {
    localStorage.setItem('mindflow_doc_h1', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=h1&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    const two = container.querySelector('[data-note-line="b2"]') as HTMLElement;
    fireEvent.pointerDown(one, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(two, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));

    fireEvent.keyDown(document, { key: 'b', code: 'KeyB', metaKey: true });
    saveNow();

    await waitFor(() => {
      const blocks = saved('h1').pages[0].blocks as { id: string; runs?: { b?: boolean }[] }[];
      expect(blocks.find((x) => x.id === 'b2')?.runs?.some((r) => r.b)).toBe(true);
    });
  });

  it('서식을 걸고 나면 **우리 칠만 남는다** — 브라우저 선택은 비운다(제보 1·2)', async () => {
    localStorage.setItem('mindflow_doc_h2', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=h2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    selectAll(one);
    const bold = container.querySelector('[data-note-mark="b"]') as HTMLElement;
    fireEvent.mouseDown(bold);
    fireEvent.click(bold);

    // 그 줄만 고른 것으로 남고(그림은 우리 것), 브라우저 선택은 비어 있다.
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(1));
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
    saveNow();
    await waitFor(() => expect((saved('h2').pages[0].blocks[0].runs as { b?: boolean }[]).every((r) => r.b)).toBe(true));
  });

  it('빈 목록 줄에서 Enter는 **그 줄을 문단으로** — 줄이 사라지지 않는다(제보 4)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ol', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '', b: false, c: null }] },
      { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_h3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=h3&title=x');
    const two = (await waitFor(() => container.querySelector('[data-note-line="b1:i2"]'))) as HTMLElement;

    caretAt(two, 0);
    fireEvent.keyDown(two, { key: 'Enter' });
    saveNow();

    await waitFor(() => {
      const blocks = saved('h3').pages[0].blocks as { kind: string; start?: number; items?: { id: string }[] }[];
      // [앞 목록(하나) / 빈 문단 / 뒤 목록(셋, 3번부터)]
      expect(blocks.map((b) => b.kind)).toEqual(['ol', 'p', 'ol']);
      expect(blocks[0]?.items?.map((i) => i.id)).toEqual(['i1']);
      expect(blocks[2]?.items?.map((i) => i.id)).toEqual(['i3']);
      expect(blocks[2]?.start).toBe(3);
    });
    // 셋째 줄은 그대로 있다(예전에는 사라지고 커서가 그 아래로 떨어졌다) —
    // 뒤 덩이는 새 블록이므로 줄 키의 **항목 쪽**으로 찾는다.
    expect(container.querySelector('[data-note-line$=":i3"]')).toBeTruthy();
  });

  it('가운데 항목의 Backspace는 **그 줄의 표식만** 걷는다(요청 6)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'ol', items: [
      { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
      { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
      { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
    ] }] }] };
    localStorage.setItem('mindflow_doc_h4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=h4&title=x');
    const three = (await waitFor(() => container.querySelector('[data-note-line="b1:i3"]'))) as HTMLElement;

    caretAt(three, 0);
    fireEvent.keyDown(three, { key: 'Backspace' });
    saveNow();

    await waitFor(() => {
      const blocks = saved('h4').pages[0].blocks as { kind: string; runs?: { t: string }[]; items?: { id: string }[] }[];
      expect(blocks.map((b) => b.kind)).toEqual(['ol', 'p']);
      expect(blocks[0]?.items?.map((i) => i.id)).toEqual(['i1', 'i2']);
      expect(blocks[1]?.runs?.map((r) => r.t).join('')).toBe('셋'); // 글은 그대로 남는다
    });
  });

  it('조합 중 방향키는 **한 칸만** 옮긴다(제보 5: 두 칸 건너뛴다)', async () => {
    localStorage.setItem('mindflow_doc_h5', JSON.stringify(TWO));
    const { container } = renderEditor('/editor?map=h5&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    /**
     * 크롬은 조합 중의 방향키로 **조합을 끝내고**, 이어서 `isComposing`이 꺼진
     * keydown을 한 번 더 보낸다 — 그 둘이 각각 한 칸씩 옮겨 두 칸이 됐다.
     */
    caretAt(one, 99);
    fireEvent.keyDown(one, { key: 'ArrowDown', isComposing: true });
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b2'));

    // 미뤄 둔 일이 뒤늦게 한 칸 더 옮기지 않는다.
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement?.getAttribute('data-note-line')).toBe('b2');
  });
});

describe('공책 47판 — 좌표계 한 벌 · 커서만 옮기면 저장 없음 · 번호 이어세기', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('링크가 든 줄을 **지나가기만** 하면 저장하지 않는다(요청 8)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', updatedAt: '2026-09-16T00:00:00.000Z', blocks: [
      { id: 'lk', kind: 'p', runs: [{ t: '링크', b: false, c: null, href: 'https://example.com' }] },
      { id: 'b2', kind: 'p', runs: [{ t: '뒤', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_k1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=k1&title=x');
    const lk = (await waitFor(() => container.querySelector('[data-note-line="lk"]'))) as HTMLElement;
    const two = container.querySelector('[data-note-line="b2"]') as HTMLElement;

    /**
     * 예전에는 여기서 저장이 돌았다: 떠날 때 DOM을 읽는데 `domToRuns`가 주소를
     * `normalizeUrl`에 태워 `https://example.com` → `…/`로 한 글자 늘렸다.
     */
    lk.focus();
    fireEvent.blur(lk);
    two.focus();
    fireEvent.blur(two);
    saveNow();
    await new Promise((r) => setTimeout(r, 20));

    expect(saved('k1').pages[0].updatedAt).toBe('2026-09-16T00:00:00.000Z');
    expect(saved('k1').pages[0].blocks[0].runs[0].href).toBe('https://example.com');
  });

  it('글을 고치면 그때는 저장한다(위 가드가 저장을 막아 버리지 않는다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', updatedAt: '2026-09-16T00:00:00.000Z', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '가', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_k2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=k2&title=x');
    const one = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    one.focus();
    one.textContent = '가나';
    fireEvent.input(one);
    fireEvent.blur(one);
    saveNow();

    await waitFor(() => expect(saved('k2').pages[0].blocks[0].runs[0].t).toBe('가나'));
  });

  it('목록 위에 `2. `로 새 줄을 만들면 아래가 **3·4·5**가 된다(요청 7)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'top', kind: 'p', runs: [{ t: '', b: false, c: null }] },
      { id: 'L', kind: 'ol', items: [
        { id: 'i1', runs: [{ t: '하나', b: false, c: null }] },
        { id: 'i2', runs: [{ t: '둘', b: false, c: null }] },
        { id: 'i3', runs: [{ t: '셋', b: false, c: null }] },
      ] },
    ] }] };
    localStorage.setItem('mindflow_doc_k3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=k3&title=x');
    const top = (await waitFor(() => container.querySelector('[data-note-line="top"]'))) as HTMLElement;
    // 툴바 단추도 `data-note-mark`를 쓴다(b·i·s…) — 본문 블록 안쪽만 센다.
    const marks = () => [...container.querySelectorAll('[data-note-block] [data-note-mark]')].map((e) => (e.getAttribute('data-note-mark') || '').trim());
    expect(marks()).toEqual(['1.', '2.', '3.']);

    // 마크다운 단축 — `2. `를 치면 그 줄이 2번부터인 목록이 된다(캐럿은 표식 바로 뒤).
    top.innerHTML = '2. ';
    top.focus();
    const range = document.createRange();
    range.setStart(top.firstChild as Text, 3);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(top);

    await waitFor(() => expect(marks()).toEqual(['2.', '3.', '4.', '5.']));
    // 아래 목록의 저장된 `start`는 그대로다 — 세는 것은 그릴 때다(모델을 건드리지 않는다).
    saveNow();
    await waitFor(() => {
      const blocks = saved('k3').pages[0].blocks as { kind: string; start?: number }[];
      expect(blocks.map((b) => b.kind)).toEqual(['ol', 'ol']);
      expect(blocks[0]?.start).toBe(2);
      expect(blocks[1]?.start).toBeUndefined();
    });
  });
});

describe('공책 48판 — 칸의 링크 · 구분선 초점 · 붙여넣기 자동 링크', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('**고른 칸**의 링크를 누르면 열린다(제보 1 — 우리가 골라 둔 선택이 막고 있었다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'tb', kind: 'table', rows: [[[{ t: '링크칸', b: false, c: null, href: 'https://example.com/' }], [{ t: '칸2', b: false, c: null }]], [[{ t: 'x', b: false, c: null }], [{ t: 'y', b: false, c: null }]]] },
    ] }] };
    localStorage.setItem('mindflow_doc_m1', JSON.stringify(doc));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = renderEditor('/editor?map=m1&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;

    // 한 번 누르면 **칸을 고른다**(armed) — 그 칸의 글자는 우리가 통째로 골라 둔다.
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
    await waitFor(() => expect(cell.getAttribute('data-armed')).toBe('1'));

    const link = container.querySelector('[data-note-line="tb:r0c0"] [data-href]') as HTMLElement;
    fireEvent.click(link);

    expect(open).toHaveBeenCalled();
    expect(open.mock.calls[0]?.[0]).toBe('https://example.com/');
    open.mockRestore();
  });

  it('빈 줄을 지울 때 위가 구분선이면 **구분선이 초점을 받는다**(제보 4: 커서가 사라졌다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'a', kind: 'p', runs: [{ t: '위', b: false, c: null }] },
      { id: 'hr', kind: 'hr' },
      { id: 'b', kind: 'p', runs: [{ t: '', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_m2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=m2&title=x');
    const empty = (await waitFor(() => container.querySelector('[data-note-line="b"]'))) as HTMLElement;

    empty.focus();
    const range = document.createRange();
    range.setStart(empty, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.keyDown(empty, { key: 'Backspace' });

    await waitFor(() => expect(document.activeElement?.hasAttribute('data-note-hr')).toBe(true));
  });

  it('본문에 주소를 붙여넣으면 **링크가 걸린다**(요청 3)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '여기: ', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_m3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=m3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    line.focus();
    const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, text.nodeValue?.length ?? 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.paste(line, { clipboardData: { getData: () => 'https://geurio.com/home' } });
    saveNow();

    await waitFor(() => {
      const runs = saved('m3').pages[0].blocks[0].runs as { t: string; href?: string }[];
      expect(runs.find((r) => r.href)?.href).toBe('https://geurio.com/home');
      expect(runs.map((r) => r.t).join('')).toBe('여기: https://geurio.com/home');
    });
  });

  it('주소가 아닌 글도 **모델로** 들어간다 — 원본 앱의 글자 크기가 따라오지 않게(제보)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '가', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_m4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=m4&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    line.focus();
    const ev = createEvent.paste(line, { clipboardData: { getData: () => '그냥 글자' } } as unknown as Event);
    fireEvent(line, ev);

    expect(ev.defaultPrevented).toBe(true);
    // 값에서 다시 그리므로 **유령 인라인 스타일이 남을 수 없다**.
    expect(line.querySelector('[style]')).toBeNull();
    saveNow();
    await waitFor(() => expect(saved('m4').pages[0].blocks[0].runs.map((r: { t: string }) => r.t).join('')).toContain('그냥 글자'));
  });
});

describe('공책 49판 — 친 주소·머리의 부피·제목 밑줄·태그 기억·목록 줄 높이', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('**손으로 친 주소**도 줄을 떠날 때 링크가 된다(요청)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] }] }] };
    localStorage.setItem('mindflow_doc_n1', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=n1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    line.focus();
    line.textContent = 'https://geurio.com 보세요';
    fireEvent.input(line);
    // 치는 **동안에는** 걸지 않는다 — 반쯤 친 주소가 링크가 됐다 풀렸다 하면 캐럿이 흔들린다.
    expect(line.querySelector('[data-href]')).toBeNull();

    fireEvent.blur(line);
    saveNow();

    await waitFor(() => {
      const runs = saved('n1').pages[0].blocks[0].runs as { t: string; href?: string }[];
      expect(runs.find((r) => r.href)?.href).toBe('https://geurio.com/');
    });
    // 비제어 박스라 **화면도 함께** 다시 그린다 — 아니면 링크가 보이지 않는다.
    expect(line.querySelector('[data-href]')).toBeTruthy();
  });

  it('제목에 초점이 가도 **주황 밑줄은 쓰지 않는다**(요청)', async () => {
    localStorage.setItem('mindflow_doc_n2', JSON.stringify(NOTE));
    renderEditor('/editor?map=n2&title=x');
    await waitFor(() => expect(document.querySelector('[data-note-title]')).toBeTruthy());
    // 규칙은 CSS에 있다(jsdom은 그 파일을 싣지 않는다) — 값이 강조색이 아닌지를 못박는다.
    // 그 파일을 글자 그대로 읽는다(`?raw`는 vitest에서 빈 문자열로 온다 — 실측).
    const cssPath = ['src/features/editor/editor.css', 'apps/web/src/features/editor/editor.css'].find((f) => existsSync(f));
    expect(cssPath).toBeTruthy();
    const rule = /\[data-note-title\]:focus \{([^}]*)\}/.exec(readFileSync(cssPath as string, 'utf8'))?.[1] ?? '';
    expect(rule).toContain('--mf-border');
    expect(rule).not.toContain('--mf-accent');
  });

  it('만든 태그는 **떼어도 목록에 남는다**(요청 4)', async () => {
    localStorage.setItem('mindflow_doc_n3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=n3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-tag-pick]'))) as HTMLElement);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-tag-add]'))) as HTMLElement);
    const input = (await waitFor(() => container.querySelector('[data-note-tag-new]'))) as HTMLInputElement;
    // 단추는 **「적용」 글자**다(요청 3) — 체크 아이콘이 아니다.
    expect((container.querySelector('[data-note-tag-commit]') as HTMLElement).textContent).toBe('적용');
    fireEvent.change(input, { target: { value: '회의준비' } });
    fireEvent.click(container.querySelector('[data-note-tag-commit]') as HTMLElement);

    // 공책이 기억한다.
    saveNow();
    await waitFor(() => expect(saved('n3').cover.tags).toContain('회의준비'));

    // 떼어도 고르개에 남아 있다.
    fireEvent.click(container.querySelector('[data-note-tag-pick]') as HTMLElement);
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-tag-clear]'))) as HTMLElement);
    fireEvent.click(container.querySelector('[data-note-tag-pick]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-note-tag-opt="회의준비"]')).toBeTruthy());
  });

  it('목록 줄은 **문단과 같은 글자 상자**다(제보 5: 아래 줄들이 위로 틀어진다)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '문단', b: false, c: null }] },
      { id: 'b2', kind: 'ul', items: [{ id: 'i1', runs: [{ t: '항목', b: false, c: null }] }] },
    ] }] };
    localStorage.setItem('mindflow_doc_n4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=n4&title=x');
    const para = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    const item = container.querySelector('[data-note-line="b2:i1"]') as HTMLElement;

    // jsdom은 레이아웃을 재지 않으므로 **값**을 못박는다 — 실측(브라우저)은 3px였다.
    expect(item.style.fontSize).toBe(para.style.fontSize);
    expect(item.style.lineHeight).toBe(para.style.lineHeight);
  });
});

describe('공책 50판 — 형광펜 상자 · 툴바 툴팁 · 링크 주소 · 단추 켜짐 · 입력칸', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const css = (): string => {
    const p = ['src/features/editor/editor.css', 'apps/web/src/features/editor/editor.css'].find((f) => existsSync(f));
    expect(p).toBeTruthy();
    return readFileSync(p as string, 'utf8');
  };

  it('형광펜은 **자리를 넓히지 않는다** — 좌우 여백을 음수로 되돌린다(제보 1)', () => {
    const rule = /\.mf-note-line \.mf-hl \{([^}]*)\}/.exec(css())?.[1] ?? '';
    // 가로 padding만큼을 음수 margin으로 돌려놓는다 — 아니면 글자가 옆으로 밀리고,
    // 밀린 만큼 줄이 감겨 아래 글이 위로 올라온 것처럼 보였다.
    expect(rule).toContain('padding: 0.02em 0.12em');
    expect(rule).toContain('margin: 0 -0.12em');
  });

  it('툴바 단추는 `title`이 아니라 **우리 툴팁**을 쓴다 — 얹는 즉시 뜬다(요청 5)', async () => {
    localStorage.setItem('mindflow_doc_t1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=t1&title=x');
    const bold = (await waitFor(() => container.querySelector('[data-note-mark="b"]'))) as HTMLElement;
    // 브라우저의 느린 `title`은 떼어 냈다(1초쯤 기다렸다 뜬다 — 우리가 정할 수 없다).
    expect(bold.getAttribute('title')).toBeNull();
    expect(bold.getAttribute('data-tip')).toBe('굵게');
    // 접근성 이름은 `aria-label`이 계속 진다.
    expect(bold.getAttribute('aria-label')).toBe('굵게');

    fireEvent.pointerOver(bold);
    // **기다리지 않는다** — 같은 틱에 이미 떠 있어야 한다.
    const tip = document.querySelector('[data-note-tip]');
    expect(tip?.textContent).toContain('굵게');

    fireEvent.pointerDown(document.body);
    expect(document.querySelector('[data-note-tip]')).toBeNull();
  });

  it('링크 글자에 얹으면 **주소**가 뜬다(요청 4)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '여기', b: false, c: null, href: 'https://geurio.com/home' }] },
    ] }] };
    localStorage.setItem('mindflow_doc_t2', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t2&title=x');
    const link = (await waitFor(() => container.querySelector('[data-href]'))) as HTMLElement;

    fireEvent.pointerOver(link);
    // 글 사이의 링크는 아주 짧게 기다렸다 뜬다 — 지나가는 것만으로 번쩍이지 않게.
    await waitFor(() => expect(document.querySelector('[data-note-tip]')?.textContent).toContain('geurio.com'));
    expect(document.querySelector('[data-note-tip]')?.textContent).toContain('눌러서 열기');
  });

  it('줄 전체를 골라 서식을 걸면 **툴바 단추가 켜진다**(제보 6)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '가나다', b: false, c: null }] },
    ] }] };
    localStorage.setItem('mindflow_doc_t3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=t3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    const bold = container.querySelector('[data-note-mark="b"]') as HTMLElement;
    expect(bold.getAttribute('aria-pressed')).toBe('false');

    line.focus();
    const range = document.createRange();
    range.selectNodeContents(line);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    fireEvent.mouseDown(bold);
    fireEvent.click(bold);

    // 서식을 걸면 브라우저 선택을 비운다(겹친 배경을 막기 위해) — 그래서 **칠해 둔
    // 자리**를 읽어야 단추가 켜진 채 남는다.
    await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'));
  });

  it('링크 판의 입력칸은 **흰 종이**다 — 가라앉은 면은 비활성으로 읽혔다(제보 7)', async () => {
    localStorage.setItem('mindflow_doc_t4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=t4&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-topbar]')).toBeTruthy());
    const surface = container.querySelector('[data-note-topbar]')!.parentElement as HTMLElement;
    expect(surface.style.getPropertyValue('--mf-note-field')).toBe('#ffffff');

    fireEvent.click((await waitFor(() => container.querySelector('[data-note-link-btn]'))) as HTMLElement);
    const url = (await waitFor(() => container.querySelector('[data-note-link-url]'))) as HTMLInputElement;
    expect(url.className).toContain('mf-note-field');
    expect(url.style.background).toBe('var(--mf-note-field)');
    // 얹음·초점 반응은 CSS에 있다(인라인으로는 `:focus`를 쓸 수 없다).
    expect(css()).toContain('.mf-note-field:focus');
  });
});

describe('공책 51판 — 표: 칸의 목록 서식 · 레일 끌어 여러 줄 · 누르는 순간 선택', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 칸 하나에 목록 두 줄 — 값은 `- 가나\n- 다라`(마커가 곧 글자다). */
  const CELLS = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b4', kind: 'table', rows: [[[{ t: '- 가나\n- 다라', b: false, c: null }], [{ t: '옆', b: false, c: null }]], [[{ t: 'x', b: false, c: null }], [{ t: 'y', b: false, c: null }]]] },
    ] }] };

  /** 4열 3행 — 레일을 끌 자리가 있어야 한다(기본 표는 2×2다). */
  const WIDE = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b4', kind: 'table', rows: Array.from({ length: 3 }, (_, r) => Array.from({ length: 4 }, (_, c) => [{ t: `${r}${c}`, b: false, c: null }])) },
    ] }] };

  it('칸의 목록에 서식을 걸어도 **마커가 남는다**(제보 9)', async () => {
    localStorage.setItem('mindflow_doc_tc1', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=tc1&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    await waitFor(() => expect(cell.querySelectorAll('[data-list-marker]')).toHaveLength(2));
    // 칸임을 DOM이 말한다 — 바깥에서 다시 그리는 길이 이 표식으로 갈래를 고른다.
    expect(cell.hasAttribute('data-list-box')).toBe(true);

    // 첫 줄의 `가나`(값 좌표 2~4)에 굵게.
    applyNoteFormatRange(cell, 2, 4, 'b');
    // 평평한 `runsToHtml`로 덮던 시절에는 여기서 마커 스팬이 통째로 사라졌다.
    expect(cell.querySelectorAll('[data-list-marker]')).toHaveLength(2);
  });

  it('칸을 통째로 골라 링크를 걸어도 **마커에는 걸리지 않는다**(제보 9 · 저장값)', async () => {
    localStorage.setItem('mindflow_doc_tc2', JSON.stringify(CELLS));
    const { container } = renderEditor('/editor?map=tc2&title=x');
    const cell = (await waitFor(() => container.querySelector('[data-note-line="b4:r0c0"]'))) as HTMLElement;
    fireEvent.doubleClick(cell.closest('td') as HTMLElement);
    await waitFor(() => expect(cell.querySelectorAll('[data-list-marker]')).toHaveLength(2));

    // `- 가나\n- 다라` = 11자. 통째로(⌘A와 같은 구간) 링크를 건다.
    const runs = applyNoteFormatRange(cell, 0, 11, 'link', 'https://geurio.com') as { t: string; href?: string }[];
    // 마커 글자에는 걸리지 않고 **내용 두 조각**에만 걸린다.
    expect(runs.filter((r) => r.href).map((r) => r.t)).toEqual(['가나', '다라']);
    expect(runs.find((r) => r.t.includes('-'))?.href).toBeUndefined();
    expect(cell.querySelectorAll('[data-list-marker]')).toHaveLength(2);
  });

  it('열 레일을 **끌면 여러 열**이 골라진다(요청 10)', async () => {
    localStorage.setItem('mindflow_doc_tc3', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=tc3&title=x');
    const h0 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;

    fireEvent.mouseDown(h0, { button: 0 });
    expect(picked(container)).toEqual(['0:0', '1:0', '2:0']); // 누르는 순간 한 열
    fireEvent.mouseEnter(container.querySelector('[data-note-table-colslot="2"]') as HTMLElement, { buttons: 1 });
    // 0~2열 × 3행 = 9칸. 3열은 들지 않는다.
    expect(picked(container)).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1', '1:2', '2:0', '2:1', '2:2']);
    fireEvent.mouseUp(document);
    // 끌고 나서 오는 click이 한 열로 되돌리지 않는다.
    fireEvent.click(h0);
    expect(picked(container)).toHaveLength(9);
    // 고른 손잡이 셋이 모두 물든다.
    for (const i of [0, 1, 2]) expect((container.querySelector(`[data-note-table-colhandle="${i}"] span`) as HTMLElement).style.background).toContain('--mf-accent');
    expect((container.querySelector('[data-note-table-colhandle="3"] span') as HTMLElement).style.background).not.toContain('--mf-accent');
  });

  it('거꾸로 끌어도(오른쪽 → 왼쪽) 같은 범위다 · 행 레일도 같다(요청 10)', async () => {
    localStorage.setItem('mindflow_doc_tc4', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=tc4&title=x');
    const h2 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="2"]'))) as HTMLElement;
    fireEvent.mouseDown(h2, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-colslot="0"]') as HTMLElement, { buttons: 1 });
    expect(picked(container)).toHaveLength(9);
    fireEvent.mouseUp(document);

    const r0 = container.querySelector('[data-note-table-rowhandle="0"]') as HTMLElement;
    fireEvent.mouseDown(r0, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-rowslot="1"]') as HTMLElement, { buttons: 1 });
    // 0~1행 × 4열 = 8칸.
    expect(picked(container)).toEqual(['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
    fireEvent.mouseUp(document);
  });

  it('여러 행을 골라 ⌫를 누르면 **한 번에 · 되돌리기도 한 번**이다(요청 10)', async () => {
    localStorage.setItem('mindflow_doc_tc5', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=tc5&title=x');
    const r0 = (await waitFor(() => container.querySelector('[data-note-table-rowhandle="0"]'))) as HTMLElement;
    fireEvent.mouseDown(r0, { button: 0 });
    fireEvent.mouseEnter(container.querySelector('[data-note-table-rowslot="1"]') as HTMLElement, { buttons: 1 });
    fireEvent.mouseUp(document);

    const keys = container.querySelector('[data-note-table-keys]') as HTMLElement;
    fireEvent.keyDown(keys, { key: 'Backspace' });
    saveNow();
    await waitFor(() => expect(saved('tc5').pages[0].blocks[0].rows).toHaveLength(1));
    // 남은 한 행은 **마지막 행**이다(큰 번호부터 지웠다는 증거).
    expect(saved('tc5').pages[0].blocks[0].rows[0][0][0].t).toBe('20');
  });

  it('레일 클릭 **한 번**은 여전히 한 줄이다(회귀)', async () => {
    localStorage.setItem('mindflow_doc_tc6', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=tc6&title=x');
    const h1 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="1"]'))) as HTMLElement;
    fireEvent.click(h1);
    expect(picked(container)).toEqual(['0:1', '1:1', '2:1']);
  });

  it('칸은 **누르는 순간** 골라진다 — 떼기를 기다리지 않는다(요청 11)', async () => {
    localStorage.setItem('mindflow_doc_tc7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=tc7&title=x');
    const td = (await waitFor(() => container.querySelector('[data-note-table-cell="1:1"]'))) as HTMLElement;

    const down = createEvent.mouseDown(td, { button: 0, bubbles: true, cancelable: true });
    fireEvent(td, down);
    expect(picked(container)).toEqual(['1:1']);
    expect(td.getAttribute('data-armed')).toBe('1');
    // 끄는 동안 브라우저 글자 선택이 겹쳐 그려지지 않게 기본 동작을 막는다.
    expect(down.defaultPrevented).toBe(true);
  });

  it('끌었다 **되돌아와** 떼면 한 칸으로 접힌다(회귀)', async () => {
    localStorage.setItem('mindflow_doc_tc8', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=tc8&title=x');
    const a = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    const b = container.querySelector('[data-note-table-cell="1:1"]') as HTMLElement;

    fireEvent.mouseDown(a, { button: 0 });
    fireEvent.mouseEnter(b);
    expect(picked(container)).toHaveLength(4);
    fireEvent.mouseEnter(a);
    fireEvent.mouseUp(a);
    expect(picked(container)).toEqual(['0:0']);
  });

  it('고치는 중인 칸의 누름은 **막지 않는다** — 캐럿을 옮기는 일이다(회귀)', async () => {
    localStorage.setItem('mindflow_doc_tc9', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=tc9&title=x');
    const td = (await waitFor(() => container.querySelector('[data-note-table-cell="0:0"]'))) as HTMLElement;
    fireEvent.doubleClick(td);
    await waitFor(() => expect(td.getAttribute('data-armed')).toBeNull());

    const down = createEvent.mouseDown(td, { button: 0, bubbles: true, cancelable: true });
    fireEvent(td, down);
    expect(down.defaultPrevented).toBe(false);
  });
});

describe('공책 52판 — 복귀 스크롤 방어 · 이미지 배율 · 서식 복사', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** rAF 몇 프레임을 돌린다 — 붙들기 펌프가 그 위에 산다. */
  const frames = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(() => r(null)));
  };

  const scroller = (c: HTMLElement): HTMLElement => c.querySelector('[data-note-page]') as HTMLElement;

  it('신호가 **둘** 와도 붙들기가 살아 있다(제보 3 — 서로를 죽이던 자리)', async () => {
    localStorage.setItem('mindflow_doc_s1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=s1&title=x');
    const box = (await waitFor(() => scroller(container))) as HTMLElement;
    Object.defineProperty(box, 'scrollHeight', { value: 4000, configurable: true });
    box.scrollTop = 800;

    // 다른 앱에 갔다 오면 `visibilitychange(visible)`와 `focus`가 **둘 다** 뜬다.
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));
    // 그 직후 브라우저가 캐럿을 좇아 스크롤을 튀긴다.
    box.scrollTop = 0;

    await frames(4);
    // 예전에는 먼저 예약된 프레임이 **두 번째 붙들기**를 꺼 버려 0이 남았다.
    expect(box.scrollTop).toBe(800);
  });

  it('사용자가 굴리면 **즉시 놓는다** — 수식키만 눌린 것은 조작이 아니다(제보 3)', async () => {
    localStorage.setItem('mindflow_doc_s2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=s2&title=x');
    const box = (await waitFor(() => scroller(container))) as HTMLElement;
    Object.defineProperty(box, 'scrollHeight', { value: 4000, configurable: true });
    box.scrollTop = 500;
    fireEvent(window, new Event('focus'));

    // ⌥Tab으로 돌아오는 길의 수식키는 붙들기를 풀지 않는다.
    fireEvent.keyDown(window, { key: 'Alt' });
    box.scrollTop = 0;
    await frames(3);
    expect(box.scrollTop).toBe(500);

    // 진짜 조작(휠·손가락)은 그 즉시 놓는다.
    fireEvent.wheel(window);
    box.scrollTop = 120;
    await frames(3);
    expect(box.scrollTop).toBe(120);
  });

  it('이미지 판은 **배율**로 본다 — 확대하면 퍼센트가 오른다(요청 8)', async () => {
    const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'im', kind: 'img', src: PIX }] }] };
    localStorage.setItem('mindflow_doc_s3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=s3&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-image]'))) as HTMLElement);
    const zoom = (await waitFor(() => container.querySelector('[data-note-image-zoom]'))) as HTMLElement;
    const pct = () => (zoom.querySelector('[data-note-image-pct]') as HTMLElement).textContent;

    // jsdom은 그림을 재지 못해(`naturalWidth`가 0) 맞춤이 1 = 100%다.
    expect(pct()).toBe('100%');
    fireEvent.click(zoom.querySelector('[data-note-image-zoom-key="in"]') as HTMLElement);
    await waitFor(() => expect(pct()).toBe('120%'));
    fireEvent.click(zoom.querySelector('[data-note-image-zoom-key="in"]') as HTMLElement);
    await waitFor(() => expect(pct()).toBe('144%'));
    // 퍼센트를 누르면 맞춤으로 돌아온다.
    fireEvent.click(zoom.querySelector('[data-note-image-pct]') as HTMLElement);
    await waitFor(() => expect(pct()).toBe('100%'));
  });

  it('휠 확대는 **굴린 양에 비례**한다 — 한 칸에 최대까지 튀지 않는다(제보 3)', async () => {
    const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [{ id: 'im', kind: 'img', src: PIX }] }] };
    localStorage.setItem('mindflow_doc_s3b', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=s3b&title=x');
    fireEvent.click((await waitFor(() => container.querySelector('[data-note-image]'))) as HTMLElement);
    const zoom = (await waitFor(() => container.querySelector('[data-note-image-zoom]'))) as HTMLElement;
    const pct = () => (zoom.querySelector('[data-note-image-pct]') as HTMLElement).textContent;

    // 마우스 휠 한 칸(약 100px) = 약 1.14배. 예전에는 이벤트마다 1.12배라 기기가
    // 한 칸을 여러 이벤트로 잘라 보내면 상한까지 내달렸다.
    fireEvent.wheel(zoom, { deltaY: -100 });
    await waitFor(() => expect(pct()).toBe('114%'));

    // 같은 칸이 **잘게 잘려** 와도 합이 같으면 결과가 같다(기기에 기대지 않는다).
    for (let i = 0; i < 10; i += 1) fireEvent.wheel(zoom, { deltaY: -10 });
    await waitFor(() => expect(pct()).toBe('130%'));

    // 되돌리면 맞춤(100%) 아래로는 내려가지 않는다.
    for (let i = 0; i < 5; i += 1) fireEvent.wheel(zoom, { deltaY: 200 });
    await waitFor(() => expect(pct()).toBe('100%'));
  });

  it('여러 줄을 골라 복사하면 **서식도 함께** 실린다(제보 12)', async () => {
    const doc = { ...NOTE, pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b1', kind: 'p', runs: [{ t: '앞말 ', b: false, c: null }, { t: '굵게', b: true, c: null }] },
      { id: 'b2', kind: 'ul', items: [{ id: 'i1', runs: [{ t: '항목', b: false, c: null }] }] },
    ] }] };
    localStorage.setItem('mindflow_doc_s4', JSON.stringify(doc));
    const written: { plain: string; html: string }[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: (items: { plain?: unknown }[]) => {
          const it = items[0] as unknown as { __data?: Record<string, string> };
          written.push({ plain: it.__data?.['text/plain'] ?? '', html: it.__data?.['text/html'] ?? '' });
          return Promise.resolve();
        },
        writeText: () => Promise.resolve(),
      },
    });
    // `ClipboardItem`이 없는 jsdom — 두 벌을 들여다볼 수 있게 대신 세운다.
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      __data: Record<string, string>;
      constructor(data: Record<string, Blob>) {
        this.__data = {};
        for (const [k, v] of Object.entries(data)) this.__data[k] = (v as unknown as { __text?: string }).__text ?? '';
      }
    };
    const RealBlob = globalThis.Blob;
    (globalThis as { Blob?: unknown }).Blob = class {
      __text: string;
      constructor(parts: string[]) {
        this.__text = parts.join('');
      }
    };

    const { container } = renderEditor('/editor?map=s4&title=x');
    const first = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    const item = container.querySelector('[data-note-line="b2:i1"]') as HTMLElement;

    // 두 블록을 가로질러 끌면 우리 칠하기 선택이 선다.
    fireEvent.pointerDown(first, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(item, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(container.querySelectorAll('[data-note-blockwrap][data-selected]')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'c', metaKey: true });

    (globalThis as { Blob?: unknown }).Blob = RealBlob;
    expect(written).toHaveLength(1);
    // 평문 규칙은 그대로다 — 목록은 마크다운 마커를 글자로 붙인다.
    expect(written[0]!.plain).toContain('- 항목');
    // 서식 한 벌이 함께 간다 — 굵게는 `<strong>`, 목록은 진짜 `<ul>`이다.
    expect(written[0]!.html).toContain('<strong>굵게</strong>');
    expect(written[0]!.html).toContain('<ul><li>항목</li></ul>');
  });
});

describe('공책 53판 — 레일 끌기가 끝나면 **놓는다**(제보)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  /** 4열 3행 — 레일을 끌 자리가 있어야 한다. */
  const WIDE = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'b4', kind: 'table', rows: Array.from({ length: 3 }, (_, r) => Array.from({ length: 4 }, (_, c) => [{ t: `${r}${c}`, b: false, c: null }])) },
    ] }] };

  const slot = (c: HTMLElement, axis: 'col' | 'row', i: number) => c.querySelector(`[data-note-table-${axis}slot="${i}"]`) as HTMLElement;

  it('손을 뗀 뒤에는 **지나가기만 해서는** 범위가 따라오지 않는다', async () => {
    localStorage.setItem('mindflow_doc_r1', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=r1&title=x');
    const h0 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;

    fireEvent.mouseDown(h0, { button: 0 });
    fireEvent.mouseEnter(slot(container, 'col', 1), { buttons: 1 });
    expect(picked(container)).toHaveLength(6);
    fireEvent.mouseUp(document);

    // 누르지 않은 채 슬롯 위를 지나간다 — 예전에는 여기서 범위가 늘어났다.
    fireEvent.mouseEnter(slot(container, 'col', 3), { buttons: 0 });
    expect(picked(container)).toHaveLength(6);
  });

  it('창 밖에서 손을 떼 `mouseup`을 못 받아도 **다음 움직임에 놓는다**', async () => {
    localStorage.setItem('mindflow_doc_r2', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=r2&title=x');
    const h0 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;

    fireEvent.mouseDown(h0, { button: 0 });
    fireEvent.mouseEnter(slot(container, 'col', 1), { buttons: 1 });
    expect(picked(container)).toHaveLength(6);

    // `mouseup`은 오지 않았다. 단추가 안 눌린 움직임 하나가 표식을 지운다.
    fireEvent.mouseEnter(slot(container, 'col', 2), { buttons: 0 });
    expect(picked(container)).toHaveLength(6);
    fireEvent.mouseEnter(slot(container, 'col', 3), { buttons: 0 });
    expect(picked(container)).toHaveLength(6);
  });

  it('끌기가 끝나면 **다음 클릭은 정상**이다 — 표식은 한 번만 쓴다', async () => {
    localStorage.setItem('mindflow_doc_r3', JSON.stringify(WIDE));
    const { container } = renderEditor('/editor?map=r3&title=x');
    const h0 = (await waitFor(() => container.querySelector('[data-note-table-colhandle="0"]'))) as HTMLElement;

    fireEvent.mouseDown(h0, { button: 0 });
    fireEvent.mouseEnter(slot(container, 'col', 2), { buttons: 1 });
    fireEvent.mouseUp(document);
    // 끌고 난 뒤의 click 하나는 건너뛴다(범위가 한 열로 되돌지 않는다).
    fireEvent.click(h0);
    expect(picked(container)).toHaveLength(9);

    // 그 다음 클릭은 평소대로 한 열이다.
    fireEvent.click(container.querySelector('[data-note-table-colhandle="3"]') as HTMLElement);
    expect(picked(container)).toEqual(['0:3', '1:3', '2:3']);
  });
});

// ── 이미 쓰인 글 **앞에서** `/`를 친다(요청) ─────────────────────────────────
//
// `/`는 예전에도 낱말의 시작에서 열렸지만 **질의가 뒤의 글까지 삼켰다** — `안녕하세요`
// 앞에서 `/제목`을 치면 질의가 `제목안녕하세요`가 되어 아무 항목도 맞지 않았다. 이제
// 열 때 기억한 **꼬리**를 접미로 떼어 사람이 친 글자만 질의로 본다.
describe('공책 — 글 앞에서 여는 `/`', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const ONE = (runs: { t: string; b?: boolean; c?: string | null }[]) => ({
    ...NOTE,
    pages: [{ id: 'p1', title: '한 줄', blocks: [{ id: 'b1', kind: 'p', runs: runs.map((r) => ({ b: false, c: null, ...r })) }] }],
  });

  /** 그 줄의 n번째 글자 앞에 캐럿을 두고 `/`를 친다 — 사람이 치는 순서 그대로. */
  function slashAt(line: HTMLElement, at: number): void {
    line.focus();
    const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    const range = document.createRange();
    if (text) range.setStart(text, Math.min(at, (text.nodeValue ?? '').length));
    else range.setStart(line, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.keyDown(line, { key: '/' });
  }

  it('질의가 **뒤의 글을 삼키지 않는다** — 목록이 제목으로 좁혀진다', async () => {
    localStorage.setItem('mindflow_doc_nsC0', JSON.stringify(ONE([{ t: '안녕하세요' }])));
    const { container } = renderEditor('/editor?map=nsC0&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    // 브라우저가 `/`를 넣고, 이어 친 `제목`이 그 뒤에 들어간다.
    type(line, '/제목안녕하세요');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="h1"]')).toBeTruthy());
    expect([...container.querySelectorAll('[data-note-slash-item]')].map((b) => b.getAttribute('data-note-slash-item'))).toEqual(['h1', 'h2', 'h3']);
  });

  it('고르면 `/질의`만 빠지고 **뒤의 글은 그 줄에 남는다**', async () => {
    localStorage.setItem('mindflow_doc_nsC1', JSON.stringify(ONE([{ t: '안녕하세요' }])));
    const { container } = renderEditor('/editor?map=nsC1&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    type(line, '/제목안녕하세요');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="h1"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-item="h1"]')!);
    saveNow();

    await waitFor(() => expect(saved('nsC1').pages[0].blocks[0].kind).toBe('h1'));
    expect(runsOf(saved('nsC1').pages[0].blocks[0])).toBe('안녕하세요');
  });

  it('뒤의 글의 **서식이 살아 있다** — 그 구간만 오려 낸다(예전에는 평문으로 풀렸다)', async () => {
    localStorage.setItem('mindflow_doc_nsC2', JSON.stringify(ONE([{ t: '굵은글', b: true }])));
    const { container } = renderEditor('/editor?map=nsC2&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    // 친 `/인용`은 평문이고 뒤의 글은 굵은 스팬이다 — 브라우저가 만드는 그 모양대로.
    type(line, '/인용<span style="font-weight:800;">굵은글</span>');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="q"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-item="q"]')!);
    saveNow();

    await waitFor(() => expect(saved('nsC2').pages[0].blocks[0].kind).toBe('q'));
    const runs = saved('nsC2').pages[0].blocks[0].runs as { t: string; b?: boolean }[];
    expect(runs.map((r) => r.t).join('')).toBe('굵은글');
    expect(runs.every((r) => r.b)).toBe(true);
  });

  it('취소하면 친 글자와 뒤의 글이 **그대로** 남는다(요청)', async () => {
    localStorage.setItem('mindflow_doc_nsC3', JSON.stringify(ONE([{ t: '안녕하세요' }])));
    const { container } = renderEditor('/editor?map=nsC3&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    type(line, '/제목안녕하세요');
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-note-slash]')).toBeNull());

    saveNow();
    await waitFor(() => expect(runsOf(saved('nsC3').pages[0].blocks[0])).toBe('/제목안녕하세요'));
    expect(saved('nsC3').pages[0].blocks[0].kind).toBe('p');
  });

  it('`/질의`에 **회색 배경**을 얹는다 — 값은 건드리지 않는다(요청)', async () => {
    // `CSS.highlights`는 jsdom에 없다 — 표준 API의 모양만 흉내 내 무엇을 칠하는지 본다
    // (아는 브라우저에서만 켜지고, 모르는 브라우저에서는 조용히 넘어간다).
    const shelf = new Map<string, { ranges: Range[] }>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    }
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { ...(typeof CSS === 'undefined' ? {} : CSS), highlights: shelf });
    try {
      localStorage.setItem('mindflow_doc_nsC6', JSON.stringify(ONE([{ t: '안녕하세요' }])));
      const { container } = renderEditor('/editor?map=nsC6&title=x');
      const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

      slashAt(line, 0);
      type(line, '/제목안녕하세요');
      // 칠하는 것은 **`/`부터 질의 끝까지** — 질의가 비어 있는 첫 순간에도 보이게.
      await waitFor(() => expect(shelf.get('mf-note-slash')?.ranges[0]?.toString()).toBe('/제목'));

      // 취소하면 색도 걷힌다(값에는 애초에 손대지 않았다).
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(shelf.get('mf-note-slash')).toBeUndefined());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('구분선처럼 **글을 그리지 않는 종류**는 남은 글을 삼키지 않고 아래에 선다', async () => {
    localStorage.setItem('mindflow_doc_nsC4', JSON.stringify(ONE([{ t: '안녕하세요' }])));
    const { container } = renderEditor('/editor?map=nsC4&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    type(line, '/구분선안녕하세요');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="hr"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-item="hr"]')!);
    // 화면이 먼저다 — 저장은 커밋이 렌더에 반영된 **뒤에** 찍는다(그러지 않으면
    // 마지막 커밋 하나가 빠진 판이 저장된다: 이 파일의 다른 테스트들이 운으로
    // 통과하고 있던 자리다).
    // 구분선 **뒤에 빈 문단**이 하나 선다(제보 4) — 구분선에는 캐럿이 설 자리가
    // 없어, 문서 끝에 넣으면 이어서 쓸 곳이 사라진다.
    await waitFor(() => expect(container.querySelectorAll('[data-note-block]')).toHaveLength(3));
    saveNow();

    await waitFor(() => expect(saved('nsC4').pages[0].blocks.map((b: { kind: string }) => b.kind)).toEqual(['p', 'hr', 'p']));
    const blocks = saved('nsC4').pages[0].blocks;
    expect(runsOf(blocks[0])).toBe('안녕하세요');
  });

  it('빈 줄에서는 예전처럼 **그 줄을** 구분선으로 바꾼다(회귀 방어)', async () => {
    localStorage.setItem('mindflow_doc_nsC5', JSON.stringify(ONE([{ t: '' }])));
    const { container } = renderEditor('/editor?map=nsC5&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    slashAt(line, 0);
    type(line, '/구분선');
    await waitFor(() => expect(container.querySelector('[data-note-slash-item="hr"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-slash-item="hr"]')!);
    await waitFor(() => expect(container.querySelector('[data-note-block="b1"]')?.getAttribute('data-note-kind')).toBe('hr'));
    saveNow();

    await waitFor(() => expect(saved('nsC5').pages[0].blocks[0].kind).toBe('hr'));
    // 그 아래에 이어서 쓸 빈 문단(제보 4).
    expect(saved('nsC5').pages[0].blocks.map((b: { kind: string }) => b.kind)).toEqual(['hr', 'p']);
  });
});

// ── 찾기에 걸린 낱말을 짚어 준다(요청 5) ───────────────────────────────────
//
// 목록은 우리가 그리는 글이라 **스팬**으로 감싸고(제목·걸린 줄), 본문은 비제어
// 편집 박스라 `CSS.highlights`로 칠한다 — 값도 DOM도 건드리지 않는 길이다.
describe('공책 — 찾기 하이라이트', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const BOOK = {
    ...NOTE,
    pages: [
      { id: 'p1', title: '공책 이야기', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: '이 페이지는 페이지다', b: false, c: null }] }], updatedAt: '2026-09-16T00:00:00.000Z' },
      { id: 'p2', title: '다른 장', blocks: [{ id: 'b9', kind: 'p', runs: [{ t: '관계 없는 글', b: false, c: null }] }] },
    ],
  };

  function search(container: HTMLElement, value: string): void {
    fireEvent.change(container.querySelector('[data-note-search]')!, { target: { value } });
  }

  it('제목이 걸리면 **목록의 제목**에 배경이 붙는다', async () => {
    localStorage.setItem('mindflow_doc_fh1', JSON.stringify(BOOK));
    const { container } = renderEditor('/editor?map=fh1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    search(container, '공책');
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(1));
    const marks = [...container.querySelectorAll('[data-note-page-row] [data-note-find]')].map((e) => e.textContent);
    expect(marks).toEqual(['공책']);
  });

  it('본문이 걸리면 **걸린 줄**의 그 낱말에 배경이 붙는다 — 여러 번 나와도 전부', async () => {
    localStorage.setItem('mindflow_doc_fh2', JSON.stringify(BOOK));
    const { container } = renderEditor('/editor?map=fh2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    search(container, '페이지');
    await waitFor(() => expect(container.querySelector('[data-note-page-hit]')).toBeTruthy());
    const hit = container.querySelector('[data-note-page-hit]') as HTMLElement;
    expect([...hit.querySelectorAll('[data-note-find]')].map((e) => e.textContent)).toEqual(['페이지', '페이지']);
    // 짚는 것은 걸린 낱말뿐이다 — 나머지 글은 그대로다.
    expect(hit.textContent).toBe('이 페이지는 페이지다');
  });

  it('검색을 지우면 표시도 사라진다', async () => {
    localStorage.setItem('mindflow_doc_fh3', JSON.stringify(BOOK));
    const { container } = renderEditor('/editor?map=fh3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-search]')).toBeTruthy());

    search(container, '공책');
    await waitFor(() => expect(container.querySelector('[data-note-find]')).toBeTruthy());
    search(container, '');
    await waitFor(() => expect(container.querySelector('[data-note-find]')).toBeNull());
  });

  it('본문의 글자는 **칠해서** 짚는다 — 값도 DOM도 건드리지 않는다', async () => {
    const shelf = new Map<string, { ranges: Range[] }>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    }
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { ...(typeof CSS === 'undefined' ? {} : CSS), highlights: shelf });
    try {
      localStorage.setItem('mindflow_doc_fh4', JSON.stringify(BOOK));
      const { container } = renderEditor('/editor?map=fh4&title=x');
      await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

      search(container, '페이지');
      await waitFor(() => expect(shelf.get('mf-note-find')?.ranges.map((r) => r.toString())).toEqual(['페이지', '페이지']));

      // 값은 그대로다 — 칠하기는 글을 고치지 않는다.
      expect((container.querySelector('[data-note-line="b1"]') as HTMLElement).textContent).toBe('이 페이지는 페이지다');

      search(container, '');
      await waitFor(() => expect(shelf.get('mf-note-find')).toBeUndefined());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── 링크 판 · 넣은 뒤의 캐럿 · 목록의 방향키(제보 3·4·5) ────────────────────
describe('공책 — 링크 판과 넣기 뒤의 캐럿', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  const DOC = {
    ...NOTE,
    pages: [{ id: 'p1', title: '장', blocks: [
      { id: 'lk', kind: 'p', runs: [{ t: '앞 ', b: false, c: null }, { t: '링크글', b: false, c: null, href: 'https://example.com/go' }, { t: ' 뒤', b: false, c: null }] },
      { id: 'b1', kind: 'p', runs: [{ t: '', b: false, c: null }] },
    ] }],
  };

  /** 그 링크 스팬을 통째로 고른다 — 사람이 끌어서 고른 것과 같은 상태. */
  function selectLink(container: HTMLElement): void {
    const span = container.querySelector('[data-note-line="lk"] [data-href]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('링크 글을 고르면 **주소·이동·삭제** 판이 뜬다(요청 3)', async () => {
    localStorage.setItem('mindflow_doc_lp1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lp1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="lk"] [data-href]')).toBeTruthy());

    selectLink(container);
    await waitFor(() => expect(container.querySelector('[data-note-linkpop]')).toBeTruthy());
    const pop = container.querySelector('[data-note-linkpop]') as HTMLElement;
    expect(pop.textContent).toContain('example.com/go');
    expect(pop.querySelector('[data-note-linkpop-open]')).toBeTruthy();
    expect(pop.querySelector('[data-note-linkpop-remove]')).toBeTruthy();
  });

  it('「링크 삭제」는 **링크만** 뗀다 — 글도 다른 서식도 그대로', async () => {
    localStorage.setItem('mindflow_doc_lp2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lp2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="lk"] [data-href]')).toBeTruthy());

    selectLink(container);
    await waitFor(() => expect(container.querySelector('[data-note-linkpop-remove]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-linkpop-remove]')!);

    await waitFor(() => expect(container.querySelector('[data-note-line="lk"] [data-href]')).toBeNull());
    expect((container.querySelector('[data-note-line="lk"] ') as HTMLElement).textContent).toBe('앞 링크글 뒤');
    // 저장본은 **한 번 찍고 폴링**한다(`probe-pitfalls` F8·F10) — ⌘S는 200ms 뒤에
    // 실제로 쓰므로, 폴링 안에서 다시 누르면 그 타이머를 매번 꺼 영영 저장되지 않는다.
    saveNow();
    await waitFor(() => expect(JSON.stringify(saved('lp2').pages[0].blocks[0].runs)).not.toContain('href'));
    expect(runsOf(saved('lp2').pages[0].blocks[0])).toBe('앞 링크글 뒤');
  });

  it('「이동」은 새 창으로 연다', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.setItem('mindflow_doc_lp3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lp3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="lk"] [data-href]')).toBeTruthy());

    selectLink(container);
    await waitFor(() => expect(container.querySelector('[data-note-linkpop-open]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-note-linkpop-open]')!);
    expect(open).toHaveBeenCalledWith('https://example.com/go', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('`/` 목록의 활성은 **마우스를 움직였을 때만** 따라온다(제보 5)', async () => {
    localStorage.setItem('mindflow_doc_lp4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=lp4&title=x');
    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    fireEvent.keyDown(line, { key: '/' });
    type(line, '/제목');
    await waitFor(() => expect(container.querySelectorAll('[data-note-slash-item]')).toHaveLength(3));
    const items = () => [...container.querySelectorAll('[data-note-slash-item]')];
    const activeAt = () => items().findIndex((e) => e.getAttribute('aria-selected') === 'true');
    expect(activeAt()).toBe(0);

    // 포인터가 목록 위에 **얹혀만** 있는 것은 고르는 일이 아니다 — 목록이 캐럿 아래
    // 뜨므로 브라우저가 `mouseenter`를 쏘는 일이 잦고, 그것이 방향키와 겹쳤다.
    fireEvent.mouseEnter(items()[2]!);
    expect(activeAt()).toBe(0);

    // 진짜로 움직이면 따라온다.
    fireEvent.mouseMove(items()[2]!);
    await waitFor(() => expect(activeAt()).toBe(2));
  });
});
