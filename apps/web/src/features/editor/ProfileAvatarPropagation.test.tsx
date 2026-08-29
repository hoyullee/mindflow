// 프로필 이미지가 에디터에서 쓰이는 자리에 반영되는가(0031).
//
// 사진의 출처는 **참가자 목록**(`share_participants` → `ShareStore.listParticipants`)이다:
// 칸반 담당은 이메일로, 댓글 작성자는 계정 id로 잇는다. 이름은 스냅샷(0020)이지만
// 사진은 조인이라 바꾸면 옛 댓글에도 반영된다 — 그 규칙을 여기서 못박는다.
// (접속자 아바타는 awareness로 오므로 `Editor.presence.test.tsx`가 덮는다.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import type { Backend, ShareParticipant } from '../../adapters/ports';
import { mockMatchMedia } from '../../test/matchMedia';

const ME = 'me@example.com';
const PHOTO = 'https://cdn.example.com/me.webp';

const PARTICIPANTS: ShareParticipant[] = [
  { kind: 'owner', email: ME, displayName: '호율', joined: true, role: 'edit', avatarUrl: PHOTO, userId: 'u-me' },
  { kind: 'invitee', email: 'friend@example.com', displayName: '민호', joined: true, role: 'edit', avatarUrl: null, userId: 'u-friend' },
];

function backendWith(participants: ShareParticipant[]): Backend {
  const shareStore = new LocalShareStore();
  vi.spyOn(shareStore, 'listParticipants').mockResolvedValue(participants);
  return {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore,
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(),
    mode: 'local',
  };
}

function renderEditor(entry: string, backend: Backend) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
          <Route path="/home" element={<div>HOME_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

const KANBAN = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'kanban',
  columns: [{ id: 'c1', title: '할 일' }],
  cards: [
    { id: 'k1', col: 'c1', pos: 0, text: '사진 있는 담당', owner: ME, ownerName: '호율' },
    { id: 'k2', col: 'c1', pos: 1024, text: '사진 없는 담당', owner: 'friend@example.com', ownerName: '민호' },
  ],
};

const MAP = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
  commentPins: [{ id: 'p1', x: 40, y: 40 }],
};

/** jsdom엔 PointerEvent가 없다 — 좌표·버튼이 실리는 MouseEvent로 흉내낸다. */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointerup', init: { clientX?: number; clientY?: number } = {}): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  fireEvent(target, ev);
}

/** 핀을 여는 실제 순서 — 선택은 pointerdown이, 팝업 열기는 click이 한다. */
function openPin(pin: HTMLElement): void {
  firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
  firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
  fireEvent.click(pin);
}

describe('프로필 이미지 반영(에디터)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u-me', email: ME, avatarUrl: PHOTO } }));
  });
  afterEach(cleanup);

  it('칸반 담당 얼굴 — 사진이 있으면 그 사진, 없으면 이름 첫 글자', async () => {
    localStorage.setItem('mindflow_doc_kbav', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kbav&title=x', backendWith(PARTICIPANTS));
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2));

    const face = (id: string) => container.querySelector(`[data-kanban-card="${id}"] [data-avatar]`) as HTMLElement;
    await waitFor(() => expect(face('k1').querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());
    // 첫 글자는 **아래에 남는다** — 주소가 죽으면 깜빡임 없이 그대로 폴백한다.
    expect(face('k1').textContent?.trim()).toBeTruthy();
    expect(face('k2').querySelector('img')).toBeNull();
  });

  it('댓글 — 작성자 얼굴은 참가자 목록의 지금 사진(이름은 스냅샷)', async () => {
    localStorage.setItem('mindflow_doc_cmav', JSON.stringify(MAP));
    const backend = backendWith(PARTICIPANTS);
    // 작성자 = 나(로컬 어댑터는 uuid를 남기지 않으므로 목록에 직접 심는다).
    vi.spyOn(backend.commentStore, 'list').mockResolvedValue([
      // 내 글 — 사진은 세션에서 바로 온다(참가자 목록은 나를 빼고 온다).
      { id: 'c1', nodeId: 'p1', parentId: null, authorName: '옛 이름', authorId: 'u-me', mine: true, body: '한 마디', createdAt: new Date().toISOString(), resolved: false, resolvedByName: null, likes: 0, likedByMe: false, mentions: [] },
      // 남의 글 — 참가자 목록의 계정 id로 그 사람의 지금 사진을 찾는다.
      { id: 'c2', nodeId: 'p1', parentId: 'c1', authorName: '민호', authorId: 'u-friend', mine: false, body: '답글', createdAt: new Date().toISOString(), resolved: false, resolvedByName: null, likes: 0, likedByMe: false, mentions: [] },
    ]);
    const { container } = renderEditor('/editor?map=cmav&title=x', backend);
    await waitFor(() => expect(container.querySelector('.mf-ed-vp')).toBeTruthy());
    const pin = await waitFor(() => container.querySelector('[data-comment-pin="p1"]') as HTMLElement);
    openPin(pin);
    const mineRow = await waitFor(() => document.querySelector('[data-comment-item="c1"] [data-comment-avatar]') as HTMLElement);
    await waitFor(() => expect(mineRow.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());
    // 이름은 스냅샷 그대로 — 사진만 지금 것이다.
    expect(document.querySelector('[data-comment-item="c1"]')?.textContent).toContain('옛 이름');

    // 남의 글: 참가자 목록에 사진이 없으면 첫 글자 그대로.
    const other = document.querySelector('[data-comment-item="c2"] [data-comment-avatar]') as HTMLElement;
    expect(other.querySelector('img')).toBeNull();
  });

  it('남의 글도 참가자 목록에 사진이 있으면 그 사진을 그린다', async () => {
    localStorage.setItem('mindflow_doc_cmoth', JSON.stringify(MAP));
    const backend = backendWith([
      PARTICIPANTS[0] as ShareParticipant,
      { kind: 'invitee', email: 'friend@example.com', displayName: '민호', joined: true, role: 'edit', avatarUrl: 'https://cdn.example.com/friend.webp', userId: 'u-friend' },
    ]);
    vi.spyOn(backend.commentStore, 'list').mockResolvedValue([
      { id: 'c9', nodeId: 'p1', parentId: null, authorName: '민호', authorId: 'u-friend', mine: false, body: '남의 글', createdAt: new Date().toISOString(), resolved: false, resolvedByName: null, likes: 0, likedByMe: false, mentions: [] },
    ]);
    const { container } = renderEditor('/editor?map=cmoth&title=x', backend);
    const pin = await waitFor(() => container.querySelector('[data-comment-pin="p1"]') as HTMLElement);
    openPin(pin);
    const row = await waitFor(() => document.querySelector('[data-comment-item="c9"] [data-comment-avatar]') as HTMLElement);
    await waitFor(() => expect(row.querySelector('img[src="https://cdn.example.com/friend.webp"]')).toBeTruthy());
  });

  it('댓글 작성창의 내 얼굴에도 내 사진이 그려진다', async () => {
    localStorage.setItem('mindflow_doc_cmme', JSON.stringify(MAP));
    const backend = backendWith(PARTICIPANTS);
    // 핀은 글이 하나라도 있어야 남는다(빈 핀은 정리된다) — 그 글을 심어 둔다.
    vi.spyOn(backend.commentStore, 'list').mockResolvedValue([
      { id: 'c1', nodeId: 'p1', parentId: null, authorName: '호율', authorId: 'u-me', mine: true, body: '한 마디', createdAt: new Date().toISOString(), resolved: false, resolvedByName: null, likes: 0, likedByMe: false, mentions: [] },
    ]);
    const { container } = renderEditor('/editor?map=cmme&title=x', backend);
    const pin = await waitFor(() => container.querySelector('[data-comment-pin="p1"]') as HTMLElement);
    openPin(pin);
    await waitFor(() => expect(screen.getByPlaceholderText(/남기기/)).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll(`img[src="${PHOTO}"]`).length).toBeGreaterThan(0));
  });

  it('핀 얼굴 — 첫 글을 쓴 사람의 사진', async () => {
    localStorage.setItem('mindflow_doc_pinav', JSON.stringify(MAP));
    const backend = backendWith(PARTICIPANTS);
    vi.spyOn(backend.commentStore, 'list').mockResolvedValue([
      { id: 'c1', nodeId: 'p1', parentId: null, authorName: '호율', authorId: 'u-me', mine: true, body: '첫 글', createdAt: new Date().toISOString(), resolved: false, resolvedByName: null, likes: 0, likedByMe: false, mentions: [] },
    ]);
    const { container } = renderEditor('/editor?map=pinav&title=x', backend);
    const pin = await waitFor(() => container.querySelector('[data-comment-pin="p1"]') as HTMLElement);
    await waitFor(() => expect(pin.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());
  });

  it('칸반 리스트·타임라인·필터 칩의 담당 얼굴에도 같은 사진', async () => {
    localStorage.setItem('mindflow_doc_kbviews', JSON.stringify({ ...KANBAN, cards: [{ ...KANBAN.cards[0], due: '2030-01-02' }] }));
    const { container } = renderEditor('/editor?map=kbviews&title=x', backendWith(PARTICIPANTS));
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(1));

    // 필터 패널의 담당 칩
    fireEvent.click(screen.getByRole('button', { name: /필터/ }));
    // 필터 패널은 포털로 body 밑에 그려진다(Radix Popover).
    const chip = await waitFor(() => document.querySelector('[data-filter-owner] [data-avatar]') as HTMLElement);
    await waitFor(() => expect(chip.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /필터/ }));

    // 리스트 보기
    fireEvent.click(container.querySelector('[data-kanban-tab="list"]') as HTMLElement);
    const listView = await waitFor(() => container.querySelector('[data-kanban-list-view]') as HTMLElement);
    await waitFor(() => expect(listView.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());

    // 타임라인 보기 — 막대 안의 얼굴
    fireEvent.click(container.querySelector('[data-kanban-tab="timeline"]') as HTMLElement);
    const timeline = await waitFor(() => container.querySelector('[data-kanban-timeline]') as HTMLElement);
    await waitFor(() => expect(timeline.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy());
  });
});
