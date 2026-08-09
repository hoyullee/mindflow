import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import type { Backend, DocStore, ShareStore } from '../../adapters/ports';

// 댓글(0020) — 주제에 붙는 논의. 본문이 아니라 별도 저장소(`CommentStore`)에 산다.
// 로컬/데모 어댑터가 Supabase와 같은 포트를 구현하므로 흐름은 여기서 그대로 검증된다.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트 주제', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '자식 주제', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

const MY_EMAIL = 'me@example.com';

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

/** 보기 메뉴 → 댓글. */
async function openCommentsViaMenu(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: '보기' }));
  fireEvent.click(await screen.findByRole('button', { name: '댓글' }));
  return await screen.findByLabelText('댓글');
}

function seedComment(documentId: string, nodeId: string, body: string, extra?: Record<string, unknown>): void {
  const list = JSON.parse(localStorage.getItem('mf_comments') || '[]') as unknown[];
  list.push({ id: `c${list.length + 1}`, documentId, nodeId, authorName: '나', body, createdAt: new Date().toISOString(), ...extra });
  localStorage.setItem('mf_comments', JSON.stringify(list));
}

function storedComments(): { id: string; nodeId: string; parentId?: string | null; body: string; resolvedAt?: string | null; mentions?: { email: string; name: string }[] }[] {
  return JSON.parse(localStorage.getItem('mf_comments') || '[]');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: MY_EMAIL } }));
});
afterEach(() => cleanup());

describe('주제 댓글', () => {
  it('보기 메뉴에서 열어 댓글을 남기면 목록에 뜨고 저장된다', async () => {
    localStorage.setItem('mindflow_doc_cm1', JSON.stringify(DOC));
    renderEditor('/editor?map=cm1&title=x');
    const panel = await openCommentsViaMenu();
    // 대상은 기본적으로 루트 주제.
    expect(within(panel).getByText('루트 주제')).toBeTruthy();
    expect(within(panel).getByText(/아직 댓글이 없어요/)).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText('댓글 입력'), { target: { value: '여기 정리가 필요해요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));

    await waitFor(() => expect(within(panel).getByText('여기 정리가 필요해요')).toBeTruthy());
    const stored = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { documentId: string; nodeId: string; body: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ documentId: 'cm1', nodeId: 'root', body: '여기 정리가 필요해요' });
  });

  it('내 댓글은 지울 수 있다', async () => {
    localStorage.setItem('mindflow_doc_cm2', JSON.stringify(DOC));
    seedComment('cm2', 'root', '지울 댓글');
    renderEditor('/editor?map=cm2&title=x');
    const panel = await openCommentsViaMenu();
    await waitFor(() => expect(within(panel).getByText('지울 댓글')).toBeTruthy());
    fireEvent.click(within(panel).getByRole('button', { name: '댓글 삭제' }));
    await waitFor(() => expect(within(panel).queryByText('지울 댓글')).toBeNull());
    expect(JSON.parse(localStorage.getItem('mf_comments') || '[]')).toHaveLength(0);
  });

  it('댓글이 달린 주제에 배지가 뜨고, 누르면 그 주제의 댓글이 열린다', async () => {
    localStorage.setItem('mindflow_doc_cm3', JSON.stringify(DOC));
    seedComment('cm3', 'c1', '자식에 남긴 말');
    seedComment('cm3', 'c1', '하나 더');
    renderEditor('/editor?map=cm3&title=x');
    // 댓글이 없는 루트에는 배지가 없다 — 배지는 논의가 있는 주제만 가리킨다.
    const badge = await screen.findByLabelText('댓글 2개');
    expect(badge.getAttribute('data-comment-badge')).toBe('c1');
    expect(screen.queryByLabelText('댓글 1개')).toBeNull();

    fireEvent.click(badge);
    const panel = await screen.findByLabelText('댓글');
    expect(within(panel).getByText('자식 주제')).toBeTruthy();
    expect(within(panel).getByText('자식에 남긴 말')).toBeTruthy();
  });

  it('답글이 스레드 아래에 달리고 parentId로 저장된다', async () => {
    localStorage.setItem('mindflow_doc_cm5', JSON.stringify(DOC));
    seedComment('cm5', 'root', '뿌리 댓글');
    renderEditor('/editor?map=cm5&title=x');
    const panel = await openCommentsViaMenu();
    await waitFor(() => expect(within(panel).getByText('뿌리 댓글')).toBeTruthy());

    fireEvent.click(within(panel).getByRole('button', { name: '답글' }));
    const replyBox = within(panel).getByLabelText('답글 입력');
    fireEvent.change(replyBox, { target: { value: '답글이에요' } });
    fireEvent.keyDown(replyBox, { key: 'Enter', ctrlKey: true }); // 등록 = Ctrl+Enter

    await waitFor(() => expect(within(panel).getByText('답글이에요')).toBeTruthy());
    const stored = storedComments();
    expect(stored).toHaveLength(2);
    expect(stored[1]!.parentId).toBe(stored[0]!.id);
  });

  it('해결 표시 — 스레드가 접힌 구획으로 내려가고 배지에서 빠진다, 다시 열기로 복귀', async () => {
    localStorage.setItem('mindflow_doc_cm6', JSON.stringify(DOC));
    seedComment('cm6', 'c1', '해결할 논의');
    renderEditor('/editor?map=cm6&title=x');
    // 배지 1 → 해결하면 사라진다(배지 = 미해결 스레드).
    await screen.findByLabelText('댓글 1개');
    fireEvent.click(screen.getByLabelText('댓글 1개'));
    const panel = await screen.findByLabelText('댓글');
    await waitFor(() => expect(within(panel).getByText('해결할 논의')).toBeTruthy());

    fireEvent.click(within(panel).getByTitle('해결됨으로 표시'));
    await waitFor(() => expect(within(panel).getByText(/해결된 스레드 1개/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByLabelText('댓글 1개')).toBeNull());
    expect(storedComments()[0]!.resolvedAt).toBeTruthy();

    // 접힌 구획을 펼치면 "해결됨 · 이름"이 보이고, 다시 열면 배지가 돌아온다.
    fireEvent.click(within(panel).getByText(/해결된 스레드 1개/));
    await waitFor(() => expect(within(panel).getByText(/해결됨 · /)).toBeTruthy());
    fireEvent.click(within(panel).getByRole('button', { name: '다시 열기' }));
    await waitFor(() => expect(screen.getByLabelText('댓글 1개')).toBeTruthy());
    expect(storedComments()[0]!.resolvedAt).toBeNull();
  });

  it('@ 입력에 참가자 자동완성이 뜨고, 고르면 멘션이 저장·강조된다', async () => {
    localStorage.setItem('mindflow_doc_cm7', JSON.stringify(DOC));
    // 멘션 후보 = 공유 참가자(소유자 + 초대). 초대 한 명을 심는다.
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm7', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm7&title=x');
    const panel = await openCommentsViaMenu();

    const box = within(panel).getByLabelText('댓글 입력') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@fri', selectionStart: 4 } });
    const candidate = await within(panel).findByText('friend@example.com');
    fireEvent.mouseDown(candidate.closest('button')!);
    await waitFor(() => expect(box.value).toContain('@friend'));

    fireEvent.change(box, { target: { value: box.value + ' 확인 부탁해요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));
    await waitFor(() => expect(storedComments()).toHaveLength(1));
    expect(storedComments()[0]!.mentions).toEqual([{ email: 'friend@example.com', name: 'friend' }]);
    // 본문에서 멘션만 강조된다.
    const mark = panel.querySelector('[data-mention]')!;
    expect(mark.textContent).toBe('@friend');
  });

  it('실시간: 다른 곳(다른 탭)의 댓글이 신호를 타고 즉시 나타난다 — 공유된 문서', async () => {
    localStorage.setItem('mindflow_doc_cm8', JSON.stringify(DOC));
    // 실시간 구독은 공유된 문서에서만(혼자 쓰는 문서에는 신호를 보낼 상대가 없다).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm8', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm8&title=x');
    const panel = await openCommentsViaMenu();
    await waitFor(() => expect(within(panel).getByText(/아직 댓글이 없어요/)).toBeTruthy());

    // 다른 탭의 저장소 인스턴스가 댓글을 단다 — BroadcastChannel 신호로 이 화면이
    // 스스로 다시 읽어야 한다(패널을 닫았다 열지 않아도).
    const other = new LocalCommentStore();
    await waitFor(async () => {
      // 구독 effect가 붙기 전의 add는 신호가 유실될 수 있어, 붙을 때까지 재시도.
      if (storedComments().length === 0) await other.add('cm8', 'root', '옆 탭에서 단 댓글');
      expect(within(panel).getByText('옆 탭에서 단 댓글')).toBeTruthy();
    });
  });

  // 노드 우클릭 진입점은 좌표 히트테스트가 필요해 ContextMenu.interactions.test.tsx에서 검증.

  it('알림 딥링크(?comments=<nodeId>)로 열면 그 주제의 댓글 패널이 바로 뜬다', async () => {
    localStorage.setItem('mindflow_doc_cmd1', JSON.stringify(DOC));
    seedComment('cmd1', 'c1', '딥링크 대상 논의');
    renderEditor('/editor?map=cmd1&title=x&comments=c1');
    const panel = await screen.findByLabelText('댓글');
    expect(within(panel).getByText('자식 주제')).toBeTruthy();
    await waitFor(() => expect(within(panel).getByText('딥링크 대상 논의')).toBeTruthy());
  });

  it('다른 주제를 고르면 패널이 따라간다 — 어느 주제의 논의인지 흐려지지 않게', async () => {
    localStorage.setItem('mindflow_doc_cm4', JSON.stringify(DOC));
    renderEditor('/editor?map=cm4&title=x');
    const panel = await openCommentsViaMenu();
    expect(within(panel).getByText('루트 주제')).toBeTruthy();

    const child = await screen.findByText('자식 주제');
    const box = child.closest('[data-node-id]') as HTMLElement;
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
    await waitFor(() => expect(within(panel).getByText('자식 주제')).toBeTruthy());
  });
});

/**
 * 링크 공유(0017)로 연 사람에게는 서버가 댓글을 아예 내주지 않는다(0020의 select
 * 정책 — 링크는 누구에게나 전달될 수 있는데 댓글은 내부 논의다). "열리는 척하다 빈
 * 목록"이 되지 않게 진입점부터 감춘다.
 */
describe('링크로 연 맵', () => {
  function linkViewerBackend(): Backend {
    const local = new LocalDocStore();
    const docStore = {
      ...local,
      list: () => local.list(),
      loadPreview: (id: string) => local.loadPreview(id),
      save: (...a: Parameters<DocStore['save']>) => local.save(...a),
      remove: (id: string) => local.remove(id),
      restore: (id: string) => local.restore(id),
      purge: (id: string) => local.purge(id),
      rename: (id: string, t: string) => local.rename(id, t),
      listEditorNames: () => local.listEditorNames(),
      load: vi.fn(async (id: string) => {
        const res = await local.load(id);
        return res ? { ...res, ownedByMe: false } : null;
      }),
    } as unknown as DocStore;
    // 링크로 들어온 사람에게는 초대 행이 하나도 보이지 않는다(RLS의 결).
    const shareStore = { ...new LocalShareStore(), list: async () => [] } as unknown as ShareStore;
    return { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore, feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
  }

  it('보기 메뉴에 댓글 항목이 없고, 남의 댓글 배지도 뜨지 않는다', async () => {
    localStorage.setItem('mindflow_doc_lk9', JSON.stringify(DOC));
    seedComment('lk9', 'c1', '보이면 안 되는 말');
    render(
      <MemoryRouter initialEntries={['/editor?map=lk9&title=x']}>
        <BackendProvider backend={linkViewerBackend()}>
          <Routes>
            <Route path="/editor" element={<Editor />} />
            <Route path="/home" element={<div>HOME_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText('보기 전용').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(screen.queryByRole('button', { name: '댓글' })).toBeNull();
    await waitFor(() => expect(screen.queryByLabelText('댓글 1개')).toBeNull());
  });
});
