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

// 보기 전용 공유(#22) — `document_shares`의 내 행이 'view'면 에디터가 읽기
// 전용으로 열린다. 로컬 모드에서도 같은 판별 경로(`LocalShareStore.list`)를
// 쓰므로, 데모 세션 이메일로 초대 행을 심어 재현한다.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '자식', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

const MY_EMAIL = 'viewer@example.com';

function seedShare(mapId: string, role: 'edit' | 'view'): void {
  localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: mapId, email: MY_EMAIL, role, createdAt: new Date().toISOString() }]));
}

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

function selectNodeBox(el: HTMLElement): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

async function waitReadOnly(): Promise<void> {
  // 배지와 데스크톱 범례("보기 전용 맵 · …")가 함께 뜬다 — 둘 다 정상.
  await waitFor(() => expect(screen.getAllByText('보기 전용').length).toBeGreaterThan(0));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: MY_EMAIL } }));
});
afterEach(() => cleanup());

describe('보기 전용 에디터', () => {
  it('view 초대면 편집·삽입·스타일·내보내기가 사라지고 "보기 전용" 배지가 뜬다 (보기·검색·공유는 유지)', async () => {
    localStorage.setItem('mindflow_doc_ro1', JSON.stringify(DOC));
    seedShare('ro1', 'view');
    renderEditor('/editor?map=ro1&title=x');
    await waitReadOnly();
    expect(screen.queryByRole('button', { name: '편집' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    expect(screen.queryByRole('button', { name: '스타일' })).toBeNull();
    expect(screen.getByRole('button', { name: '보기' })).toBeTruthy();
    // 내보내기도 감춘다(요청) — 보기 전용은 "할 수 없는 것은 보이지 않는다"로 일관.
    // 보안 경계는 아니다(화면을 볼 수 있으면 캡처할 수 있다) — 정책·마찰 장치다.
    expect(screen.queryByRole('button', { name: '내보내기' })).toBeNull();
    expect(screen.getByRole('button', { name: '맵에서 검색' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '공유' })).toBeTruthy();
  });

  it('더블클릭해도 편집 세션이 열리지 않고, Delete로 지워지지 않는다', async () => {
    localStorage.setItem('mindflow_doc_ro2', JSON.stringify(DOC));
    seedShare('ro2', 'view');
    const { container } = renderEditor('/editor?map=ro2&title=x');
    await waitReadOnly();
    const node = container.querySelector('[data-node-id="c1"]') as HTMLElement;
    fireEvent.doubleClick(node);
    expect(container.querySelector('.mf-richedit')).toBeNull();
    selectNodeBox(node);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(container.querySelector('[data-node-id="c1"]')).toBeTruthy();
  });

  it('우클릭 메뉴가 열리지 않고 속성 패널도 뜨지 않는다 (선택 자체는 된다)', async () => {
    localStorage.setItem('mindflow_doc_ro3', JSON.stringify(DOC));
    seedShare('ro3', 'view');
    const { container } = renderEditor('/editor?map=ro3&title=x');
    await waitReadOnly();
    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    fireEvent.contextMenu(vp, { clientX: 300, clientY: 300, button: 2 });
    expect(container.querySelector('.mf-ctx')).toBeNull();
    selectNodeBox(container.querySelector('[data-node-id="c1"]') as HTMLElement);
    expect(screen.queryByText('선택한 주제')).toBeNull();
  });

  it('edit 초대는 기존 그대로다 — 편집 메뉴가 있고 더블클릭 편집이 열린다 (무회귀)', async () => {
    localStorage.setItem('mindflow_doc_ro4', JSON.stringify(DOC));
    seedShare('ro4', 'edit');
    const { container } = renderEditor('/editor?map=ro4&title=x');
    // 판별(비동기)이 끝난 뒤에도 edit면 아무것도 달라지지 않는다.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByText('보기 전용').length).toBe(0);
    expect(screen.getByRole('button', { name: '편집' })).toBeTruthy();
    fireEvent.doubleClick(container.querySelector('[data-node-id="c1"]')!);
    expect(container.querySelector('.mf-richedit')).toBeTruthy();
  });
});

/**
 * 링크 공유(0017)로 남의 맵을 연 사람.
 *
 * 초대 목록에는 자기 행이 **없다** — 소유자도 자기 행이 없으므로 목록만으로는 둘이
 * 구별되지 않는다. 그 구별을 만드는 게 `load()`가 실어 주는 `ownedByMe`다. 이게
 * 없으면 뷰어에게 편집 UI를 내주고 저장만 서버(RLS)에 거부당하는 화면이 된다.
 */
describe('링크로 연 맵 (보기 전용)', () => {
  function backendWith(ownedByMe: boolean | undefined): Backend {
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
        return res ? { ...res, ownedByMe } : null;
      }),
    } as unknown as DocStore;
    // 링크로 들어온 사람에게는 초대 행이 하나도 보이지 않는다(RLS의 결).
    // 클래스 인스턴스를 스프레드하면 프로토타입 메서드가 통째로 빠진다
    // (`listParticipants` 등) — 덮어쓸 것만 얹는다.
    const shareStore = Object.assign(new LocalShareStore(), { list: async () => [] }) as unknown as ShareStore;
    return { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore, feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
  }

  function renderWith(backend: Backend, entry: string) {
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

  it('내 문서가 아닌데 초대 행도 없으면 = 링크로 열었다 → 보기 전용', async () => {
    localStorage.setItem('mindflow_doc_lk1', JSON.stringify(DOC));
    renderWith(backendWith(false), '/editor?map=lk1&title=x');
    await waitReadOnly();
    expect(screen.queryByRole('button', { name: '편집' })).toBeNull();
  });

  it('내 문서면 그대로 편집할 수 있다 (무회귀)', async () => {
    localStorage.setItem('mindflow_doc_lk2', JSON.stringify(DOC));
    renderWith(backendWith(true), '/editor?map=lk2&title=x');
    await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy());
    expect(screen.queryByText('보기 전용')).toBeNull();
  });

  it('소유 여부를 모르는 백엔드(로컬/데모)는 기존 동작을 유지한다', async () => {
    localStorage.setItem('mindflow_doc_lk3', JSON.stringify(DOC));
    renderWith(backendWith(undefined), '/editor?map=lk3&title=x');
    await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy());
  });
});

/**
 * 보기 전용으로 들어온 사람의 **공유 팝업**(제보).
 *
 * 배포 후 확인에서 링크 뷰어에게 링크 토글과 초대 입력이 그대로 열려 있었고 소유자도
 * 보이지 않았다. 서버 원인은 `share_participants` RPC의 가드였고(0018이 고침 — 링크
 * 뷰어는 소유자도 초대받은 사람도 아니라 빈 목록이 왔고, 그러면 클라이언트가 "구
 * 서버"로 착각해 나를 소유자로 폴백했다), 여기서는 그것과 무관하게 성립하는 신호
 * (`readOnly`)로도 잠기는지 본다.
 */
describe('보기 전용 사용자의 공유 팝업', () => {
  const OWNER_EMAIL = 'owner@example.com';

  function seedParticipants(mapId: string, withOwner: boolean) {
    const shareStore = {
      ...new LocalShareStore(),
      list: async () => [{ documentId: mapId, email: MY_EMAIL, role: 'view' as const, createdAt: '2026-01-01T00:00:00.000Z' }],
      listParticipants: async () =>
        withOwner
          ? [
              { kind: 'owner' as const, email: OWNER_EMAIL, displayName: '맵 주인', joined: true, role: 'edit' as const },
              { kind: 'invitee' as const, email: MY_EMAIL, displayName: null, joined: true, role: 'view' as const },
            ]
          : [],
      getLink: async () => 'view' as const,
      setLink: vi.fn(async () => ({})),
    } as unknown as ShareStore;
    const backend: Backend = {
      auth: new LocalAuth(),
      docStore: new LocalDocStore(),
      spaceStore: new LocalSpaceStore(),
      shareStore,
      feedbackStore: new LocalFeedbackStore(),
      imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(),
      mode: 'supabase',
    };
    return { backend, shareStore };
  }

  function renderShared(backend: Backend, mapId: string) {
    return render(
      <MemoryRouter initialEntries={[`/editor?map=${mapId}&title=x`]}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/editor" element={<Editor />} />
            <Route path="/home" element={<div>HOME_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
  }

  it('링크 토글은 잠기고 초대 입력은 없다 — 대신 왜인지 알려 준다', async () => {
    localStorage.setItem('mindflow_doc_sv1', JSON.stringify(DOC));
    const { backend, shareStore } = seedParticipants('sv1', true);
    renderShared(backend, 'sv1');
    await waitReadOnly();

    fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const dialog = await screen.findByRole('dialog', { name: '공유' });

    const toggle = await within(dialog).findByRole('switch', { name: '링크가 있는 사람은 열람' });
    expect(toggle.getAttribute('data-disabled')).not.toBeNull();
    expect((within(dialog).getByRole('button', { name: '링크 복사' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByLabelText('초대할 이메일')).toBeNull();
    expect(within(dialog).getByText(/공유 설정은 소유자만 바꿀 수 있어요/)).toBeTruthy();
    // 실수로라도 서버를 부르지 않는다.
    expect(shareStore.setLink).not.toHaveBeenCalled();
  });

  it('소유자가 보인다 (제보: 링크로 열면 소유자가 안 나왔다)', async () => {
    localStorage.setItem('mindflow_doc_sv2', JSON.stringify(DOC));
    const { backend } = seedParticipants('sv2', true);
    renderShared(backend, 'sv2');
    await waitReadOnly();

    fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const dialog = await screen.findByRole('dialog', { name: '공유' });
    const ownerRow = await within(dialog).findByLabelText('소유자');
    expect(within(ownerRow).getByText('맵 주인')).toBeTruthy();
    expect(within(ownerRow).getByText(OWNER_EMAIL)).toBeTruthy();
  });

  it('참가자 목록이 비어 오는 서버(0018 이전)에서도 잠긴다 — readOnly 하나로 성립', async () => {
    localStorage.setItem('mindflow_doc_sv3', JSON.stringify(DOC));
    const { backend } = seedParticipants('sv3', false);
    renderShared(backend, 'sv3');
    await waitReadOnly();

    fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const dialog = await screen.findByRole('dialog', { name: '공유' });
    expect((await within(dialog).findByRole('switch', { name: '링크가 있는 사람은 열람' })).getAttribute('data-disabled')).not.toBeNull();
    expect(within(dialog).queryByLabelText('초대할 이메일')).toBeNull();
  });
});
