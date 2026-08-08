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

function seedComment(documentId: string, nodeId: string, body: string): void {
  const list = JSON.parse(localStorage.getItem('mf_comments') || '[]') as unknown[];
  list.push({ id: `c${list.length + 1}`, documentId, nodeId, authorName: '나', body, createdAt: new Date().toISOString() });
  localStorage.setItem('mf_comments', JSON.stringify(list));
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
    return { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore, feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), mode: 'supabase' };
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
