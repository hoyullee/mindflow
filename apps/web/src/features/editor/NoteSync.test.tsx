// 공책의 **기기 간 동기화** — 제보에서 나온 회귀 가드.
//
// 제보한 흐름: 같은 계정으로 **설치형 앱**과 **크롬**에 같은 공책을 열어 각각 고쳤더니
// 서로의 내용이 보이지 않았다. 원인은 둘이다.
//
// ① 공책은 실시간 공동 편집을 붙이지 않기로 한 문서라 **CRDT 바인딩에 페이지가 없다**
//    (코어 `docSyncsViaCrdt`). 그래서 한쪽의 편집이 다른 쪽 화면에 닿을 길이 없었다.
// ② 그런데 저장 쪽은 "협업 중이면 이미 수렴해 있다"고 **가정**해 충돌을 조용히 다시
//    썼다 — 수렴하지 않는 공책에서는 그게 곧 상대 편집을 지우는 일이다.
//
// 규칙: 수렴하지 않는 문서의 충돌은 **진짜 충돌**이다(덮지 않고 알린다, 덮게 될 서버
// 판은 버전 기록에 남긴다). 그리고 내가 쓰고 있지 않을 때는 서버 판을 **다시 읽어**
// 따라잡는다(창 포커스·탭 노출·상대의 저장 신호).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import type { Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { BroadcastChannelProvider } from '../../collab/BroadcastChannelProvider';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalTagStore } from '../../adapters/local/localTagStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { mockMatchMedia } from '../../test/matchMedia';
import type { Backend, DocStore, SaveResult } from '../../adapters/ports';

const CANVAS: Doc = {
  v: 1,
  nodes: { root: { id: 'root', text: '제품 로드맵', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

/** 공책 한 권 — 문단 하나. `text`로 본문을 갈아 서버의 새 판을 만든다. */
function noteDoc(text: string): Doc {
  return {
    ...CANVAS,
    kind: 'note',
    pages: [{ id: 'p1', title: '회의록', blocks: [{ id: 'b1', kind: 'p', runs: [{ t: text, b: false, c: null }] }] }],
    cover: { tag: '회의록' },
  } as Doc;
}

/**
 * 저장·읽기를 들여다볼 수 있는 백엔드. `load`가 돌려줄 값은 테스트가 도중에 바꾼다
 * (= 다른 기기가 저장했다).
 */
function makeBackend(initial: Doc) {
  const server = { doc: initial, version: 1 };
  /** 다음 저장이 어떻게 끝날지 — 테스트가 도중에 바꾼다. */
  const outcome = { mode: 'ok' as 'ok' | 'conflict' | 'error' };
  const save = vi.fn(async (): Promise<SaveResult> => {
    if (outcome.mode === 'conflict') return { ok: false, reason: 'conflict', currentVersion: 7 };
    if (outcome.mode === 'error') return { ok: false, reason: 'error', message: '네트워크' };
    return { ok: true, version: ++server.version };
  });
  const load = vi.fn(async () => ({ doc: server.doc, version: server.version, title: '회의록' }));
  const docStore = {
    list: async () => [],
    load,
    loadPreview: async () => null,
    listEditorNames: async () => ({}),
    setFavorite: async () => undefined,
    remove: async () => undefined,
    restore: async () => undefined,
    purge: async () => undefined,
    rename: async () => undefined,
    save,
  } as unknown as DocStore;
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), tagStore: new LocalTagStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
  /** 다른 기기가 저장했다 — 서버 판을 갈아 끼운다. */
  const serverSaves = (doc: Doc): void => {
    server.doc = doc;
    server.version += 1;
  };
  return { backend, save, load, serverSaves, outcome };
}

function renderEditor(backend: Backend, docId: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor?map=${docId}&title=x`]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
          <Route path="/home" element={<div>HOME_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** 편집 박스에 글을 넣는다 — `contentEditable`이라 `input` 이벤트로 알린다. */
function type(el: Element, text: string): void {
  (el as HTMLElement).innerHTML = text;
  fireEvent.input(el);
}

/** "다른 탭"의 피어 — 같은 방에 붙어 접속자로 보이게 한다(협업 세션 성립). */
function joinPeer(docId: string) {
  const ydoc = new Y.Doc();
  const provider = new BroadcastChannelProvider();
  provider.connect(docId, ydoc);
  provider.getAwareness()?.setLocalStateField('user', { name: '상대', color: '#3f8fd0' });
  return { ydoc, provider };
}

/**
 * 문서가 **정착**하기를 기다린다 — 마운트 시드 → 서버 판 채택까지.
 *
 * 공책 본문은 서버 판이 들어온 뒤에야 그려지므로(마운트 시드는 빈 맵이다) 편집·포커스
 * 계기는 그다음이어야 한다.
 */
async function settled(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy(), { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 200));
  // **정착한 뒤에 잡는다** — 서버 판을 채택하면 본문이 다시 마운트되므로(`docEpoch`),
  // 그전에 잡아 둔 편집 박스는 화면에서 떨어져 나가 타이핑이 아무 데도 닿지 않는다.
  return container.querySelector('[data-note-line="b1"]') as HTMLElement;
}

/** 창이 앞으로 왔다(설치형 앱에서도 오는 계기 — `visibilityState`는 늘 visible이다). */
function focusWindow(): void {
  window.dispatchEvent(new Event('focus'));
}

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia(false);
  vi.useRealTimers();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('공책 — 본문을 고치면 저장이 걸린다', () => {
  /**
   * **이 제보의 뿌리.** "문서가 달라졌나"를 판정하는 서명(`docSignature`)에 공책의
   * `pages`가 빠져 있어서, 본문을 아무리 고쳐도 문서가 `변경됨`이 되지 않았다 —
   * 자동저장이 **한 번도** 걸리지 않고 화면에는 `저장됨`이라고 적혀 있었다. ⌘S·저장
   * 단추·닫기 직전 강제 저장처럼 서명을 보지 않는 경로로만 올라가던 것이라, ⌘S로
   * 확인하는 기존 테스트에서는 드러나지 않았다.
   */
  it('글을 치면 자동저장이 걸리고, 그 본문이 서버로 간다 (제보의 뿌리)', async () => {
    const docId = `note-autosave-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, save } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    const line = await settled(container);
    save.mockClear();

    type(line, '자동저장으로 올라가야 한다');

    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 6000 });
    const sent = (save.mock.calls[0] as unknown as [string, Doc, unknown])[1];
    expect(JSON.stringify(sent.pages)).toContain('자동저장으로 올라가야 한다');
  });

  it('페이지 목록에 손대는 것(표지·쪽 추가)도 저장으로 이어진다', async () => {
    const docId = `note-autosave2-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, save } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    await settled(container);
    save.mockClear();

    fireEvent.click(container.querySelector('[data-note-new-page]') as HTMLElement);

    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 6000 });
    const sent = (save.mock.calls[0] as unknown as [string, Doc, unknown])[1];
    expect((sent.pages ?? []).length).toBe(2);
  });
});

describe('공책 — 저장 충돌은 조용히 덮지 않는다', () => {
  it('실시간이 붙어 있어도 공책의 충돌은 **진짜 충돌**이다 (제보: 서로의 편집이 사라졌다)', async () => {
    const docId = `note-conflict-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, save, outcome } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    const line = await settled(container);

    const peer = joinPeer(docId);
    await waitFor(() => expect(screen.getByLabelText(/명 접속 중/)).toBeTruthy());
    save.mockClear();
    outcome.mode = 'conflict'; // 상대가 방금 먼저 저장했다

    type(line, 'abc');
    // 충돌 한 번으로 멈춘다 — 예전에는 여기서 새 버전 기준으로 **다시 써서**
    // 상대가 저장한 판을 경고도 없이 지웠다.
    await waitFor(() => expect(container.querySelector('[data-note-save-conflict]')).toBeTruthy(), { timeout: 6000 });
    expect(save).toHaveBeenCalledTimes(1);

    peer.provider.disconnect();
    peer.ydoc.destroy();
  });

  it('덮게 될 **서버 판을 버전 기록에 남긴다** — 어느 쪽도 흔적 없이 사라지지 않게', async () => {
    const docId = `note-keep-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, save, serverSaves, outcome } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    const line = await settled(container);
    save.mockClear();

    serverSaves(noteDoc('상대가 쓴 글')); // 다른 기기가 먼저 저장했다
    outcome.mode = 'conflict';
    type(line, 'abc');

    await waitFor(() => expect(localStorage.getItem(`mindflow_hist_${docId}`) ?? '').toContain('상대가 쓴 글'), { timeout: 6000 });
  });
});

describe('공책 — 서버 판을 다시 읽어 따라잡는다', () => {
  it('창이 앞으로 오면 다른 기기가 저장한 판이 화면에 들어온다 (제보의 그 상황)', async () => {
    const docId = `note-refresh-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, serverSaves } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('처음'));
    await settled(container);

    serverSaves(noteDoc('다른 기기에서 쓴 글'));
    focusWindow();

    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('다른 기기에서 쓴 글'));
  });

  it('**못 올린 내 편집이 있으면 읽지 않는다** — 새로고침이 내 글을 덮는 일은 없다', async () => {
    const docId = `note-keepmine-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, serverSaves, outcome } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    const line = await settled(container);

    // 여기서부터 저장이 계속 실패한다 = 내 편집이 서버에 올라가지 못한 상태.
    outcome.mode = 'error';
    type(line, '아직 못 올린 내 글');
    serverSaves(noteDoc('서버의 옛 글'));
    await new Promise((r) => setTimeout(r, 1600)); // 자동저장이 실패까지 가도록
    focusWindow();
    await new Promise((r) => setTimeout(r, 400));

    // 내 글이 그대로다 — 서버 판으로 되돌아가지 않았다.
    expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('아직 못 올린 내 글');
  });

  it('**글을 쓰고 있는 중이면 갈아 끼우지 않는다** — 돌아올 때마다 깜빡이고 커서가 풀렸다(제보)', async () => {
    const docId = `note-typing-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, serverSaves } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    const line = await settled(container);

    /**
     * 저장까지 **끝난** 상태에서 커서만 본문에 둔다 — 위의 두 방어(못 올린 편집이
     * 있는가 · 보낼 것이 남았는가)는 여기서 전부 통과한다. 그런데도 갈아 끼우면
     * 편집 박스가 다시 그려져 초점과 캐럿이 사라진다(제보의 그 자리).
     */
    line.focus();
    // jsdom에서도 `contentEditable` 박스는 초점을 받는다 — 그 상태가 이 판의 전제다.
    expect(document.activeElement?.closest('[contenteditable="true"]')).toBeTruthy();

    serverSaves(noteDoc('다른 기기에서 쓴 글'));
    focusWindow();
    await new Promise((r) => setTimeout(r, 500));

    // 화면은 그대로다 — 미룬 것이지 버린 것이 아니다(초점도 편집 박스에 남아 있다).
    expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('처음');
    expect(document.activeElement?.closest('[contenteditable="true"]')).toBeTruthy();

    // **초점을 놓으면 그때 받는다** — 다음 계기까지 미뤘을 뿐이다.
    (document.activeElement as HTMLElement | null)?.blur();
    focusWindow();
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('다른 기기에서 쓴 글'), { timeout: 4000 });
  });

  it('**상대가 저장했다는 신호**만으로도 따라잡는다 — 창을 옮기지 않아도(나란히 놓고 쓸 때)', async () => {
    const docId = `note-nudge-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('처음')));
    const { backend, serverSaves } = makeBackend(noteDoc('처음'));
    const { container } = renderEditor(backend, docId);
    await settled(container);

    const peer = joinPeer(docId);
    await waitFor(() => expect(screen.getByLabelText(/명 접속 중/)).toBeTruthy());

    serverSaves(noteDoc('옆 창에서 쓴 글'));
    // 상대가 "v99까지 올렸다"고 알린다 — 커서·선택과 같은 awareness 통로다.
    peer.provider.getAwareness()?.setLocalStateField('saved', { v: 99 });

    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('옆 창에서 쓴 글'), { timeout: 6000 });
    peer.provider.disconnect();
    peer.ydoc.destroy();
  });
});

describe('캔버스 문서는 이 경로를 타지 않는다', () => {
  it('맵은 창 포커스로 서버를 다시 읽지 않는다 — 수렴은 CRDT가 맡는다', async () => {
    const docId = `map-norefresh-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(CANVAS));
    const { backend, load } = makeBackend(CANVAS);
    renderEditor(backend, docId);
    await waitFor(() => expect(load).toHaveBeenCalled());
    const before = load.mock.calls.length;

    focusWindow();
    await new Promise((r) => setTimeout(r, 400));
    expect(load.mock.calls.length).toBe(before);
  });
});

describe('공책 — 서버 판을 채택해도 **커서는 남는다**', () => {
  /**
   * 제보: 본문에 처음 커서를 놓으면 잠깐 켜졌다 꺼지고, 다시 눌러야 켜진다.
   *
   * 원인은 채택이다 — 저장소에서 문서를 뒤늦게 받아 갈아 끼우면 본문이 **통째로 다시
   * 마운트된다**(`docEpoch`: 비제어 편집 박스가 새 글을 그려야 한다). 그 사이에 놓아
   * 둔 캐럿은 함께 사라졌다(두 번째 클릭은 채택이 끝난 뒤라 멀쩡했다).
   */
  it('채택으로 본문이 다시 그려져도 캐럿이 그 줄에 돌아온다', async () => {
    const docId = `note-caret-${Math.random()}`;
    // 이 기기에는 옛 판이 있고(바로 그려진다), 서버에는 **다른 판**이 있다 → 채택이 일어난다.
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(noteDoc('로컬 판입니다')));
    const { backend, load } = makeBackend(noteDoc('로컬 판입니다'));
    // 읽기를 **늦춘다** — 실제로도 서버는 한 박자 뒤에 오고, 사용자는 그 사이에
    // 캐럿을 놓는다(그 틈이 바로 이 제보의 자리다).
    load.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { doc: noteDoc('서버 판입니다'), version: 2, title: '회의록' };
    });
    const { container } = renderEditor(backend, docId);

    const line = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    expect(line.textContent).toBe('로컬 판입니다'); // 아직 채택 전이다
    // 사용자가 채택 **전에** 캐럿을 놓는다.
    line.focus();
    const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(document.activeElement).toBe(line);

    // 채택이 끝나 본문이 다시 그려진다.
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')?.textContent).toBe('서버 판입니다'), { timeout: 6000 });

    // 캐럿이 **그 줄로 돌아온다**(그 자리까지).
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note-line')).toBe('b1'));
    const now = window.getSelection();
    expect(now?.focusNode && container.contains(now.focusNode)).toBe(true);
    expect(now?.focusOffset).toBe(3);
  });
});
