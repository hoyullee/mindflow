// Editor-level presence (awareness) integration test — a REMOTE peer (its own
// Y.Doc + `BroadcastChannelProvider` connected to the same document id,
// modelling "another browser tab", exactly like `Editor.collab.test.tsx`
// does for document sync) announces a cursor + a node selection, and the
// open `<Editor>` renders that peer's presence bar avatar + remote cursor +
// selection highlight — all without touching the document itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { docToYDoc, type Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { BroadcastChannelProvider } from '../../collab/BroadcastChannelProvider';

const DOC: Doc = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Editor presence (multi-user awareness)', () => {
  it('shows nothing peer-related when opened solo (single-user, no-op)', async () => {
    const docId = `presence-solo-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);

    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    expect(screen.queryByLabelText(/명 접속 중/)).toBeNull();
  });

  it("renders a remote peer's presence avatar, cursor, and node-selection highlight", async () => {
    const docId = `presence-multi-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    // "Another browser tab" for the same document, joined to the same
    // BroadcastChannel room the editor's `useYjsDocSync`/awareness connected.
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, docToYDoc(DOC));
    const remoteAwareness = remoteProvider.getAwareness()!;

    remoteAwareness.setLocalState({
      user: { name: '차분한 수달', color: '#3f8fd0' },
      cursor: { x: 40, y: -30 },
      selection: { nodes: ['c1'], floats: [], lines: [], zones: [] },
    });

    // 얼굴은 상단 바에 겹쳐 선다(디자인 원본) — 접근 이름이 인원수를 말한다.
    await waitFor(() => expect(screen.getByLabelText('1명 접속 중')).toBeTruthy());
    // the remote peer's name tag (NodeLayer's `RemotePeerTag`) shows up near the selected node.
    await waitFor(() => expect(within(getViewport(container)).getAllByText('차분한 수달').length).toBeGreaterThan(0));

    // 얼굴은 **상단 바 안**에 겹쳐 선다(디자인 원본) — 캔버스 위 알약이 아니다.
    const avatars = screen.getByLabelText('1명 접속 중');
    expect(avatars.closest('.mf-ed-topbar')).toBeTruthy();
    expect(getComputedStyle(avatars).position).not.toBe('absolute');

    remoteProvider.disconnect();
    await waitFor(() => expect(screen.queryByLabelText(/명 접속 중/)).toBeNull());
  });

  it('상대의 프로필 이미지가 접속자 얼굴에 그려진다(0031) — 없으면 이름 첫 글자', async () => {
    const docId = `presence-avatar-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, docToYDoc(DOC));
    const remoteAwareness = remoteProvider.getAwareness()!;
    remoteAwareness.setLocalState({
      // 사진 주소는 awareness로 함께 온다(서버에 다시 묻지 않는다).
      user: { name: '호율', color: '#3f8fd0', authed: true, avatar: 'https://cdn.example.com/me.webp' },
      cursor: null,
      selection: { nodes: [], floats: [], lines: [], zones: [] },
    });

    const bar = await waitFor(() => screen.getByLabelText('1명 접속 중'));
    await waitFor(() => expect(bar.querySelector('img[src="https://cdn.example.com/me.webp"]')).toBeTruthy());
    // 첫 글자는 **아래에 남아 있다** — 주소가 죽으면 깜빡임 없이 그대로 폴백한다.
    expect(bar.textContent).toContain('호');

    remoteAwareness.setLocalState({
      user: { name: '민호', color: '#8a6bd1' },
      cursor: null,
      selection: { nodes: [], floats: [], lines: [], zones: [] },
    });
    await waitFor(() => expect(screen.getByLabelText('1명 접속 중').querySelector('img')).toBeNull());
    remoteProvider.disconnect();
  });
});
