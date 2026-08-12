import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MAP_TEMPLATES } from '../../templates/mapTemplates';
import { Home } from './Home';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { mapId } from './storage';
import { HOME_THEMES, UNREAD_BADGE_BG } from './theme';
import type { Doc } from '@mindflow/mindmap-core';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult, SpaceStore, WorkspaceData } from '../../adapters/ports';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Minimal `DocStore` test double — `list()` resolves to whatever metas the
 * test seeds it with; the mutating methods are spies so tests can assert
 * they were (or weren't) called, without touching real storage. */
class MockDocStore implements DocStore {
  listEditorNames = vi.fn(async (): Promise<Record<string, string>> => ({}));
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  rename = vi.fn(async (): Promise<void> => undefined);
  save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 }));
  // Bodies live behind `load()` only (like a real backend) — `list()` never
  // carries them, and nothing is written to localStorage.
  load = vi.fn(async (id: string): Promise<LoadedDoc | null> => this.bodies[id] ?? null);
  // 썸네일 전용 본문 — 실백엔드처럼 load와 같은 원천에서 직렬화만 해 준다.
  loadPreview = vi.fn(async (id: string): Promise<string | null> => {
    const b = this.bodies[id];
    return b ? JSON.stringify(b.doc) : null;
  });

  constructor(
    private metas: DocMeta[] = [],
    private bodies: Record<string, LoadedDoc> = {},
  ) {}

  async list(): Promise<DocMeta[]> {
    return this.metas;
  }
}

/** `mode`는 기본 'local'(기존 테스트 그대로). 백엔드 모드에서만 갈리는 동작
 *  (예: ②의 "이미 있는 문서엔 손대지 않는다")을 볼 때 'supabase'를 넘긴다. */
function renderHomeWithDocStore(metas: DocMeta[] = [], bodies: Record<string, LoadedDoc> = {}, mode: Backend['mode'] = 'local') {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode };
  const utils = render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
  return { ...utils, docStore };
}

/**
 * "새로 만들기"는 이제 **템플릿 갤러리**를 연다 — 빈 맵 칸까지 눌러야 예전과 같은
 * 결과(로더 → 카드 등록 → /editor)가 된다. 세 진입점(툴바·빈 상태 CTA·빈 자리
 * 우클릭)이 전부 같은 갤러리를 열므로 여는 버튼은 인자로 받는다.
 */
async function createBlankMap(user: ReturnType<typeof userEvent.setup>, opener?: HTMLElement) {
  await user.click(opener ?? screen.getAllByText('＋ 새로 만들기')[0]!);
  await user.click(await screen.findByRole('button', { name: /빈 맵/ }));
}

/** 워크스페이스 블롭에 등록된 맵 카드 제목들 — 새 맵 생성이 남기는 흔적. */
function newMapTitles(): string[] {
  const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces?: { maps?: { title: string }[] }[] };
  return (ws.spaces ?? []).flatMap((sp) => (sp.maps ?? []).map((m) => m.title));
}

describe('Home', () => {
  it('renders the sidebar and the main map sections', async () => {
    const { container } = renderHome();
    const sidebar = within(container.querySelector('aside') as HTMLElement);

    // sidebar
    expect(sidebar.getByText('스페이스')).toBeTruthy();
    // Google Drive 연동은 실연동 전까지 임시 숨김 (Sidebar.tsx SHOW_DRIVE_LNB)
    expect(sidebar.queryByText('Google Drive')).toBeNull();
    expect(sidebar.getByText('즐겨찾기')).toBeTruthy();
    expect(sidebar.getByText('휴지통')).toBeTruthy();
    // the space list is a skeleton until the workspace load settles, then 일반 공간 appears
    await waitFor(() => expect(sidebar.getByText('일반 스페이스')).toBeTruthy());

    // toolbar / main. With no saved maps the grid shows its empty state (after
    // the initial DocStore.list() settles — until then it shows a skeleton), so
    // "＋ 새로 만들기" appears both in the toolbar and the empty-state CTA.
    expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy();
    expect(screen.getAllByText('＋ 새로 만들기').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
  });

  it('shows the signed-in email in the LNB profile and derives the name from it', async () => {
    // LocalAuth reads its session from `mf_demo_session`; seed a real login email.
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    const { container } = renderHomeWithDocStore([]);
    const aside = within(container.querySelector('aside') as HTMLElement);

    // the real email is shown (popover content is always in the DOM), and the
    // name defaults to its local part — not the hardcoded "mine" placeholder.
    await waitFor(() => expect(aside.getByText('hoyul.lee@wantedlab.com')).toBeTruthy());
    expect(aside.getAllByText('hoyul.lee').length).toBeGreaterThan(0);
    expect(aside.queryByText('mine@wantedlab.com')).toBeNull();
    expect(aside.queryByText('mine')).toBeNull();
  });

  it("shows the Google account's real name and photo in the LNB profile", async () => {
    // A Google-OAuth session carries name/avatarUrl (mapped from user_metadata);
    // the profile should prefer that name over the email local part, and layer
    // the photo over the initial circle (which stays as the broken-image fallback).
    class GoogleAuth extends LocalAuth {
      override async getSession() {
        return { user: { id: 'g1', email: 'hoyul.lee@gmail.com', name: '이호율', avatarUrl: 'https://lh3.googleusercontent.com/a/photo=s96-c' } };
      }
    }
    const backend: Backend = { auth: new GoogleAuth(), docStore: new MockDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    const { container } = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    const aside = within(container.querySelector('aside') as HTMLElement);

    await waitFor(() => expect(aside.getAllByText('이호율').length).toBeGreaterThan(0)); // Google name, not "hoyul.lee"
    const img = container.querySelector('aside img[src="https://lh3.googleusercontent.com/a/photo=s96-c"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer'); // googleusercontent rejects cross-site referrers
  });

  it('renders saved documents from DocStore.list() as map cards', async () => {
    const { container } = renderHomeWithDocStore([
      { id: 'doc-a', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'doc-b', title: '무상 비즈머니 지급', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
    expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeTruthy();
  });

  it('map cards show the LAST-EDITED time (updatedAt), not the legacy "최근 항목:내 맵" line', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const { container } = renderHomeWithDocStore([
      { id: 'doc-a', title: '시간표기', version: 1, updatedAt: twoHoursAgo, isFavorite: false, deletedAt: null },
    ]);
    const card = await waitFor(() => {
      const el = container.querySelector('a[data-title="시간표기"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await waitFor(() => expect(within(card).getByText('수정일 · 2시간 전')).toBeTruthy());
    // 옛 문구는 사라져야 한다
    expect(within(card).queryByText(/최근 항목:/)).toBeNull();
    expect(within(card).queryByText('내 맵')).toBeNull();
    // 정확한 일시는 툴팁으로
    expect(within(card).getByText('수정일 · 2시간 전').getAttribute('title')).toMatch(/^\d{4}\. \d{1,2}\. \d{1,2}\. \d{2}:\d{2}$/);
  });

  it('shows the loading overlay then navigates to /editor after clicking "새로 만들기"', async () => {
    const user = userEvent.setup();
    renderHome();

    await createBlankMap(user);

    expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
  });

  it('filters the map grid as the search box is typed into', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([
      { id: 'doc-a', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'doc-b', title: '무상 비즈머니 지급', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
    expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '따라잡기');

    // 적용은 입력이 멎은 뒤(디바운스) — 그래서 즉시가 아니라 기다려서 확인한다.
    await waitFor(() => expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeNull());
    expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy();
  });

  it('renders a real-map thumbnail for a backend-stored map (body via DocStore.load, not localStorage)', async () => {
    // A map whose body lives ONLY behind DocStore.load() (a real backend like
    // Supabase — nothing in localStorage). The preview must prefetch the body
    // and draw the actual nodes, not fall back to the generic miniPreview.
    const doc = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '분기목표', emoji: '🎯', parent: null, children: ['n1', 'n2'], collapsed: false, color: null, x: 0, y: 0 },
        n1: { id: 'n1', text: '매출확대', emoji: '', parent: 'root', children: [], collapsed: false, color: '#3f8fd0', x: 0, y: 0 },
        n2: { id: 'n2', text: '신규채용', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    const { container } = renderHomeWithDocStore(
      [{ id: 'doc-remote', title: '분기목표', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
      { 'doc-remote': { doc: doc as unknown as LoadedDoc['doc'], version: 1, title: '분기목표' } },
    );

    const card = await waitFor(() => {
      const c = container.querySelector('a[data-title="분기목표"]');
      if (!c) throw new Error('card not rendered yet');
      return c as HTMLElement;
    });
    // Once the body is prefetched, the thumbnail is a realPreview SVG that
    // includes the node labels (miniPreview draws no text at all). 이모지는
    // 에디터처럼 텍스트와 분리된 요소다(크기 22/17px, 좌측 고정 — mapPreview 참고).
    await waitFor(() => {
      const thumb = card.querySelector('.map-thumb') as HTMLElement;
      const labels = Array.from(thumb.querySelectorAll('svg text')).map((t) => t.textContent);
      expect(labels).toEqual(expect.arrayContaining(['🎯', '분기목표', '매출확대', '신규채용']));
    });
  });

  it('shows a skeleton while a backend map body loads (no generic-sketch flash), then the real nodes', async () => {
    // Gate the thumbnail body fetch (`loadPreview`) so we can observe the card
    // WHILE its body is still loading: it must show a neutral skeleton, never
    // the generic miniPreview SVG (which would flash and then be replaced).
    let resolveLoad!: (v: string | null) => void;
    const gate = new Promise<string | null>((r) => {
      resolveLoad = r;
    });
    const doc = {
      v: 1,
      nodes: { root: { id: 'root', text: '실제루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    const docStore: DocStore = {
      list: async () => [{ id: 'd1', title: '실제루트', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
      load: vi.fn(async () => null),
      loadPreview: vi.fn(async () => gate),
      setFavorite: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      purge: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      listEditorNames: vi.fn(async () => ({})),
      save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 })),
    };
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    const { container } = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    const thumb = await waitFor(() => {
      const t = container.querySelector('a[data-title="실제루트"] .map-thumb');
      if (!t) throw new Error('card not rendered yet');
      return t as HTMLElement;
    });
    // still loading: a shimmer skeleton, NOT a preview SVG (no generic flash)
    expect(thumb.querySelector('.mf-skel')).toBeTruthy();
    expect(thumb.querySelector('svg')).toBeNull();

    // body arrives → the real nodes render (and the skeleton is gone)
    resolveLoad(JSON.stringify(doc));
    await waitFor(() => expect(Array.from(thumb.querySelectorAll('svg text')).map((t) => t.textContent)).toContain('실제루트'));
    expect(thumb.querySelector('.mf-skel')).toBeNull();
  });

  it("never borrows another doc's body for a docId-backed card with no saved body (새로 만들기 → 뒤로가기 repro)", async () => {
    // Repro: map A was modified but its root text is still the default
    // "새 마인드맵"; the user then hits 새로 만들기 and leaves the editor with
    // BROWSER BACK (goHome's explicit save never runs, and the untouched seed
    // never autosaves — the fresh `new-…` doc has NO body anywhere). The new
    // card must fall back to the generic sketch, NOT title-scan localStorage
    // and pick up A's body (which rendered A's preview on the new card).
    const docA = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '새 마인드맵', emoji: '', parent: null, children: ['n1'], collapsed: false, color: null, x: 0, y: 0 },
        n1: { id: 'n1', text: 'A전용노드', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    localStorage.setItem('mindflow_doc_doc-a', JSON.stringify(docA));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          {
            id: 's1',
            name: '일반 공간',
            home: true,
            color: '#f0663f',
            maps: [
              { title: '새 마인드맵', when: '방금', hue: '#f0663f', docId: 'doc-a' },
              { title: '새 마인드맵', when: '방금', hue: '#f0663f', docId: 'new-zz1' },
            ],
            folders: [],
          },
        ],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([{ id: 'doc-a', title: '새 마인드맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);

    const thumbOf = (docId: string) => container.querySelector(`.mf-map-grid a[href*="map=${docId}"] .map-thumb`) as HTMLElement | null;
    // Sanity: A's own card renders A's body.
    await waitFor(() => {
      const labels = Array.from(thumbOf('doc-a')?.querySelectorAll('svg text') ?? []).map((t) => t.textContent);
      expect(labels).toContain('A전용노드');
    });
    // The new card's fetch resolves to null → generic sketch, no skeleton…
    await waitFor(() => {
      const thumb = thumbOf('new-zz1');
      expect(thumb).toBeTruthy();
      expect(thumb!.querySelector('.mf-skel')).toBeNull();
      expect(thumb!.querySelector('svg')).toBeTruthy();
    });
    // …and crucially NONE of A's node labels (miniPreview draws no text at all).
    expect(Array.from(thumbOf('new-zz1')!.querySelectorAll('svg text'))).toHaveLength(0);
  });

  it('LNB 프로필: 세션이 풀리기 전엔 스켈레톤 — mine 플레이스홀더가 절대 노출되지 않는다', async () => {
    let resolveSession!: (v: { user: { id: string; email: string } } | null) => void;
    const gate = new Promise<{ user: { id: string; email: string } } | null>((r) => {
      resolveSession = r;
    });
    class GatedAuth extends LocalAuth {
      override getSession() {
        return gate as ReturnType<LocalAuth['getSession']>;
      }
    }
    const backend: Backend = { auth: new GatedAuth(), docStore: new MockDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    const { container } = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    const aside = within(container.querySelector('aside') as HTMLElement);
    // 세션 대기 중: 프로필은 스켈레톤이고 'mine'/'M' 플레이스홀더는 렌더되지 않는다
    expect(aside.getByLabelText('프로필을 불러오는 중')).toBeTruthy();
    expect(aside.queryByText('mine')).toBeNull();
    expect(aside.queryByRole('button', { name: '계정 메뉴' })).toBeNull();

    await act(async () => {
      resolveSession({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } });
      await gate;
    });
    // 세션 도착: 실제 이름으로 바로 그려진다 (플레이스홀더 → 실명 깜빡임 없음)
    await waitFor(() => expect(aside.getAllByText('hoyul.lee').length).toBeGreaterThan(0));
    expect(aside.queryByLabelText('프로필을 불러오는 중')).toBeNull();
  });

  it('로딩 중 최근 항목 자리에 같은 크기의 스켈레톤을 깔아 툴바가 위아래로 튀지 않는다', async () => {
    // 저장된 최근 기록이 있으면, 워크스페이스/문서 목록이 로드되는 동안에도
    // "최근 항목" 트레이 footprint가 미리 잡혀 있어야 한다 — 로드 완료 시
    // 트레이가 끼어들며 아래 툴바(파일 검색·새로 만들기)가 밀리던 점프 방지.
    localStorage.setItem('mf_recent', JSON.stringify(['doc-r1']));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ spaces: [{ id: 's1', name: '일반 공간', color: '#f0663f', maps: [{ title: '최근맵', when: '방금', hue: '#f0663f', docId: 'doc-r1' }], folders: [] }], mapFolders: {} }),
    );
    let resolveList!: (v: DocMeta[]) => void;
    const gate = new Promise<DocMeta[]>((r) => {
      resolveList = r;
    });
    const docStore: DocStore = {
      list: () => gate,
      load: vi.fn(async () => null),
      loadPreview: vi.fn(async () => null),
      setFavorite: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      purge: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      listEditorNames: vi.fn(async () => ({})),
      save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 })),
    };
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    // 로딩 중: 스켈레톤 트레이가 자리를 확보하고 있고, 툴바도 이미 그 아래에 있다
    await waitFor(() => expect(screen.getByLabelText('최근 항목을 불러오는 중')).toBeTruthy());
    expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy();

    await act(async () => {
      resolveList([{ id: 'doc-r1', title: '최근맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);
      await gate;
    });
    // 로드 후: 실제 트레이로 교체 (스켈레톤 제거 + '최근 항목' 헤더 노출)
    await waitFor(() => expect(screen.queryByLabelText('최근 항목을 불러오는 중')).toBeNull());
    expect(screen.getByText('최근 항목')).toBeTruthy();
  });

  it('최근 항목 카드에 위치(폴더명)가 보이고, 스페이스까지 포함한 전체 경로가 툴팁·aria로 붙는다', async () => {
    localStorage.setItem('mf_recent', JSON.stringify(['doc-p1']));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 공간', color: '#f0663f', maps: [{ title: '기획맵', when: '방금', hue: '#f0663f', docId: 'doc-p1' }], folders: [{ id: 'f1', name: '기획' }] }],
        mapFolders: { 'doc-p1': 'f1' },
      }),
    );
    const docStore: DocStore = {
      list: async () => [{ id: 'doc-p1', title: '기획맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
      load: vi.fn(async () => null),
      loadPreview: vi.fn(async () => null),
      setFavorite: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      purge: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      listEditorNames: vi.fn(async () => ({})),
      save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 })),
    };
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    // 스크린리더에는 스페이스명까지 포함한 전체 경로가 노출된다(라벨에선 생략되므로)
    const row = await screen.findByLabelText('위치: 일반 공간 › 기획 › 기획맵');
    // 보이는 라벨은 폴더명만 — 좁은 폭을 변별력 있는 쪽에 양보한다
    expect(row.textContent).toBe('기획');
    // 잘림 대비 전체 경로는 마우스 툴팁으로도 준다
    expect(row.getAttribute('title')).toBe('일반 공간 › 기획 › 기획맵');
    // 스페이스 색 점은 유지된다(스페이스는 색으로 계속 구분)
    expect(row.querySelector('span[aria-hidden="true"]')).toBeTruthy();
  });

  it('hides the "아직 만든 맵이 없어요" prompt when the space has folders but no loose maps', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: {},
      }),
    );
    renderHomeWithDocStore([]);

    // the folder section renders …
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    expect(screen.getByText('폴더')).toBeTruthy();
    // … but NOT the empty-space prompt, and the empty-state "＋ 새로 만들기" CTA is
    // gone (only the always-present toolbar button remains).
    expect(screen.queryByText('아직 만든 맵이 없어요')).toBeNull();
    expect(screen.getAllByText('＋ 새로 만들기').length).toBe(1);
  });

  it('still shows the "아직 만든 맵이 없어요" prompt for a space with neither maps nor folders', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'se', name: '빈공간', color: '#3f8fd0', maps: [], folders: [] }], mapFolders: {} }));
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    // both the toolbar button and the empty-state CTA are present
    expect(screen.getAllByText('＋ 새로 만들기').length).toBe(2);
  });

  it('keeps a folder-filed map in its folder when the merge renames it to its backend title', async () => {
    const user = userEvent.setup();
    // A map filed in a folder under its old title, whose backend doc has since
    // been renamed (e.g. created in a folder, then its root text edited in the
    // editor). On load the merge renames the card to the backend title — the
    // folder assignment must follow, not orphan (folder counts it while the
    // card drops to the space top level).
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [{ title: '옛이름', when: '내 맵', hue: '#f0663f', docId: 'd1' }], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: { 옛이름: 'f1' },
      }),
    );
    const { container } = renderHomeWithDocStore([{ id: 'd1', title: '새이름', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);

    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    // the renamed card must NOT appear at the space top level (it belongs to the folder)
    expect(container.querySelector('a[data-title="새이름"]')).toBeNull();
    expect(container.querySelector('a[data-title="옛이름"]')).toBeNull();
    // entering the folder shows the renamed card
    await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
    await waitFor(() => expect(container.querySelector('a[data-title="새이름"]')).toBeTruthy());
  });

  it('files a new map into the folder you are currently inside', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([]);

    // enter the folder
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
    await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

    // create a new map from inside the folder (toolbar CTA)
    await createBlankMap(user);

    // the folder view only renders cards filed to THIS folder, so the new map
    // appearing here proves it was filed into the folder (not the space top level).
    await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵"]')).toBeTruthy());
  });

  // 신규 기능: 폴더 안에 폴더(중첩 폴더). 폴더 안에서 새 폴더를 만들면 현재
  // 폴더가 부모가 되고, 뒤로가기는 한 계층씩 올라간다.
  it('폴더 안에서 새 폴더를 만들면 그 폴더의 하위 폴더가 되고, 뒤로가기는 한 계층씩 올라간다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: {},
      }),
    );
    renderHomeWithDocStore([]);

    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
    await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

    // 폴더 안에서 새 폴더 생성 → 하위 폴더 카드가 이 화면에 나타난다
    await user.click(screen.getByRole('button', { name: '새 폴더' }));
    await user.type(screen.getByPlaceholderText('예: 기획 (최대 10자)'), '하위자료');
    await user.click(screen.getByRole('button', { name: '만들기' }));
    await waitFor(() => expect(screen.getByText('하위자료')).toBeTruthy());

    // 하위 폴더로 진입 → 브레드크럼 전체 경로가 깊어진다
    await user.dblClick(screen.getByText('하위자료')); // 폴더 진입 = 더블클릭
    await waitFor(() => expect(screen.getByTitle('폴더공간 / 내폴더 / 하위자료')).toBeTruthy());

    // 뒤로가기 1회 = 상위 폴더('내폴더')로 — 하위 폴더 카드가 다시 보인다
    await user.click(screen.getByRole('button', { name: '스페이스로 돌아가기' }));
    await waitFor(() => expect(screen.getByText('하위자료')).toBeTruthy());
    expect(screen.getByTitle('폴더공간 / 내폴더')).toBeTruthy();

    // 뒤로가기 2회 = 스페이스 최상위 — 최상위 폴더 카드('내폴더')가 보인다
    await user.click(screen.getByRole('button', { name: '스페이스로 돌아가기' }));
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    expect(screen.queryByText('하위자료')).toBeNull();
  });

  // 제보: 모바일 홈에서 폴더 안에 들어가면 파일을 가져올 방법이 없다. 폴더 안에서는
  // `가져오기` 버튼 자체가 사라져서, 폴더에 파일을 넣으려면 최상위로 나가 가져온 뒤
  // 다시 옮겨야 했다. 이제 폴더 안에서도 가져올 수 있고, 가져온 맵은 **그 폴더에**
  // 들어간다(새 맵 만들기와 같은 규칙 — 위 테스트).
  describe('폴더 안에서 가져오기', () => {
    const IMPORT_JSON = JSON.stringify({
      v: 1,
      nodes: { root: { id: 'root', text: '가져온 맵', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    });

    function seedFolderSpace() {
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
          mapFolders: {},
        }),
      );
    }

    /** 숨겨진 file input에 파일을 흘려 넣는다 — 실제 클릭은 OS 파일 선택창을 열므로
     *  테스트에서는 그 다음 단계(onChange)부터 재현한다. */
    async function upload(container: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      await user.upload(input, new File([IMPORT_JSON], '가져온 맵.json', { type: 'application/json' }));
    }

    it('폴더 안에서도 가져오기 버튼이 보인다 (모바일)', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        seedFolderSpace();
        renderHomeWithDocStore([]);
        await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
        await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
        await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

        expect(screen.getByRole('button', { name: '가져오기' })).toBeTruthy();
        // 중첩 폴더: 폴더 안에서도 새 폴더를 만들 수 있다(현재 폴더가 부모가 된다).
        expect(screen.getByRole('button', { name: '새 폴더' })).toBeTruthy();
      } finally {
        restore();
      }
    });

    it('가져온 맵이 지금 보고 있는 폴더에 들어간다', async () => {
      const user = userEvent.setup();
      seedFolderSpace();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
      await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
      await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

      await upload(container, user);

      // 완료 토스트가 목적지를 폴더로 말한다("현재 공간에"가 아니라)
      await waitFor(() => expect(screen.getByText(/'내폴더' 폴더에 추가했어요/)).toBeTruthy());
      await user.click(screen.getByRole('button', { name: '확인' }));

      // 폴더 뷰는 이 폴더에 배정된 카드만 그리므로, 여기 보이면 폴더에 들어간 것이다.
      await waitFor(() => expect(container.querySelector('a[data-title="가져온 맵"]')).toBeTruthy());
    });

    // 제보(배포 후): 가져온 직후엔 폴더에 있었는데 **나중에 스페이스로 옮겨져 있다.**
    // 가져온 카드는 docId가 없어 배정이 제목 키로 저장되는데, 다른 스페이스에 같은
    // 제목의 doc 카드가 있으면 다음 홈 진입의 키 마이그레이션이 그 제목 키를 남의
    // docId로 옮겨 버렸다(`migrateMapFolderKeys`). 홈을 다시 열어 재현한다.
    it('다른 스페이스에 같은 제목의 맵이 있어도 홈을 다시 열면 폴더에 그대로 있다', async () => {
      const user = userEvent.setup();
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          spaces: [
            { id: 'sa', name: '내 공간', color: '#3f8fd0', home: true, maps: [], folders: [{ id: 'f1', name: '내폴더' }] },
            // 같은 제목의 **다른** 맵(doc 카드) — 예전엔 이 카드가 제목 키를 가로챘다.
            { id: 'sb', name: '다른 공간', color: '#8a6bd1', maps: [{ title: '가져온 맵', when: '내 맵', hue: '#f0663f', docId: 'other-doc' }], folders: [] },
          ],
          mapFolders: {},
        }),
      );
      const other: DocMeta = { id: 'other-doc', title: '가져온 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null };
      const first = renderHomeWithDocStore([other]);

      await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
      await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
      await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());
      await upload(first.container, user);
      await waitFor(() => expect(screen.getByText(/'내폴더' 폴더에 추가했어요/)).toBeTruthy());
      await user.click(screen.getByRole('button', { name: '확인' }));
      await waitFor(() => expect(first.container.querySelector('.mf-map-grid a[data-title="가져온 맵"]')).toBeTruthy());

      // 홈을 다시 연다(리로드/에디터 왕복) → 키 마이그레이션이 다시 돈다.
      first.unmount();
      const second = renderHomeWithDocStore([other]);
      // 보고 있던 폴더가 복원되고, 가져온 맵은 여전히 그 폴더 안에 있어야 한다.
      await waitFor(() => expect(second.container.querySelector('h2')?.textContent).toContain('내폴더'));
      await waitFor(() => expect(second.container.querySelector('.mf-map-grid a[data-title="가져온 맵"]')).toBeTruthy());

      // 그리고 스페이스 최상위에는 없어야 한다(배정이 살아 있다는 뜻).
      await user.click(screen.getByRole('button', { name: '스페이스로 돌아가기' }));
      await waitFor(() => expect(second.container.querySelector('h2')?.textContent).toBe('내 공간'));
      expect(second.container.querySelector('.mf-map-grid a[data-title="가져온 맵"]')).toBeNull();
    });

    // ① 가져온 맵도 다른 맵과 똑같이 백엔드에 올라가야 한다(다기기 동기화). 예전엔
    // localStorage에만 써서, 다른 기기에서 그 카드를 열면 에디터가 "새 문서"로 보고
    // 빈 seed를 저장했고 → 원래 기기에서 다시 열면 그 빈 문서가 로컬 본문을 덮었다.
    it('가져오기가 DocStore에 저장하고, 카드는 그 docId를 갖는다', async () => {
      const user = userEvent.setup();
      seedFolderSpace();
      const { container, docStore } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());

      await upload(container, user);
      await waitFor(() => expect(screen.getByText(/추가했어요/)).toBeTruthy());
      await user.click(screen.getByRole('button', { name: '확인' }));
      await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="가져온 맵"]')).toBeTruthy());

      // 백엔드에 본문이 올라갔고, "없을 때만 만들기"로 남의 문서를 덮지 않는다.
      expect(docStore.save).toHaveBeenCalledTimes(1);
      const [savedId, savedDoc, savedOpts] = docStore.save.mock.calls[0] as unknown as [string, { nodes: Record<string, { text?: string }> }, { title?: string; createOnly?: boolean }];
      expect(savedOpts).toMatchObject({ title: '가져온 맵', createOnly: true });
      expect(savedDoc.nodes.root?.text).toBe('가져온 맵');
      // id는 제목 해시(`mapId`)가 아니라 랜덤이어야 한다 — 제목 해시는 두 기기가
      // 같은 제목을 가져올 때 같은 행을 두고 다투게 만든다.
      expect(savedId).not.toBe(mapId('가져온 맵'));
      expect(savedId.startsWith('new-')).toBe(true);

      // 카드가 그 docId를 들고 있어야 이후 열기·삭제·즐겨찾기가 그 문서를 가리킨다.
      const saved = JSON.parse(localStorage.getItem('mf_spaces') as string) as { spaces: { maps: { title: string; docId?: string }[] }[] };
      expect(saved.spaces[0]!.maps.find((m) => m.title === '가져온 맵')?.docId).toBe(savedId);
    });

    // ② 예전에 가져온 카드(docId 없음 + 본문은 이 기기 localStorage에만)를 홈 진입 때
    // 자기 문서에 묶어 백엔드로 올린다 — 그래야 다른 기기에서도 본문이 보인다.
    describe('예전에 가져온 맵 묶기(②)', () => {
      const LEGACY_TITLE = '옛날에 가져온 맵';
      const legacyId = mapId(LEGACY_TITLE);
      const legacyBody = JSON.stringify({
        v: 1,
        nodes: { root: { id: 'root', text: LEGACY_TITLE, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
        floats: [],
        lines: [],
        zones: [],
        layoutMode: 'right',
        themeKey: 'coral',
      });

      /** docId 없는 카드 + 폴더 배정(제목 키) + 이 기기에만 있는 본문. */
      function seedLegacy() {
        localStorage.setItem(
          'mf_spaces',
          JSON.stringify({
            spaces: [{ id: 'sa', name: '내 공간', color: '#3f8fd0', home: true, maps: [{ title: LEGACY_TITLE, when: '방금 가져옴', hue: '#f0663f' }], folders: [{ id: 'f1', name: '내폴더' }] }],
            mapFolders: { [LEGACY_TITLE]: 'f1' },
          }),
        );
        localStorage.setItem(`mindflow_doc_${legacyId}`, legacyBody);
      }

      it('본문을 올리고 카드에 docId를 붙이며, 폴더 배정도 그 키로 옮긴다', async () => {
        seedLegacy();
        const { docStore } = renderHomeWithDocStore([], {}, 'supabase');
        await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());

        // 업로드는 "없을 때만 만들기"로 — 다른 기기가 올린 문서를 덮지 않는다.
        await waitFor(() => expect(docStore.save).toHaveBeenCalled());
        const [id, , opts] = docStore.save.mock.calls[0] as unknown as [string, unknown, { title?: string; createOnly?: boolean }];
        expect(id).toBe(legacyId);
        expect(opts).toMatchObject({ title: LEGACY_TITLE, createOnly: true });

        // 카드에 docId가 붙고, 제목으로 저장돼 있던 폴더 배정이 그 키로 옮겨져 영속된다.
        await waitFor(() => {
          const saved = JSON.parse(localStorage.getItem('mf_spaces') as string) as { spaces: { maps: { title: string; docId?: string }[] }[]; mapFolders: Record<string, string> };
          expect(saved.spaces[0]!.maps[0]!.docId).toBe(legacyId);
          expect(saved.mapFolders).toEqual({ [legacyId]: 'f1' });
        });
      });

      it('백엔드에 이미 그 문서가 있으면 손대지 않는다 (다른 기기가 올린 것)', async () => {
        seedLegacy();
        const existing: DocMeta = { id: legacyId, title: LEGACY_TITLE, version: 5, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null };
        const { docStore } = renderHomeWithDocStore([existing], {}, 'supabase');
        await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
        await new Promise((r) => setTimeout(r, 50));

        expect(docStore.save).not.toHaveBeenCalled();
      });

      it('로컬/데모 모드에서는 목록에 이미 떠 있어도 묶는다 (그 문서가 곧 이 카드의 본문)', async () => {
        seedLegacy();
        // 로컬 모드의 DocStore는 localStorage 자신이라, 예전 본문이 이미 목록에 뜬다.
        const existing: DocMeta = { id: legacyId, title: LEGACY_TITLE, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null };
        renderHomeWithDocStore([existing], {}, 'local');
        await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
        await waitFor(() => {
          const saved = JSON.parse(localStorage.getItem('mf_spaces') as string) as { spaces: { maps: { docId?: string }[] }[]; mapFolders: Record<string, string> };
          expect(saved.spaces[0]!.maps[0]!.docId).toBe(legacyId);
          expect(saved.mapFolders).toEqual({ [legacyId]: 'f1' });
        });
      });

      it('이 기기에 본문이 없으면 올리지 않는다 (그 맵은 다른 기기 소유)', async () => {
        seedLegacy();
        localStorage.removeItem(`mindflow_doc_${legacyId}`);
        const { docStore } = renderHomeWithDocStore([], {}, 'supabase');
        await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
        await new Promise((r) => setTimeout(r, 50));

        expect(docStore.save).not.toHaveBeenCalled();
      });
    });

    it('저장이 실패하면 카드를 만들지 않고 에러를 보여 준다', async () => {
      const user = userEvent.setup();
      seedFolderSpace();
      const { container, docStore } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
      docStore.save.mockResolvedValue({ ok: false, reason: 'error', message: '연결이 끊겼어요' });

      await upload(container, user);

      await waitFor(() => expect(screen.getByText(/저장하지 못했어요/)).toBeTruthy());
      // 본문 없는 카드를 남기면 다른 기기에서 그걸 열었을 때 빈 문서가 올라간다.
      expect(container.querySelector('.mf-map-grid a[data-title="가져온 맵"]')).toBeNull();
    });

    it('최상위에서 가져오면 종전대로 스페이스 최상위에 들어간다', async () => {
      const user = userEvent.setup();
      seedFolderSpace();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());

      await upload(container, user);

      await waitFor(() => expect(screen.getByText(/현재 스페이스에 추가했어요/)).toBeTruthy());
      await user.click(screen.getByRole('button', { name: '확인' }));
      await waitFor(() => expect(container.querySelector('a[data-title="가져온 맵"]')).toBeTruthy());

      // 폴더 안으로 들어가면 없다 — 최상위에 남았다는 뜻.
      await user.dblClick(screen.getByText('내폴더')); // 폴더 진입 = 더블클릭
      await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());
      expect(container.querySelector('a[data-title="가져온 맵"]')).toBeNull();
    });
  });

  // 제보: 이름이 긴 폴더에 들어가면 제목의 경로가 줄바꿈된다.
  describe('제목 경로 표기', () => {
    const LONG = '아주 긴 이름의 폴더입니다';

    async function enterLongFolder() {
      const user = userEvent.setup();
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: LONG }] }],
          mapFolders: {},
        }),
      );
      const utils = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText(LONG)).toBeTruthy());
      await user.dblClick(screen.getByText(LONG)); // 폴더 진입 = 더블클릭
      await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());
      return utils;
    }

    it('폴더 안에서는 상위 경로를 … 로 접고 폴더명만 보여 준다', async () => {
      const { container } = await enterLongFolder();
      const h2 = container.querySelector('h2') as HTMLElement;
      // 스페이스명은 제목에서 사라지고 …로 접힌다
      expect(h2.textContent).not.toContain('폴더공간');
      expect(h2.textContent).toContain('…');
      expect(h2.textContent).toContain(LONG);
    });

    it('접힌 전체 경로는 툴팁·스크린리더에 남는다', async () => {
      const { container } = await enterLongFolder();
      const h2 = container.querySelector('h2') as HTMLElement;
      expect(h2.getAttribute('title')).toBe(`폴더공간 / ${LONG}`);
      expect(h2.getAttribute('aria-label')).toBe(`폴더공간 / ${LONG}`);
    });

    it('한 줄을 유지한다 — 넘치면 줄바꿈이 아니라 말줄임', async () => {
      const { container } = await enterLongFolder();
      const h2 = container.querySelector('h2') as HTMLElement;
      expect(h2.style.whiteSpace).toBe('nowrap');
      // 자리가 모자랄 때 줄어들 수 있어야 말줄임이 걸린다(minWidth 0 + shrink 허용).
      expect(h2.style.minWidth).toBe('0');
      expect(h2.style.flex).toContain('1');
      const leaf = h2.querySelector('span:last-child') as HTMLElement;
      expect(leaf.textContent).toBe(LONG);
      expect(leaf.style.textOverflow).toBe('ellipsis');
      expect(leaf.style.overflow).toBe('hidden');
    });

    it('최상위에서는 접지 않는다 — 스페이스명 그대로, 접근성 라벨도 덧붙이지 않는다', async () => {
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({ spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [] }], mapFolders: {} }),
      );
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(container.querySelector('h2')?.textContent).toBe('폴더공간'));
      const h2 = container.querySelector('h2') as HTMLElement;
      expect(h2.textContent).not.toContain('…');
      // 잘림은 CSS 말줄임이라 접근성 트리엔 전체 이름이 남는다 → aria-label 불필요.
      expect(h2.getAttribute('aria-label')).toBeNull();
      // 툴팁은 여기서도 붙는다(최상위의 긴 스페이스명도 잘리므로).
      expect(h2.getAttribute('title')).toBe('폴더공간');
    });
  });

  it('restores the space you were viewing when Home remounts (editor round-trip)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 'sa', name: '공간에이', color: '#3f8fd0', maps: [] },
          { id: 'sb', name: '공간비이', color: '#8a6bd1', maps: [] },
        ],
        mapFolders: {},
      }),
    );

    // First visit: active space defaults to the first space.
    const first = renderHomeWithDocStore([]);
    await waitFor(() => expect(first.container.querySelector('h2')?.textContent).toBe('공간에이'));

    // Switch to the second space (as the user would before opening a map).
    const aside = first.container.querySelector('aside') as HTMLElement;
    await user.click(within(aside).getByText('공간비이'));
    await waitFor(() => expect(first.container.querySelector('h2')?.textContent).toBe('공간비이'));

    // Open a map → editor → back to Home: Home unmounts and remounts fresh. It
    // should land back on the space we left from, not reset to the first space.
    first.unmount();
    const second = renderHomeWithDocStore([]);
    await waitFor(() => expect(second.container.querySelector('h2')?.textContent).toBe('공간비이'));
  });

  it('never overwrites the workspace when the space load fails (re-login data loss)', async () => {
    // A backend whose workspace load REJECTS (transient error / RLS / not-ready).
    // The app falls back to the default seed, but it must NOT persist that seed —
    // doing so would wipe the user's real spaces/folders (the reported bug).
    const save = vi.fn(async (): Promise<void> => undefined);
    const spaceStore: SpaceStore = {
      load: vi.fn(async (): Promise<WorkspaceData | null> => {
        throw new Error('transient load failure');
      }),
      save,
    };
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    // the home settles on the default seed after the failed load…
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    // …but the workspace is NEVER written back — the failed load must not clobber it.
    expect(save).not.toHaveBeenCalled();
  });

  it('does not re-save the workspace merely from loading it (hydration is a no-op)', async () => {
    const save = vi.fn(async (): Promise<void> => undefined);
    const spaceStore: SpaceStore = {
      load: vi.fn(async (): Promise<WorkspaceData | null> => ({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} })),
      save,
    };
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    const { container } = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('작업 공간')).toBeTruthy());
    // loading real data and rendering it must not trigger a write-back
    expect(save).not.toHaveBeenCalled();
  });

  it('moves a map to another space via the card ☰ menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 'sa', name: '공간에이', color: '#3f8fd0', maps: [{ title: '내 맵', when: '방금', hue: '#f0663f', docId: 'd1' }], folders: [] },
          { id: 'sb', name: '공간비이', color: '#8a6bd1', maps: [], folders: [] },
        ],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([]);

    const card = (await waitFor(() => {
      const c = container.querySelector('a[data-title="내 맵"]');
      if (!c) throw new Error('card not rendered');
      return c;
    })) as HTMLElement;

    // open ☰ → 스페이스로 이동 → 공간비이 (scope name lookups to the card's menu,
    // since the space name also appears in the sidebar)
    // 메뉴는 이제 카드 안이 아니라 화면 위에 뜨는 공용 메뉴(`HomeContextMenu`)다 —
    // 하위 항목도 드릴다운이 아니라 옆으로 뻗는 플라이아웃이다.
    await user.click(within(card).getByLabelText('메뉴'));
    await user.click(await screen.findByRole('menuitem', { name: /스페이스로 이동/ }));
    await user.click(await screen.findByRole('menuitem', { name: '공간비이' }));

    // the move toast labels itself "이동 완료" (not the old hardcoded "복원 완료")
    await waitFor(() => expect(screen.getByText('이동 완료')).toBeTruthy());
    expect(screen.getByText(/공간비이.*스페이스로 옮겼어요/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' })); // dismiss toast

    // the map leaves the current (공간에이) view…
    await waitFor(() => expect(container.querySelector('a[data-title="내 맵"]')).toBeNull());
    // …and shows up when we switch to 공간비이
    const aside = within(container.querySelector('aside') as HTMLElement);
    await user.click(aside.getByText('공간비이'));
    await waitFor(() => expect(container.querySelector('a[data-title="내 맵"]')).toBeTruthy());
  });

  it('a user-created space persists across a reload (localStorage)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /새 스페이스/ })).toBeTruthy());

    // open "새 공간" → type a name → Enter (onNewSpaceKey → createSpace)
    await user.click(screen.getByRole('button', { name: /새 스페이스/ }));
    await user.type(screen.getByLabelText('스페이스 이름'), '내 스페이스{Enter}');
    await waitFor(() => expect(screen.getByText('내 스페이스')).toBeTruthy());

    // "reload": unmount and mount a fresh Home sharing the same localStorage
    unmount();
    cleanup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('내 스페이스')).toBeTruthy());
  });

  it('renames a space (name + color) via the shared new-space popup', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sx', name: '옛이름', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('옛이름')).toBeTruthy());

    // ⋮ menu → 이름 변경 opens the SAME popup as "새 공간", but in edit mode.
    // 메뉴는 이제 카드·폴더와 같은 공용 메뉴(`HomeContextMenu`)라 화면 위에 뜬다.
    await user.click(aside.getByLabelText('스페이스 메뉴'));
    await user.click(await screen.findByRole('menuitem', { name: '이름 변경' }));

    expect(screen.getByText('스페이스 이름 변경')).toBeTruthy();
    const input = screen.getByLabelText('스페이스 이름') as HTMLInputElement;
    expect(input.value).toBe('옛이름'); // pre-filled

    // change the name, pick a different tag color, then 변경
    await user.clear(input);
    await user.type(input, '새이름');
    await user.click(screen.getByRole('button', { name: '색상 #d0568f' }));
    await user.click(screen.getByRole('button', { name: '변경' }));

    await waitFor(() => expect(aside.getByText('새이름')).toBeTruthy());
    expect(aside.queryByText('옛이름')).toBeNull();
    // both name AND color persisted to the workspace
    await waitFor(() => {
      const sp = JSON.parse(localStorage.getItem('mf_spaces') as string).spaces.find((s: { id: string }) => s.id === 'sx');
      expect(sp.name).toBe('새이름');
      expect(sp.color).toBe('#d0568f');
    });
  });

  it('shows a spaces skeleton in the LNB until the workspace loads (no seed-space flash)', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = container.querySelector('aside') as HTMLElement;

    // before the workspace load resolves: the sidebar shows a skeleton, not the
    // seed 일반 공간 SpaceRow; the title is a skeleton too (no <h2> yet)
    expect(within(aside).getByLabelText('스페이스를 불러오는 중')).toBeTruthy();
    expect(aside.querySelector('.space-row')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();

    // after load: real spaces render, the skeletons are gone, and the title shows
    await waitFor(() => expect(within(aside).getByText('작업 공간')).toBeTruthy());
    expect(within(aside).queryByLabelText('스페이스를 불러오는 중')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('작업 공간');
  });

  it('does not resurrect a deleted 일반 공간 on reload (respects a persisted spaces list with no home space)', async () => {
    // simulate the state persisted after the user deleted the home space: only a
    // custom space remains, none flagged `home`.
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    renderHomeWithDocStore([]);

    // after the workspace load settles, the custom space shows and 일반 공간 is NOT re-created
    await waitFor(() => expect(screen.getAllByText('작업 공간').length).toBeGreaterThan(0));
    expect(screen.queryByText('일반 스페이스')).toBeNull();
  });

  it('creating a map while a custom space is active assigns it to that space (not the home space)', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /새 스페이스/ })).toBeTruthy());

    // create a custom space, then activate it (click its sidebar row)
    await user.click(screen.getByRole('button', { name: /새 스페이스/ }));
    await user.type(screen.getByLabelText('스페이스 이름'), '작업 공간{Enter}');
    await waitFor(() => expect(screen.getByText('작업 공간')).toBeTruthy());
    await user.click(screen.getByText('작업 공간'));

    // create a new map from the toolbar CTA
    await createBlankMap(user);

    // the new map's card is registered under "작업 공간", not "일반 공간".
    // 카드 등록은 로더가 페인트된 뒤(더블 rAF)로 미뤄지므로 waitFor로 기다린다
    // — 로더 페이드 중 새 카드가 배경에 번쩍이던 문제를 막기 위한 의도적 지연.
    const readSpaces = () => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces?: { name: string; maps?: unknown[] }[] };
      return ws.spaces ?? [];
    };
    await waitFor(() => expect(readSpaces().find((s) => s.name === '작업 공간')?.maps?.length).toBe(1));
    expect(readSpaces().find((s) => s.name === '일반 스페이스')?.maps?.length ?? 0).toBe(0);
  });

  it('새로 만들기: 로더가 먼저 화면을 덮은 다음에 새 카드가 추가된다(배경 깜빡임 방지)', async () => {
    // 제보: 로더 애니메이션이 뜨기 전에 새 파일이 배경에 생성되는 게 번쩍였다.
    // 로더는 클릭 즉시(같은 커밋) 뜨고, 카드 등록은 그 뒤 프레임으로 미뤄진다.
    const user = userEvent.setup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

    const cardCount = () => screen.queryAllByText('새 마인드맵').length;
    const before = cardCount();

    await createBlankMap(user);

    // 클릭 직후: 로더는 이미 떠 있고, 새 카드는 아직 추가되지 않았다
    expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
    expect(cardCount()).toBe(before);

    // 이후 프레임에서 카드가 등록된다 (로더 뒤에서)
    await waitFor(() => expect(cardCount()).toBeGreaterThan(before));
    expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
  });

  it('logs out (via the confirm dialog) and navigates to /login', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: /로그아웃/ }));
    expect(screen.getByText('로그아웃하시겠습니까?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
  });

  it('renames the profile via the "프로필명 변경" popup from the profile menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    // profile popover → 프로필명 변경 opens a popup (like 공간 이름 변경)
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));

    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    const input = within(dialog).getByLabelText('프로필명') as HTMLInputElement;
    expect(input.value).toBe('hoyul.lee'); // pre-filled from the current name
    await user.clear(input);
    await user.type(input, '홍길동');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));

    // committed: the LNB profile shows the new name; the popup is gone
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog', { name: '프로필명 변경' })).toBeNull();
  });

  it('cancelling the "프로필명 변경" popup keeps the old name', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '버릴이름');
    await user.click(within(dialog).getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('dialog', { name: '프로필명 변경' })).toBeNull();
    expect(screen.queryByText('버릴이름')).toBeNull();
    expect(screen.getAllByText('hoyul.lee').length).toBeGreaterThan(0);
  });

  it('does not close the "프로필명 변경" popup when the dim backdrop is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });

    // click the dim overlay (the dialog's backdrop parent) — must NOT dismiss
    await user.click(dialog.parentElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: '프로필명 변경' })).toBeTruthy();
  });

  it('persists the renamed profile across a reload', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    const { unmount } = renderHomeWithDocStore([]);

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '홍길동');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));

    // "reload": remount a fresh Home sharing the same localStorage + session
    unmount();
    cleanup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));
    expect(screen.queryByText('hoyul.lee')).toBeNull(); // did NOT revert to the email default
  });

  it('loads the profile name from the backend (survives a cache clear) and saves renames to it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    // no localStorage cache (mf_profile_names absent) — as after clearing browser cache
    const setProfileName = vi.fn(async (): Promise<{ error?: string }> => ({}));
    class BackendAuth extends LocalAuth {
      override getProfileName = async (): Promise<string | null> => '서버닉네임';
      override setProfileName = setProfileName;
    }
    const backend: Backend = { auth: new BackendAuth(), docStore: new MockDocStore([]), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    // reconciled from the backend even with an empty local cache
    await waitFor(() => expect(screen.getAllByText('서버닉네임').length).toBeGreaterThan(0));

    // renaming writes through to the backend
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '새닉네임');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));

    await waitFor(() => expect(setProfileName).toHaveBeenCalledWith('새닉네임'));
  });

  it('opens 설정 → 회원 탈퇴 and gates the destructive button on typing "탈퇴"', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);

    // profile popover → 설정 → account-settings modal → 회원 탈퇴 row
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });
    await user.click(within(settingsDialog).getByText('회원 탈퇴'));

    // the confirm dialog's destructive button starts disabled…
    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    const delBtn = within(confirmDialog).getByRole('button', { name: '회원 탈퇴' }) as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);

    // …and arms only once the exact phrase is typed
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '탈퇴');
    expect(delBtn.disabled).toBe(false);
  });

  it('설정 modal links to the legal docs (the logged-in entry point)', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });

    const privacy = within(settingsDialog).getByRole('link', { name: '개인정보처리방침' });
    const terms = within(settingsDialog).getByRole('link', { name: '이용약관' });
    expect(privacy.getAttribute('href')).toBe('/privacy');
    expect(terms.getAttribute('href')).toBe('/terms');
    // new tab so the modal/home state isn't torn down mid-session
    expect(privacy.getAttribute('target')).toBe('_blank');
  });

  it('deletes the account: wipes MindFlow storage and lands on /login', async () => {
    const user = userEvent.setup();
    // seed a signed-in demo session + some MindFlow data to prove it's wiped
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'general', name: '일반 공간', home: true, maps: [] }], mapFolders: {} }));
    localStorage.setItem('mindflow_doc_d1', JSON.stringify({ v: 1 }));
    renderHomeWithDocStore([]);

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(within(screen.getByRole('dialog', { name: '설정' })).getByText('회원 탈퇴'));

    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '탈퇴');
    await user.click(within(confirmDialog).getByRole('button', { name: '회원 탈퇴' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
    // every MindFlow-namespaced key is gone
    expect(localStorage.getItem('mf_demo_session')).toBeNull();
    expect(localStorage.getItem('mf_spaces')).toBeNull();
    expect(localStorage.getItem('mindflow_doc_d1')).toBeNull();
  });

  it('a live map is NOT hidden by a trashed map sharing its title (trash/space names do not interfere)', async () => {
    // Repro of the reported bug: "새 마인드맵_1" sits in the trash; a NEW map
    // with the same title is created and saved — the title-keyed deleted flag
    // used to hide the new (live) map from the grid entirely.
    const { container } = renderHomeWithDocStore([
      { id: 'doc-old', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'doc-new', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-03T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);

    // the LIVE doc renders as a grid card…
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵_1"]')).toBeTruthy());
    // …while the trashed one is ONLY in the trash list (one grid card, not two)
    expect(container.querySelectorAll('.mf-map-grid a[data-title="새 마인드맵_1"]').length).toBe(1);
    const aside = within(container.querySelector('aside') as HTMLElement);
    expect(aside.getByText('새 마인드맵_1')).toBeTruthy(); // trash row
  });

  it('restoring into a space that already has the title keeps the name (duplicates fully allowed)', async () => {
    // XMind-style policy: no "_복원N" rename — identity is the docId, so two
    // same-titled cards simply coexist, each with its own menu/selection state.
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-old', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'doc-new', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-03T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵_1"]')).toBeTruthy());

    // restore the trashed doc from the LNB trash list
    await user.click(container.querySelector('.restore-link') as HTMLElement);
    const confirmBtn = screen.getAllByRole('button', { name: '복원' }).find((el) => el.tagName === 'BUTTON');
    await user.click(confirmBtn!);

    // both maps coexist under the SAME title, no rename anywhere
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title="새 마인드맵_1"]').length).toBe(2));
    expect(docStore.restore).toHaveBeenCalledWith('doc-old');
    expect(docStore.rename).not.toHaveBeenCalled();
  });

  it('new maps are always "새 마인드맵" — no "_{n}" suffix even when the name is taken', async () => {
    // Duplicate names are fully allowed, so the auto-uniquifier is gone: with a
    // "새 마인드맵" (and even a trashed one) already present, the create CTA still
    // points at plain "새 마인드맵".
    const { container } = renderHomeWithDocStore([
      { id: 'doc-n1', title: '새 마인드맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'doc-n2', title: '새 마인드맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵"]')).toBeTruthy());
    // 갤러리의 "빈 맵"으로 만든 새 맵의 제목을 등록된 카드에서 확인한다
    // (예전엔 툴바 링크의 href에서 읽었다 — 이제 버튼이라 href가 없다).
    await createBlankMap(userEvent.setup());
    await waitFor(() => expect(newMapTitles()).toContain('새 마인드맵'));
    expect(newMapTitles().some((t) => /_\d+$/.test(t))).toBe(false); // not 새 마인드맵_1
  });

  it('same-titled cards in one space keep independent selection and ☰ menus (key-scoped UI state)', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([
      { id: 'dup-a', title: '중복 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'dup-b', title: '중복 맵', version: 1, updatedAt: '2026-01-02T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title="중복 맵"]').length).toBe(2));
    const [cardA, cardB] = [...container.querySelectorAll('.mf-map-grid a[data-title="중복 맵"]')] as HTMLElement[];

    // selecting A must not select B (title-keyed state used to light up both)
    await user.click(cardA!);
    // 선택 표시는 강조색 — 색상 테마(#41) 이후 값은 CSS 변수다(테마마다 색이 다르다).
    expect(cardA!.style.border).toContain('var(--mf-accent)');
    expect(cardB!.style.border).not.toContain('var(--mf-accent)');

    // A의 ☰이 B의 메뉴를 열면 안 된다. 메뉴는 화면에 하나뿐이므로 "어느 카드를
    // 가리키는가"로 본다 — ☰ 버튼이 드러난 쪽(opacity 1)이 그 카드다.
    await user.click(within(cardA!).getByRole('button', { name: '메뉴' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    const menuBtnOf = (el: HTMLElement) => within(el).getByRole('button', { name: '메뉴' }) as HTMLElement;
    expect(menuBtnOf(cardA!).style.opacity).toBe('1');
    expect(menuBtnOf(cardB!).style.opacity).toBe('0');
  });

  it('keeps a legacy title-keyed folder assignment working (migrated to the docId key on load)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [
          {
            id: 'general',
            name: '일반 공간',
            home: true,
            color: '#f0663f',
            folders: [{ id: 'f1', name: '자료' }],
            maps: [{ title: '폴더 속 맵', when: '내 맵', hue: '#f0663f', docId: 'doc-in' }],
          },
        ],
        mapFolders: { '폴더 속 맵': 'f1' }, // legacy TITLE key
        recent: [],
      }),
    );
    const { container } = renderHomeWithDocStore([
      { id: 'doc-in', title: '폴더 속 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);

    // top level shows the folder (count 1), not the map
    await waitFor(() => expect(screen.getByText('자료')).toBeTruthy());
    expect(container.querySelector('.mf-map-grid a[data-title="폴더 속 맵"]')).toBeNull();
    // entering the folder shows the map — the migrated docId key resolves
    await user.dblClick(screen.getByText('자료')); // 폴더 진입 = 더블클릭
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="폴더 속 맵"]')).toBeTruthy());
  });

  it('폴더도 한 번 = 선택 / 두 번 = 진입 (맵 카드와 같은 규칙)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '기획' }] }],
        mapFolders: {},
        recent: [],
      }),
    );
    renderHomeWithDocStore([]);

    const tile = () => (screen.getByText('기획').closest('.map-card') as HTMLElement);
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    expect(tile().style.border).not.toContain('var(--mf-accent)');

    // 한 번 = 선택(진입하지 않는다). 선택 표시는 맵 카드와 같은 강조색 테두리.
    await user.click(tile());
    expect(screen.queryByText('이 폴더는 비어 있어요')).toBeNull();
    expect(tile().style.border).toBe('2px solid var(--mf-accent)');

    // 두 번 = 진입
    await user.dblClick(tile());
    await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());
  });

  it('맵 카드를 누른 뒤 곧바로 폴더를 한 번 눌러도 들어가지 않는다 (같은 dblclick 함정)', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [
          {
            id: 'sf',
            name: '폴더공간',
            color: '#3f8fd0',
            maps: [{ title: '바깥 맵', when: '내 맵', hue: '#f0663f', docId: 'doc-out' }],
            folders: [{ id: 'f1', name: '기획' }],
          },
        ],
        mapFolders: {},
        recent: [],
      }),
    );
    const { container } = renderHomeWithDocStore([
      { id: 'doc-out', title: '바깥 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    const card = container.querySelector('.mf-map-grid a[data-title="바깥 맵"]') as HTMLElement;
    const tile = screen.getByText('기획').closest('.map-card') as HTMLElement;

    fireEvent.click(card); // 다른 카드를 한 번
    fireEvent.click(tile); // 폴더를 한 번 — 크롬은 여기에 dblclick을 얹어 준다
    fireEvent.doubleClick(tile);
    expect(screen.queryByText('이 폴더는 비어 있어요')).toBeNull();
  });

  it('폴더에 들어간 직후 그 자리의 맵을 한 번 눌러도 열리지 않는다 (제보: 빠른 연속 클릭)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [
          {
            id: 'general',
            name: '일반 스페이스',
            home: true,
            color: '#f0663f',
            folders: [{ id: 'f1', name: '기획' }],
            maps: [{ title: '폴더 속 맵', when: '내 맵', hue: '#f0663f', docId: 'doc-in' }],
          },
        ],
        mapFolders: { 'doc-in': 'f1' },
        recent: [],
      }),
    );
    const { container } = renderHomeWithDocStore([
      { id: 'doc-in', title: '폴더 속 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);

    await user.dblClick(await screen.findByText('기획')); // 폴더 진입(더블클릭)
    const card = (await waitFor(() => container.querySelector('.mf-map-grid a[data-title="폴더 속 맵"]'))) as HTMLElement;

    // 폴더 진입 클릭에 이어 카드를 **한 번** 클릭 — 크롬은 같은 지점·시간이면 이
    // 클릭에 dblclick까지 얹어 준다(폴더 카드가 있던 자리에 맵 카드가 그려졌으므로).
    fireEvent.click(card);
    fireEvent.doubleClick(card);
    // 열기는 로더를 거쳐 0.9초 뒤에 이동하므로, "안 열렸다"는 URL이 아니라 **로더가
    // 뜨지 않았다**로 본다(즉시 판정 + 대기 시간에 기대지 않는다).
    expect(screen.queryByText('맵을 불러오고 있어요')).toBeNull();

    // 사용자가 진짜로 이 카드를 두 번 누르면 열린다.
    fireEvent.click(card);
    fireEvent.click(card);
    fireEvent.doubleClick(card);
    expect(screen.getByText('맵을 불러오고 있어요')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
  });

  it('permanently deletes a single trash entry via 영구 삭제 (confirm-gated, backend purge)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_recent', JSON.stringify(['영구삭제 맵']));
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-p', title: '영구삭제 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('영구삭제 맵')).toBeTruthy());

    await user.click(aside.getByRole('button', { name: "'영구삭제 맵' 영구 삭제" }));
    // destructive action is confirm-gated; the dialog's real <button> confirms
    const confirmBtn = screen.getAllByRole('button', { name: '영구 삭제' }).find((el) => el.tagName === 'BUTTON');
    expect(confirmBtn).toBeTruthy();
    await user.click(confirmBtn!);

    await waitFor(() => expect(aside.queryByText('영구삭제 맵')).toBeNull()); // trash row gone
    expect(docStore.purge).toHaveBeenCalledWith('doc-p'); // hard-deleted on the backend
    expect(docStore.remove).not.toHaveBeenCalled(); // not another soft delete
    // its recent entry is dropped too (the doc no longer exists anywhere)
    expect(JSON.parse(localStorage.getItem('mf_recent')!)).toEqual([]);
  });

  it('empties the whole trash via the header 비우기 action', async () => {
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-t1', title: '휴지통 맵 1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'doc-t2', title: '휴지통 맵 2', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('휴지통 맵 1')).toBeTruthy());

    await user.click(aside.getByText('비우기'));
    await user.click(screen.getByRole('button', { name: '모두 삭제' }));

    await waitFor(() => expect(aside.queryByText('휴지통 맵 1')).toBeNull());
    expect(aside.queryByText('휴지통 맵 2')).toBeNull();
    expect(docStore.purge).toHaveBeenCalledWith('doc-t1');
    expect(docStore.purge).toHaveBeenCalledWith('doc-t2');
    expect(aside.getByText('휴지통이 비어 있습니다')).toBeTruthy();
  });

  it('unfavorites from the LNB favorites list via the leading star button', async () => {
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-f', title: '즐겨찾는 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
    ]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('즐겨찾는 맵')).toBeTruthy());

    // The star strips the favorite (row disappears, backend persisted)…
    await user.click(aside.getByRole('button', { name: "'즐겨찾는 맵' 즐겨찾기 해제" }));
    await waitFor(() => expect(aside.queryByText('즐겨찾는 맵')).toBeNull());
    expect(docStore.setFavorite).toHaveBeenCalledWith('doc-f', false);
    // …without opening the map (the row's click handler must not fire).
    expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();
    // The map itself is untouched — still in the grid.
    expect(container.querySelector('.mf-map-grid a[data-title="즐겨찾는 맵"]')).toBeTruthy();
  });

  // 마크다운: 카드 ☰ → 내보내기 → Markdown 개요(.md). 그 파일을 그대로 다시
  // 가져오면 트리·노트·메모가 복원되는지도 한 번에 확인한다(왕복).
  describe('Markdown 내보내기/가져오기', () => {
    const MD_DOC = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '개요 맵', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0, note: '루트 노트' },
        c1: { id: 'c1', text: '가지', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [{ id: 'm1', x: 0, y: 0, w: 180, text: '메모 하나' }],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    };

    it('카드 메뉴에서 .md 로 내려받는다', async () => {
      const user = userEvent.setup();
      localStorage.setItem('mindflow_doc_doc-md', JSON.stringify(MD_DOC));
      const created: Blob[] = [];
      URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
        created.push(b as Blob);
        return 'blob:mock';
      }) as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
      const names: string[] = [];
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });

      const { container } = renderHomeWithDocStore([{ id: 'doc-md', title: '개요 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);
      await waitFor(() => expect(container.querySelector('a[data-title="개요 맵"]')).toBeTruthy());

      const card = container.querySelector('a[data-title="개요 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'Markdown 개요 (.md)' }));

      expect(names[0]).toBe('개요 맵.md');
      const md = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(created[0]!);
      });
      expect(md).toMatch(/^# 개요 맵$/m);
      expect(md).toMatch(/^\s*> 루트 노트$/m);
      expect(md).toMatch(/^## 메모$/m);
      clickSpy.mockRestore();
    });

    it('카드 메뉴에서 .svg 로 내려받는다 — 벡터 문서에 노드·메모 텍스트', async () => {
      const user = userEvent.setup();
      localStorage.setItem('mindflow_doc_doc-svg', JSON.stringify(MD_DOC));
      const created: Blob[] = [];
      URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
        created.push(b as Blob);
        return 'blob:mock';
      }) as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
      const names: string[] = [];
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });

      const { container } = renderHomeWithDocStore([{ id: 'doc-svg', title: '개요 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);
      await waitFor(() => expect(container.querySelector('a[data-title="개요 맵"]')).toBeTruthy());

      const card = container.querySelector('a[data-title="개요 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'SVG 이미지 (.svg)' }));

      await waitFor(() => expect(created.length).toBe(1));
      expect(names[0]).toBe('개요 맵.svg');
      const svg = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(created[0]!);
      });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toContain('개요 맵');
      expect(svg).toContain('메모 하나');
      clickSpy.mockRestore();
    });

    it('내보낸 .md 를 다시 가져오면 트리·노트·메모가 복원된다', async () => {
      const user = userEvent.setup();
      // 위 테스트가 만드는 것과 같은 내용의 개요
      const md = ['# 개요 맵', '  > 루트 노트', '- 가지', '', '## 메모', '- 메모 하나'].join('\n');
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByRole('button', { name: /새로 만들기/ })).toBeTruthy());

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, new File([md], '개요 맵.md', { type: 'text/markdown' }));
      await waitFor(() => expect(screen.getByText(/추가했어요/)).toBeTruthy());
      await user.click(screen.getByRole('button', { name: '확인' }));
      await waitFor(() => expect(container.querySelector('a[data-title="개요 맵"]')).toBeTruthy());

      // 저장된 본문에 노트와 메모가 들어 있어야 한다(예전엔 둘 다 잃었다).
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('mindflow_doc_') && !k.includes('_meta_'));
      const raw = localStorage.getItem(keys[0] as string) as string;
      const doc = JSON.parse(raw) as { nodes: Record<string, { text: string; note?: string }>; floats: { text: string }[] };
      expect(doc.nodes.root?.text).toBe('개요 맵');
      expect(doc.nodes.root?.note).toBe('루트 노트');
      expect(Object.values(doc.nodes).map((n) => n.text)).toContain('가지');
      expect(doc.floats.map((f) => f.text)).toEqual(['메모 하나']);
    });
  });

  // 카드가 들고 있는 본문은 **썸네일용**이다 — `preview_doc` RPC(0012)가 전송량을
  // 아끼려고 이미지 데이터를 'stripped'로 지운 것. 썸네일에는 충분하지만 내보내기가
  // 그걸 쓰면 JSON에 `"img":"stripped"`가 담기고, 가져온 맵은 `<img src="stripped">`가
  // 되어 **깨진 이미지**로 보인다(제보). PNG도 같은 이유로 빈 상자만 남는다.
  describe('내보내기는 썸네일 본문이 아니라 전문을 쓴다', () => {
    const REF = 'mfimg:원본문서/pic.webp';
    const PIXEL = 'data:image/webp;base64,' + btoa('webp-bytes');

    function docs(): { full: Doc; preview: string } {
      const full = {
        v: 1,
        nodes: {
          root: { id: 'root', text: '사진 맵', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
          c1: { id: 'c1', text: '스크린샷', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, img: REF, imgW: 180, imgH: 120 },
        },
        floats: [],
        lines: [],
        zones: [],
        layoutMode: 'radial',
        themeKey: 'coral',
      } as unknown as Doc;
      // RPC가 돌려주는 모습 그대로: 크기 필드는 남고 이미지 값만 지워진다.
      const preview = JSON.stringify({ ...full, nodes: { ...full.nodes, c1: { ...full.nodes.c1, img: 'stripped' } } });
      return { full, preview };
    }

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }) })));
      vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
        Object.defineProperty(this, 'result', { value: PIXEL, configurable: true });
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('썸네일 본문에 이미지가 지워져 있으면 전문을 다시 받아 실물을 담는다', async () => {
      const user = userEvent.setup();
      const { full, preview } = docs();
      const load = vi.fn(async () => ({ doc: full, version: 1, title: '사진 맵' }));
      const docStore = {
        list: async () => [{ id: 'doc-img', title: '사진 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
        load,
        loadPreview: vi.fn(async () => preview),
        listEditorNames: async () => ({}),
        setFavorite: async () => undefined,
        remove: async () => undefined,
        restore: async () => undefined,
        purge: async () => undefined,
        rename: async () => undefined,
        save: async () => ({ ok: true as const, version: 1 }),
      } as unknown as DocStore;
      const imageStore = {
        upload: async () => null,
        resolve: async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `https://cdn.example/${encodeURIComponent(r)}`])),
        removeForDoc: async () => undefined,
      };
      const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore, commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };

      const created: Blob[] = [];
      URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
        created.push(b as Blob);
        return 'blob:mock';
      }) as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(container.querySelector('a[data-title="사진 맵"]')).toBeTruthy());
      // 썸네일 본문이 카드에 실린 뒤에 내보낸다 — 그게 이 회귀가 나던 상태다.
      await waitFor(() => expect(docStore.loadPreview).toHaveBeenCalled());

      const card = container.querySelector('a[data-title="사진 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'JSON 파일 (.json)' }));

      await waitFor(() => expect(created).toHaveLength(1));
      const json = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(created[0]!);
      });
      expect(load).toHaveBeenCalledWith('doc-img'); // 전문을 다시 받았다
      expect(json).not.toContain('stripped'); // 수리 전: "img": "stripped" 가 그대로 담겼다
      expect(json).toContain('data:image'); // 실물이 들어 있다 = 가져오면 그대로 보인다
    });
  });

  // 공유(0009): `DocStore.list()`가 남이 나에게 공유한 문서까지 돌려준다. 워크스페이스
  // (스페이스·폴더·즐겨찾기·휴지통)는 per-user 블롭이라, 남의 문서를 여기 섞으면 내
  // 스페이스에 카드로 박히고 그대로 저장돼 버린다.
  describe('공유받은 문서는 내 워크스페이스를 오염시키지 않는다', () => {
    const mine: DocMeta = { id: 'mine', title: '내 맵', version: 1, updatedAt: '2026-01-02T00:00:00.000Z', isFavorite: false, deletedAt: null, ownedByMe: true };
    // 제목을 섹션 이름("공유받음")과 겹치지 않게 둔다 — LNB 헤더와 행 제목을 구분해
    // 단정해야 하기 때문.
    const theirs: DocMeta = { id: 'theirs', title: '남의 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null, ownedByMe: false, sharedRole: 'edit' };

    it('남의 문서는 내 스페이스 카드가 되지 않고, 저장되는 블롭에도 들어가지 않는다', async () => {
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      const { container } = renderHomeWithDocStore([mine, theirs]);

      // 내 문서는 카드가 된다
      await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="내 맵"]')).toBeTruthy());
      // 남이 공유한 문서는 그리드에 없다
      expect(container.querySelector('.mf-map-grid a[data-title="남의 맵"]')).toBeNull();

      // 저장된 워크스페이스에도 없어야 한다(있으면 내 것으로 굳어 버린다).
      // (내 문서 카드는 매 로드에 메타에서 다시 파생되므로 블롭에 없을 수 있다 —
      //  여기서 중요한 건 **남의 문서가 들어가지 않는다**는 것이다.)
      const saved = JSON.parse(localStorage.getItem('mf_spaces') as string) as { spaces: { maps: { title: string }[] }[] };
      expect(saved.spaces[0]!.maps.map((m) => m.title)).not.toContain('남의 맵');
    });

    // 제보: 처음엔 본문 상단에 최근 항목과 같은 카드 트레이로 놓았는데 "상단을 너무
    // 많이 잡아먹고" 있었다 → LNB의 접이식 항목(즐겨찾기·휴지통과 같은 꼴)으로 옮겼다.
    it('공유받은 문서는 LNB "공유받음" 항목으로 뜨고, 본문 상단을 차지하지 않는다', async () => {
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      const { container } = renderHomeWithDocStore([mine, theirs]);

      const aside = within(container.querySelector('aside') as HTMLElement);
      await waitFor(() => expect(aside.getByText('공유받음')).toBeTruthy()); // 섹션 헤더(범용 명칭 — 사용자 결정)
      const row = await waitFor(() => aside.getByTitle("'남의 맵' 열기 (함께 편집)"));
      expect(row.textContent).toContain('남의 맵');

      // 본문(main)에는 아무 것도 추가되지 않는다 — 그리드에도, 상단 트레이에도 없다.
      const main = container.querySelector('main') as HTMLElement;
      expect(within(main).queryByText('공유받음')).toBeNull();
      expect(container.querySelector('.mf-map-grid a[data-title="남의 맵"]')).toBeNull();
    });

    it('LNB 항목을 클릭하면 그 문서를 연다', async () => {
      const user = userEvent.setup();
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      const { container } = renderHomeWithDocStore([mine, theirs]);
      const aside = within(container.querySelector('aside') as HTMLElement);
      const row = await waitFor(() => aside.getByTitle("'남의 맵' 열기 (함께 편집)"));

      await user.click(row);

      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
      // 최근 항목에 그 **문서 id**로 남아야 한다(제목 키로 남기면 같은 제목의 내
      // 맵과 뒤섞인다 — `cardKeyOf`).
      expect(JSON.parse(localStorage.getItem('mf_recent') || '[]')).toContain('theirs');
    });

    it('보기 전용으로 공유받았으면 그 사실을 행에 표시한다', async () => {
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      const { container } = renderHomeWithDocStore([mine, { ...theirs, sharedRole: 'view' }]);
      const aside = within(container.querySelector('aside') as HTMLElement);
      const row = await waitFor(() => aside.getByTitle("'남의 맵' 열기 (보기 전용)"));
      expect(row.textContent).toContain('보기');
    });

    it('공유받은 게 없어도 "공유받음" 항목은 항상 있고, 빈 안내를 보여 준다 (고정 노출 — 사용자 결정)', async () => {
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      const { container } = renderHomeWithDocStore([mine]);
      await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="내 맵"]')).toBeTruthy());
      const aside = within(container.querySelector('aside') as HTMLElement);
      expect(aside.getByText('공유받음')).toBeTruthy();
      expect(aside.getByText('공유받은 항목이 없습니다')).toBeTruthy();
    });

    // 초대 알림 ①(0019): 맵을 공유받아도 상대는 알 길이 없었다 — 직접 "링크 보냈어"라고
    // 말해 줘야 했다. 아직 열어 보지 않은 초대를 LNB 배지로 알린다.
    describe('초대 알림 배지', () => {
      /** 이 브라우저의 데모 세션 + 아직 확인하지 않은 초대 한 건을 심는다. */
      function seedUnseenInvite(docId: string): void {
        localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
        localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: docId, email: 'me@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
      }

      it('아직 열어 보지 않은 초대를 배지와 점으로 알리고, 열면 사라진다', async () => {
        const user = userEvent.setup();
        localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
        seedUnseenInvite('theirs');
        const { container } = renderHomeWithDocStore([mine, theirs]);

        const aside = within(container.querySelector('aside') as HTMLElement);
        expect(await waitFor(() => aside.getByLabelText('확인하지 않은 공유 1개'))).toBeTruthy();
        expect(aside.getByLabelText('새로 공유됨')).toBeTruthy();

        await user.click(aside.getByTitle("'남의 맵' 열기 (함께 편집)"));

        // 열면 배지가 사라지고, "봤다"가 저장소에 남는다(다른 기기에서도 안 뜨도록).
        await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
        const stored = JSON.parse(localStorage.getItem('mf_doc_shares') || '[]') as { seenAt?: string | null }[];
        expect(stored[0]?.seenAt).toBeTruthy();
      });

      it('모바일에서는 서랍이 닫혀 있어도 ☰에 점이 뜬다', async () => {
        mockMatchMedia(true);
        try {
          localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
          seedUnseenInvite('theirs');
          const { container } = renderHomeWithDocStore([mine, theirs]);

          const menu = await waitFor(() => screen.getByLabelText('메뉴 열기, 확인하지 않은 공유 1개'));
          expect(menu.querySelector('[data-unread-dot]')).toBeTruthy();
          expect(container).toBeTruthy();
        } finally {
          mockMatchMedia(false);
        }
      });

      // 제보: 홈 테마를 바꾸면 배지 색까지 함께 바뀌었다. 배지는 강조 UI가 아니라
      // **알림**이라 테마와 무관하게 같은 색이어야 한다(모노 테마에서는 강조색이
      // 회색이라 알림처럼 보이지도 않았다).
      it('배지 색은 홈 테마를 따라가지 않는다', async () => {
        localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
        localStorage.setItem('mf_home_theme', 'ocean'); // 강조색이 파랑인 테마
        seedUnseenInvite('theirs');
        const { container } = renderHomeWithDocStore([mine, theirs]);

        const aside = within(container.querySelector('aside') as HTMLElement);
        // jsdom은 hex를 rgb()로 정규화한다 — 값을 맞춰 비교한다.
        const rgb = (hex: string): string => {
          const n = parseInt(hex.slice(1), 16);
          return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
        };
        const badge = await waitFor(() => aside.getByLabelText('확인하지 않은 공유 1개'));
        expect(badge.style.background).toBe(rgb(UNREAD_BADGE_BG));
        expect(badge.style.background).not.toContain('var('); // 테마 변수를 쓰지 않는다
        expect(aside.getByLabelText('새로 공유됨').style.background).toBe(rgb(UNREAD_BADGE_BG));
        // 파랑 테마의 강조색과 달라야 한다(= 테마를 따라가지 않는다).
        expect(badge.style.background).not.toBe(rgb(HOME_THEMES.ocean.accent));
      });

      it('이미 확인한 초대는 배지를 만들지 않는다', async () => {
        localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
        localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
        localStorage.setItem(
          'mf_doc_shares',
          JSON.stringify([{ documentId: 'theirs', email: 'me@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z', seenAt: '2026-01-02T00:00:00.000Z' }]),
        );
        const { container } = renderHomeWithDocStore([mine, theirs]);

        const aside = within(container.querySelector('aside') as HTMLElement);
        await waitFor(() => expect(aside.getByTitle("'남의 맵' 열기 (함께 편집)")).toBeTruthy());
        expect(aside.queryByLabelText(/확인하지 않은 공유/)).toBeNull();
        expect(aside.queryByLabelText('새로 공유됨')).toBeNull();
      });

      // 0019가 아직 안 간 서버에서는 `seenAt`을 알 수 없다(undefined). 그때 "안 봤다"로
      // 치면 **없는 알림**을 만들어 낸다 — 모든 공유가 새것처럼 보인다.
      it('seen 정보를 얻을 수 없으면(구 서버) 배지를 띄우지 않는다', async () => {
        localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
        const legacyShareStore = new LocalShareStore();
        legacyShareStore.listSharedWithMe = async () => [{ documentId: 'theirs', role: 'edit' as const }];
        const docStore = new MockDocStore([mine, theirs], {});
        const backend: Backend = {
          auth: new LocalAuth(),
          docStore,
          spaceStore: new LocalSpaceStore(),
          shareStore: legacyShareStore,
          feedbackStore: new LocalFeedbackStore(),
          imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(),
          mode: 'local',
        };
        const { container } = render(
          <MemoryRouter initialEntries={['/home']}>
            <BackendProvider backend={backend}>
              <Routes>
                <Route path="/home" element={<Home />} />
                <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
              </Routes>
            </BackendProvider>
          </MemoryRouter>,
        );

        const aside = within(container.querySelector('aside') as HTMLElement);
        await waitFor(() => expect(aside.getByTitle("'남의 맵' 열기 (함께 편집)")).toBeTruthy());
        expect(aside.queryByLabelText(/확인하지 않은 공유/)).toBeNull();
      });
    });

    it('남의 문서의 즐겨찾기·휴지통 상태가 내 것으로 새지 않는다', async () => {
      localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 공간', color: '#f0663f', home: true, maps: [], folders: [] }], mapFolders: {} }));
      // `theirs`는 isFavorite: true — 소유자가 별을 달아 둔 상태다. 내 LNB에는 안 보여야 한다.
      const { container } = renderHomeWithDocStore([mine, { ...theirs, deletedAt: '2026-01-03T00:00:00.000Z' }]);
      await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="내 맵"]')).toBeTruthy());

      const aside = within(container.querySelector('aside') as HTMLElement);
      expect(aside.queryByText('남의 맵')).toBeNull(); // 즐겨찾기·휴지통·공유받음 어디에도 없다
      expect(aside.getByText('공유받은 항목이 없습니다')).toBeTruthy(); // 휴지통에 들어간 공유 문서는 행을 만들지 않는다
    });
  });

  describe('mobile (M6)', () => {
    it('collapses the toolbar actions into icon-only buttons on one row (no stray action line)', async () => {
      // On mobile the labeled 가져오기/새 폴더 pair used to wrap onto a lonely line
      // of its own; they now render as 44px icon-only buttons inside the search
      // row, and the primary CTA becomes an icon-only "+" — labels live on
      // aria-label/title so they stay accessible.
      const restore = mockMatchMedia(true);
      try {
        renderHome();
        await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeTruthy());
        const importBtn = screen.getByRole('button', { name: '가져오기' });
        const folderBtn = screen.getByRole('button', { name: '새 폴더' });
        const newBtn = screen.getByRole('button', { name: '새로 만들기' });
        // icon-only: the visible label text is gone…
        expect(importBtn.textContent).toBe('');
        expect(folderBtn.textContent).toBe('');
        expect(newBtn.textContent).toBe(''); // toolbar CTA is icon-only (the empty-state CTA keeps its label)
        // …and every action keeps the 44px touch target (§7)
        expect(importBtn.style.width).toBe('44px');
        expect(folderBtn.style.width).toBe('44px');
        expect(newBtn.style.width).toBe('44px');
        // all three live in the SAME row container as the search field
        const row = screen.getByPlaceholderText('모든 스페이스에서 검색').closest('div')!.parentElement!;
        expect(row.contains(importBtn)).toBe(true);
        expect(row.contains(folderBtn)).toBe(true);
        expect(row.contains(newBtn)).toBe(true);
      } finally {
        restore();
      }
    });

    it('opens the drawer on a left-edge swipe right, and closes it on a swipe left', async () => {
      const restore = mockMatchMedia(true);
      try {
        const { container } = renderHome();
        expect(container.querySelector('aside')).toBeNull();

        // A swipe that does NOT start at the left edge must not open the drawer…
        fireEvent.touchStart(document, { touches: [{ clientX: 120, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 260, clientY: 300 }] });
        fireEvent.touchEnd(document);
        expect(container.querySelector('aside')).toBeNull();

        // …and neither must a vertical (scroll) gesture that begins at the edge.
        fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 200 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 16, clientY: 320 }] });
        fireEvent.touchEnd(document);
        expect(container.querySelector('aside')).toBeNull();

        // Left-edge swipe right → drawer opens.
        fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 90, clientY: 306 }] });
        fireEvent.touchEnd(document);
        await waitFor(() => expect(container.querySelector('aside')).toBeTruthy());

        // Swipe left anywhere while open → drawer closes.
        fireEvent.touchStart(document, { touches: [{ clientX: 220, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 120, clientY: 296 }] });
        fireEvent.touchEnd(document);
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });

    it('맵 카드는 데스크톱과 같이 한 번=선택 / 두 번(더블탭)=열기 — 한 번에 열리면 ☰ 메뉴를 쓸 수 없다', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHomeWithDocStore([
          { id: 'doc-m', title: '모바일 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ]);
        await waitFor(() => expect(container.querySelector('a[data-title="모바일 맵"]')).toBeTruthy());

        // ☰ 메뉴 탭은 여전히 이동하지 않는다.
        const card = container.querySelector('a[data-title="모바일 맵"]') as HTMLElement;
        await user.click(within(card).getByRole('button', { name: '메뉴' }));
        expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();

        // 첫 탭: 선택만 — 에디터로 넘어가지 않아야 ☰에 손댈 수 있다.
        await user.click(card);
        await new Promise((r) => setTimeout(r, 1200)); // 로더 지연(900ms)을 넘겨도
        expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();

        // 두 번째 탭이 임계값 안에 들어오면 연다.
        await user.click(card);
        await user.click(card);
        await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
      } finally {
        restore();
      }
    });

    it('최근 항목 카드도 같은 규칙 — 한 번 탭으로는 열리지 않는다', async () => {
      const restore = mockMatchMedia(true);
      try {
        localStorage.setItem('mf_recent', JSON.stringify(['doc-r']));
        localStorage.setItem(
          'mf_spaces',
          JSON.stringify({ spaces: [{ id: 's1', name: '일반 공간', color: '#f0663f', maps: [{ title: '최근 맵', when: '방금', hue: '#f0663f', docId: 'doc-r' }], folders: [] }], mapFolders: {} }),
        );
        const user = userEvent.setup();
        const { container } = renderHomeWithDocStore([
          { id: 'doc-r', title: '최근 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ]);
        const tray = await waitFor(() => {
          const el = container.querySelector('.mf-recent-scroll a');
          if (!el) throw new Error('recent card not rendered');
          return el as HTMLElement;
        });

        await user.click(tray);
        await new Promise((r) => setTimeout(r, 1200));
        expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();

        await user.click(tray);
        await user.click(tray);
        await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
      } finally {
        restore();
      }
    });

    it('hides the sidebar behind a hamburger drawer and opens/closes it, crash-free', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHome();

        // Drawer starts closed: no <aside> in the document at all (not just hidden).
        expect(container.querySelector('aside')).toBeNull();
        expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));

        const sidebar = within(container.querySelector('aside') as HTMLElement);
        expect(sidebar.getByText('스페이스')).toBeTruthy();
        // No ✕ button — the drawer closes via backdrop tap, left swipe, or Esc.
        expect(screen.queryByRole('button', { name: '메뉴 닫기' })).toBeNull();

        // Backdrop tap closes. The drawer plays its exit slide before unmounting
        // (Sidebar keeps the aside mounted for DRAWER_EXIT_MS), so closing is
        // observed via waitFor.
        fireEvent.click(container.parentElement!.querySelector('.mf-drawer-backdrop')!);
        expect(container.querySelector('aside')).toBeTruthy(); // still mounted, sliding out…
        await waitFor(() => expect(container.querySelector('aside')).toBeNull()); // …then gone

        // Escape closes too — the keyboard-accessible path now that ✕ is gone.
        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));
        expect(container.querySelector('aside')).toBeTruthy();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });

    it('animates the drawer: mounts off-screen, slides in, and slides out before unmounting', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHome();

        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));
        const aside = container.querySelector('aside') as HTMLElement;
        expect(aside.className).toContain('mf-drawer'); // transition class attached
        // Mounts at the off-screen position; the next frames flip it on-screen
        // (double rAF), which is what makes the enter transition actually play.
        expect(aside.style.transform).toBe('translateX(-105%)');
        await waitFor(() => expect(aside.style.transform).toBe('translateX(0)'));

        await user.keyboard('{Escape}');
        // Exit phase: still mounted but translated back off-screen (sliding)…
        expect(container.querySelector('aside')).toBeTruthy();
        expect((container.querySelector('aside') as HTMLElement).style.transform).toBe('translateX(-105%)');
        // …and only unmounts after the slide finishes.
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });
  });

  describe('favorites/trash persistence (DocStore-wired)', () => {
    it('favoriting a doc-backed card calls docStore.setFavorite(docId, true)', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([
        { id: 'doc1', title: '새 맵 하나', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('새 맵 하나')).toBeTruthy());
      const card = container.querySelector('a[data-title="새 맵 하나"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '즐겨찾기' }));

      expect(docStore.setFavorite).toHaveBeenCalledWith('doc1', true);
    });

    it('reveals the ☰ menu button when its card is selected (so it is reachable without hover, e.g. on touch)', async () => {
      const user = userEvent.setup();
      const { container } = renderHomeWithDocStore([
        { id: 'doc-sel', title: '선택할 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('선택할 맵')).toBeTruthy());
      const card = container.querySelector('a[data-title="선택할 맵"]') as HTMLElement;
      const menuBtn = within(card).getByRole('button', { name: '메뉴' }) as HTMLElement;

      // hidden by default (only the hover CSS would show it — absent on touch)
      expect(menuBtn.style.opacity).toBe('0');

      await user.click(card); // a single click selects the card
      expect(menuBtn.style.opacity).toBe('1'); // …which now exposes the ☰ menu
    });

    it('renders 최근 항목 (recent) cards as a compact variant with no ☰ menu button', async () => {
      localStorage.setItem('mf_recent', JSON.stringify(['최근 맵']));
      const { container } = renderHomeWithDocStore([
        { id: 'doc-rec', title: '최근 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      // the recent card is the first card with this title (recent section renders above 맵)
      const recentCard = container.querySelectorAll('a[data-title="최근 맵"]')[0] as HTMLElement;
      // no ☰ menu button on a recent card…
      expect(within(recentCard).queryByRole('button', { name: '메뉴' })).toBeNull();
      // …and it's the compact thumbnail (72px), not the full 150px one
      const thumb = recentCard.querySelector('.map-thumb') as HTMLElement;
      expect(thumb.style.height).toBe('72px');

      // the main-grid copy of the same map keeps its full card + ☰ menu
      const mainCard = container.querySelectorAll('a[data-title="최근 맵"]')[1] as HTMLElement;
      expect(within(mainCard).getByRole('button', { name: '메뉴' })).toBeTruthy();
      expect((mainCard.querySelector('.map-thumb') as HTMLElement).style.height).toBe('150px');
    });

    it('renders the 최근 항목 (recent) section as a fixed-card horizontal tray (design-system §8.1)', async () => {
      const titles = ['맵 A', '맵 B', '맵 C', '맵 D', '맵 E', '맵 F'];
      localStorage.setItem('mf_recent', JSON.stringify(titles));
      const { container } = renderHomeWithDocStore(
        titles.map((title, i) => ({
          id: `doc-${i}`,
          title,
          version: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          isFavorite: false,
          deletedAt: null,
        })),
      );

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      // recent cards are the compact variant (72px thumbnail)
      const recent = [...container.querySelectorAll('a[data-title]')].filter((c) => {
        const th = c.querySelector('.map-thumb') as HTMLElement | null;
        return th?.style.height === '72px';
      });
      // Desktop exposes only as many cards as FIT the measured width — jsdom has
      // no layout (clientWidth 0), so the strip keeps its pre-measurement default
      // (3). The point: a long history collapses to one width-fitted row, it does
      // not all mount.
      expect(recent.length).toBe(3);
      expect(recent.length).toBeLessThan(titles.length);

      // Defensive (design-system §8.1): each card sits in a FIXED-width,
      // NON-STRETCHING slot — `flex: 0 0 auto`, never `flex: 1` (the flex analogue
      // of `1fr`, which is what previously made cards balloon "wide").
      const scroll = container.querySelector('.mf-recent-scroll') as HTMLElement;
      expect(scroll.style.overflowX).toBe('auto');
      // 선택 링(카드 밖 3px 글로우)이 잘리지 않게 스크롤 박스에 여유를 두고 같은
      // 크기의 음수 마진으로 상쇄한다 — `overflow-x: auto`는 세로축까지 auto로
      // 만들어(CSS 규칙) 여유가 없으면 위·아래·왼쪽이 잘렸다(제보).
      expect(parseFloat(scroll.style.padding)).toBeGreaterThanOrEqual(3);
      expect(parseFloat(scroll.style.margin)).toBe(-parseFloat(scroll.style.padding));
      recent.forEach((card) => {
        const slot = card.parentElement as HTMLElement;
        expect(slot.style.width).toBe('128px');
        expect(slot.style.flex).toContain('0 0 auto');
      });
    });

    it('mobile: the recent tray swipes through the history instead of cutting to the fit count', async () => {
      // Width-fit on a phone would strand everything past the ~2 cards that fit —
      // mobile keeps the swipeable overflow row (bounded by MOBILE_SWIPE_MAX).
      const restore = mockMatchMedia(true);
      try {
        const titles = ['맵 A', '맵 B', '맵 C', '맵 D', '맵 E', '맵 F'];
        localStorage.setItem('mf_recent', JSON.stringify(titles));
        const { container } = renderHomeWithDocStore(
          titles.map((title, i) => ({
            id: `doc-${i}`,
            title,
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            isFavorite: false,
            deletedAt: null,
          })),
        );
        await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
        const recent = [...container.querySelectorAll('a[data-title]')].filter((c) => {
          const th = c.querySelector('.map-thumb') as HTMLElement | null;
          return th?.style.height === '72px';
        });
        expect(recent.length).toBe(titles.length); // all reachable by swiping
      } finally {
        restore();
      }
    });

    it('migrates legacy title recents through a rename onto the docId key', async () => {
      // LEGACY recents were title-keyed: editing a map's root text renamed it
      // and the old-title entry matched nothing — every rename permanently
      // killed that recent card. The entry now rides the rename migration and
      // then lands on the docId key, where future renames can't touch it.
      localStorage.setItem('mf_recent', JSON.stringify(['옛 이름']));
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          v: 1,
          spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '옛 이름', when: '내 맵', hue: '#f0663f', docId: 'doc-r' }] }],
          mapFolders: {},
          recent: ['옛 이름'],
        }),
      );
      // The backend meta carries the map's post-rename title.
      const { container } = renderHomeWithDocStore([
        { id: 'doc-r', title: '새 이름', version: 2, updatedAt: '2026-01-02T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      const tray = container.querySelector('.mf-recent-tray') as HTMLElement;
      expect(tray.querySelector('a[data-title="새 이름"]')).toBeTruthy(); // follows the rename
      expect(tray.querySelector('a[data-title="옛 이름"]')).toBeNull();
      // …and this device's persisted list is kept in step, now docId-keyed
      expect(JSON.parse(localStorage.getItem('mf_recent')!)).toEqual(['doc-r']);
    });

    it('prefetches thumbnail bodies for recent maps living in OTHER spaces (they render in the tray)', async () => {
      // Regression: the preview prefetch was scoped to the ACTIVE space's maps
      // only, but the recent tray is cross-space — a recent map from another
      // space never resolved and sat on the loading skeleton forever.
      localStorage.setItem('mf_recent', JSON.stringify(['작업맵']));
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          v: 1,
          spaces: [
            { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '일반맵', when: '내 맵', hue: '#f0663f', docId: 'doc-g' }] },
            { id: 'work', name: '작업', color: '#3f8fd0', maps: [{ title: '작업맵', when: '내 맵', hue: '#3f8fd0', docId: 'doc-w' }] },
          ],
          mapFolders: {},
          recent: ['작업맵'],
        }),
      );
      const { docStore } = renderHomeWithDocStore([
        { id: 'doc-g', title: '일반맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        { id: 'doc-w', title: '작업맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      // active space is 일반 공간, yet the 작업-space recent's body must be fetched too
      // (썸네일 본문은 loadPreview 경로 — load 전문이 아니라)
      const fetched = () => docStore.loadPreview.mock.calls.map((c) => c[0]);
      await waitFor(() => expect(fetched()).toContain('doc-w'));
      expect(fetched()).toContain('doc-g'); // active space still prefetches
    });

    it('deleting calls docStore.remove(docId), restoring calls docStore.restore(docId)', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([
        { id: 'doc2', title: '삭제할 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('삭제할 맵')).toBeTruthy());
      const card = container.querySelector('a[data-title="삭제할 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: '삭제하기' }));

      // ConfirmModal is always mounted (display:none when hidden), so only the
      // now-visible delete-map dialog's button is in the accessibility tree —
      // the folder/space delete dialogs (also labeled "삭제") stay excluded.
      await user.click(screen.getByRole('button', { name: '삭제' }));
      expect(docStore.remove).toHaveBeenCalledWith('doc2');

      // The trash list's "복원" link is always in the DOM (CSS-collapsed, not
      // unmounted) regardless of the "휴지통" section's open/closed state.
      const restoreLink = container.querySelector('.restore-link') as HTMLElement;
      expect(restoreLink).toBeTruthy();
      await user.click(restoreLink);

      // Disambiguate from the (still-present) "복원" restore-link span, which
      // also matches role=button/name=복원 — only the confirm dialog uses a
      // real <button>.
      const restoreConfirmBtn = screen.getAllByRole('button', { name: '복원' }).find((el) => el.tagName === 'BUTTON');
      expect(restoreConfirmBtn).toBeTruthy();
      await user.click(restoreConfirmBtn!);

      expect(docStore.restore).toHaveBeenCalledWith('doc2');
    });

    it('permanently deletes a workspace-only (docId-less) card — removed from the persisted workspace so it cannot reappear on reload', async () => {
      const user = userEvent.setup();
      // A space whose card has NO docId (the reported "새 마인드맵_1 (2)" case):
      // deletion used to only set a session-only `deleted[title]`, so a refresh
      // (which re-reads this workspace) brought the card straight back.
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          spaces: [{ id: 'snew', name: '신규 공간', color: '#3f8fd0', maps: [{ title: '새 마인드맵_1 (2)', when: '내 맵', hue: '#f0663f' }], folders: [] }],
          mapFolders: {},
        }),
      );
      const { container, unmount } = renderHomeWithDocStore([]); // no doc metas

      await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeTruthy());
      const card = container.querySelector('a[data-title="새 마인드맵_1 (2)"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: '삭제하기' }));
      await user.click(screen.getByRole('button', { name: '삭제' }));

      // gone from the grid…
      await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeNull());
      // …and REMOVED from the persisted workspace (the reload source of truth)
      await waitFor(() => {
        const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces?: { maps?: { title: string }[] }[] };
        const titles = (ws.spaces || []).flatMap((s) => (s.maps || []).map((m) => m.title));
        expect(titles).not.toContain('새 마인드맵_1 (2)');
      });

      // simulate a browser refresh: a fresh mount reads the persisted workspace
      unmount();
      const { container: c2 } = renderHomeWithDocStore([]);
      await waitFor(() => expect(within(c2).getAllByText('신규 공간').length).toBeGreaterThan(0)); // loaded
      expect(c2.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeNull();
    });

    it('seeds trash from docStore.list() metas on mount (refresh scenario: deletedAt survives reload)', async () => {
      const { container } = renderHomeWithDocStore([
        // A live doc still present in the grid (sanity anchor).
        { id: 'doc-live', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        // A meta with deletedAt already set — as if a previous session had
        // deleted it and the page is now reloading. Before the fix,
        // `deleted`/`trash` always started empty, so this card would reappear
        // as a regular map.
        { id: 'doc3', title: '무상 비즈머니 지급', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      ]);

      // Sanity: an unrelated live doc still renders normally.
      await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());

      // Seeded as deleted => no card for it in the regular map grid...
      await waitFor(() => expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeNull());
      // ...but it shows up in the trash sidebar list with a working restore link.
      const trashRow = Array.from(container.querySelectorAll('.drive-file')).find((el) => (el.textContent || '').includes('무상 비즈머니 지급'));
      expect(trashRow).toBeTruthy();
      expect(trashRow?.querySelector('.restore-link')).toBeTruthy();
    });

    it('seeds favorites from docStore.list() metas on mount (refresh scenario: isFavorite survives reload)', async () => {
      const { container } = renderHomeWithDocStore([
        { id: 'doc4', title: '따라잡기', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
      ]);

      // Still shows as a regular card (favoriting doesn't hide it)...
      await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
      // ...and the card's own favorite star renders as "on" (filled, not hollow).
      const card = container.querySelector('a[data-title="따라잡기"]') as HTMLElement;
      expect(within(card).getByRole('button', { name: '즐겨찾기 해제' })).toBeTruthy();
    });

    it('a favorited+deleted map on reload lands ONLY in trash, never in favorites (LNB)', async () => {
      const { container } = renderHomeWithDocStore([
        // A live favorite (sanity anchor — should stay in the favorites list).
        { id: 'fav-live', title: '살아있는 즐겨찾기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
        // The bug case: favorited AND deleted. `remove()` only sets deletedAt,
        // so the persisted meta still carries isFavorite=true. It must show up
        // in trash only — not in both LNB lists.
        { id: 'fav-del', title: '즐겨찾기했다삭제한맵', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: '2026-01-02T00:00:00.000Z' },
      ]);

      await waitFor(() => expect(container.querySelector('aside')).toBeTruthy());
      // Rows in the favorites/trash lists both use `.drive-file`; trash rows are
      // the ones carrying a `.restore-link`.
      const rows = () => Array.from(container.querySelectorAll('aside .drive-file'));
      const favTitles = () => rows().filter((r) => !r.querySelector('.restore-link')).map((r) => (r.textContent || '').trim());
      const trashTitles = () => rows().filter((r) => r.querySelector('.restore-link')).map((r) => (r.textContent || '').trim());

      await waitFor(() => expect(favTitles().some((t) => t.includes('살아있는 즐겨찾기'))).toBe(true));

      // The favorited+deleted map is in trash...
      expect(trashTitles().some((t) => t.includes('즐겨찾기했다삭제한맵'))).toBe(true);
      // ...and NOT in favorites (the reported regression).
      expect(favTitles().some((t) => t.includes('즐겨찾기했다삭제한맵'))).toBe(false);
    });


    it('new-map link keeps the plain default title when no "새 마인드맵" exists', async () => {
      const { container } = renderHomeWithDocStore([
        { id: 'other', title: '기획 회의', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);
      await waitFor(() => expect(container.querySelector('a[data-title="기획 회의"]')).toBeTruthy());
      await createBlankMap(userEvent.setup());
      // No collision → the registered card carries the plain default title.
      await waitFor(() => expect(newMapTitles()).toContain('새 마인드맵'));
      expect(newMapTitles().some((t) => /_\d+$/.test(t))).toBe(false);
    });

    it('shows a loading skeleton (not the empty state) while DocStore.list() is pending', async () => {
      // A docStore whose list() never resolves within the test — the grid must
      // show its skeleton, not flash the "아직 만든 맵이 없어요" empty state.
      class PendingDocStore extends MockDocStore {
        override list(): Promise<DocMeta[]> {
          return new Promise<DocMeta[]>(() => {}); // never resolves
        }
      }
      const backend: Backend = { auth: new LocalAuth(), docStore: new PendingDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(container.querySelectorAll('.mf-skel').length).toBeGreaterThan(0);
      expect(screen.queryByText('아직 만든 맵이 없어요')).toBeNull();
    });
  });

  describe('cross-device first-login workspace race', () => {
    // Reproduces the reported bug: logging in on a new PC showed ONLY the default
    // 일반 공간; other spaces appeared only after a manual browser refresh. Cause:
    // the mount hydrate ran before Supabase applied the session token, so the
    // first RLS-scoped read came back empty. Fix: re-hydrate once auth confirms a
    // session (onAuthChange), which is the automatic equivalent of that refresh.

    /** SpaceStore whose FIRST `load()` returns null (the racing pre-session read)
     * and every later call returns the real workspace (post-session read). */
    class RacySpaceStore implements SpaceStore {
      calls = 0;
      constructor(private full: WorkspaceData) {}
      async load(): Promise<WorkspaceData | null> {
        this.calls += 1;
        return this.calls === 1 ? null : this.full;
      }
      async save(): Promise<void> {
        /* no-op */
      }
    }

    /** Auth that emits a confirmed session shortly after subscription — mirrors
     * Supabase firing INITIAL_SESSION/SIGNED_IN once the client has initialized. */
    class RacyAuth extends LocalAuth {
      override onAuthChange(listener: (s: { user: { id: string; email: string | null } } | null) => void): () => void {
        const un = super.onAuthChange(listener);
        setTimeout(() => listener({ user: { id: 'u1', email: 'a@b.com' } }), 0);
        return un;
      }
    }

    it('re-hydrates when auth confirms a session, so all spaces show without a manual refresh', async () => {
      const full: WorkspaceData = {
        spaces: [
          { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [] },
          { id: 's2', name: '업무 공간', color: '#3f8fd0', maps: [] },
        ],
        mapFolders: {},
      };
      const spaceStore = new RacySpaceStore(full);
      const backend: Backend = { auth: new RacyAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
      const sidebar = () => within(container.querySelector('aside') as HTMLElement);

      // The racing first read saw no custom spaces — only the default 일반 공간.
      await waitFor(() => expect(sidebar().getByText('일반 공간')).toBeTruthy());

      // …then the auth-confirmed resync pulls the real workspace automatically.
      await waitFor(() => expect(sidebar().getByText('업무 공간')).toBeTruthy());
      expect(spaceStore.calls).toBeGreaterThanOrEqual(2);
    });

    it('card preview resolves even when spaces re-hydrate mid-prefetch (no stuck loading skeleton)', async () => {
      // Repro of the reported "미리보기가 계속 로딩" on a new PC: the preview
      // prefetch's `docStore.load` batch was in flight when a SECOND spaces
      // setState (the late mount hydrate landing after the auth resync, same
      // content/new identity) re-ran the effect — whose cleanup cancelled the
      // batch before it set `previewResolved`, so the card was stranded on the
      // skeleton until a full remount (opening the map and coming back).
      function defer<T = void>() {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((r) => {
          resolve = r;
        });
        return { promise, resolve };
      }
      const docId = 'doc-race-1';
      const full: WorkspaceData = { spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '내 맵', docId }] }], mapFolders: {} };
      const body: LoadedDoc = {
        doc: { v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' } as unknown as LoadedDoc['doc'],
        version: 1,
        title: '내 맵',
      };

      // Mount workspace load is gated so it lands AFTER the resync; both return `full`.
      const mountGate = defer<WorkspaceData>();
      const spaceStore: SpaceStore = {
        calls: 0,
        async load() {
          this.calls += 1;
          return this.calls === 1 ? mountGate.promise : full;
        },
        async save() {},
      } as SpaceStore & { calls: number };

      // Doc body load is gated so the prefetch is still in flight when the late
      // mount hydrate re-runs the prefetch effect.
      const loadGate = defer<void>();
      const docStore: DocStore = {
        list: async () => [{ id: docId, title: '내 맵' } as DocMeta],
        load: async (id: string) => {
          await loadGate.promise;
          return id === docId ? body : null;
        },
        loadPreview: async (id: string) => {
          await loadGate.promise;
          return id === docId ? JSON.stringify(body.doc) : null;
        },
        listEditorNames: vi.fn(async () => ({})),
        save: vi.fn(async () => ({ ok: true, version: 1 })),
        setFavorite: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        restore: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
      } as unknown as DocStore;

      const backend: Backend = { auth: new RacyAuth(), docStore, spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
      render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );

      // Resync (call 2) returns immediately → the card shows, preview still loading (body gated).
      await waitFor(() => expect(screen.getByText('내 맵')).toBeTruthy());
      const thumb = () => (screen.getByText('내 맵').closest('.map-card') as HTMLElement).querySelector('.map-thumb') as HTMLElement;
      expect(thumb().querySelector('.mf-skel')).toBeTruthy(); // loading skeleton

      // The late mount workspace load lands → a second spaces setState re-runs the
      // prefetch effect (this is what used to cancel the in-flight batch).
      await act(async () => {
        mountGate.resolve(full);
        await Promise.resolve();
      });
      // Release the doc body → the (previously cancelled) prefetch must still apply.
      await act(async () => {
        loadGate.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(thumb().querySelector('svg')).toBeTruthy(); // real preview rendered
        expect(thumb().querySelector('.mf-skel')).toBeNull(); // skeleton cleared
      });
    });
  });
});

// 0015: 마지막으로 저장한 사람 — 공동 편집이 실사용에 들어가면서 "이 맵을 마지막으로
// 건드린 사람이 누구인가"가 정보가 됐다. 단, 그게 **나**면 아무 정보도 아니다.
describe('맵 카드의 마지막 수정자', () => {
  function renderWith(metas: DocMeta[], names: Record<string, string>) {
    const docStore = new MockDocStore(metas);
    docStore.listEditorNames = vi.fn(async () => names);
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
    const utils = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    return { ...utils, docStore };
  }

  const meta = (id: string, title: string, editedByMe?: boolean): DocMeta => ({
    id,
    title,
    version: 1,
    updatedAt: new Date().toISOString(),
    isFavorite: false,
    deletedAt: null,
    editedByMe,
  });

  it('남이 마지막으로 저장했으면 카드에 이름이 붙는다', async () => {
    const { docStore } = renderWith([meta('d-them', '같이 쓰는 맵', false)], { 'd-them': '홍길동' });
    await waitFor(() => expect(screen.getByText('같이 쓰는 맵')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/수정일 · .* · 홍길동/)).toBeTruthy());
    expect(docStore.listEditorNames).toHaveBeenCalledWith(['d-them']);
  });

  it('내가 마지막으로 저장했으면 이름을 묻지도, 붙이지도 않는다', async () => {
    const { docStore } = renderWith([meta('d-mine', '내 맵', true), meta('d-old', '옛 맵', undefined)], {});
    await waitFor(() => expect(screen.getByText('내 맵')).toBeTruthy());
    expect(screen.queryByText(/수정일 · .* · /)).toBeNull();
    // 대상이 하나도 없으면 요청 자체가 나가지 않는다(혼자 쓰는 사람은 왕복 0회).
    expect(docStore.listEditorNames).not.toHaveBeenCalled();
  });
});

// 피드백 보내기(홈 진입점) — LNB 최하단 고정 항목으로 모달이 열린다(사용자
// 요청으로 프로필 메뉴에서 이동).
describe('피드백 보내기 (홈 진입점)', () => {
  it('LNB 최하단의 피드백 보내기 → 모달 → 제출 (프로필 메뉴에는 없다)', async () => {
    const user = userEvent.setup();
    renderHome();
    // 프로필 메뉴에서는 빠졌다 — 진입점은 LNB 하나.
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    const popover = screen.getByRole('button', { name: '프로필명 변경' }).parentElement as HTMLElement;
    expect(within(popover).queryByRole('button', { name: '피드백 보내기' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '피드백 보내기' })); // LNB 최하단
    const dialog = await screen.findByRole('dialog', { name: '피드백 보내기' });
    expect(dialog).toBeTruthy();
    // 로컬(데모) 백엔드 — 안내 문구가 뜨고, 제출은 mf_feedback에 쌓인다.
    expect(screen.getByText(/데모 모드예요/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('피드백 내용'), { target: { value: '홈에서 보냄' } });
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('전달됐어요, 고마워요!')).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem('mf_feedback')!) as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({ page: 'home', message: '홈에서 보냄' });
  });
});

// 홈 색상 테마 — LNB 최하단에서 고르고, 워크스페이스 블롭으로 기기 간에 따라온다.
describe('홈 색상 테마', () => {
  /** 테마 선택은 프로필 메뉴 → 설정 모달 안에 있다(사용자 요청으로 LNB에서 이동). */
  async function openThemeSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    return within(await screen.findByRole('dialog', { name: '설정' }));
  }

  it('설정에서 테마를 고르면 즉시 색이 바뀌고, 캐시·워크스페이스에 저장된다', async () => {
    const user = userEvent.setup();
    renderHome();

    const dialog = await openThemeSettings(user);
    expect(dialog.getByRole('radio', { name: '코랄 테마' }).getAttribute('aria-checked')).toBe('true');
    // LNB에는 더 이상 없다 — 진입점은 설정 하나.
    expect(screen.queryByRole('button', { name: '색상 테마' })).toBeNull();

    await user.click(dialog.getByRole('radio', { name: '오션 테마' }));

    // ① 화면 색이 바로 바뀐다(CSS 변수) ② 이 기기 캐시 ③ 워크스페이스(정본)
    expect(document.documentElement.style.getPropertyValue('--mf-accent')).toBe(HOME_THEMES.ocean.accent);
    expect(localStorage.getItem('mf_home_theme')).toBe('ocean');
    expect(dialog.getByRole('radio', { name: '오션 테마' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces')!) as { theme?: string };
      expect(ws.theme).toBe('ocean');
    });
  });

  it('다크를 고르면 면과 글자가 함께 뒤집힌다 (배경만 어두워지지 않는다)', async () => {
    const user = userEvent.setup();
    renderHome();
    const dialog = await openThemeSettings(user);
    await user.click(dialog.getByRole('radio', { name: '다크 테마' }));

    const root = document.documentElement.style;
    expect(root.getPropertyValue('--mf-bg')).toBe(HOME_THEMES.dark.bg);
    expect(root.getPropertyValue('--mf-panel')).toBe(HOME_THEMES.dark.panel);
    expect(root.getPropertyValue('--mf-text')).toBe(HOME_THEMES.dark.text);
    expect(localStorage.getItem('mf_home_theme')).toBe('dark');
  });

  it('저장된 워크스페이스의 테마를 불러와 입힌다 (다른 기기에서 고른 색)', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sa', name: '내 스페이스', home: true, color: '#f0663f', maps: [] }], mapFolders: {}, theme: 'forest' }));
    renderHome();
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--mf-accent')).toBe(HOME_THEMES.forest.accent));
    expect(localStorage.getItem('mf_home_theme')).toBe('forest'); // 다음 부팅 첫 페인트용
  });

  it('테마를 고르지 않았으면 저장된 워크스페이스를 다시 쓰지 않는다 (불러온 그대로면 무저장)', async () => {
    const saved: WorkspaceData[] = [];
    const spaceStore: SpaceStore = {
      load: async () => ({ spaces: [{ id: 'sa', name: '내 스페이스', home: true, color: '#f0663f', maps: [] }], mapFolders: {}, recent: [], theme: 'grape' }),
      save: async (d) => {
        saved.push(d);
      },
    };
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--mf-accent')).toBe(HOME_THEMES.grape.accent));
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved).toEqual([]);
  });
});

// 홈 우클릭 메뉴(요청) — ☰ 버튼과 우클릭이 **같은 메뉴**를 열고, 하위 메뉴는
// 드릴다운이 아니라 옆으로 뻗는 플라이아웃이다. 빈 자리와 폴더에도 메뉴가 있다.
describe('전역 검색 (모든 스페이스)', () => {
  const mkDoc = (rootText: string, extra: Record<string, unknown> = {}) => ({
    v: 1,
    nodes: { root: { id: 'root', text: rootText, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral',
    ...extra,
  });
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  /** 스페이스 둘 — 활성('업무')과 비활성('개인'). 개인 스페이스의 맵은 평소 화면에 없다. */
  function seedTwoSpaces() {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 's1', name: '업무', color: '#f0663f', home: true, maps: [{ title: '업무 회고', when: '방금', hue: '#f0663f', docId: 'w1' }], folders: [] },
          { id: 's2', name: '개인', color: '#2f7fd6', maps: [{ title: '개인 노트', when: '방금', hue: '#2f7fd6', docId: 'p1' }], folders: [{ id: 'pf1', name: '취미' }] },
        ],
        mapFolders: { p1: 'pf1' },
        activeSpace: 's1',
      }),
    );
  }

  it('다른 스페이스의 맵도 찾고, 스페이스별로 묶어 보여 준다', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고'), meta('p1', '개인 노트')], {
      w1: { doc: mkDoc('업무 회고') as never, version: 1, title: '업무 회고' },
      p1: { doc: mkDoc('개인 노트', { floats: [{ id: 'f1', x: 0, y: 0, w: 200, text: '등산 계획 메모' }] }) as never, version: 1, title: '개인 노트' },
    });
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());
    // 평소엔 활성 스페이스만 보인다
    expect(container.querySelector('a[data-title="개인 노트"]')).toBeNull();

    // 다른 스페이스 맵의 **본문**에만 있는 낱말
    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '등산{Enter}');

    await waitFor(() => expect(container.querySelector('a[data-title="개인 노트"]')).toBeTruthy());
    // 결과는 그 맵이 사는 스페이스 이름 아래 묶인다
    const results = container.querySelector('[data-search-results]') as HTMLElement;
    expect(within(results).getByText('개인')).toBeTruthy();
    expect(container.querySelector('a[data-title="업무 회고"]')).toBeNull();
  });

  it('폴더 이름도 스페이스를 가리지 않고 찾는다 (경로 이름으로)', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고'), meta('p1', '개인 노트')]);
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '취미{Enter}');

    await waitFor(() => expect(container.querySelector('[data-search-results]')).toBeTruthy());
    expect(screen.getByText('취미')).toBeTruthy();
  });

  it('다른 스페이스의 결과 카드에는 폴더 이동을 내주지 않는다 (미아 방지)', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고'), meta('p1', '개인 노트')]);
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '개인{Enter}');
    const card = await waitFor(() => {
      const el = container.querySelector('a[data-title="개인 노트"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    const menu = await screen.findByRole('menu');
    // 폴더 이동은 없다 — mapFolders는 폴더 id만 들고 있어 다른 스페이스의 폴더에
    // 배정하면 어느 목록에도 안 나오는 미아가 된다.
    expect(within(menu).queryByRole('menuitem', { name: /폴더로 이동/ })).toBeNull();
    // 스페이스 이동은 안전하다(원본 스페이스를 key로 찾는다)
    expect(within(menu).getByRole('menuitem', { name: /스페이스로 이동/ })).toBeTruthy();
  });

  it('검색 중에도 검색창과 스페이스 헤더가 남는다 — 글자를 고치거나 지울 수 있어야 한다', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고'), meta('p1', '개인 노트')]);
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '개인{Enter}');
    await waitFor(() => expect(container.querySelector('[data-search-results]')).toBeTruthy());

    // 검색창은 그 자리에 그대로(툴바 안) — 사라지면 질의를 고칠 방법이 없다
    const box = screen.getByPlaceholderText('모든 스페이스에서 검색') as HTMLInputElement;
    expect(box.value).toBe('개인');
    // 제목은 "검색" — 결과는 전 스페이스에서 오는데 활성 스페이스명이 그대로면
    // "이 스페이스 안에서 찾았다"로 읽힌다(제보).
    expect(container.querySelector('main h2')?.textContent).toBe('검색');
    // 최근 항목만 감춰진다(질의로 걸러지지 않는 목록이라 결과를 흐린다)
    expect(screen.queryByText('최근 항목')).toBeNull();
  });

  it('검색을 지우면 원래 스페이스 화면으로 돌아온다', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고'), meta('p1', '개인 노트')]);
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());

    const box = screen.getByPlaceholderText('모든 스페이스에서 검색');
    await user.type(box, '개인{Enter}');
    await waitFor(() => expect(container.querySelector('[data-search-results]')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: '검색 지우기' }));
    await waitFor(() => expect(container.querySelector('[data-search-results]')).toBeNull());
    expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy();
    expect(container.querySelector('a[data-title="개인 노트"]')).toBeNull();
    // 제목도 "검색"에서 원래 스페이스명으로 복귀한다.
    expect(container.querySelector('main h2')?.textContent).toContain('업무');
  });
});

describe('홈 루트 높이', () => {
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('루트는 100dvh — 모바일에서 100vh는 주소창만큼 길어져 페이지 스크롤이 하나 더 생긴다(제보: 이중 스크롤)', async () => {
    const { container } = renderHomeWithDocStore([meta('d1', '맵')]);
    const root = container.querySelector('.mf-home') as HTMLElement;
    expect(root.getAttribute('style') || '').toContain('height: 100dvh');
  });
});

describe('검색 입력 디바운스', () => {
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('타이핑 중에는 목록을 다시 그리지 않고, 손을 뗀 뒤에 적용된다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('d1', '따라잡기'), meta('d2', '지급 내역')]);
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(2));

    const box = screen.getByPlaceholderText('모든 스페이스에서 검색');
    await user.type(box, '따라');

    // 입력값은 즉시 보인다 …
    expect((box as HTMLInputElement).value).toBe('따라');
    // … 하지만 목록은 아직 그대로다(중간 결과를 그리지 않는다)
    expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(2);

    // 멎으면 적용된다
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(1));
    expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy();
  });

  it('Enter는 기다리지 않고 바로 적용한다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('d1', '따라잡기'), meta('d2', '지급 내역')]);
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(2));

    const box = screen.getByPlaceholderText('모든 스페이스에서 검색');
    await user.type(box, '따라{Enter}');

    // Enter 직후(디바운스를 기다리지 않고) 이미 걸러져 있다
    expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(1);
  });

  it('지우면 즉시 원상 복귀한다 — 지웠는데 결과가 남아 있으면 고장으로 읽힌다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('d1', '따라잡기'), meta('d2', '지급 내역')]);
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(2));

    const box = screen.getByPlaceholderText('모든 스페이스에서 검색');
    await user.type(box, '따라{Enter}');
    expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(1);

    await user.clear(box);
    expect(container.querySelectorAll('.mf-map-grid a[data-title]').length).toBe(2);
  });
});

describe('본문 검색', () => {
  const mkDoc = (rootText: string, extra: Record<string, unknown> = {}) => ({
    v: 1,
    nodes: { root: { id: 'root', text: rootText, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
    ...extra,
  });
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('제목에 없는 낱말이 본문에 있으면 찾힌다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore(
      [meta('d1', '1월 정리'), meta('d2', '2월 정리')],
      {
        d1: { doc: mkDoc('1월 정리', { floats: [{ id: 'f1', x: 0, y: 0, w: 200, text: '이탈률 개선 아이디어' }] }) as never, version: 1, title: '1월 정리' },
        d2: { doc: mkDoc('2월 정리') as never, version: 1, title: '2월 정리' },
      },
    );
    await waitFor(() => expect(container.querySelector('a[data-title="1월 정리"]')).toBeTruthy());
    // 본문(메모)이 도착할 때까지 기다린다 — 도착 전에는 제목으로만 걸린다.
    await waitFor(() => expect(container.querySelectorAll('.mf-map-grid a').length).toBe(2));

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '이탈률');

    await waitFor(() => expect(container.querySelector('a[data-title="2월 정리"]')).toBeNull());
    expect(container.querySelector('a[data-title="1월 정리"]')).toBeTruthy();
  });

  it('검색은 폴더 경계를 넘고, 결과 카드에 그 위치를 붙인다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '일반 스페이스', color: '#f0663f', home: true, maps: [{ title: '숨은 맵', when: '방금', hue: '#f0663f', docId: 'in-folder' }], folders: [{ id: 'fo1', name: '기획' }] }],
        mapFolders: { 'in-folder': 'fo1' },
        activeSpace: 's1',
      }),
    );
    const { container } = renderHomeWithDocStore([meta('in-folder', '숨은 맵')], {
      'in-folder': { doc: mkDoc('숨은 맵') as never, version: 1, title: '숨은 맵' },
    });
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    // 최상위에서는 폴더 안 맵이 보이지 않는다(기존 동작)
    expect(container.querySelector('a[data-title="숨은 맵"]')).toBeNull();

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '숨은');

    const card = await waitFor(() => {
      const el = container.querySelector('a[data-title="숨은 맵"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // 어느 폴더의 맵인지 카드가 알려 준다
    expect(card.querySelector('[data-card-path]')?.textContent).toBe('기획');
    // 그리고 결과가 스페이스 전체에서 모였다는 안내가 뜬다
    expect(container.querySelector('[data-search-notice]')?.textContent).toContain('모든 스페이스');
  });

  it('결과가 없으면 "새로 만들기" 빈 화면이 아니라 검색 전용 안내가 뜬다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('d1', '1월 정리')], {
      d1: { doc: mkDoc('1월 정리') as never, version: 1, title: '1월 정리' },
    });
    await waitFor(() => expect(container.querySelector('a[data-title="1월 정리"]')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('모든 스페이스에서 검색'), '없는낱말');

    await waitFor(() => expect(container.querySelector('[data-search-empty]')).toBeTruthy());
    expect(screen.getByText("'없는낱말'에 맞는 맵이 없어요")).toBeTruthy();
    // 맵이 있는데도 "아직 만든 맵이 없어요"라고 말하면 안 된다
    expect(screen.queryByText('아직 만든 맵이 없어요')).toBeNull();
  });

  it('평소(검색 안 함) 카드에는 위치 줄도 안내 줄도 없다 — 레이아웃 무변화', async () => {
    const { container } = renderHomeWithDocStore([meta('d1', '1월 정리')], {
      d1: { doc: mkDoc('1월 정리') as never, version: 1, title: '1월 정리' },
    });
    await waitFor(() => expect(container.querySelector('a[data-title="1월 정리"]')).toBeTruthy());
    expect(container.querySelector('[data-card-path]')).toBeNull();
    expect(container.querySelector('[data-search-notice]')).toBeNull();
  });
});

describe('홈 우클릭 메뉴', () => {
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  function mapDoc(title: string) {
    return {
      v: 1,
      nodes: { root: { id: 'root', text: title, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    } as unknown as Doc;
  }

  it('맵 카드 우클릭은 ☰과 같은 메뉴를 커서 자리에 연다', async () => {
    const { container } = renderHomeWithDocStore([meta('doc-r', '주간 회의')]);
    await waitFor(() => expect(container.querySelector('a[data-title="주간 회의"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="주간 회의"]') as HTMLElement;

    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('map');
    // ☰을 눌렀을 때와 같은 항목들
    [/즐겨찾기/, '이름 변경', /내보내기/, '삭제하기'].forEach((label) => {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
    });
    // 커서 자리에 뜬다
    expect(menu.style.left).toBe('240px');
    expect(menu.style.top).toBe('180px');
  });

  it('하위 메뉴는 화면을 갈아 끼우지 않고 옆으로 뻗는다 (부모 항목이 그대로 보인다)', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('doc-s', '내보낼 맵')]);
    await waitFor(() => expect(container.querySelector('a[data-title="내보낼 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="내보낼 맵"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));

    // 하위 항목이 열렸는데도 상위 항목(삭제하기)은 그대로 보인다 = 플라이아웃.
    expect(screen.getByRole('menuitem', { name: 'PNG 이미지' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'SVG 이미지 (.svg)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'PDF 문서 (.pdf)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '삭제하기' })).toBeTruthy();
    // 예전 드릴다운의 흔적("‹ 뒤로")은 없다.
    expect(screen.queryByText(/뒤로/)).toBeNull();
  });

  it('"스페이스로 이동" 하위 목록은 LNB와 같은 스페이스 색 점을 쓴다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [
          { id: 'a', name: '내 공간', home: true, color: '#f0663f', maps: [{ title: '옮길 맵', when: '방금', hue: '#f0663f', docId: 'doc-m' }], folders: [] },
          { id: 'b', name: '두 번째', color: '#3f8fd0', maps: [], folders: [] },
        ],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([meta('doc-m', '옮길 맵')]);
    await waitFor(() => expect(container.querySelector('a[data-title="옮길 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="옮길 맵"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await user.click(await screen.findByRole('menuitem', { name: /스페이스로 이동/ }));
    const row = await screen.findByRole('menuitem', { name: '두 번째' });
    const dot = row.querySelector('span[style*="border-radius"]') as HTMLElement;
    expect(dot.style.background).toBe('rgb(63, 143, 208)'); // 그 스페이스의 색
  });

  it('폴더 우클릭도 ☰과 같은 메뉴를 연다', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ v: 1, spaces: [{ id: 'a', name: '내 공간', home: true, color: '#f0663f', maps: [], folders: [{ id: 'f1', name: '기획' }] }], mapFolders: {} }),
    );
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    const folderCard = (screen.getByText('기획').closest('.map-card') as HTMLElement) || (container.querySelector('.map-card') as HTMLElement);

    fireEvent.contextMenu(folderCard, { clientX: 100, clientY: 120 });

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('folder');
    expect(within(menu).getByRole('menuitem', { name: '이름 변경' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '폴더 삭제' })).toBeTruthy();
  });

  it('빈 자리 우클릭은 "새로 만들기 · 새 폴더 · 가져오기 · 설정"을 연다', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());

    fireEvent.contextMenu(container.querySelector('main') as HTMLElement, { clientX: 500, clientY: 300 });

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('bg');
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['새로 만들기', '새 폴더', '가져오기', '설정']);

    // 실제로 동작한다 — "새 폴더"는 폴더 만들기 팝업을 연다.
    await user.click(within(menu).getByRole('menuitem', { name: '새 폴더' }));
    expect(screen.getByText('새 폴더 만들기')).toBeTruthy();
  });

  describe('템플릿 갤러리', () => {
    it('"새로 만들기"가 갤러리를 연다 — 첫 칸이 빈 맵, 그 뒤로 템플릿들', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);

      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const cards = within(dialog).getAllByRole('button').filter((b) => b.hasAttribute('data-template'));
      expect(cards[0]?.getAttribute('data-template')).toBe('blank');
      expect(cards.map((c) => c.getAttribute('data-template'))).toEqual(
        expect.arrayContaining(['blank', ...MAP_TEMPLATES.map((t) => t.id)]),
      );
      // 썸네일은 홈 카드와 같은 렌더러 — 템플릿 칸마다 실제 미리보기 SVG가 있다
      const meeting = cards.find((c) => c.getAttribute('data-template') === 'meeting') as HTMLElement;
      expect(meeting.querySelector('svg[viewBox]')).toBeTruthy();
    });

    it('화이트보드 카드는 맵 카드와 다르게 보인다 — 종류 배지 + 흰 종이 썸네일(제보)', async () => {
      // 본문이 board면 카드가 스스로 갈린다(썸네일 본문 하나로 판별 — isBoardRaw).
      const boardDoc = { v: 1, kind: 'board', nodes: {}, floats: [{ id: 'f1', x: 10, y: 20, w: 180, text: '보드 메모' }], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' };
      const mapDoc = { v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' };
      const { container } = renderHomeWithDocStore(
        [
          { id: 'doc-board', title: '아이디어 보드', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
          { id: 'doc-map', title: '제품 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ],
        {
          'doc-board': { doc: boardDoc as never, version: 1, title: '아이디어 보드' },
          'doc-map': { doc: mapDoc as never, version: 1, title: '제품 맵' },
        },
      );

      const boardCard = await waitFor(() => {
        const el = container.querySelector('a[data-title="아이디어 보드"]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      const mapCard = container.querySelector('a[data-title="제품 맵"]') as HTMLElement;

      // 종류 배지는 보드에만.
      await waitFor(() => expect(boardCard.querySelector('[data-board-badge]')?.textContent).toContain('화이트보드'));
      expect(mapCard.querySelector('[data-board-badge]')).toBeNull();
      // 썸네일 바탕: 보드는 흰 종이, 맵은 기존 그라디언트.
      const thumbBg = (card: HTMLElement) => ((card.querySelector('.map-thumb') as HTMLElement).style.background || '');
      expect(thumbBg(boardCard)).toContain('rgb(255, 255, 255)');
      expect(thumbBg(mapCard)).toContain('gradient');
    });

    it('화이트보드 칸 — 빈 맵 다음 자리, 고르면 "새 화이트보드"로 에디터에 넘어간다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const cards = within(dialog).getAllByRole('button').filter((b) => b.hasAttribute('data-template'));
      // 두 문서 종류를 구획으로 나눴다(제보: 섞여 있어 구별이 어렵다) — 마인드맵
      // 구획(빈 맵 + 템플릿들) 뒤에 화이트보드 구획이 온다.
      expect(cards[0]?.getAttribute('data-template')).toBe('blank');
      expect(cards[cards.length - 1]?.getAttribute('data-template')).toBe('board');
      expect(within(dialog).getByText('마인드맵')).toBeTruthy();
      expect(within(dialog).getByText('화이트보드')).toBeTruthy();

      await user.click(within(dialog).getByRole('button', { name: /화이트보드/ }));
      await waitFor(() => expect(newMapTitles()).toContain('새 화이트보드'));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('화이트보드 JSON(루트 없는 문서)도 가져올 수 있다 — 제목은 파일명', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      const boardJson = JSON.stringify({ v: 1, kind: 'board', nodes: {}, floats: [{ id: 'f1', x: 10, y: 20, w: 180, text: '보드 메모' }], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, new File([boardJson], '아이디어 보드.json', { type: 'application/json' }));

      await waitFor(() => expect(screen.getByText(/추가했어요/)).toBeTruthy());
      const [, savedDoc, savedOpts] = docStore.save.mock.calls[0] as unknown as [string, { kind?: string; floats: unknown[] }, { title?: string }];
      expect(savedOpts).toMatchObject({ title: '아이디어 보드' });
      expect(savedDoc.kind).toBe('board');
      expect(savedDoc.floats).toHaveLength(1);
    });

    it('템플릿을 고르면 그 이름으로 맵이 만들어지고 에디터로 넘어간다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);
      await user.click(await screen.findByRole('button', { name: /회의록/ }));

      expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
      await waitFor(() => expect(newMapTitles()).toContain('회의록'));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('Escape로 닫으면 아무 맵도 만들어지지 않는다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);
      await screen.findByRole('dialog', { name: '새로 만들기' });
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog', { name: '새로 만들기' })).toBeNull());
      expect(newMapTitles()).toEqual([]);
      expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();
    });

    it('카드 제목 앞은 이모지가 아니라 SVG 아이콘이다 (기기마다 다르게 그려지지 않게)', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });

      for (const tpl of MAP_TEMPLATES) {
        const card = within(dialog).getByRole('button', { name: new RegExp(tpl.name) });
        const title = card.querySelector('[data-template-icon]')?.parentElement as HTMLElement;
        expect(title).toBeTruthy();
        expect(title.querySelector(`[data-template-icon="${tpl.id}"]`)?.tagName.toLowerCase()).toBe('svg');
        // 제목 줄에 이모지 글자가 남아 있으면 안 된다 (그림이 기기마다 갈린다)
        expect(title.textContent).toBe(tpl.name);
      }
    });

    it('dim 배경도 함께 페이드한다 — 막만 툭 깔리고 내용이 뒤늦게 뜨면 깜빡임으로 보인다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByText('＋ 새로 만들기')[0]).toBeTruthy());

      await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const backdrop = dialog.parentElement as HTMLElement;
      // 제자리 페이드(mf-dim-in)여야 한다 — mf-fade의 translateY를 fixed inset:0
      // 배경에 걸면 레이어가 통째로 슬라이드한다(#331).
      expect(backdrop.style.animation).toContain('mf-dim-in');
      expect(dialog.style.animation).toContain('mf-fade');
    });

    it('열기 전에 한가할 때 미리보기를 미리 만들어 둔다 (첫 열기의 프레임 멈춤 방지)', async () => {
      // 실측: 데우지 않으면 첫 열기에 55·60ms 롱태스크 두 개가 걸려 클릭한
      // 프레임이 통째로 멎었다. 비용은 그대로지만 아무 일도 없을 때로 옮긴다.
      const ric = vi.fn((cb: () => void) => {
        cb();
        return 1;
      });
      (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback = ric;
      try {
        renderHomeWithDocStore([]);
        await waitFor(() => expect(ric).toHaveBeenCalled());
      } finally {
        delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
      }
    });

    it('빈 자리 우클릭의 "새로 만들기"도 같은 갤러리를 연다 (진입점이 갈리지 않는다)', async () => {
      const user = userEvent.setup();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());

      fireEvent.contextMenu(container.querySelector('main') as HTMLElement, { clientX: 500, clientY: 300 });
      const menu = await screen.findByRole('menu');
      await user.click(within(menu).getByRole('menuitem', { name: '새로 만들기' }));

      expect(await screen.findByRole('dialog', { name: '새로 만들기' })).toBeTruthy();
      // 메뉴는 닫힌다 — 메뉴가 갤러리 위에 남아 있으면 안 된다
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('좁은 화면에서는 하위 메뉴가 옆이 아니라 부모 아래로 펼쳐진다 (화면 밖으로 안 나가게)', async () => {
    const user = userEvent.setup();
    const prev = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      const { container } = renderHomeWithDocStore([meta('doc-w', '좁은 화면 맵')]);
      await waitFor(() => expect(container.querySelector('a[data-title="좁은 화면 맵"]')).toBeTruthy());
      const card = container.querySelector('a[data-title="좁은 화면 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));
      const sub = document.querySelector('[data-home-ctx-sub="export"]') as HTMLElement;
      expect(sub.getAttribute('data-inline')).toBe('true');
      expect(sub.style.position).not.toBe('absolute');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: prev });
    }
  });

  it('최근 항목 카드의 우클릭은 빈 자리 메뉴로 새지 않는다 (그 카드엔 메뉴가 없다)', async () => {
    localStorage.setItem('mf_recent', JSON.stringify(['doc-rc']));
    const { container } = renderHomeWithDocStore([meta('doc-rc', '최근 맵')]);
    await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
    const recentCard = container.querySelectorAll('a[data-title="최근 맵"]')[0] as HTMLElement;

    fireEvent.contextMenu(recentCard, { clientX: 30, clientY: 30 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // "새 탭에서 열기"는 #345에서 넣었다가 사용자 결정으로 뺐다 — 필요하면 카드
  // 링크를 Ctrl/⌘+클릭하면 된다(카드는 여전히 <a href>다).
  it('맵 카드 메뉴에 "새 탭에서 열기"가 없다 (사용자 결정으로 제거)', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('doc-t', '새 탭 맵')]);
    await waitFor(() => expect(container.querySelector('a[data-title="새 탭 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="새 탭 맵"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: '새 탭에서 열기' })).toBeNull();
  });

  it('모바일에서는 메뉴 행이 44px 터치 타깃을 지킨다', async () => {
    mockMatchMedia(true);
    try {
      const { container } = renderHomeWithDocStore([meta('doc-tt', '터치 맵')]);
      await waitFor(() => expect(container.querySelector('a[data-title="터치 맵"]')).toBeTruthy());
      const card = container.querySelector('a[data-title="터치 맵"]') as HTMLElement;

      fireEvent.contextMenu(card, { clientX: 20, clientY: 20 });
      const row = (await screen.findByRole('menuitem', { name: '이름 변경' })) as HTMLElement;
      expect(row.style.minHeight).toBe('44px');
    } finally {
      mockMatchMedia(false); // 데스크톱으로 되돌린다 — LNB는 모바일에서 드로어라 안 붙어 있다
    }
  });

  // 선택하면 테두리가 1px→2px가 되는데, 폴더 카드는 그걸 **패딩을 줄여** 맞추고
  // 있었다. 그러면 카드 겉면은 그대로여도 패딩 박스가 1px 안으로 들어가고, ☰ 버튼은
  // `position: absolute`로 거기 붙어 있어서 선택하는 순간 버튼만 (-1,+1)px 움직였다
  // (제보). 맵 카드처럼 **음수 마진**으로 상쇄하면 안쪽 좌표계가 흔들리지 않는다.
  it('폴더를 선택해도 ☰ 버튼이 움직이지 않는다 (패딩이 아니라 마진으로 테두리를 상쇄)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ v: 1, spaces: [{ id: 'a', name: '내 공간', home: true, color: '#f0663f', maps: [], folders: [{ id: 'f1', name: '기획' }] }], mapFolders: {} }),
    );
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    const folderCard = screen.getByText('기획').closest('.map-card') as HTMLElement;

    const padBefore = folderCard.style.padding;
    expect(folderCard.style.margin).toBe('0px');

    await user.click(folderCard); // 한 번 = 선택
    expect(folderCard.style.border).toContain('2px');
    // 패딩은 그대로 (= 패딩 박스가 안 움직인다 = 절대 배치된 ☰도 안 움직인다)
    expect(folderCard.style.padding).toBe(padBefore);
    expect(folderCard.style.margin).toBe('-1px'); // 늘어난 테두리는 마진이 상쇄
  });

  // LNB(사이드바) 우클릭 — 메뉴가 있는 건 스페이스 행 하나뿐이고, 나머지는
  // 브라우저 기본 메뉴만 막는다(같은 화면 안에서 우클릭의 뜻이 갈리지 않게).
  it('스페이스 행 우클릭은 ⋮과 같은 메뉴를 연다', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sx', name: '기획 공간', color: '#3f8fd0', maps: [] }, { id: 'sy', name: '다른 공간', color: '#4f9d69', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = container.querySelector('aside') as HTMLElement;
    await waitFor(() => expect(within(aside).getByText('기획 공간')).toBeTruthy());
    const row = within(aside).getByText('기획 공간').closest('.space-row') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 80, clientY: 200 });

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('data-home-ctx')).toBe('space');
    expect(within(menu).getByRole('menuitem', { name: '이름 변경' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '스페이스 삭제' })).toBeTruthy();
  });

  it('마지막 스페이스는 삭제가 잠기고 이유를 말한다', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sx', name: '유일한 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = container.querySelector('aside') as HTMLElement;
    await waitFor(() => expect(within(aside).getByText('유일한 공간')).toBeTruthy());
    const row = within(aside).getByText('유일한 공간').closest('.space-row') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 80, clientY: 200 });
    const del = await screen.findByRole('menuitem', { name: '스페이스 삭제' });
    expect(del.style.cursor).toBe('not-allowed');
    expect(screen.getByText('마지막 스페이스는 삭제할 수 없어요')).toBeTruthy();
  });

  it('LNB의 나머지 우클릭은 브라우저 기본 메뉴를 막기만 한다 (앱 메뉴도 열지 않는다)', async () => {
    const { container } = renderHomeWithDocStore([]);
    const aside = container.querySelector('aside') as HTMLElement;
    await waitFor(() => expect(within(aside).getByText('휴지통')).toBeTruthy());

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    within(aside).getByText('휴지통').dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true); // 브라우저 메뉴 차단
    expect(screen.queryByRole('menu')).toBeNull(); // 그렇다고 앱 메뉴가 뜨지도 않는다
  });

  it('Escape로 닫힌다', async () => {
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    fireEvent.contextMenu(container.querySelector('main') as HTMLElement, { clientX: 20, clientY: 20 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  // 이름 변경(요청) — 목록의 메타 제목과 **문서 본문의 루트 글자**를 함께 고친다.
  // 하나만 바꾸면 열자마자 옛 이름이 보이고, 다음 저장이 그 이름을 되돌린다.
  it('이름 변경은 카드 제목과 문서 루트 글자를 함께 바꾼다', async () => {
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([meta('doc-n', '옛 이름')], { 'doc-n': { doc: mapDoc('옛 이름'), version: 3, title: '옛 이름' } });
    await waitFor(() => expect(container.querySelector('a[data-title="옛 이름"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="옛 이름"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await user.click(await screen.findByRole('menuitem', { name: '이름 변경' }));

    const input = await screen.findByLabelText('맵 이름');
    expect((input as HTMLInputElement).value).toBe('옛 이름');
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '변경' }));

    await waitFor(() => expect(container.querySelector('a[data-title="새 이름"]')).toBeTruthy());
    const [id, doc, opts] = docStore.save.mock.calls.at(-1) as unknown as [string, Doc, { prevVersion?: number; title?: string }];
    expect(id).toBe('doc-n');
    expect(doc.nodes.root?.text).toBe('새 이름'); // 본문도 함께 (에디터가 그리는 이름)
    expect(opts.title).toBe('새 이름');
    expect(opts.prevVersion).toBe(3); // 낙관적 잠금 — 남의 저장을 덮지 않는다
  });

  // 공유(요청) — 맵을 열지 않고 카드에서 바로 초대한다. 팝업은 에디터가 쓰는
  // `ShareModal` 그대로이고, 색만 홈 테마로 넘어간다.
  it('카드 메뉴의 "공유"가 에디터와 같은 공유 팝업을 연다 (맵은 열리지 않는다)', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('doc-s', '공유할 맵')], { 'doc-s': { doc: mapDoc('공유할 맵'), version: 1, title: '공유할 맵' } });
    await waitFor(() => expect(container.querySelector('a[data-title="공유할 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="공유할 맵"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await user.click(await screen.findByRole('menuitem', { name: '공유' }));

    const dialog = await screen.findByRole('dialog', { name: '공유' });
    // 에디터로 넘어가지 않았다 — 홈에 그대로 있다(맵 카드가 여전히 보인다).
    expect(container.querySelector('a[data-title="공유할 맵"]')).toBeTruthy();

    // 이 문서에 대한 초대가 실제로 걸린다(로컬 어댑터).
    await user.type(within(dialog).getByLabelText('초대할 이메일'), 'friend@example.com');
    await user.click(within(dialog).getByRole('button', { name: '초대' }));
    expect(await within(dialog).findByText('friend@example.com')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '공유' })).toBeNull());
  });

  it('공유 팝업은 홈 테마를 따른다 (다크에서 밝은 모달이 남지 않는다)', async () => {
    localStorage.setItem('mf_home_theme', 'dark');
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([meta('doc-d', '다크 맵')], { 'doc-d': { doc: mapDoc('다크 맵'), version: 1, title: '다크 맵' } });
    await waitFor(() => expect(container.querySelector('a[data-title="다크 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="다크 맵"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: '메뉴' }));
    await user.click(await screen.findByRole('menuitem', { name: '공유' }));

    const dialog = await screen.findByRole('dialog', { name: '공유' });
    // jsdom은 hex를 rgb()로 정규화한다 — 값을 맞춰 비교한다.
    const rgb = (hex: string): string => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(dialog.style.background).toBe(rgb(HOME_THEMES.dark.panel));
    expect(dialog.style.background).not.toBe(rgb(HOME_THEMES.coral.panel));
  });

  it('문서가 없는 옛 카드에는 공유를 내주지 않는다 (가리킬 문서가 없다)', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ v: 1, spaces: [{ id: 'a', name: '내 스페이스', home: true, color: '#f0663f', maps: [{ title: '옛 카드', when: '방금', hue: '#f0663f' }], folders: [] }], mapFolders: {} }),
    );
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(container.querySelector('a[data-title="옛 카드"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="옛 카드"]') as HTMLElement;

    fireEvent.contextMenu(card, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: '공유' })).toBeNull();
  });

  it('문서가 없는 옛 카드에는 이름 변경을 내주지 않는다 (제목이 곧 식별자라 잃는다)', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({ v: 1, spaces: [{ id: 'a', name: '내 공간', home: true, color: '#f0663f', maps: [{ title: '옛 카드', when: '방금', hue: '#f0663f' }], folders: [] }], mapFolders: {} }),
    );
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(container.querySelector('a[data-title="옛 카드"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="옛 카드"]') as HTMLElement;

    fireEvent.contextMenu(card, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: '이름 변경' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: '삭제하기' })).toBeTruthy();
  });
});

// 맵 카드의 "공유 중" 표식(요청) — 내가 초대를 걸었거나 링크를 켜 둔 맵은 제목 옆에
// 사람 아이콘이 뜬다(Google Drive 관례). 초대/링크 여부는 툴팁 문구로 갈린다.
// 화면 밖 카드의 렌더링을 브라우저가 건너뛰는 계약(가상화의 저렴한 중간 단계) —
// 실측: 150맵 기준 검색 해제 재마운트 1221ms → 347ms, 첫 로드 2047ms → 1019ms.
// 이 속성이 빠지면 조용히 예전 비용으로 돌아가므로 스타일 계약으로 고정한다.
describe('맵 카드 렌더 스킵(content-visibility)', () => {
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('그리드 카드가 content-visibility:auto + intrinsic-size를 갖는다', async () => {
    const { container } = renderHomeWithDocStore([meta('doc-cv', '가벼운 맵')]);
    await waitFor(() => expect(container.querySelector('a[data-title="가벼운 맵"]')).toBeTruthy());
    const card = container.querySelector('a[data-title="가벼운 맵"]') as HTMLElement;
    expect(card.style.contentVisibility).toBe('auto');
    // intrinsic-size의 `auto`가 있어야 한 번 그려진 카드의 실제 크기를 기억한다
    // (없으면 스크롤할 때마다 추정 높이로 접혀 스크롤바가 널뛴다).
    expect(card.getAttribute('style') || '').toContain('contain-intrinsic-size: auto');
  });
});

describe('맵 카드 공유 표식', () => {
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  it('초대가 걸린 맵에만 표식이 뜨고, 툴팁이 인원수를 말한다', async () => {
    localStorage.setItem(
      'mf_doc_shares',
      JSON.stringify([
        { documentId: 'doc-sh', email: 'a@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' },
        { documentId: 'doc-sh', email: 'b@example.com', role: 'view', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );
    renderHomeWithDocStore([meta('doc-sh', '공유한 맵'), meta('doc-solo', '혼자 쓰는 맵')]);
    const badge = await screen.findByRole('img', { name: '공유 중 — 2명과 공유 중' });
    expect(badge.closest('[data-title]')?.getAttribute('data-title')).toBe('공유한 맵');
    // 공유가 없는 카드에는 표식이 없다.
    const soloCard = screen.getByText('혼자 쓰는 맵').closest('[data-title]')!;
    expect(soloCard.querySelector('[data-shared-badge]')).toBeNull();
  });

  it('링크 공유만 켠 맵은 "링크" 문구의 표식이 뜬다', async () => {
    localStorage.setItem('mf_doc_links', JSON.stringify({ 'doc-ln': 'view' }));
    renderHomeWithDocStore([meta('doc-ln', '링크 공유 맵')]);
    expect(await screen.findByRole('img', { name: '공유 중 — 링크가 있는 사람이 열람 가능' })).toBeTruthy();
  });
});

// 최근 트레이 미리보기가 로딩 스켈레톤에 갇히던 문제(제보 스크린샷) — 프리페치가
// 원시 recent의 앞 N개를 잘라, 휴지통·사라진 문서 항목이 머리에 쌓이면 트레이에
// 보이는 카드(특히 **비활성 스페이스**의 맵)가 프리페치에서 빠졌다.
describe('최근 트레이 미리보기 프리페치', () => {
  it('사라진 문서 항목이 머리에 쌓여도, 비활성 스페이스의 최근 카드가 스켈레톤에 갇히지 않는다', async () => {
    const stale = Array.from({ length: 40 }, (_, i) => `gone-${i}`);
    localStorage.setItem('mf_recent', JSON.stringify([...stale, 'doc-sk']));
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 's1', name: '일반 공간', home: true, color: '#f0663f', maps: [] },
          { id: 's2', name: '1212', color: '#3f8fd0', maps: [{ title: '주간 계획', when: '방금', hue: '#3f8fd0', docId: 'doc-sk' }] },
        ],
        mapFolders: {},
      }),
    );
    // 본문은 백엔드에만 있다(localStorage `mindflow_doc_doc-sk` 없음) — 미리보기는
    // 오직 프리페치(loadPreview)로만 그려질 수 있다.
    const body = {
      doc: {
        v: 1,
        nodes: { root: { id: 'root', text: '주간 계획', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
        floats: [],
        lines: [],
        zones: [],
        layoutMode: 'radial',
        themeKey: 'coral',
      } as unknown as Doc,
      version: 1,
      title: '주간 계획',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    renderHomeWithDocStore([{ id: 'doc-sk', title: '주간 계획', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }], { 'doc-sk': body });

    // 트레이 카드가 뜨고(비활성 스페이스라 그리드에는 없다), 스켈레톤이 실제
    // 미리보기로 정착해야 한다. 수리 전: 프리페치 창(원시 앞 32개) 밖이라 영영 스켈레톤.
    await screen.findByText('최근 항목');
    const card = document.querySelector('[data-title="주간 계획"]')!;
    expect(card).toBeTruthy();
    await waitFor(() => expect(card.querySelector('.mf-skel')).toBeNull(), { timeout: 4000 });
  });
});
