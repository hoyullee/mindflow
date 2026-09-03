import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BOARD_TEMPLATES, KANBAN_TEMPLATES, MAP_TEMPLATES } from '../../templates/mapTemplates';
import { Home } from './Home';
import { mockMatchMedia } from '../../test/matchMedia';
import { themeOf } from '../editor/theme';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { mapId } from './storage';
import { RECENT_CARD_W, recentFit } from './components/RecentStrip';
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
function renderHomeWithDocStore(metas: DocMeta[] = [], bodies: Record<string, LoadedDoc> = {}, mode: Backend['mode'] = 'local', imageStore: Backend['imageStore'] = new LocalImageStore()) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore, commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode };
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
  return { ...utils, docStore, imageStore };
}

/**
 * 프로필명 변경은 프로필 팝오버에서 **설정 모달**로 옮겨졌다(요청: 프로필 이미지
 * 변경과 한자리에). 팝오버가 열린 상태에서 부른다.
 */
async function openProfileNameEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '설정' }));
  const settings = screen.getByRole('dialog', { name: '설정' });
  await user.click(settings.querySelector('[data-profile-detail-row]') as HTMLElement);
  await user.click(within(settings).getByRole('button', { name: '프로필명 변경' }));
}

/**
 * "새로 만들기"는 이제 **템플릿 갤러리**를 연다 — 빈 맵 칸까지 눌러야 예전과 같은
 * 결과(로더 → 카드 등록 → /editor)가 된다. 세 진입점(툴바·빈 상태 CTA·빈 자리
 * 우클릭)이 전부 같은 갤러리를 열므로 여는 버튼은 인자로 받는다.
 */
async function createBlankMap(user: ReturnType<typeof userEvent.setup>, opener?: HTMLElement) {
  await user.click(opener ?? screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
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
    expect(screen.getAllByRole('button', { name: '새로 만들기' }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
  });

  it('shows the signed-in email in the LNB profile and derives the name from it', async () => {
    // LocalAuth reads its session from `mf_demo_session`; seed a real login email.
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    const { container } = renderHomeWithDocStore([]);
    const aside = within(container.querySelector('aside') as HTMLElement);

    // the real email is shown (popover content is always in the DOM), and the
    // name defaults to its local part — not the hardcoded "mine" placeholder.
    // 이메일은 사이드바에 **두 번** 나온다 — 프로필 버튼의 부제(디자인 원본)와
    // 팝오버 머리(항상 DOM에 있다). 둘 중 하나라도 있으면 이 테스트의 뜻은 통한다.
    await waitFor(() => expect(aside.getAllByText('hoyul.lee@wantedlab.com').length).toBeGreaterThan(0));
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
    const backend: Backend = { auth: new GoogleAuth(), docStore: new MockDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    const backend: Backend = { auth: new GatedAuth(), docStore: new MockDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    expect(screen.getAllByRole('button', { name: '새로 만들기' }).length).toBe(1);
  });

  it('still shows the "아직 만든 맵이 없어요" prompt for a space with neither maps nor folders', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'se', name: '빈공간', color: '#3f8fd0', maps: [], folders: [] }], mapFolders: {} }));
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    // both the toolbar button and the empty-state CTA are present
    expect(screen.getAllByRole('button', { name: '새로 만들기' }).length).toBe(2);
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

  // 제보: 폴더를 더블클릭해 들어가는 순간 두 번째 클릭이 그 자리에 새로 그려진
  // "상위 폴더" 타일에 떨어져 글자가 통째로 선택된 것처럼 보였다. 타일도 폴더 카드와
  // 같은 규칙(두 번 클릭)으로 바꾸고, 남의 첫 클릭에 딸려 온 dblclick은 무시한다.
  it('상위 폴더 타일은 폴더 카드와 같이 두 번 눌러야 올라간다(진입 직후 dblclick 무시)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sc', name: '클릭공간', color: '#3f8fd0', maps: [], folders: [{ id: 'fc', name: '들어갈폴더' }] }],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([]);

    await waitFor(() => expect(screen.getByText('들어갈폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('들어갈폴더'));
    // 폴더에 들어왔고, 그 dblclick이 타일로 새어 다시 나가지 않았다.
    await waitFor(() => expect(container.querySelector('[data-parent-tile]')).toBeTruthy());
    expect(screen.getByTitle('클릭공간 / 들어갈폴더')).toBeTruthy();

    // 한 번 클릭으로는 올라가지 않는다.
    const tile = screen.getByRole('button', { name: '상위 폴더 클릭공간(으)로 이동' });
    await user.click(tile);
    expect(container.querySelector('[data-parent-tile]')).toBeTruthy();

    // 두 번 클릭해야 올라간다.
    await user.dblClick(tile);
    await waitFor(() => expect(container.querySelector('[data-parent-tile]')).toBeNull());
    expect(screen.getByText('들어갈폴더')).toBeTruthy();
  });

  // 요청: 내용이 있어도 폴더를 지울 수 있다. 폴더는 이름표라 지워도 안의 것은
  // 남는다 — 맵과 하위 폴더는 한 단계 위로 올라온다.
  it('내용이 있는 폴더도 삭제할 수 있고, 안의 맵·하위 폴더는 한 단계 위로 올라온다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          {
            id: 'sd',
            name: '삭제공간',
            color: '#3f8fd0',
            maps: [{ title: '폴더 안 맵', when: '내 맵', hue: '#f0663f', docId: 'd-in' }],
            folders: [
              { id: 'fa', name: '지울폴더' },
              { id: 'fb', name: '하위폴더', parent: 'fa' },
            ],
          },
        ],
        mapFolders: { 'd-in': 'fa' },
      }),
    );
    const { container } = renderHomeWithDocStore([{ id: 'd-in', title: '폴더 안 맵', updatedAt: '', version: 1, isFavorite: false, deletedAt: null }]);

    await waitFor(() => expect(screen.getByText('지울폴더')).toBeTruthy());
    fireEvent.contextMenu(screen.getByText('지울폴더'));
    const menu = await screen.findByRole('menu');
    const del = within(menu).getByRole('menuitem', { name: /폴더 삭제/ });
    expect(del.getAttribute('aria-disabled')).not.toBe('true'); // 예전엔 막혀 있었다
    await user.click(del);

    // 확인창이 무엇이 어디로 가는지 말해 준다.
    await waitFor(() => expect(screen.getByText(/맵 1개와 하위 폴더 1개는 삭제되지 않고 '삭제공간'\(으\)로 옮겨져요/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '삭제' }));

    // 폴더는 사라지고, 안에 있던 하위 폴더와 맵이 최상위로 올라온다.
    await waitFor(() => expect(screen.queryByText('지울폴더')).toBeNull());
    expect(screen.getByText('하위폴더')).toBeTruthy();
    expect(container.querySelector('.mf-map-grid a[data-title="폴더 안 맵"]')).toBeTruthy();
  });

  // 요청: 아래로는 드래그로 넣는데 위로 꺼내려면 우클릭 메뉴뿐이었다 — 그리드
  // 첫 칸의 "상위 폴더" 타일이 드롭 대상이 되어 방향이 대칭을 이룬다.
  it('상위 폴더 타일에 카드를 끌어다 놓으면 한 단계 위로 옮겨진다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          {
            id: 'su',
            name: '이동공간',
            color: '#3f8fd0',
            maps: [{ title: '올릴 맵', when: '내 맵', hue: '#f0663f', docId: 'd-up' }],
            folders: [
              { id: 'p1', name: '상위폴더' },
              { id: 'p2', name: '하위폴더', parent: 'p1' },
            ],
          },
        ],
        mapFolders: { 'd-up': 'p2' },
      }),
    );
    const { container } = renderHomeWithDocStore([{ id: 'd-up', title: '올릴 맵', updatedAt: '', version: 1, isFavorite: false, deletedAt: null }]);

    await waitFor(() => expect(screen.getByText('상위폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('상위폴더'));
    await waitFor(() => expect(screen.getByText('하위폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('하위폴더'));
    await waitFor(() => expect(container.querySelector('a[data-title="올릴 맵"]')).toBeTruthy());

    // 타일은 "올라가면 닿는 곳"의 이름을 말한다.
    const tile = container.querySelector('[data-parent-tile]') as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.textContent).toContain('상위폴더');

    // jsdom의 fireEvent에는 dataTransfer가 없어 핸들러가 첫 줄에서 죽는다 — 최소 스텁.
    const store: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? '',
    };
    const card = container.querySelector('a[data-title="올릴 맵"]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(tile, { dataTransfer });
    fireEvent.drop(tile, { dataTransfer });

    // 이 폴더(하위폴더)에서는 사라지고, 한 단계 위(상위폴더)에서 보인다.
    await waitFor(() => expect(container.querySelector('a[data-title="올릴 맵"]')).toBeNull());
    await user.dblClick(screen.getByRole('button', { name: '상위 폴더 상위폴더(으)로 이동' }));
    await waitFor(() => expect(container.querySelector('a[data-title="올릴 맵"]')).toBeTruthy());
  });

  // 제보: 여러 장을 골라 상위 폴더 타일로 끌어 올린 뒤 그 폴더로 올라가 보니
  // **옮긴 카드들이 그대로 다중 선택돼** 있었다. 타일이 단일 경로(`moveMapUp`)를
  // 키마다 불렀는데 그 길은 선택을 비우지 않았다 — 폴더 카드 드롭·메뉴 이동과
  // 같은 일괄 경로를 쓰게 해 "옮긴 카드는 이 목록에서 사라진다 → 선택도 끝난다".
  it('상위 폴더 타일로 여러 장을 올리면 선택이 남지 않는다', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          {
            id: 'sm',
            name: '이동공간',
            color: '#3f8fd0',
            maps: [
              { title: '맵하나', when: '내 맵', hue: '#f0663f', docId: 'm1' },
              { title: '맵둘', when: '내 맵', hue: '#f0663f', docId: 'm2' },
            ],
            folders: [
              { id: 'q1', name: '위폴더' },
              { id: 'q2', name: '아래폴더', parent: 'q1' },
            ],
          },
        ],
        mapFolders: { m1: 'q2', m2: 'q2' },
      }),
    );
    const { container } = renderHomeWithDocStore([
      { id: 'm1', title: '맵하나', updatedAt: '', version: 1, isFavorite: false, deletedAt: null },
      { id: 'm2', title: '맵둘', updatedAt: '', version: 1, isFavorite: false, deletedAt: null },
    ]);
    const cardKeys = () => Array.from(container.querySelectorAll('[data-card-key]')).map((e) => e.getAttribute('data-card-key')!);
    const chosen = () =>
      Array.from(container.querySelectorAll('[data-card-key]')).filter((e) => (e as HTMLElement).style.outline.includes('var(--mf-accent)')).length;

    await waitFor(() => expect(screen.getByText('위폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('위폴더'));
    await waitFor(() => expect(screen.getByText('아래폴더')).toBeTruthy());
    await user.dblClick(screen.getByText('아래폴더'));
    await waitFor(() => expect(cardKeys()).toHaveLength(2));

    // 둘을 고른다.
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;
    const [ka, kb] = cardKeys();
    fireEvent.click(card(ka!));
    fireEvent.click(card(kb!), { ctrlKey: true });
    expect(chosen()).toBe(2);

    const store: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? '',
    };
    const tile = container.querySelector('[data-parent-tile]') as HTMLElement;
    fireEvent.dragStart(card(ka!), { dataTransfer });
    fireEvent.dragOver(tile, { dataTransfer });
    fireEvent.drop(tile, { dataTransfer });

    // 둘 다 이 폴더에서 사라지고, 한 단계 위로 올라가도 **선택 표시가 없다**.
    await waitFor(() => expect(cardKeys()).toHaveLength(0));
    await user.dblClick(screen.getByRole('button', { name: '상위 폴더 위폴더(으)로 이동' }));
    await waitFor(() => expect(cardKeys()).toHaveLength(2));
    expect(chosen()).toBe(0);
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

    // 위로 1회 = 상위 폴더('내폴더')로 — 그리드 첫 칸의 "상위 폴더" 타일이
    // 뒤로가기 버튼을 대신한다(요청).
    await user.dblClick(screen.getByRole('button', { name: '상위 폴더 내폴더(으)로 이동' }));
    await waitFor(() => expect(screen.getByText('하위자료')).toBeTruthy());
    expect(screen.getByTitle('폴더공간 / 내폴더')).toBeTruthy();

    // 위로 2회 = 스페이스 최상위 — 최상위 폴더 카드('내폴더')가 보인다
    await user.dblClick(screen.getByRole('button', { name: '상위 폴더 폴더공간(으)로 이동' }));
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
      await user.dblClick(screen.getByRole('button', { name: '상위 폴더 내 공간(으)로 이동' }));
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
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    // ⚠️ 플라이아웃 안 항목은 `fireEvent.click`으로 누른다 — jsdom에는 레이아웃이
    // 없어 모든 사각형이 0이고, Radix가 "포인터가 하위 메뉴로 향하는가"를 그 사각형
    // 으로 판단하므로 userEvent가 함께 쏘는 pointermove가 하위 메뉴를 닫아 버린다
    // (실브라우저에서는 정상이다 — 마우스 경로는 실브라우저 프로브로 확인한다).
    fireEvent.click(await screen.findByRole('menuitem', { name: '공간비이' }));

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

  it('새 스페이스 팝업이 첨부 디자인 그대로 — 아이콘 칩·부제·0/10·색 여섯·빈 이름은 못 만든다', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /새 스페이스/ })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /새 스페이스/ }));

    const dlg = await screen.findByRole('dialog', { name: '새 스페이스 만들기' });
    expect(within(dlg).getByText('주제별로 보드를 정리할 공간을 만들어요')).toBeTruthy();
    expect(dlg.querySelector('[data-dialog-icon]')).toBeTruthy();
    expect(dlg.querySelector('[data-dialog-count]')?.textContent).toBe('0/10');
    expect((within(dlg).getByRole('button', { name: '만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dlg.querySelectorAll('[data-dialog-color]').length).toBe(6);
    expect(within(dlg).getByPlaceholderText('예: 팀 프로젝트')).toBeTruthy();

    await user.type(within(dlg).getByLabelText('스페이스 이름'), '팀');
    expect(dlg.querySelector('[data-dialog-count]')?.textContent).toBe('1/10');
    expect((within(dlg).getByRole('button', { name: '만들기' }) as HTMLButtonElement).disabled).toBe(false);
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
    // 색 칸은 이름을 가진 라디오다(hex를 읽지 않는다).
    await user.click(screen.getByRole('radio', { name: '분홍' }));
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
    await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

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

  it('설정 모달에서 프로필 이미지를 바꾸면 아바타에 반영되고, 프로필명 변경도 여기 있다(요청)', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const calls: (Blob | null)[] = [];
    vi.spyOn(auth, 'updateAvatar').mockImplementation(async (blob) => {
      calls.push(blob);
      return { url: blob ? 'https://cdn.example.com/a.webp' : null };
    });
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    // 프로필명 변경은 팝오버에서 사라지고(요청) 설정 모달로 옮겨졌다.
    expect(screen.queryByRole('button', { name: '프로필명 변경' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '설정' }));
    const dialog = screen.getByRole('dialog', { name: '설정' });
    // 첫 화면은 진입 행 둘 + 색상 테마이고, 테마가 **가장 아래**다(요청).
    const rows = [...dialog.querySelectorAll('[data-profile-detail-row], [data-account-detail-row]')];
    expect(rows).toHaveLength(2);
    const themeGroup = within(dialog).getByRole('radiogroup', { name: '색상 테마 선택' });
    expect(rows[1]!.compareDocumentPosition(themeGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 사진·이름은 한 겹 안('프로필 설정')에 모여 있다.
    await user.click(rows[0] as HTMLElement);
    expect(within(dialog).getByText('프로필 이미지 변경')).toBeTruthy();
    expect(within(dialog).getByText('프로필명 변경')).toBeTruthy();

    // 파일 고르기가 실제로 연결돼 있다(이미지만 받는다). 올리는 흐름 전체는
    // 캔버스가 필요해 별도 파일에서 검증한다(`AvatarChange.test.tsx`).
    const input = dialog.querySelector('[data-avatar-input]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    // 아바타 자체도 버튼이다(카메라 배지) — 같은 파일 고르기를 연다.
    expect(dialog.querySelector('[data-avatar-pick]')).toBeTruthy();
    expect(calls).toEqual([]); // 아직 아무것도 올리지 않았다
  });

  it('프로필 메뉴도 펼침·접힘 애니메이션을 그린다 (요청)', async () => {
    const user = userEvent.setup();
    renderHome();

    const trigger = await screen.findByRole('button', { name: '계정 메뉴' });
    const pop = () => document.querySelector('.settings-pop') as HTMLElement | null;
    // 첫 페인트에서는 아예 그리지 않는다 — 나가는 애니메이션이 괜히 돌 일이 없다
    // (예전에는 `display: none`으로 마운트된 채였다).
    expect(pop()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    // 상태는 클래스가 아니라 **자기 속성**으로 알린다 — 애니메이션은 CSS가
    // `[data-state]`에 걸고, 닫히는 동안 Radix가 노드를 붙잡아 둔다.
    await waitFor(() => expect(pop()?.getAttribute('data-state')).toBe('open'));
    expect(pop()?.className).toContain('mf-pop-anim');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.click(trigger);
    await waitFor(() => expect(document.querySelector('.settings-pop')).toBeNull());
  });

  it('logs out (via the confirm dialog) and navigates to /login', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await user.click(screen.getByRole('button', { name: /로그아웃/ }));
    expect(screen.getByText('로그아웃하시겠습니까?')).toBeTruthy();

    // 확인창 안의 버튼을 누른다 — 프로필 메뉴는 닫힘 애니메이션 동안 잠깐 더
    // 마운트돼 있어(usePopAnim) 같은 이름의 행이 둘 보인다.
    const logoutCard = screen.getByText('로그아웃하시겠습니까?').parentElement as HTMLElement;
    await user.click(within(logoutCard).getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
  });

  it('renames the profile via the "프로필명 변경" popup from the profile menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    // profile popover → 프로필명 변경 opens a popup (like 공간 이름 변경)
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' })); // 프로필 스켈레톤 해제(getSession) 대기
    await openProfileNameEdit(user);

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
    await openProfileNameEdit(user);
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
    await openProfileNameEdit(user);
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
    await openProfileNameEdit(user);
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
    const backend: Backend = { auth: new BackendAuth(), docStore: new MockDocStore([]), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
    await openProfileNameEdit(user);
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '새닉네임');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));

    await waitFor(() => expect(setProfileName).toHaveBeenCalledWith('새닉네임'));
  });

  it('설정 → 회원 탈퇴: 문장을 입력해야 다음이 열리고, 한 번 더 확인한 뒤에야 지운다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const del = vi.spyOn(auth, 'deleteAccount');
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });
    // ① 첫 화면에는 '계정 설정' 한 줄만 있고, 그 안에 네 항목이 있다(요청)
    expect(within(settingsDialog).getByText('계정 설정')).toBeTruthy();
    expect(within(settingsDialog).queryByText('회원 탈퇴')).toBeNull();
    await user.click(settingsDialog.querySelector('[data-account-detail-row]') as HTMLElement);
    for (const label of ['비밀번호 변경', 'Google 연동', '모든 기기에서 로그아웃', '회원 탈퇴']) {
      expect(within(settingsDialog).getByText(label)).toBeTruthy();
    }
    // 화면 전환 애니메이션 — **좌우 이동 없이 제자리 페이드**(제보: 글자가 가로로
    // 지나가는데 상자는 세로로 줄어 어긋나 보였다). 높이 전이와 같은 길이·곡선.
    // 처음 열 때는 걸리지 않는다(카드 자체가 페이드로 뜬다).
    const view = () => settingsDialog.querySelector('.mf-settings-view') as HTMLElement;
    expect(view().className).toContain('is-swap');
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    expect(css).toContain('@keyframes mf-view-fade');
    const fade = css.slice(css.indexOf('@keyframes mf-view-fade'), css.indexOf('.mf-settings-view.is-swap'));
    expect(fade).not.toContain('translateX'); // 가로 이동은 없다
    const rule = css.slice(css.indexOf('.mf-settings-view.is-swap'));
    expect(rule).toContain('mf-view-fade');
    expect(rule).toContain('cubic-bezier(0.4, 0, 0.2, 1)'); // 높이 전이와 같은 곡선
    expect(css).not.toContain('mf-view-in-fwd'); // 좌우 슬라이드는 걷어냈다

    // 헤더 제목은 '설정'을 지키고(요청) 어느 화면인지는 본문 부 제목이 말한다.
    expect(settingsDialog.getAttribute('aria-label')).toBe('설정');
    expect((settingsDialog.querySelector('div') as HTMLElement).textContent).toContain('설정');
    expect(within(settingsDialog).getByText('계정 설정')).toBeTruthy();
    // 묶음 제목은 지웠다(요청)
    expect(within(settingsDialog).queryByText('로그인 수단')).toBeNull();
    expect(within(settingsDialog).queryByText('계정 관리')).toBeNull();
    // 카드 높이도 이어 준다(요청) — 실제 전이는 실브라우저에서 재고, 여기서는
    // 본문 래퍼가 있고 전환 뒤 인라인 높이가 **남지 않는지**를 지킨다(남으면 안쪽
    // 오류 문구가 늘어나도 상자가 안 늘어난다).
    const body = settingsDialog.querySelector('[data-settings-body]') as HTMLElement;
    expect(body).toBeTruthy();
    await user.click(within(settingsDialog).getByRole('button', { name: '뒤로' }));
    expect(view().className).toContain('is-swap'); // 뒤로 갈 때도 같은 페이드(요청)
    expect(body.style.height).toBe('');
    await user.click(settingsDialog.querySelector('[data-account-detail-row]') as HTMLElement); // 흐름 계속

    await user.click(within(settingsDialog).getByText('회원 탈퇴'));
    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    const next = within(confirmDialog).getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    // 짧은 '탈퇴'로는 열리지 않는다 — 문장을 정확히 쳐야 한다
    const input = within(confirmDialog).getByLabelText('탈퇴 확인 입력');
    await user.type(input, '탈퇴');
    expect((within(confirmDialog).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    await user.type(input, '회원 탈퇴에 동의합니다');
    expect((within(confirmDialog).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(false);

    // ② 여기서 눌러도 아직 지우지 않는다 — 마지막 확인창이 한 번 더 뜬다
    await user.click(within(confirmDialog).getByRole('button', { name: '다음' }));
    expect(del).not.toHaveBeenCalled();
    const last = await screen.findByText('마지막으로 확인할게요');
    const card = last.parentElement as HTMLElement;

    // 취소하면 아무것도 지워지지 않고 흐름이 닫힌다
    await user.click(within(card).getByRole('button', { name: '취소' }));
    expect(del).not.toHaveBeenCalled();
    // 닫힌 모달은 이제 **DOM에서 사라진다**(Radix Dialog) — 예전에는 `display: none`
    // 으로 계속 떠 있어 "보이는지"로 판정해야 했다.
    expect(screen.queryByText('마지막으로 확인할게요')).toBeNull();
    expect(card.isConnected).toBe(false);
  });

  it('마지막 확인창에서 영구 삭제를 누르면 그때 지운다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const del = vi.spyOn(auth, 'deleteAccount').mockResolvedValue({});
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(screen.getByRole('dialog', { name: '설정' }).querySelector('[data-account-detail-row]') as HTMLElement);
    await user.click(within(screen.getByRole('dialog', { name: '설정' })).getByText('회원 탈퇴'));
    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '회원 탈퇴에 동의합니다');
    await user.click(within(confirmDialog).getByRole('button', { name: '다음' }));
    const card = (await screen.findByText('마지막으로 확인할게요')).parentElement as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '영구 삭제' }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  // 제보: 로그인 후 비밀번호를 바꿀 자리가 없어(로그아웃 → '비밀번호 찾기'뿐) 설정에
  // 항목을 추가했다. 현재 비밀번호 확인이 붙는다(backend.md §15).
  it('설정 → 비밀번호 변경: 현재/새/확인을 받아 changePassword를 부르고 완료를 알린다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const calls: string[][] = [];
    vi.spyOn(auth, 'changePassword').mockImplementation(async (...args: unknown[]) => {
      calls.push(args as string[]);
      return {};
    });
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['email']);
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@geurio.com' } }));
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

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });
    await user.click(settingsDialog.querySelector('[data-account-detail-row]') as HTMLElement);
    await user.click(within(settingsDialog).getByText('비밀번호 변경'));

    const dialog = screen.getByRole('dialog', { name: '비밀번호 변경' });
    // 확인이 맞지 않으면 서버를 부르지 않고 그 자리에서 알린다.
    await user.type(within(dialog).getByLabelText('현재 비밀번호'), 'old-pw');
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'new-pw');
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'new-pX');
    await user.click(within(dialog).getByRole('button', { name: '비밀번호 변경' }));
    expect(within(dialog).getByText('비밀번호가 일치하지 않습니다.')).toBeTruthy();
    expect(calls).toEqual([]);

    // 맞게 고치면 어댑터로 (현재, 새) 그대로 넘어가고 완료 화면이 뜬다.
    await user.clear(within(dialog).getByLabelText('새 비밀번호 확인'));
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'new-pw');
    await user.click(within(dialog).getByRole('button', { name: '비밀번호 변경' }));
    await waitFor(() => expect(within(dialog).getByText('비밀번호를 변경했어요')).toBeTruthy());
    expect(calls).toEqual([['old-pw', 'new-pw']]);
    // 어댑터가 실제로 하는 일(다른 기기 세션 해지)을 한 줄로 알린다.
    expect(within(dialog).getByText(/현재 기기를 제외한/)).toBeTruthy();
    expect(within(dialog).getByText(/다른 기기의 로그인/)).toBeTruthy();
    // 체크는 원·체크가 한 그림인 SVG 아이콘이다(요청) — CSS 원 + 획 조합이 아니다.
    expect(dialog.querySelector('svg[data-done-check]')).toBeTruthy();
  });

  it('현재 비밀번호가 틀리면 그 사실만 알리고 모달에 머문다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'changePassword').mockResolvedValue({ wrongCurrent: true, error: 'Invalid login credentials' });
    vi.spyOn(auth, 'emailSignInProviders').mockResolvedValue(['email']);
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(screen.getByRole('dialog', { name: '설정' }).querySelector('[data-account-detail-row]') as HTMLElement);
    await user.click(within(screen.getByRole('dialog', { name: '설정' })).getByText('비밀번호 변경'));
    const dialog = screen.getByRole('dialog', { name: '비밀번호 변경' });
    await user.type(within(dialog).getByLabelText('현재 비밀번호'), 'nope');
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'new-pw');
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'new-pw');
    await user.click(within(dialog).getByRole('button', { name: '비밀번호 변경' }));
    await waitFor(() => expect(within(dialog).getByText('현재 비밀번호가 올바르지 않아요.')).toBeTruthy());
    expect(within(dialog).queryByText('비밀번호를 변경했어요')).toBeNull();
  });

  // 요청: Google로 가입한 계정도 **비밀번호를 설정**할 수 있어야 한다(막는 대신
  // 수단을 늘린다). 확인할 현재 비밀번호가 없으니 계정 이메일로 코드를 받는다.
  it('Google로만 가입한 계정: 비밀번호 설정 → 코드 확인 후 설정하고 행이 변경으로 바뀐다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const methods = vi.spyOn(auth, 'signinMethods');
    methods.mockResolvedValue({ hasPassword: false, providers: ['google'] });
    const send = vi.spyOn(auth, 'sendPasswordSetupCode').mockResolvedValue({});
    const setPw = vi.spyOn(auth, 'setPasswordWithCode').mockResolvedValue({});
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));
    const row = await waitFor(() => {
      const el = document.querySelector('[data-change-pw-row]') as HTMLElement;
      expect(el.textContent).toContain('비밀번호 설정');
      return el;
    });
    // Google이 유일한 수단이면 연결 해제는 내주지 않는다 — 들어올 길이 사라진다.
    const unlink = document.querySelector('[data-google-link-action]') as HTMLButtonElement;
    expect(unlink.textContent).toContain('연결 해제');
    expect(unlink.disabled).toBe(true);
    expect((document.querySelector('[data-google-link-row]') as HTMLElement).textContent).toContain('유일한 로그인 수단');

    // 모달을 열면 곧바로 코드를 보낸다
    await user.click(row);
    const dialog = await screen.findByRole('dialog', { name: '비밀번호 설정' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(dialog.textContent).toContain('me@gmail.com');

    // 설정이 끝나면 컨트롤러가 **이메일 신원까지 등록**한다(0030) — 그래야 Google을
    // 뗄 수 있다(Supabase는 신원을 세고 비밀번호는 신원이 아니다).
    const register = vi.spyOn(auth, 'registerEmailIdentity').mockImplementation(async () => {
      methods.mockResolvedValue({ hasPassword: true, providers: ['google', 'email'] });
      return true;
    });
    methods.mockResolvedValue({ hasPassword: true, providers: ['google'] });
    await user.type(within(dialog).getByLabelText('메일로 받은 인증번호'), '123456');
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'newpw');
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'newpw');
    await user.click(within(dialog).getByRole('button', { name: '비밀번호 설정' }));

    await waitFor(() => expect(setPw).toHaveBeenCalledWith('123456', 'newpw'));
    expect(dialog.querySelector('[data-set-pw-done]')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '확인' }));
    // 이제 비밀번호가 있고 이메일 신원도 있다 — 행은 '변경'이고 해제도 열린다
    await waitFor(() => expect((document.querySelector('[data-change-pw-row]') as HTMLElement).textContent).toContain('비밀번호 변경'));
    expect(register).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((document.querySelector('[data-google-link-action]') as HTMLButtonElement).disabled).toBe(false));
  });

  // 제보: 비밀번호 설정 모달에서 **새 비밀번호를 치는데 커서가 코드 칸으로 튀었다**.
  // 인라인 `ref` 콜백이 렌더마다 돌면서 "코드 칸이 비어 있으면 포커스"를 계속
  // 실행한 것 — 다른 칸의 타이핑이 곧 리렌더라 한 글자마다 되가져갔다.
  it('첫 칸 포커스는 열릴 때 한 번 — 다른 칸을 타이핑해도 커서가 튀지 않는다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signinMethods').mockResolvedValue({ hasPassword: false, providers: ['google'] });
    vi.spyOn(auth, 'sendPasswordSetupCode').mockResolvedValue({});
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));
    await user.click(await waitFor(() => document.querySelector('[data-change-pw-row]') as HTMLElement));
    const dialog = await screen.findByRole('dialog', { name: '비밀번호 설정' });
    const code = within(dialog).getByLabelText('메일로 받은 인증번호');
    // 열릴 때는 첫 칸(코드)에 포커스가 간다
    await waitFor(() => expect(document.activeElement).toBe(code));

    // 새 비밀번호로 옮겨 한 글자씩 치는 동안 포커스가 그 칸에 머문다
    const pw = within(dialog).getByLabelText('새 비밀번호') as HTMLInputElement;
    await user.click(pw);
    await user.type(pw, 'newpw');
    expect(document.activeElement).toBe(pw);
    expect(pw.value).toBe('newpw'); // 튀었다면 글자가 코드 칸으로 흘렀다
    expect((code as HTMLInputElement).value).toBe('');
  });

  // 제보: 비밀번호를 설정한 뒤에도 해제가 막히는데 문구가 "마지막 로그인 수단은
  // 해제할 수 없어요. 비밀번호를 먼저 설정해 주세요."라 **두 이유가 섞여** 어느
  // 쪽인지 알 수 없었다. 두 상황은 조건도 해법도 다르다:
  //  ① 신원이 Google 하나뿐 → 서버가 거절한다(비밀번호를 설정해도 신원은 안 늘어난다)
  //  ② 신원은 둘인데 비밀번호가 없다 → 우리 규칙(해제하면 들어올 길이 없다)
  it.each([
    [{ hasPassword: true, providers: ['google'] }, '유일한 로그인 수단', '비밀번호를 먼저'],
    [{ hasPassword: false, providers: ['google', 'email'] }, '비밀번호를 먼저 설정', '유일한 로그인 수단'],
  ])('Google 해제가 막히는 이유를 상황별로 말한다 (%o)', async (methods, expected, notExpected) => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signinMethods').mockResolvedValue(methods as never);
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));
    const row = await waitFor(() => {
      const el = document.querySelector('[data-google-link-row]') as HTMLElement;
      expect(el.textContent).toContain(expected);
      return el;
    });
    expect(row.textContent).not.toContain(notExpected); // 두 이유가 섞이지 않는다
    expect((document.querySelector('[data-google-link-action]') as HTMLButtonElement).disabled).toBe(true);
  });

  // 제보자 계정처럼 **이미 비밀번호만 설정해 둔** 계정(0030 이전)은 설정을 열 때
  // 이메일 신원을 등록해 스스로 낫는다 — 그러면 해제 버튼이 열린다.
  it('비밀번호는 있는데 이메일 신원이 없으면 설정을 열 때 등록하고 해제가 열린다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const methods = vi.spyOn(auth, 'signinMethods');
    methods.mockResolvedValue({ hasPassword: true, providers: ['google'] });
    const register = vi.spyOn(auth, 'registerEmailIdentity').mockImplementation(async () => {
      methods.mockResolvedValue({ hasPassword: true, providers: ['google', 'email'] });
      return true;
    });
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((document.querySelector('[data-google-link-action]') as HTMLButtonElement).disabled).toBe(false));
    expect((document.querySelector('[data-google-link-row]') as HTMLElement).textContent).toContain('Google 계정으로도 로그인할 수 있어요');
  });

  it('코드가 틀리면 그 자리에서 말한다 (설정은 되지 않는다)', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'signinMethods').mockResolvedValue({ hasPassword: false, providers: ['google'] });
    vi.spyOn(auth, 'sendPasswordSetupCode').mockResolvedValue({});
    vi.spyOn(auth, 'setPasswordWithCode').mockResolvedValue({ wrongCode: true, error: 'invalid nonce' });
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));
    await user.click(await waitFor(() => document.querySelector('[data-change-pw-row]') as HTMLElement));
    const dialog = await screen.findByRole('dialog', { name: '비밀번호 설정' });
    await user.type(within(dialog).getByLabelText('메일로 받은 인증번호'), '000000');
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'newpw');
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'newpw');
    await user.click(within(dialog).getByRole('button', { name: '비밀번호 설정' }));
    await waitFor(() => expect(dialog.querySelector('[data-set-pw-error]')?.textContent).toContain('인증번호가 올바르지 않'));
    expect(dialog.querySelector('[data-set-pw-done]')).toBeNull();
  });

  // 요청: 이메일로 가입한 계정에 Google을 **연결**할 수 있어야 한다(SNS 연동).
  it('설정 → 로그인 수단: Google 연결 / 확인 뒤 연결 해제', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const methods = vi.spyOn(auth, 'signinMethods');
    methods.mockResolvedValue({ hasPassword: true, providers: ['email'] });
    const link = vi.spyOn(auth, 'linkGoogle').mockResolvedValue({});
    const unlink = vi.spyOn(auth, 'unlinkGoogle').mockResolvedValue({});
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await waitFor(() => document.querySelector('[data-account-detail-row]') as HTMLElement));
    const action = await waitFor(() => {
      const el = document.querySelector('[data-google-link-action]') as HTMLButtonElement;
      expect(el.textContent).toContain('연결');
      expect(el.disabled).toBe(false);
      return el;
    });

    methods.mockResolvedValue({ hasPassword: true, providers: ['email', 'google'] });
    await user.click(action);
    await waitFor(() => expect(link).toHaveBeenCalledTimes(1));
    // 연결되면 같은 버튼이 해제로 바뀐다
    const off = await waitFor(() => {
      const el = document.querySelector('[data-google-link-action]') as HTMLButtonElement;
      expect(el.textContent).toContain('연결 해제');
      return el;
    });

    methods.mockResolvedValue({ hasPassword: true, providers: ['email'] });
    await user.click(off);
    // 확인창을 한 번 거친다 — 출입구가 하나 사라지는 동작이다
    expect(unlink).not.toHaveBeenCalled();
    const card = (await screen.findByText('Google 연결을 해제할까요?')).parentElement as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '연결 해제' }));
    await waitFor(() => expect(unlink).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((document.querySelector('[data-google-link-action]') as HTMLButtonElement).textContent).toContain('연결'));
  });

  // 세션 정책 ①(backend.md §15) — 이 앱의 세션은 기기 수 제한 없이 오래 유지되므로
  // 분실·공용 PC의 로그인을 **회수할 수단**이 필요하다.
  it('설정 → 모든 기기에서 로그아웃: 확인 뒤 global 범위로 signOut하고 /login으로 간다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const scopes: (string | undefined)[] = [];
    const realSignOut = auth.signOut.bind(auth);
    auth.signOut = async (scope?: 'local' | 'global' | 'others') => {
      scopes.push(scope);
      await realSignOut(scope);
    };
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_had_session', '1'); // 로그인한 적 있는 기기
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

    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });
    await user.click(settingsDialog.querySelector('[data-account-detail-row]') as HTMLElement);
    await user.click(within(settingsDialog).getByText('모든 기기에서 로그아웃'));

    // 다른 기기까지 끊는 동작이라 한 번 묻는다.
    expect(screen.getByText('모든 기기에서 로그아웃할까요?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '모두 로그아웃' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
    expect(scopes).toEqual(['global']);
    // 직접 로그아웃했으므로 만료 판정 마커를 지운다 — 다음 방문에 "만료" 거짓말 금지.
    expect(localStorage.getItem('mf_had_session')).toBeNull();
  });

  it('평범한 로그아웃은 이 기기만(local) — 그래도 만료 마커는 지운다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const scopes: (string | undefined)[] = [];
    const realSignOut = auth.signOut.bind(auth);
    auth.signOut = async (scope?: 'local' | 'global' | 'others') => {
      scopes.push(scope);
      await realSignOut(scope);
    };
    const backend: Backend = { auth, docStore: new MockDocStore([], {}), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
    localStorage.setItem('mf_had_session', '1');
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
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: /로그아웃/ }));
    const card = screen.getByText('로그아웃하시겠습니까?').parentElement as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
    expect(scopes).toEqual(['local']);
    expect(localStorage.getItem('mf_had_session')).toBeNull();
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
    await user.click(screen.getByRole('dialog', { name: '설정' }).querySelector('[data-account-detail-row]') as HTMLElement);
    await user.click(within(screen.getByRole('dialog', { name: '설정' })).getByText('회원 탈퇴'));

    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '회원 탈퇴에 동의합니다');
    await user.click(within(confirmDialog).getByRole('button', { name: '다음' }));
    // 마지막 확인창을 한 번 더 지난다(요청)
    const lastCard = (await screen.findByText('마지막으로 확인할게요')).parentElement as HTMLElement;
    await user.click(within(lastCard).getByRole('button', { name: '영구 삭제' }));

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
    // 선택 표시는 강조색 아웃라인 — 색상 테마(#41) 이후 값은 CSS 변수다(테마마다 색이 다르다).
    expect(cardA!.style.outline).toContain('var(--mf-accent)');
    expect(cardB!.style.outline).not.toContain('var(--mf-accent)');

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
    expect(tile().style.outline).not.toContain('var(--mf-accent)');

    // 한 번 = 선택(진입하지 않는다). 선택 표시는 맵 카드와 같은 강조색 outline 링.
    await user.click(tile());
    expect(screen.queryByText('이 폴더는 비어 있어요')).toBeNull();
    expect(tile().style.outline).toBe('2px solid var(--mf-accent)');

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
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Markdown 개요 (.md)' }));

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
      fireEvent.click(await screen.findByRole('menuitem', { name: 'SVG 이미지 (.svg)' }));

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
      const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore, commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'supabase' };

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
      fireEvent.click(await screen.findByRole('menuitem', { name: 'JSON 파일 (.json)' }));

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
          imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(),
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
        // 툴바 CTA와 빈 상태 CTA가 같은 이름을 쓴다 — 첫 번째(툴바)를 잡는다.
        const newBtn = screen.getAllByRole('button', { name: '새로 만들기' })[0]!;
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
      // …and it's the compact thumbnail (74px, 디자인 원본), not the full 150px one
      const thumb = recentCard.querySelector('.map-thumb') as HTMLElement;
      expect(thumb.style.height).toBe('74px');

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
      // recent cards are the compact variant (74px thumbnail — 디자인 원본)
      const recent = [...container.querySelectorAll('a[data-title]')].filter((c) => {
        const th = c.querySelector('.map-thumb') as HTMLElement | null;
        return th?.style.height === '74px';
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
        expect(slot.style.width).toBe('158px');
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
          return th?.style.height === '74px';
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
      const backend: Backend = { auth: new LocalAuth(), docStore: new PendingDocStore(), spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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
      const backend: Backend = { auth: new RacyAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'supabase' };
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

      const backend: Backend = { auth: new RacyAuth(), docStore, spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'supabase' };
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
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'supabase' };
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
    const popover = screen.getByRole('button', { name: '설정' }).parentElement as HTMLElement;
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
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(), mode: 'local' };
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

  // 제보: 회원가입 직후 홈에 들어오면 검색창에 **가입 이메일**이 채워진 채
  // 검색 결과 화면이 떠 있었다 — 이름·타입이 없는 단독 텍스트 입력을 브라우저가
  // 이메일 칸으로 짐작해 채워 넣은 것이고, 그 값이 우리 검색 상태로 그대로 들어왔다.
  it('포커스 없이 채워지는 값(브라우저 자동완성)은 검색으로 받지 않는다', async () => {
    const user = userEvent.setup();
    seedTwoSpaces();
    const { container } = renderHomeWithDocStore([meta('w1', '업무 회고')]);
    await waitFor(() => expect(container.querySelector('a[data-title="업무 회고"]')).toBeTruthy());

    const input = screen.getByPlaceholderText('모든 스페이스에서 검색') as HTMLInputElement;
    // 브라우저에도 성격을 밝혀 둔다(자동완성 대상에서 빠지게)
    expect(input.type).toBe('search');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('name')).toBeTruthy();

    // 제보 재현 — 포커스 없이 값이 도착한다
    fireEvent.change(input, { target: { value: 'ssasya2@gmail.com' } });
    expect(input.value).toBe('');
    expect(container.querySelector('[data-search-results]')).toBeNull();

    // 사람이 직접 치는 것은 그대로
    await user.type(input, '업무');
    await waitFor(() => expect(input.value).toBe('업무'));
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
    // 커서 자리에 뜬다 — 메뉴는 **클릭 지점에 놓인 0×0 자리표시자**(Radix 트리거)를
    // 기준으로 서므로, 자리는 그 자리표시자가 들고 있다(예전엔 메뉴가 직접 clamp한
    // left/top을 들었다).
    const anchor = document.querySelector('[aria-haspopup="menu"][aria-hidden="true"]') as HTMLElement;
    expect(anchor.style.left).toBe('240px');
    expect(anchor.style.top).toBe('180px');
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
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);

      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const cards = within(dialog).getAllByRole('button').filter((b) => b.hasAttribute('data-template'));
      expect(cards[0]?.getAttribute('data-template')).toBe('blank');
      // 마인드맵 구획은 **4칸**(요청: 빈 맵 + 브레인스토밍·주간 계획·학습 정리) —
      // 데이터는 그대로 있고(옛 tpl 주소는 동작) 갤러리에만 내놓지 않는다.
      expect(cards.map((c) => c.getAttribute('data-template'))).toEqual(expect.arrayContaining(['blank', 'brainstorm', 'weekly', 'study']));
      expect(cards.some((c) => c.getAttribute('data-template') === 'meeting')).toBe(false);
      // 썸네일은 홈 카드와 같은 렌더러 — 템플릿 칸마다 실제 미리보기 SVG가 있다
      const weekly = cards.find((c) => c.getAttribute('data-template') === 'weekly') as HTMLElement;
      expect(weekly.querySelector('svg[viewBox]')).toBeTruthy();
    });

    it('화이트보드 카드는 맵 카드와 다르게 보인다 — 종류 배지(제보)', async () => {
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

      // 종류 배지는 **모든 카드**에 붙는다(홈 리디자인) — 종류 이름이 다르다.
      await waitFor(() => expect(boardCard.querySelector('[data-board-badge]')?.textContent).toContain('화이트보드'));
      expect(mapCard.querySelector('[data-board-badge]')?.textContent).toContain('마인드맵');
      // 썸네일 바탕은 이제 **그 문서의 캔버스 배경**이다(제보: 에디터 배경색 미반영).
      // 그래서 종류를 알리는 일은 배지가 맡는다 — 화이트보드의 캔버스도 에디터에서는
      // 같은 따뜻한 wash라(테마 'white'의 canvasWash) 바탕만으로는 갈리지 않는다.
      const thumbBg = (card: HTMLElement) => ((card.querySelector('.map-thumb') as HTMLElement).style.background || '');
      expect(thumbBg(boardCard)).toContain('radial-gradient');
      expect(thumbBg(mapCard)).toContain('radial-gradient');
      expect(thumbBg(mapCard)).not.toContain('--mf-wash');
      expect(boardCard.querySelector('[data-dot-grid]')).toBeTruthy();
      expect(mapCard.querySelector('[data-dot-grid]')).toBeTruthy();
      // 종류 색은 배지의 점이 말한다(홈 리디자인) — 테두리는 둘 다 같은 경계선.
      expect((boardCard.querySelector('[data-board-badge] span') as HTMLElement).style.background).toContain('--mf-doc-board');
      expect((mapCard.querySelector('[data-board-badge] span') as HTMLElement).style.background).toContain('--mf-doc-map');
      expect(mapCard.style.border).toContain('--mf-border');
      // 배지는 카드 오른쪽 끝에 붙는다(제보: 너무 떨어져 있다).
      expect((boardCard.querySelector('[data-board-badge]') as HTMLElement).style.right).toBe('10px');
    });

    // 요청: 세 종류의 테두리 색이 서로 **명확히 구별**돼야 한다(예전엔 화이트보드와
    // 칸반이 같은 파랑을 썼고 마인드맵은 중립 경계선이었다).
    it('마인드맵·화이트보드·칸반 카드의 테두리 색이 각각 다르다(요청)', async () => {
      const mapDoc = { v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' };
      const boardDoc = { v: 1, kind: 'board', nodes: {}, floats: [{ id: 'f1', x: 10, y: 20, w: 180, text: '메모' }], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' };
      const kanbanDoc = { v: 1, kind: 'kanban', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', columns: [{ id: 'c1', title: '할 일' }], cards: [{ id: 'k1', col: 'c1', pos: 1, text: '카드' }] };
      const { container } = renderHomeWithDocStore(
        [
          { id: 'd-m', title: '맵 카드', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
          { id: 'd-b', title: '보드 카드', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
          { id: 'd-k', title: '칸반 카드', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ],
        {
          'd-m': { doc: mapDoc as never, version: 1, title: '맵 카드' },
          'd-b': { doc: boardDoc as never, version: 1, title: '보드 카드' },
          'd-k': { doc: kanbanDoc as never, version: 1, title: '칸반 카드' },
        },
      );
      const card = async (t: string) =>
        await waitFor(() => {
          const el = container.querySelector(`a[data-title="${t}"]`) as HTMLElement;
          expect(el).toBeTruthy();
          return el;
        });
      const kanban = await card('칸반 카드');
      await waitFor(() => expect(kanban.querySelector('[data-board-badge]')?.textContent).toContain('칸반'));
      // 종류 색은 이제 **배지의 점**에 있다(홈 리디자인) — 카드 테두리는 셋 다 같은
      // 옅은 경계선이다(디자인 원본). 종류 신호는 배지 이름·점 색·흰 종이 바탕 세 겹.
      const kindDot = (el: HTMLElement) => (el.querySelector('[data-board-badge] span') as HTMLElement).style.background;
      expect(kindDot(await card('맵 카드'))).toContain('--mf-doc-map');
      expect(kindDot(await card('보드 카드'))).toContain('--mf-doc-board');
      expect(kindDot(kanban)).toContain('--mf-doc-kanban');
      expect((await card('맵 카드')).style.border).toContain('--mf-border');
      // 값도 실제로 다르다 — 변수 이름만 갈라 두고 같은 색을 넣는 실수를 막는다.
      // 종류 색은 **테마를 따르지 않으므로**(무엇인가를 말하는 표식) 밝은 다섯 벌이
      // 같은 값을 쓰고 다크만 한 단계 밝다 — 그 계약도 함께 고정한다.
      for (const key of ['coral', 'ocean', 'forest', 'grape', 'mono', 'dark'] as const) {
        const t = HOME_THEMES[key];
        expect(new Set([t.docMap, t.docBoard, t.docKanban]).size).toBe(3);
      }
      expect(HOME_THEMES.ocean.docMap).toBe(HOME_THEMES.coral.docMap);
      expect(HOME_THEMES.dark.docKanban).not.toBe(HOME_THEMES.coral.docKanban);
    });

    it('내용 없는 화이트보드 카드의 폴백 삽화는 마인드맵이 아니다(제보)', async () => {
      // 그릴 내용이 없는 보드(막 만든 빈 보드, 또는 본문을 못 받은 카드)는
      // 폴백 삽화로 떨어진다 — 예전에는 종류와 무관하게 가지 뻗은 마인드맵
      // 그림이라 "화이트보드" 배지가 붙은 카드에 마인드맵이 그려졌다.
      const emptyBoard = { v: 1, kind: 'board', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' };
      const emptyMap = { v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' };
      const { container } = renderHomeWithDocStore(
        [
          { id: 'doc-eb', title: '빈 보드', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
          { id: 'doc-em', title: '빈 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ],
        {
          'doc-eb': { doc: emptyBoard as never, version: 1, title: '빈 보드' },
          'doc-em': { doc: emptyMap as never, version: 1, title: '빈 맵' },
        },
      );

      const boardCard = await waitFor(() => {
        const el = container.querySelector('a[data-title="빈 보드"]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      await waitFor(() => expect(boardCard.querySelector('[data-board-sketch]')).toBeTruthy());
      // 맵 카드는 예전 그대로(마인드맵 삽화).
      const mapCard = container.querySelector('a[data-title="빈 맵"]') as HTMLElement;
      await waitFor(() => expect(mapCard.querySelector('.map-thumb svg')).toBeTruthy());
      expect(mapCard.querySelector('[data-board-sketch]')).toBeNull();
    });

    it('화이트보드 칸 — 빈 맵 다음 자리, 고르면 "새 화이트보드"로 에디터에 넘어간다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const cards = within(dialog).getAllByRole('button').filter((b) => b.hasAttribute('data-template'));
      // 두 문서 종류를 구획으로 나눴다(제보: 섞여 있어 구별이 어렵다) — 마인드맵
      // 구획(빈 맵 + 템플릿들) 뒤에 화이트보드 구획(빈 보드 + 보드 템플릿들)이 온다.
      expect(cards[0]?.getAttribute('data-template')).toBe('blank');
      const ids = cards.map((c) => c.getAttribute('data-template'));
      // 마인드맵 → 화이트보드 → 칸반 보드 순서의 구획들.
      expect(ids.slice(-2 - BOARD_TEMPLATES.length - KANBAN_TEMPLATES.length)).toEqual(['board', ...BOARD_TEMPLATES.map((t) => t.id), 'kanban', ...KANBAN_TEMPLATES.map((t) => t.id)]);
      // 구획 이름은 탭에도 있다(디자인 개정판) — 하나 이상이면 된다.
      expect(within(dialog).getAllByText('마인드맵').length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText('화이트보드').length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText('칸반 보드').length).toBeGreaterThan(0);

      await user.click(within(dialog).getByRole('button', { name: /빈 화이트보드/ }));
      await waitFor(() => expect(newMapTitles()).toContain('새 화이트보드'));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('칸반 칸 — 고르면 "새 칸반 보드"로 에디터에 넘어간다(세 번째 문서 종류)', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      await user.click(within(dialog).getByRole('button', { name: /새 칸반 보드/ }));
      await waitFor(() => expect(newMapTitles()).toContain('새 칸반 보드'));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('칸반 템플릿 — 칸반 구획에 나란히, 고르면 그 이름의 보드가 열린다', async () => {
      // 갤러리 → 생성 경로를 통째로 지킨다. 데이터·빌더만 만들고 `createFromTemplate`에
      // 분기를 빠뜨리면 카드는 보이는데 눌러도 아무 일이 없다(실브라우저가 잡았던 구멍).
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const first = KANBAN_TEMPLATES[0]!;
      await user.click(within(dialog).getByRole('button', { name: new RegExp(first.name) }));
      await waitFor(() => expect(newMapTitles()).toContain(first.name));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('보드 템플릿 — 화이트보드 구획에 나란히, 고르면 그 이름의 보드가 열린다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });

      const retro = BOARD_TEMPLATES[0]!;
      const card = within(dialog).getByRole('button', { name: new RegExp(retro.name.replace(/[()]/g, '\\$&')) });
      // 썸네일은 홈 카드와 같은 렌더러 — 보드 템플릿도 완성된 Doc이라 메모 배치가 그대로 보인다.
      expect(card.querySelector('svg[viewBox]')).toBeTruthy();
      // 제목 앞은 종류 색 점(홈 카드 배지와 같은 --mf-doc-* 토큰)
      const dot = card.querySelector('[data-template-dot]') as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.style.background).toContain('--mf-doc-board');

      await user.click(card);
      await waitFor(() => expect(newMapTitles()).toContain(retro.name));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('화이트보드 JSON(루트 없는 문서)도 가져올 수 있다 — 제목은 파일명', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

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
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      await user.click(await screen.findByRole('button', { name: /브레인스토밍/ }));

      expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
      await waitFor(() => expect(newMapTitles()).toContain('브레인스토밍'));
      await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
    });

    it('Escape로 닫으면 아무 맵도 만들어지지 않는다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      await screen.findByRole('dialog', { name: '새로 만들기' });
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog', { name: '새로 만들기' })).toBeNull());
      expect(newMapTitles()).toEqual([]);
      expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();
    });

    it('카드 제목 줄은 색 점 + 이름뿐이다 (이모지 글자가 기기마다 다르게 그려지지 않게)', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });

      // 갤러리에 보이는 마인드맵 템플릿은 셋(빈 맵 포함 4칸 — 사용자 선정).
      const galleryIds = ['brainstorm', 'weekly', 'study'];
      for (const tpl of MAP_TEMPLATES.filter((t) => galleryIds.includes(t.id))) {
        const card = within(dialog).getByRole('button', { name: new RegExp(tpl.name) });
        const dot = card.querySelector('[data-template-dot]') as HTMLElement;
        expect(dot).toBeTruthy();
        // 제목 줄(점의 부모)에 이모지 글자가 남아 있으면 안 된다 (그림이 기기마다 갈린다)
        expect(dot.parentElement?.textContent).toBe(tpl.name);
      }
      // 갤러리에서 뺀 템플릿(회의록 등)은 카드가 없다 — 데이터는 남지만 훑기 화면은 넷뿐.
      expect(within(dialog).queryByRole('button', { name: /회의록/ })).toBeNull();
    });

    it('dim 배경도 함께 페이드한다 — 막만 툭 깔리고 내용이 뒤늦게 뜨면 깜빡임으로 보인다', async () => {
      const user = userEvent.setup();
      renderHomeWithDocStore([]);
      await waitFor(() => expect(screen.getAllByRole('button', { name: '새로 만들기' })[0]).toBeTruthy());

      await user.click(screen.getAllByRole('button', { name: '새로 만들기' })[0]!);
      const dialog = await screen.findByRole('dialog', { name: '새로 만들기' });
      const backdrop = dialog.parentElement as HTMLElement;
      // 제자리 페이드(mf-dim-in)여야 한다 — mf-fade의 translateY를 fixed inset:0
      // 배경에 걸면 레이어가 통째로 슬라이드한다(#331).
      expect(backdrop.style.animation).toContain('mf-dim-in');
      // 카드의 등장 애니메이션은 home.css의 `.mf-gallery-pop`(mf-pop)이 맡는다.
      expect(dialog.className).toContain('mf-gallery-pop');
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
    // 디자인 개정판: 선택은 outline 링이라 테두리·패딩·마진이 **아무것도 안 변한다**
    // (레이아웃 밖에 그려지므로 ⋯ 버튼도 1px도 움직일 수 없다).
    expect(folderCard.style.outline).toBe('2px solid var(--mf-accent)');
    expect(folderCard.style.border).toContain('1px');
    expect(folderCard.style.padding).toBe(padBefore);
    expect(folderCard.style.margin).toBe('0px');
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
    // Radix는 Escape를 `document`에서 듣는다(window 이벤트는 document로 내려가지 않는다).
    fireEvent.keyDown(document, { key: 'Escape' });
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

/** jsdom엔 PointerEvent가 없다 — MouseEvent를 pointer 이름으로 던진다(에디터 테스트와 같은 처방). */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { clientX?: number; clientY?: number }): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  fireEvent(target as Element, ev);
}

describe('홈 카드 다중 선택', () => {
  /** 맵 셋이 있는 홈 — 카드 키(`data-card-key`) 순서가 곧 화면 순서다. */
  const seedThree = () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 's1', name: '일반 스페이스', color: '#f0663f', maps: [{ title: 'A맵', docId: 'da' }, { title: 'B맵', docId: 'db' }, { title: 'C맵', docId: 'dc' }], folders: [{ id: 'fx', name: '보관함' }] },
          { id: 's2', name: '다른 스페이스', color: '#3f8fd0', maps: [], folders: [] },
        ],
        activeSpace: 's1',
        mapFolders: {},
        recent: [],
      }),
    );
  };
  const keys = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-card-key]')).map((e) => e.getAttribute('data-card-key')!);
  const selectedKeys = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-card-key]'))
      // 선택 표시는 outline 링(디자인 개정판) — 테두리는 늘 1px 그대로다.
      .filter((e) => (e as HTMLElement).style.outline.includes('var(--mf-accent)'))
      .map((e) => e.getAttribute('data-card-key')!);

  it('Ctrl+클릭으로 더하고 빼며, Shift+클릭은 앵커부터 범위로 고른다', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2, k3] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    expect(selectedKeys(container)).toEqual([k1]);

    // Ctrl+클릭 = 더하기
    fireEvent.click(card(k3!), { ctrlKey: true });
    expect(selectedKeys(container).sort()).toEqual([k1, k3].sort());
    // 한 번 더 = 빼기
    fireEvent.click(card(k3!), { ctrlKey: true });
    expect(selectedKeys(container)).toEqual([k1]);

    // Shift+클릭 = 앵커(k1)부터 범위
    fireEvent.click(card(k3!), { shiftKey: true });
    expect(selectedKeys(container)).toEqual([k1, k2, k3]);

    // 수정 키 클릭은 **여는 동작이 아니다** — 에디터로 넘어가지 않았다.
    expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();
  });

  it('Shift+클릭을 이어서 해도 앵커가 움직이지 않는다 — C → B → A에서 C가 빠지지 않는다(제보)', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [kA, kB, kC] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    // C를 고르고(앵커=C) B → A로 이어서 Shift+클릭.
    fireEvent.click(card(kC!));
    fireEvent.click(card(kB!), { shiftKey: true });
    expect(selectedKeys(container).sort()).toEqual([kB, kC].sort());

    // 수리 전: 앵커가 B로 옮겨 가 범위가 B..A가 되고 **C가 빠졌다**.
    fireEvent.click(card(kA!), { shiftKey: true });
    expect(selectedKeys(container).sort()).toEqual([kA, kB, kC].sort());

    // 평범한 클릭은 앵커를 다시 세운다 — 그다음 Shift는 거기서부터.
    fireEvent.click(card(kB!));
    fireEvent.click(card(kC!), { shiftKey: true });
    expect(selectedKeys(container).sort()).toEqual([kB, kC].sort());
  });

  it('빈 자리에서 끌면 사각형으로 여러 장을 고른다(요청)', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [kA, kB] = keys(container);

    // jsdom은 레이아웃을 재지 않는다 — 카드 사각형을 심어 준다(에디터 드래그 테스트와 같은 처방).
    const put = (k: string, left: number, top: number) => {
      const el = container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ left, top, right: left + 100, bottom: top + 60, width: 100, height: 60, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    };
    put(kA!, 0, 0);
    put(kB!, 120, 0);
    put(keys(container)[2]!, 400, 400);

    const main = container.querySelector('main') as HTMLElement;
    firePointer(main, 'pointerdown', { clientX: 5, clientY: 200 });
    // 끄는 동안 브라우저의 글자 선택을 끈다 — 그러지 않으면 카드 글자가 통째로
    // 선택되고, 폴더로 옮긴 뒤에도 파랗게 남는다(제보).
    expect(document.body.classList.contains('mf-noselect')).toBe(true);
    firePointer(window, 'pointermove', { clientX: 200, clientY: 210 });
    // 문턱(5px)을 넘긴 뒤라야 사각형이 뜬다.
    await waitFor(() => expect(container.querySelector('[data-marquee]')).toBeTruthy());
    firePointer(window, 'pointermove', { clientX: 230, clientY: 10 });
    await waitFor(() => expect(selectedKeys(container).sort()).toEqual([kA, kB].sort()));

    firePointer(window, 'pointerup', {});
    // 사각형은 사라지고 선택은 남는다.
    await waitFor(() => expect(container.querySelector('[data-marquee]')).toBeNull());
    expect(selectedKeys(container).sort()).toEqual([kA, kB].sort());
    // 놓으면 글자 선택 잠금도 풀린다(다른 화면에서 글자를 못 고르면 안 된다).
    expect(document.body.classList.contains('mf-noselect')).toBe(false);
  });

  it('카드 위에서 시작한 드래그는 마퀴가 아니다 — 카드 드래그(폴더로 옮기기)를 지킨다', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [kA] = keys(container);
    const card = container.querySelector(`[data-card-key="${kA}"]`) as HTMLElement;

    firePointer(card, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(window, 'pointermove', { clientX: 200, clientY: 200 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
    firePointer(window, 'pointerup', {});
  });

  it('여러 장을 고르고 우클릭하면 일괄 메뉴가 뜬다 — 즐겨찾기·이름 변경은 없다', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });
    fireEvent.contextMenu(card(k2!), { clientX: 200, clientY: 200 });

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('삭제하기 (2개)')).toBeTruthy();
    expect(within(menu).getByText('폴더로 이동')).toBeTruthy();
    expect(within(menu).getByText('스페이스로 이동')).toBeTruthy();
    // 한 장에만 뜻이 있는 항목·즐겨찾기(사용자 결정)는 없다.
    expect(within(menu).queryByText('즐겨찾기')).toBeNull();
    expect(within(menu).queryByText('이름 변경')).toBeNull();
    expect(within(menu).queryByText('공유')).toBeNull();
    expect(within(menu).queryByText('내보내기')).toBeNull();
  });

  it('일괄 폴더 이동 — 고른 것만 그 폴더로 들어간다', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });
    fireEvent.contextMenu(card(k2!), { clientX: 200, clientY: 200 });
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('폴더로 이동'));
    const sub = await waitFor(() => menu.querySelector('[data-home-ctx-sub]') as HTMLElement);
    fireEvent.click(within(sub).getByText('보관함'));

    await waitFor(() => {
      const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { mapFolders?: Record<string, string> };
      expect(ws.mapFolders?.[k1!]).toBe('fx');
      expect(ws.mapFolders?.[k2!]).toBe('fx');
      expect(ws.mapFolders?.[keys(container)[2] ?? 'x']).toBeUndefined();
    });
  });

  it('일괄 삭제 — 확인창이 개수를 말하고, 고른 것만 휴지통으로', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });
    fireEvent.contextMenu(card(k2!), { clientX: 200, clientY: 200 });
    fireEvent.click(within(await screen.findByRole('menu')).getByText('삭제하기 (2개)'));

    const body = await screen.findByText(/맵 2개를 휴지통으로 이동합니다/);
    const dialog = body.closest('div[style]')!.parentElement as HTMLElement;
    fireEvent.click(within(dialog).getByText('삭제'));

    await waitFor(() => expect(keys(container)).toHaveLength(1));
    // 휴지통 행(복원 링크가 달린 LNB 행)에 둘 다 들어갔다.
    await waitFor(() => {
      const trash = Array.from(container.querySelectorAll('aside .drive-file'))
        .filter((r) => r.querySelector('.restore-link'))
        .map((r) => (r.textContent || '').trim());
      expect(trash.some((t) => t.includes('A맵'))).toBe(true);
      expect(trash.some((t) => t.includes('B맵'))).toBe(true);
      expect(trash.some((t) => t.includes('C맵'))).toBe(false);
    });
  });

  it('선택 전체를 끌어 폴더에 놓으면 함께 들어간다 — 잡은 카드에 개수 배지', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });

    // jsdom의 fireEvent에는 dataTransfer가 없다 — 최소 스텁(기존 드래그 테스트와 동일).
    const store: Record<string, string> = {};
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '' };
    fireEvent.dragStart(card(k2!), { dataTransfer });
    // 잡은 카드에 "2"가 뜬다 — 선택 전체를 끌고 있다는 표시.
    await waitFor(() => expect(card(k2!).querySelector('[data-drag-count]')?.textContent).toBe('2'));

    const folder = container.querySelector('[data-folder-card]') ?? screen.getByText('보관함').closest('div')!;
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });

    // 둘 다 폴더로 들어가 그리드에서 사라지고, 고르지 않은 한 장만 남는다.
    await waitFor(() => expect(keys(container)).toHaveLength(1));
  });

  it('메뉴를 누르는 동안 선택이 풀리지 않는다 — 일괄 메뉴가 단일로 갈아 끼워지지 않게', async () => {
    // 실브라우저가 잡은 결함: 메뉴 행의 mousedown이 "카드 밖 클릭"으로 읽혀 선택을
    // 비웠고, 클릭이 도착하기 전에 메뉴가 일괄 → 단일로 바뀌어 엉뚱한 항목이 실행됐다.
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });
    fireEvent.contextMenu(card(k2!), { clientX: 200, clientY: 200 });
    const menu = await screen.findByRole('menu');

    // 메뉴 안에서 눌러도 선택은 그대로 — 항목이 여전히 일괄이다.
    fireEvent.mouseDown(within(menu).getByText('삭제하기 (2개)'));
    expect(selectedKeys(container)).toHaveLength(2);
    expect(within(menu).getByText('삭제하기 (2개)')).toBeTruthy();
  });

  it('빈 배경을 누르면 선택이 풀린다', async () => {
    seedThree();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(keys(container)).toHaveLength(3));
    const [k1, k2] = keys(container);
    const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;
    fireEvent.click(card(k1!));
    fireEvent.click(card(k2!), { ctrlKey: true });
    expect(selectedKeys(container)).toHaveLength(2);

    fireEvent.mouseDown(container.querySelector('main') as HTMLElement);
    await waitFor(() => expect(selectedKeys(container)).toHaveLength(0));
  });
});

/**
 * 모바일 다중 선택 — 진입은 **길게 누르기**(요청). 터치에는 수정 키가 없어
 * Ctrl/Shift 관례를 쓸 수 없고, 폰에서는 카드 드래그도 발화하지 않으므로
 * 이동·삭제는 선택 바의 ⋯ 메뉴가 맡는다.
 */
describe('모바일 홈 다중 선택', () => {
  /** 길게 누르기의 두 경로가 모두 이 pointerdown으로 시작한다(터치였음을 기록). */
  const touchDown = (el: Element, x = 40, y = 40) => {
    const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerType', { value: 'touch', configurable: true });
    Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
    fireEvent(el, ev);
  };
  const touchMove = (el: Element, x: number, y: number) => {
    const ev = new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerType', { value: 'touch', configurable: true });
    fireEvent(el, ev);
  };
  const seedTwo = () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 's1', name: '일반 스페이스', color: '#f0663f', maps: [{ title: 'A맵', docId: 'da' }, { title: 'B맵', docId: 'db' }], folders: [{ id: 'fx', name: '보관함' }] },
        ],
        activeSpace: 's1',
        mapFolders: {},
        recent: [],
      }),
    );
  };
  const keys = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-card-key]')).map((e) => e.getAttribute('data-card-key')!);
  const checked = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-select-check] svg')).length;

  it('길게 누르면(타이머) 선택 모드 — 툴바가 선택 바로 바뀌고 탭이 토글이 된다', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const [k1, k2] = keys(container);
      const card = (k: string) => container.querySelector(`[data-card-key="${k}"]`) as HTMLElement;

      touchDown(card(k1!));
      await new Promise((r) => setTimeout(r, 560)); // 길게 누르기(500ms)

      // 툴바 자리를 선택 바가 쓴다 — 검색·만들기는 그 시간대의 일이 아니다.
      await waitFor(() => expect(screen.getByText('1개 선택')).toBeTruthy());
      expect(screen.queryByPlaceholderText('모든 스페이스에서 검색')).toBeNull();
      expect(checked(container)).toBe(1);

      // 모드 안의 탭 = 토글. 더블탭 열기는 꺼져 있다.
      fireEvent.click(card(k2!));
      await waitFor(() => expect(screen.getByText('2개 선택')).toBeTruthy());
      fireEvent.click(card(k2!));
      fireEvent.click(card(k2!)); // 두 번 연속 탭해도 에디터로 넘어가지 않는다
      await waitFor(() => expect(screen.getByText('2개 선택')).toBeTruthy());
      expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();

      // ✕ = 모드 종료 + 선택 비움 → 평소 툴바 복귀
      fireEvent.click(screen.getByRole('button', { name: '선택 종료' }));
      await waitFor(() => expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy());
      expect(checked(container)).toBe(0);
    } finally {
      restore();
    }
  });

  it('기기의 길게 누르기(contextmenu)도 같은 모드로 — 카드 메뉴는 뜨지 않는다', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const card = container.querySelector(`[data-card-key="${keys(container)[0]}"]`) as HTMLElement;

      touchDown(card);
      fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });

      await waitFor(() => expect(screen.getByText('1개 선택')).toBeTruthy());
      // 길게 누르기의 옛 뜻(카드 메뉴)은 ☰이 맡는다 — 여기서 메뉴가 뜨면 둘이 겹친다.
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      restore();
    }
  });

  it('누르는 동안 손가락이 밀리면(스크롤) 모드에 들어가지 않는다', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const card = container.querySelector(`[data-card-key="${keys(container)[0]}"]`) as HTMLElement;

      touchDown(card, 40, 40);
      touchMove(card, 44, 90); // 세로로 밀었다 = 스크롤 의도
      await new Promise((r) => setTimeout(r, 560));

      expect(screen.queryByText('1개 선택')).toBeNull();
      expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('선택 모드에서는 폴더 카드가 반응하지 않는다 — 선택이 비워진 채 모드만 남지 않게', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const card = container.querySelector(`[data-card-key="${keys(container)[0]}"]`) as HTMLElement;

      touchDown(card);
      fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
      await waitFor(() => expect(screen.getByText('1개 선택')).toBeTruthy());

      // 폴더는 다중 선택 대상이 아니다 — 여기서 선택이 바뀌면 "0개 선택" 바가 뜬다.
      const folder = screen.getByText('보관함').closest('.map-card') as HTMLElement;
      fireEvent.click(folder);
      fireEvent.doubleClick(folder);
      await new Promise((r) => setTimeout(r, 60));
      expect(screen.getByText('1개 선택')).toBeTruthy();
      expect(keys(container)).toHaveLength(2); // 폴더 안으로 들어가지도 않았다
    } finally {
      restore();
    }
  });

  it('선택 바의 전체 선택 · ⋯ — 데스크톱과 같은 일괄 메뉴가 뜨고 폴더로 옮긴다', async () => {
    const restore = mockMatchMedia(true);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const [k1, k2] = keys(container);
      const card = container.querySelector(`[data-card-key="${k1}"]`) as HTMLElement;

      touchDown(card);
      fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
      await waitFor(() => expect(screen.getByText('1개 선택')).toBeTruthy());

      fireEvent.click(screen.getByText('전체 선택'));
      await waitFor(() => expect(screen.getByText('2개 선택')).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: '선택한 맵 메뉴' }));
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByText('삭제하기 (2개)')).toBeTruthy();
      fireEvent.click(within(menu).getByText('폴더로 이동'));
      const sub = await waitFor(() => menu.querySelector('[data-home-ctx-sub]') as HTMLElement);
      fireEvent.click(within(sub).getByText('보관함'));

      await waitFor(() => {
        const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { mapFolders?: Record<string, string> };
        expect(ws.mapFolders?.[k1!]).toBe('fx');
        expect(ws.mapFolders?.[k2!]).toBe('fx');
      });
      // 일괄 동작이 끝나면 모드도 나간다 — 옮긴 카드는 이 목록에서 사라진다.
      await waitFor(() => expect(screen.getByPlaceholderText('모든 스페이스에서 검색')).toBeTruthy());
    } finally {
      restore();
    }
  });

  it('데스크톱에서는 길게 눌러도 모드에 들어가지 않는다 — 그 자리는 카드 메뉴 그대로', async () => {
    const restore = mockMatchMedia(false);
    try {
      seedTwo();
      const { container } = renderHomeWithDocStore([]);
      await waitFor(() => expect(keys(container)).toHaveLength(2));
      const card = container.querySelector(`[data-card-key="${keys(container)[0]}"]`) as HTMLElement;

      touchDown(card);
      fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });

      expect(await screen.findByRole('menu')).toBeTruthy();
      expect(screen.queryByText('1개 선택')).toBeNull();
    } finally {
      restore();
    }
  });
});

// 홈 리디자인(디자인 원본 `Geurio 홈 리디자인.dc.html` 이식) — 사용자가 콕 집어
// 요청한 세 가지를 계약으로 고정한다: 툴바 버튼의 **순서**, 마우스 오버 **애니메이션**,
// 카드 미리보기의 **틀**(옅은 wash + 도트 격자 + 종류 배지).
describe('홈 리디자인 계약', () => {
  it('툴바 순서 — 알림 · 검색 · 구분선 · 가져오기 · 새 폴더 · 새로 만들기', async () => {
    renderHome();
    const search = await screen.findByPlaceholderText('모든 스페이스에서 검색');
    const bell = screen.getByRole('button', { name: '알림' });
    const divider = document.querySelector('[data-toolbar-divider]') as HTMLElement;
    const importBtn = screen.getByRole('button', { name: '가져오기' });
    const folderBtn = screen.getByRole('button', { name: '새 폴더' });
    const createBtn = screen.getAllByRole('button', { name: '새로 만들기' })[0]!;
    expect(divider).toBeTruthy();
    // DOM 순서가 곧 화면 순서다(모두 같은 행의 flex 항목).
    const order = [bell, search, divider, importBtn, folderBtn, createBtn];
    for (let i = 0; i < order.length - 1; i += 1) {
      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      expect(order[i]!.compareDocumentPosition(order[i + 1]!) & 4).toBe(4);
    }
    // 컨트롤은 모두 알약(원형 반지름) — 디자인 원본의 32px 한 줄.
    expect(getComputedStyle(bell).borderRadius).toBe('999px');
    expect((importBtn as HTMLElement).style.borderRadius).toBe('999px');
    expect((folderBtn as HTMLElement).style.borderRadius).toBe('999px');
    expect((createBtn as HTMLElement).style.background).toContain('linear-gradient');
  });

  // 제보: 프리뷰의 홈 검색창 안쪽이 파랗게 칠해졌다 — 크롬이 이 칸을 계속
  // 자동완성 대상으로 표시해 `#e8f0fe` 배경을 칠한 것이다(값은 포커스 게이트가
  // 되돌리므로 실제로 채워지지 않는다). jsdom은 `:-webkit-autofill`을 만들 수 없어
  // 규칙 자체를 고정한다(#391과 같은 처방).
  it('검색창은 자동완성 배경을 지운다 (홈·에디터 같은 규칙)', () => {
    for (const path of ['src/features/home/home.css', 'src/features/editor/editor.css']) {
      const css = readFileSync(resolve(path), 'utf8');
      const i = css.indexOf('.mf-search-input:-webkit-autofill');
      expect(i).toBeGreaterThan(-1);
      const rule = css.slice(i, css.indexOf('}', i));
      // 배경을 글자 모양으로 잘라 사실상 보이지 않게 한다(주변 색을 몰라도 성립).
      expect(rule).toContain('background-clip: text');
      expect(rule).toContain('-webkit-text-fill-color');
      // 크롬이 배경을 애니메이션으로 되돌리는 것도 막는다.
      expect(rule).toMatch(/transition: background-color \d{3,}s/);
    }
  });

  // 요청: '공유받음'을 즐겨찾기 **아래**로 옮기고, 펼친 목록도 즐겨찾기·휴지통과
  // 같은 가라앉은 판으로. 셋이 같은 종류의 접이식 목록이므로 자리와 옷을 맞춘다.
  it("LNB '공유받음'은 즐겨찾기 아래에 있고 펼친 목록이 같은 판을 쓴다", async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@gmail.com' } }));
    const { container } = renderHomeWithDocStore([]);
    const aside = await waitFor(() => container.querySelector('aside') as HTMLElement);
    const fav = within(aside).getByText('즐겨찾기');
    const shared = within(aside).getByText('공유받음');
    const trash = within(aside).getByText('휴지통');
    // 순서: 즐겨찾기 → 공유받음 → 휴지통
    expect(fav.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shared.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 공유받음도 즐겨찾기·휴지통처럼 **접힌 채** 시작한다(요청)
    expect(shared.closest('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    // 공유받음과 휴지통 사이에는 구분선이 있다(요청) — 성격이 다른 묶음이다
    const sharedRow = shared.closest('.nav-item') as HTMLElement;
    const trashRow = trash.closest('.nav-item') as HTMLElement;
    const between = [...aside.children].filter((el) => {
      const after = sharedRow.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const before = trashRow.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      return after && before;
    });
    expect(between.some((el) => (el as HTMLElement).style.height === '1px')).toBe(true);
    // 세 구분선(스페이스↔즐겨찾기 / 공유받음↔휴지통 / 피드백 위)은 **같은 값**이다
    // (제보: 굵기가 달라 보였다 — 원인은 flexShrink였다. 선은 눌리는 여백이 아니다).
    const lines = [...aside.querySelectorAll('[data-lnb-divider]')] as HTMLElement[];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const el of lines) {
      const st = el.style;
      expect(st.height).toBe('1px');
      expect(st.background).toContain('--mf-border-soft');
      expect(st.flexShrink).toBe('0');
    }
    // 스페이스 목록은 내용 높이만 쓴다 — 하나일 때 '새 스페이스'와의 빈칸이 벌어지던 원인
    expect(parseFloat((aside.querySelector('.lnb-scroll') as HTMLElement).style.minHeight)).toBe(0);

    await user.click(shared);
    const panel = await waitFor(() => {
      const el = within(aside).getByText('공유받은 항목이 없습니다').parentElement as HTMLElement;
      expect(el.style.background).toContain('--mf-bg');
      return el;
    });
    // 즐겨찾기 판과 같은 값(가라앉은 면 + hairline + r12)
    expect(panel.style.borderRadius).toBe('12px');
    expect(panel.style.border).toContain('--mf-hairline');
  });

  it('마우스 오버 애니메이션 — 카드가 3px 떠오르고 그늘·경계가 바뀐다(CSS 계약)', () => {
    // jsdom은 :hover를 렌더하지 않으므로 규칙 자체를 읽어 고정한다(#391과 같은 처방).
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const hover = css.slice(css.indexOf('.mf-home .map-card:hover {'));
    expect(hover).toContain('transform: translateY(-3px)');
    expect(hover).toContain('var(--mf-border-hover)');
    expect(hover).toContain('var(--mf-card-shadow-hover)');
    // 카드 위에 얹힌 것들(★ · ⋯ · 진입 셰브론)은 hover에서 드러난다.
    expect(css).toContain('.mf-home .map-card:hover .fav-btn');
    expect(css).toContain('.mf-home .map-card:hover .card-open');
    // 움직임을 줄이라고 한 사용자에게는 떠오르지 않는다.
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('transform: none');
  });

  it('본문 면은 **흰 면**이고 최근 항목 띠만 따뜻한 면으로 남는다(요청 ①)', async () => {
    localStorage.setItem('mf_recent', JSON.stringify(['맵 하나']));
    const { container } = renderHomeWithDocStore([
      { id: 'd1', title: '맵 하나', version: 1, updatedAt: '2026-08-16T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('.mf-recent-tray')).toBeTruthy());
    const main = container.querySelector('main') as HTMLElement;
    expect(main.style.backgroundColor).toContain('--mf-card');
    // 스페이스 화면에도 점 격자를 얹는다(요청 ①) — 대시보드·일정과 같은 값이다.
    expect(main.style.backgroundImage).toContain('--mf-dot-grid');
    expect(main.style.backgroundSize).toBe('17px 17px');
    // 예외는 최근 항목 띠 하나 — 흰 카드가 흰 배경에 묻히지 않게 그 자리만 지킨다.
    // 본문 패딩만큼 음수 마진으로 빼고 같은 값을 패딩으로 되돌려 카드 자리는 불변이다.
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const tray = css.slice(css.indexOf('.mf-recent-tray {'), css.indexOf('}', css.indexOf('.mf-recent-tray {')));
    expect(tray).toContain('background: var(--mf-bg)');
    expect(tray).toContain('margin: -24px -32px 26px');
    expect(tray).toContain('padding: 24px 32px 26px');
  });

  it('카드 미리보기 틀 — 옅은 wash + 도트 격자 + 종류 배지(최근 항목도 같은 틀)', async () => {
    localStorage.setItem('mf_recent', JSON.stringify(['맵 하나']));
    const { container } = renderHomeWithDocStore([
      { id: 'd1', title: '맵 하나', version: 1, updatedAt: '2026-08-16T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    const cards = await waitFor(() => {
      const list = [...container.querySelectorAll('a[data-title="맵 하나"]')] as HTMLElement[];
      expect(list.length).toBeGreaterThanOrEqual(1);
      return list;
    });
    for (const card of cards) {
      const thumb = card.querySelector('.map-thumb') as HTMLElement;
      expect(thumb.style.background).toContain('--mf-wash');
      const dots = card.querySelector('[data-dot-grid]') as HTMLElement;
      expect(dots.style.backgroundImage).toContain('--mf-dot-grid');
      expect(card.querySelector('[data-board-badge]')?.textContent).toContain('마인드맵');
    }
  });
});

describe('홈 디자인 후속 6건', () => {
  it('프로필 팝업·설정 모달 디자인(첨부 이미지): 잉크 아바타(호율)·인셋 머리·로그아웃 구분선·모달 560', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    localStorage.setItem('mf_profile_names', JSON.stringify({ 'hoyul.lee@wantedlab.com': '이호율' }));
    const user = userEvent.setup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: '계정 메뉴' })).toBeTruthy());

    // 아바타 글자 — 한글 이름은 성을 뗀 뒤 두 글자("이호율" → "호율").
    const trigger = screen.getByRole('button', { name: '계정 메뉴' });
    expect(trigger.textContent).toContain('호율');
    expect(trigger.textContent).not.toContain('이호율호율'); // 아바타가 이름 앞에 선다

    await user.click(trigger);
    // 팝오버는 포털로 body 밑에 그려진다(Radix) — 컨테이너 안이 아니다.
    const pop = (await waitFor(() => {
      const el = document.querySelector('.settings-pop');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLElement;
    // 머리는 accent-soft 인셋 블록, 로그아웃 앞에는 구분선.
    const head = pop.firstElementChild as HTMLElement;
    expect(head.style.background).toContain('--mf-accent-soft');
    expect(head.style.margin).toBeTruthy();
    // 프로필명 변경이 설정 모달로 옮겨져(요청) 팝오버는 [설정][로그아웃] 두 행이다.
    const rows = pop.querySelectorAll('.menu-row');
    expect(rows).toHaveLength(2);
    const dividerBeforeLogout = rows[0]!.nextElementSibling as HTMLElement;
    expect(dividerBeforeLogout.getAttribute('aria-hidden')).toBe('true');

    // 설정 모달 — 560 폭, 계정 행 accent-soft, 테마 스와치는 원, 탈퇴 행 문구.
    await user.click(screen.getByRole('button', { name: '설정' }));
    const dialog = await screen.findByRole('dialog', { name: '설정' });
    expect(dialog.style.width).toBe('560px');
    const accountRow = [...dialog.querySelectorAll('div')].find((d) => (d as HTMLElement).style.background.includes('--mf-accent-soft') && d.textContent?.includes('이호율')) as HTMLElement;
    expect(accountRow).toBeTruthy();
    const chip = within(dialog).getByRole('radio', { name: '코랄 테마' });
    expect((chip.querySelector('span') as HTMLElement).style.borderRadius).toBe('50%');
    expect(within(dialog).getByText('개인정보처리방침').getAttribute('href')).toBe('/privacy');
    // 탈퇴 행은 '계정 설정' 안(두 번째 화면)에 있다
    await user.click(dialog.querySelector('[data-account-detail-row]') as HTMLElement);
    expect(within(dialog).getByText('계정과 모든 보드·스페이스가 영구 삭제돼요')).toBeTruthy();
  });

  it('그리드 카드 hover 그림자도 같은 기하로 진해지기만 한다 + ⋯ 버튼에 클릭 효과가 있다(요청)', () => {
    // hover 토큰의 기하 = 기본 그늘의 기하(알파만 다르다)는 theme.test.ts 스냅샷이
    // 고정한다. 여기서는 CSS 쪽 계약: 갤러리 카드도 같은 토큰을 쓰고, ⋯ 버튼은
    // hover 원판 + :active 눌림을 가진다(예전엔 글자색만 바뀌어 클릭 반응이 없었다).
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const tpl = css.slice(css.indexOf('.mf-home .tpl-card:hover'));
    expect(tpl).toContain('var(--mf-card-shadow-hover)');
    const menuHover = css.slice(css.indexOf('.mf-home .menu-btn:hover'));
    expect(menuHover).toContain('background: var(--mf-panel2) !important');
    const menuActive = css.slice(css.indexOf('.mf-home .map-card .menu-btn:active'));
    expect(menuActive).toContain('scale(0.86)');
    // :active 규칙은 reveal 규칙(.map-card:hover .menu-btn)보다 **뒤에** 있어야
    // 같은 특이도에서 이긴다 — 앞에 두면 눌림 transform이 reveal에 덮인다.
    expect(css.indexOf('.mf-home .map-card .menu-btn:active')).toBeGreaterThan(css.indexOf('.mf-home .map-card:hover .menu-btn'));
  });

  it('칸반 종류 아이콘은 채운 세로 막대 둘이다 (가는 선 틀은 13px에서 구별이 흐렸다 — 제보)', async () => {
    localStorage.setItem('mindflow_doc_kb1', JSON.stringify({ v: 1, kind: 'kanban', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', columns: [{ id: 'c1', title: '할 일' }], cards: [] }));
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([
      { id: 'kb1', title: '칸반 파일', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
    ]);
    await waitFor(() => expect(screen.getAllByText('칸반 파일').length).toBeGreaterThan(0));
    const aside = container.querySelector('aside') as HTMLElement;
    await user.click([...aside.querySelectorAll('.nav-item')].find((el) => el.textContent?.includes('즐겨찾기')) as HTMLElement);
    const icon = aside.querySelector('svg[data-kind-icon="kanban"]') as SVGElement;
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('fill')).toBe('var(--mf-doc-kanban)');
    expect(icon.querySelectorAll('rect')).toHaveLength(2);
  });

  it('최근 항목 fit — 트레이 폭을 그대로 재서 마지막 칸이 들어갈 공간이 있으면 노출한다', () => {
    const STEP = RECENT_CARD_W + 10; // 카드 158 + 간격 10
    // 5칸이 딱 맞는 폭. 예전 계산은 좌우 패딩 몫(48px)을 빼서 4를 돌려줬다(제보:
    // 마지막 항목에 공간이 넓어도 최근 항목이 추가되지 않는다).
    expect(recentFit(5 * STEP - 10)).toBe(5);
    expect(recentFit(5 * STEP - 11)).toBe(4);
    expect(recentFit(0)).toBe(1); // 최소 1
  });

  it('최근 항목 hover 그림자 — 같은 기하로 진해지기만 한다(트레이 아래 여유를 넘지 않게)', () => {
    const css = readFileSync(resolve('src/features/home/home.css'), 'utf8');
    const rule = css.slice(css.indexOf('.mf-home .mf-recent-scroll .map-card:hover'));
    expect(rule).toContain('var(--mf-card-shadow-sm-hover)');
    // 토큰 자체의 기하가 기본(sm)과 같은지는 theme.test.ts의 스냅샷이 고정한다.
  });

  it('스페이스 제목 옆 파일·폴더 개수가 없다(요청 ④ — 구획 머리의 파일 N/폴더 N이 이미 말한다)', async () => {
    const { container } = renderHomeWithDocStore([
      { id: 'd-meta', title: '개수 확인', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(screen.getByText('개수 확인')).toBeTruthy());
    expect(container.querySelector('[data-space-meta]')).toBeNull();
  });

  it('LNB 배경은 카드 면(--mf-card)이고, 즐겨찾기·휴지통 행에 문서 종류 아이콘이 붙는다', async () => {
    // 종류 판별은 localStorage 본문(readDocRaw)에서 온다 — 맵/보드/칸반 셋을 심는다.
    localStorage.setItem(
      'mindflow_doc_k-map',
      JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '맵', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
    );
    localStorage.setItem('mindflow_doc_k-board', JSON.stringify({ v: 1, kind: 'board', nodes: {}, floats: [{ id: 'f1', x: 0, y: 0, w: 100, text: '메모' }], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' }));
    localStorage.setItem('mindflow_doc_k-kanban', JSON.stringify({ v: 1, kind: 'kanban', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', columns: [{ id: 'c1', title: '할 일' }], cards: [] }));
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([
      { id: 'k-map', title: '맵 파일', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
      { id: 'k-board', title: '보드 파일', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
      { id: 'k-kanban', title: '칸반 파일', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    await waitFor(() => expect(screen.getAllByText('맵 파일').length).toBeGreaterThan(0));

    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.style.background).toBe('var(--mf-card)');

    // 즐겨찾기를 펼치면 행마다 종류 아이콘 — 색은 카드 배지와 같은 --mf-doc-* 토큰.
    const favHead = [...aside.querySelectorAll('.nav-item')].find((el) => el.textContent?.includes('즐겨찾기')) as HTMLElement;
    await user.click(favHead);
    const favRows = [...container.querySelectorAll('aside [data-kind-icon]')];
    expect(favRows.some((el) => el.getAttribute('data-kind-icon') === 'map')).toBe(true);
    expect(favRows.some((el) => el.getAttribute('data-kind-icon') === 'board')).toBe(true);

    // 휴지통을 펼치면 칸반 아이콘이 붙는다.
    await user.click(aside.querySelector('.mf-trash-head') as HTMLElement);
    await waitFor(() => expect(container.querySelector('aside [data-kind-icon="kanban"]')).toBeTruthy());
  });

  it('상위 폴더 타일 — 폴더 카드와 같은 그늘, 선택 링·인라인 transition 없음(요청 ③)', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        v: 1,
        spaces: [{ id: 's1', name: '작업공간', color: '#f0663f', maps: [], folders: [{ id: 'fo1', name: '기획' }] }],
        mapFolders: {},
      }),
    );
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('기획')).toBeTruthy());
    await user.dblClick(screen.getByText('기획'));

    const tile = (await screen.findByLabelText(/상위 폴더/)).closest('[data-parent-tile]') as HTMLElement;
    expect(tile.style.boxShadow).toBe('var(--mf-card-shadow)');
    expect(tile.style.outline).toBe(''); // 선택 효과 없음
    expect(tile.style.transition).toBe(''); // transition은 home.css의 .map-card가 정한다
    void container;
  });
});

// ── 미리보기 2건(제보) ──────────────────────────────────────────────────────
//
// ① 카드·위젯의 첨부 이미지가 늘 회색 자리표시자였다.
// ② 미리보기 바탕이 에디터의 캔버스 배경을 따르지 않았다.
describe('미리보기 — 이미지와 배경', () => {
  const REF = 'mfimg:d1/pic.webp';
  const docWith = (extra: Record<string, unknown>) => ({
    v: 1,
    nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral',
    ...extra,
  });
  const meta = (id: string, title: string): DocMeta => ({ id, title, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null });

  function seedCard(docId: string, title: string) {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 's1', name: '업무', color: '#f0663f', home: true, maps: [{ title, when: '방금', hue: '#f0663f', docId }], folders: [] }],
        activeSpace: 's1',
      }),
    );
  }

  it('본문에 남은 이미지 참조를 발급받아 카드에 실제 이미지를 그린다', async () => {
    seedCard('d1', '사진 맵');
    const resolveRefs = vi.fn(async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `https://signed.example/${encodeURIComponent(r)}?token=t`])));
    const imageStore = { upload: async () => null, resolve: resolveRefs, removeForDoc: async () => undefined };
    const { container } = renderHomeWithDocStore(
      [meta('d1', '사진 맵')],
      { d1: { doc: docWith({ floats: [{ id: 'f1', x: 30, y: 30, w: 120, h: 90, img: REF, text: '' }] }) as never, version: 1, title: '사진 맵' } },
      'supabase',
      imageStore,
    );
    // 참조는 한 번에 묶어 발급받는다(왕복 1회).
    await waitFor(() => expect(resolveRefs).toHaveBeenCalledWith([REF]));
    await waitFor(() => {
      const img = container.querySelector('a[data-title="사진 맵"] image');
      expect(img?.getAttribute('href')).toContain('https://signed.example/');
    });
  });

  // 전송량: 스페이스 안의 모든 카드가 한꺼번에 사진을 받으면 안 된다. `content-visibility`
  // 가 막아 줄 거라 생각했지만 실측으로 틀렸다(화면 밖 카드의 이미지도 전부 요청됐다) —
  // 그래서 **화면에 닿은 카드**의 문서만 발급받는다.
  it('화면에 닿지 않은 카드의 이미지는 발급받지 않는다', async () => {
    seedCard('d1', '사진 맵');
    const observed: Element[] = [];
    let fire: (() => void) | null = null;
    class FakeIO {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
      observe(el: Element) {
        observed.push(el);
        fire = () => this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver);
    try {
      const resolveRefs = vi.fn(async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `https://signed.example/x?ref=${encodeURIComponent(r)}`])));
      const imageStore = { upload: async () => null, resolve: resolveRefs, removeForDoc: async () => undefined };
      const { container } = renderHomeWithDocStore(
        [meta('d1', '사진 맵')],
        { d1: { doc: docWith({ floats: [{ id: 'f1', x: 30, y: 30, w: 120, h: 90, img: REF, text: '' }] }) as never, version: 1, title: '사진 맵' } },
        'supabase',
        imageStore,
      );
      await waitFor(() => expect(container.querySelector('a[data-title="사진 맵"]')).toBeTruthy());
      await waitFor(() => expect(observed.length).toBeGreaterThan(0));
      // 아직 화면에 닿지 않았다 — 발급 요청이 나가지 않는다.
      expect(resolveRefs).not.toHaveBeenCalled();
      // 스크롤해서 카드가 보이면 그때 받는다.
      await act(async () => { fire?.(); });
      await waitFor(() => expect(resolveRefs).toHaveBeenCalledWith([REF]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('썸네일 바탕이 그 문서의 캔버스 배경을 따른다(에디터와 같은 색)', async () => {
    seedCard('d2', '다크 맵');
    const { container } = renderHomeWithDocStore([meta('d2', '다크 맵')], {
      d2: { doc: docWith({ themeKey: 'dark' }) as never, version: 1, title: '다크 맵' },
    });
    await waitFor(() => expect(container.querySelector('a[data-title="다크 맵"] .map-thumb')).toBeTruthy());
    const thumb = container.querySelector('a[data-title="다크 맵"] .map-thumb') as HTMLElement;
    // 예전엔 어느 문서든 홈 테마의 wash 한 값이었다.
    expect(thumb.style.background).toContain(themeOf('dark').canvasBg);
    expect(thumb.style.background).not.toContain('--mf-wash');
    // 도트도 캔버스와 같은 색.
    const dots = container.querySelector('a[data-title="다크 맵"] [data-dot-grid]') as HTMLElement;
    expect(dots.style.backgroundImage).toContain(themeOf('dark').dot);
  });
});
