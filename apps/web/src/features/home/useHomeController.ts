import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { ROOT_ID, collectImageRefs, parseDoc, serializeDoc, toMarkdown } from '@mindflow/mindmap-core';
import { inlineImagesForExport } from '../editor/imageExport';
import { exportDocPng } from '../editor/png';
import { exportDocSvg } from '../editor/svg';
import { exportDocPdf } from '../editor/pdf';
import { themeOf } from '../editor/theme';
import { applyHomeTheme, homeThemeKeyOf, saveHomeThemeCache, type HomeThemeKey } from './theme';
import { useBackend } from '../../adapters/BackendContext';
import { findBoardTemplate, findTemplate } from '../../templates/mapTemplates';
import {
  DRIVE_FILES,
  initialHomeState,
  type FolderModalState,
  type HomeCtxTarget,
  type HomeState,
} from './types';

/** 같은 대상인지 비교하려고 쓰는 납작한 키(☰ 토글 판정). */
export function ctxTargetKey(t: HomeCtxTarget): string {
  return t.kind === 'bg' ? 'bg' : `${t.kind}:${t.kind === 'map' ? t.key : t.id}`;
}
import {
  coerceSpaces,
  docKey,
  downloadFile,
  ensureHomeSpace,
  cardKeyOf,
  migrateMapFolderKeys,
  migrateRecentKeys,
  loadActiveView,
  loadRecent,
  saveActiveView,
  mapId,
  mapHref as buildMapHref,
  mergeDocMetasIntoSpaces,
  mergeRecent,
  newDocId,
  newMapHref as buildNewMapHref,
  parseOutline,
  planImportBinding,
  applyImportBinding,
  readDocRaw,
  RECENT_CAP,
  readSavedProfileName,
  rootTextOf,
  safeFileName,
  saveRecent,
  seedFavAndTrashFromMetas,
  sourceOf,
  writeSavedProfileName,
} from './storage';
import { recentTrayDocIds } from './viewModel';

/**
 * 썸네일 본문(`preview_doc` RPC, 0012)이 이미지 데이터를 지운 자리에 남기는 값.
 * 크기 필드는 유지되므로 박스 계산은 그대로고, 이 값이 보이면 "여기 이미지가 있었다"는
 * 뜻이다 — 썸네일에는 충분하지만 내보내기에는 실물이 필요하다.
 */
const STRIPPED_IMG = 'stripped';

function hasStrippedImage(doc: Doc): boolean {
  for (const id of Object.keys(doc.nodes)) {
    if (doc.nodes[id]?.img === STRIPPED_IMG) return true;
  }
  return doc.floats.some((f) => f.img === STRIPPED_IMG);
}

/**
 * React port of Home.dc.html's `class Component extends DCLogic`. Every exported
 * method below corresponds 1:1 to a method on the original controller; `patch()`
 * stands in for `this.setState`. `renderVals()`'s derived fields live in `viewModel.ts`.
 */
/** 입력이 멎고 이만큼 지나면 검색을 적용한다. 사람이 다음 글자를 치는 간격(~90ms)보다
 * 넉넉히 길어 타이핑 중 중간 결과를 그리지 않고, 손을 뗀 뒤엔 기다렸다는 느낌이 없다. */
const SEARCH_DEBOUNCE_MS = 180;

export function useHomeController() {
  // 최근 기록은 동기(localStorage)로 초기 상태에 바로 싣는다 — 마운트 이펙트로
  // 늦게 넣으면 첫 페인트 프레임에 최근 항목 스켈레톤조차 없어 툴바가 한 번
  // 출렁인다(새로고침 깜빡임).
  const [state, setState] = useState<HomeState>(() => ({ ...initialHomeState(), recent: loadRecent() }));
  const navigate = useNavigate();
  const { auth, docStore, spaceStore, shareStore, imageStore, mode: backendMode } = useBackend();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const loaderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 새 맵 카드 등록을 로더 페인트 뒤로 미룰 때의 폴백 타이머(rAF 없는 환경).
  const cardRegisterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 검색어 적용을 미루는 타이머 — `setSearch` 참고. */
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // docIds whose body we've already fetched (or are fetching) for card previews,
  // so the prefetch effect never re-requests the same doc.
  const previewFetchedRef = useRef<Set<string>>(new Set());
  /** docId → 마지막 list()가 준 (version, updatedAt) — 썸네일 캐시 판별 키. */
  const docMetaRef = useRef<Map<string, { version: number; updatedAt: string }>>(new Map());
  // Workspace-persistence guards. `canPersistWorkspaceRef` is true ONLY after the
  // mount `spaceStore.load()` actually FULFILLED — so a failed/absent load never
  // lets us overwrite the user's saved spaces/folders with the default seed (the
  // "재로그인하니 스페이스가 사라짐" bug). `savedWorkspaceSigRef` holds the signature of
  // the last hydrated/persisted workspace, so the hydration itself is never
  // re-saved and unchanged state is a no-op.
  const canPersistWorkspaceRef = useRef(false);
  const savedWorkspaceSigRef = useRef<string | null>(null);
  // Cross-device first-login race guards. On a fresh login (esp. the OAuth
  // redirect on a new PC) the Home mount can fire the workspace/doc reads BEFORE
  // Supabase has applied the auth session token, so the RLS-scoped queries come
  // back empty and only the default 일반 스페이스 shows (a manual refresh then works,
  // because the persisted session is applied at client init). We therefore
  // re-hydrate ONCE when auth first confirms a session — the automatic version
  // of that refresh — but only while the user hasn't touched the workspace yet
  // (`workspaceMutatedRef`) and only if the mount load didn't already succeed
  // (`workspaceLoadedRef`), so the resync can never clobber real edits.
  const mountedRef = useRef(true);
  const workspaceLoadedRef = useRef(false);
  const workspaceResyncedRef = useRef(false);
  const workspaceMutatedRef = useRef(false);

  const patch = (partial: Partial<HomeState>) => setState((prev) => ({ ...prev, ...partial }));

  // Fetch the per-user workspace (spaces + folders) and the doc list, then apply
  // both in ONE setState. Extracted so both the mount and the auth-confirmed
  // resync (see below) share identical hydration logic.
  const hydrateFromBackend = useCallback(async () => {
    // Restore the space/folder the user was last viewing in THIS tab (set before
    // they opened a map in the editor), so returning to Home lands back on that
    // space instead of the default 일반 공간.
    const restore = loadActiveView();
    const res = await Promise.allSettled([spaceStore.load(), docStore.list(), shareStore.listSharedWithMe(), shareStore.listSharedByMe()]);
    if (!mountedRef.current) return;
    // Only allow persisting the workspace once the load actually SUCCEEDED. If
    // it rejected (network/RLS/transient), we must not save — otherwise the
    // default-seed fallback below would clobber the user's stored spaces.
    canPersistWorkspaceRef.current = res[0].status === 'fulfilled';
    const ws = res[0].status === 'fulfilled' ? res[0].value : null;
    const allMetas = res[1].status === 'fulfilled' ? res[1].value : [];
    // 공유(0009) 이후 `list()`는 **남이 나에게 공유한 문서까지** 돌려준다. 워크스페이스
    // (스페이스·폴더·즐겨찾기·휴지통)는 per-user 블롭이므로 남의 문서를 여기 섞으면
    // 내 스페이스에 카드로 박히고 그대로 저장된다. 그래서 아래 모든 워크스페이스
    // 계산에는 **내 문서만** 넘긴다. 공유받은 문서는 별도 목록으로 다룬다(sharedMetas).
    const metas = allMetas.filter((m) => m.ownedByMe !== false);
    // 내 권한(편집/보기 전용)은 `document_shares`의 내 행에서 온다 — LNB의
    // "보기 전용" 배지 근거(#22). 조회 실패는 'edit' 폴백(기존 표시와 동일).
    const myShares = res[2].status === 'fulfilled' ? res[2].value : [];
    const myRoles = new Map(myShares.map((s) => [s.documentId, s.role]));
    // 아직 확인하지 않은 초대(= 배지). `seenAt`이 `undefined`인 환경(구 서버·오류)은
    // "안 봤다"로 치지 않는다 — 없는 알림을 만들어 내는 쪽이 더 나쁘다.
    const unseen = new Set(myShares.filter((s) => s.seenAt === null).map((s) => s.documentId));
    const sharedMetas = allMetas
      .filter((m) => m.ownedByMe === false && !m.deletedAt)
      .map((m) => ({ ...m, sharedRole: m.sharedRole ?? myRoles.get(m.id) }));
    // 썸네일 캐시 키(버전 판별)용 — loadPreview에 (version, updatedAt)을 넘겨
    // 같은 판이면 재다운로드를 건너뛴다(previewBodyCache 참고).
    docMetaRef.current = new Map(allMetas.map((m) => [m.id, { version: m.version, updatedAt: m.updatedAt }]));
    if (ws && Array.isArray(ws.spaces)) workspaceLoadedRef.current = true;
    const wsBase = ws && Array.isArray(ws.spaces) ? ensureHomeSpace(coerceSpaces(ws.spaces)) : null;
    // ② 예전에 가져온(docId 없는) 카드를 자기 문서에 묶는다 — 조건과 근거는
    // `planImportBinding`에. 업로드는 부수효과라 setState 밖(아래)에서 하고, 여기서는
    // 계획만 세운다. 저장된 워크스페이스를 못 읽었으면 건너뛴다(기준이 없으면 판단도
    // 못 한다 — 다음 진입에서 다시 본다).
    // 로컬/데모 모드에서는 그 id의 문서가 곧 이 카드의 본문이므로 그대로 묶는다
    // (`planImportBinding`의 `adoptExisting` 참고).
    const binding = wsBase ? planImportBinding(wsBase, metas, backendMode === 'local') : [];
    // 홈 색상 테마의 정본은 이 블롭이다(기기 간 동기화). 저장된 값이 있으면 곧바로
    // 입히고 이 기기 캐시도 맞춰 둔다 — 다음 부팅의 첫 페인트가 바로 이 색이 되도록.
    const wsTheme = ws && ws.theme !== undefined ? homeThemeKeyOf(ws.theme) : null;
    if (wsTheme) {
      applyHomeTheme(wsTheme);
      saveHomeThemeCache(wsTheme);
    }
    setState((prev) => {
      let base = wsBase ?? prev.spaces;
      let mapFolders = prev.mapFolders;
      if (wsBase && ws?.mapFolders && Object.keys(ws.mapFolders).length) mapFolders = ws.mapFolders;
      const { spaces: merged, renamed } = mergeDocMetasIntoSpaces(base, metas);
      // 키 마이그레이션보다 **먼저** docId를 붙여야, 제목으로 저장돼 있던 폴더 배정·
      // 최근 항목이 그 docId로 함께 옮겨 간다(아래 `migrateMapFolderKeys`/
      // `migrateRecentKeys`가 처리한다 — 여기서 따로 손댈 필요가 없다).
      base = applyImportBinding(merged, binding);
      const spaces = base;
      // `mapFolders` is keyed by map title, so when the merge renames a card to
      // its backend title (e.g. a map created/edited then reopened), migrate the
      // folder assignment to the new title — otherwise the folder still counts
      // the old (orphaned) key while the renamed card falls back to the top level.
      if (renamed.length) {
        const mf = { ...mapFolders };
        let mfChanged = false;
        renamed.forEach(({ from, to }) => {
          if (from !== to && mf[from] !== undefined) {
            mf[to] = mf[from]!;
            delete mf[from];
            mfChanged = true;
          }
        });
        if (mfChanged) mapFolders = mf;
      }
      // One-time migration: historical workspaces keyed `mapFolders` by TITLE;
      // move doc-backed entries onto docId keys (after the rename migration
      // above, so old-title keys have already been carried to current titles).
      const mfBeforeMigration = mapFolders;
      const mfMigration = migrateMapFolderKeys(spaces, mapFolders);
      mapFolders = mfMigration.mapFolders;
      // Prefer the tab-restored space (if it still exists), else keep the
      // previously-active one, else fall back to a real space (e.g. the user
      // deleted 일반 공간) so the sidebar/grid stay in sync.
      const existsInSpaces = (id: string | undefined): boolean => id === 'drive' || spaces.some((s) => s.id === id);
      const activeSpace = existsInSpaces(restore?.activeSpace)
        ? restore!.activeSpace
        : existsInSpaces(prev.activeSpace)
          ? prev.activeSpace
          : (spaces.find((s) => s.home)?.id ?? spaces[0]?.id ?? prev.activeSpace);
      // Restore the open folder only when it still belongs to the restored space.
      let curFolder = prev.curFolder;
      if (restore && restore.curFolder && activeSpace === restore.activeSpace) {
        const sp = spaces.find((s) => s.id === activeSpace);
        const folders = sp && Array.isArray(sp.folders) ? sp.folders : [];
        curFolder = folders.some((f) => f.id === restore.curFolder) ? restore.curFolder : prev.curFolder;
      }
      // Seed favs/deleted/trash from the backend's persisted meta
      // (isFavorite/deletedAt) so favorite/trash status survives a refresh.
      const { favs, deleted, trash } = seedFavAndTrashFromMetas(prev.favs, prev.deleted, prev.trash, metas);
      // Fold the per-user synced recents (from the backend workspace) into this
      // device's local recents so "recent items" follow the user across devices
      // (e.g. work PC → home PC). `prev.recent` (this device's localStorage, loaded
      // on mount) keeps its ordering priority; the synced list fills in history.
      let recent = mergeRecent(prev.recent, ws?.recent);
      // LEGACY recent entries were title-keyed, so renamed maps (root text
      // edited in the editor) must migrate before the key migration below —
      // otherwise a rename permanently killed the map's recent entry (the old
      // title matched nothing). New entries are docId-keyed and immune.
      let recentRenamed = false;
      if (renamed.length) {
        const renameTo = new Map(renamed.filter((r) => r.from !== r.to).map((r) => [r.from, r.to]));
        if (renameTo.size) {
          const seen = new Set<string>();
          const migrated: string[] = [];
          for (const t of recent) {
            const nt = renameTo.get(t) ?? t;
            if (nt !== t) recentRenamed = true;
            if (!seen.has(nt)) {
              seen.add(nt);
              migrated.push(nt);
            }
          }
          recent = migrated;
        }
      }
      // One-time key migration: legacy title entries move onto docId keys and
      // aliases of the same doc collapse (an editor push from an old app
      // version + this device's docId entry).
      const recentBeforeMigration = recent;
      const recentMigration = migrateRecentKeys(spaces, recent);
      recent = recentMigration.recent;
      if (recentRenamed || recentMigration.changed) saveRecent(recent); // keep this device's localStorage in step
      // Baseline the just-hydrated workspace so the save effect treats it as
      // already-persisted (no re-save of what we just loaded/seeded). When a
      // key migration rewrote `mapFolders` or `recent`, baseline the
      // PRE-migration shape instead, so the save effect sees a change and
      // persists the docId-keyed blob once — otherwise it would stay legacy
      // and re-migrate every load.
      // (같은 이유로, ②의 docId 묶기가 있었다면 **묶기 전** 카드를 기준선으로 둔다 —
      // 안 그러면 저장 효과가 "바뀐 게 없다"고 보고 지나쳐 docId가 영속되지 않는다.
      // 그러면 업로드가 성공한 다음 진입에서는 백엔드에 행이 있어 묶기 조건이 깨지고,
      // 카드는 영원히 docId 없는 상태로 남는다.)
      const theme = wsTheme ?? prev.theme;
      savedWorkspaceSigRef.current = JSON.stringify({
        spaces: binding.length ? merged : spaces,
        mapFolders: mfMigration.changed ? mfBeforeMigration : mapFolders,
        recent: recentMigration.changed ? recentBeforeMigration : recent,
        theme,
      });
      // Always flip `loaded` so the grid drops its loading skeleton and
      // renders the real (possibly empty) state.
      // 카드의 "마지막 수정" 표기 원천 — 휴지통 문서 메타까지 포함해 통째로
      // 갱신한다 (복원 직후에도 카드에 시각이 바로 뜨도록). timeFormat.ts 참고.
      const docTimes = Object.fromEntries(allMetas.map((m) => [m.id, m.updatedAt]));
      // 카드의 "공유 중" 표식 원천 — 내가 걸어 둔 초대/링크의 일괄 요약. 조회
      // 실패는 빈 객체(표식만 빠지고 홈은 그대로).
      const sharedByMe = res[3].status === 'fulfilled' ? res[3].value : prev.sharedByMe;
      return { ...prev, theme, spaces, activeSpace, curFolder, mapFolders, favs, deleted, trash, recent, docTimes, sharedByMe, sharedMaps: sharedMetas.map((m) => ({ docId: m.id, title: m.title, updatedAt: m.updatedAt, role: m.sharedRole ?? 'edit', isNew: unseen.has(m.id) })), loaded: true };
    });
    // 마지막 저장자가 **내가 아닌** 문서들만 이름을 물어본다(0015). 혼자 쓰는
    // 사람은 대상이 하나도 없어 요청 자체가 나가지 않는다. 실패해도 조용히 넘어간다 —
    // 이름은 부가 정보라 홈 로드를 붙잡을 이유가 없다.
    const foreignIds = allMetas.filter((m) => m.editedByMe === false).map((m) => m.id);
    if (foreignIds.length > 0) {
      void docStore
        .listEditorNames(foreignIds)
        .then((names) => {
          if (!mountedRef.current || Object.keys(names).length === 0) return;
          setState((prev) => ({ ...prev, editorNames: { ...prev.editorNames, ...names } }));
        })
        .catch(() => {
          /* 조회 실패 — 이름 없이 그린다 */
        });
    }

    // ② 묶은 카드의 본문을 올린다. `createOnly`라 이미 있으면 아무것도 하지 않는다
    // (다른 기기가 올린 문서를 덮지 않는다). 실패는 조용히 넘긴다 — 다음 진입에서
    // 조건이 그대로라 다시 시도한다.
    for (const b of binding) {
      const raw = readDocRaw(b.docId);
      if (!raw) continue;
      let parsed: Doc | null = null;
      try {
        parsed = parseDoc(JSON.parse(raw));
      } catch {
        parsed = null;
      }
      if (!parsed) continue;
      void docStore.save(b.docId, parsed, { title: b.title, createOnly: true }).catch(() => {
        /* 오프라인/전송 실패 — 다음 진입에서 재시도 */
      });
    }
  }, [docStore, spaceStore, backendMode]);

  // ---- mount: restore recent list, pick up docs saved from the editor ----
  useEffect(() => {
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const closest = (sel: string) => !!(target && target.closest && target.closest(sel));
      setState((prev) => {
        let next = prev;
        // 메뉴는 자기 바깥 클릭에 스스로 닫힌다(`HomeContextMenu`) — 여기서는 카드
        // 선택/설정/스페이스 메뉴만 본다.
        if (prev.selectedCard && !closest('.map-card')) next = { ...next, selectedCard: null };
        if (prev.settingsOpen && !closest('.settings-pop,.settings-btn')) next = { ...next, settingsOpen: false };
        return next;
      });
    };
    window.addEventListener('mousedown', onDocMouseDown);

    // Back/forward bfcache restore: the browser can restore this page with the
    // full-screen loader (`creatingMap`) frozen as it was when we navigated
    // away, so instead of the page you'd see the loading animation stuck on
    // top. On a persisted `pageshow` (bfcache), cancel any pending navigate and
    // clear the loader so the restored page shows immediately.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      clearTimeout(loaderTimer.current);
      setState((prev) => (prev.creatingMap ? { ...prev, creatingMap: false, loaderMsg: '' } : prev));
    };
    window.addEventListener('pageshow', onPageShow);

    // (recent은 useState 초기화에서 동기로 실렸다 — 여기서 다시 patch하지 않는다)

    // Kick off the initial workspace + doc hydration (see `hydrateFromBackend`).
    void hydrateFromBackend();

    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('pageshow', onPageShow);
      clearTimeout(loaderTimer.current);
      clearTimeout(cardRegisterTimer.current);
    };
  }, [hydrateFromBackend]);

  // Track mounted state so a late hydrate/resync never `setState`s after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(searchTimer.current);
    };
  }, []);

  // Cross-device first-login fix: re-hydrate ONCE when auth first confirms a
  // session. On a fresh login the mount hydrate above can run before Supabase has
  // applied the session token, so its RLS-scoped reads return empty and only the
  // default 일반 스페이스 shows until a manual refresh. `onAuthChange` fires an
  // INITIAL_SESSION/SIGNED_IN event after the client has fully initialized (token
  // applied), so re-fetching then reliably pulls the real workspace — automatic,
  // no refresh needed. Guarded so it can't clobber: skip if the user already
  // edited the workspace (`workspaceMutatedRef`) or the mount load already
  // succeeded (`workspaceLoadedRef`), and run at most once (`workspaceResyncedRef`).
  useEffect(() => {
    const unsubscribe = auth.onAuthChange((session) => {
      if (!session || workspaceResyncedRef.current || workspaceMutatedRef.current || workspaceLoadedRef.current) return;
      workspaceResyncedRef.current = true;
      void hydrateFromBackend();
    });
    return unsubscribe;
  }, [auth, hydrateFromBackend]);

  // Load the signed-in user's email for the LNB profile, and default the display
  // name to the email's local part (e.g. hoyul.lee@… → "hoyul.lee") instead of
  // the hardcoded "mine" / "mine@wantedlab.com" placeholder. `userName` is
  // editable in-session; the seed only applies on mount.
  useEffect(() => {
    let cancelled = false;
    void auth.getSession().then(async (session) => {
      if (cancelled) return;
      const email = session?.user?.email;
      if (!email) {
        // 세션 없음(로그인 페이지로 리다이렉트될 케이스) — 스켈레톤만 풀어준다.
        setState((prev) => ({ ...prev, profileLoaded: true }));
        return;
      }
      // Show the locally-cached name immediately, no flash. Default order:
      // explicit rename (local cache) → provider name (Google full_name) →
      // email local part. The provider avatar rides along (null for email/demo
      // accounts — the UI falls back to the initial circle).
      const name0 = readSavedProfileName(email) || session?.user?.name || email.split('@')[0] || email;
      setState((prev) => ({ ...prev, userEmail: email, userName: name0, userAvatar: session?.user?.avatarUrl || null, profileLoaded: true }));
      // …then reconcile with the backend (Supabase `profiles.display_name`), which
      // survives a browser-cache clear and syncs across devices. Local mode returns
      // null here, so it just keeps the cached value.
      try {
        const remote = await auth.getProfileName();
        if (cancelled || !remote || !remote.trim()) return;
        writeSavedProfileName(email, remote); // refresh the local cache
        setState((prev) => (prev.userEmail === email ? { ...prev, userName: remote } : prev));
      } catch {
        /* offline / transient — keep the cached name */
      }
    }).catch(() => {
      // 세션 조회 실패 — 플레이스홀더라도 보여주도록 스켈레톤을 풀어준다.
      if (!cancelled) setState((prev) => ({ ...prev, profileLoaded: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  // Remember the space/folder currently being viewed (tab-scoped) so that
  // opening a map in the editor and returning to Home restores it. Gated on
  // `loaded` so the transient initial 'general' can't overwrite a real value
  // before the mount restore above has applied it. Drive is a pseudo-space with
  // no local folder, so it persists with `curFolder: null`.
  useEffect(() => {
    if (!state.loaded) return;
    saveActiveView({ activeSpace: state.activeSpace, curFolder: state.activeSpace === 'drive' ? null : state.curFolder });
  }, [state.loaded, state.activeSpace, state.curFolder]);

  // Prefetch document BODIES for the map cards' thumbnails. `DocStore.list()`
  // above only returns metadata, and `realPreview` reads localStorage — so a
  // map whose body lives in a backend (Supabase) had no real preview and fell
  // back to the generic sketch. Load each map's doc once via the DocStore and
  // cache its serialized form in `previewDocs`, then the view renders the real
  // nodes. `previewFetchedRef` dedupes across runs.
  //
  // Scope: the CURRENTLY-ACTIVE space's maps + the maps referenced by the
  // cross-space "최근 항목" strip — those are the only cards that render a real
  // preview (folder cards are folder thumbnails; favorites/trash are text
  // lists). Recent cards resolve from EVERY space (viewModel `recentByTitle`),
  // so scoping to the active space alone stranded other-space recents on the
  // loading skeleton forever (`previewResolved[docId]` never flipped). Recents
  // considered here are bounded to RECENT_RENDER_MAX (the most the tray can
  // ever render — retention RECENT_CAP is larger), so this adds a bounded batch
  // of loads and does NOT reintroduce the whole-workspace fan-out this scope
  // avoids. Switching spaces re-runs this and prefetches that space on demand
  // (`state.activeSpace` dep).
  useEffect(() => {
    if (!state.loaded) return;
    const active = state.spaces.find((s) => s.id === state.activeSpace);
    const wanted = new Set((Array.isArray(active?.maps) ? active!.maps : []).map((m) => m.docId).filter((id): id is string => !!id));
    if (state.recent.length) {
      // 트레이가 **실제로 그릴** 카드들의 docId — 반드시 트레이와 같은 파이프라인으로
      // 골라야 한다. 원시 recent의 앞 N개를 자르던 예전 방식은 휴지통·별칭·사라진
      // 문서 항목이 머리에 쌓이면 화면에 보이는 카드가 프리페치에서 빠져 로딩
      // 스켈레톤에 갇혔다(제보 — `recentTrayDocIds`의 doc comment 참고).
      recentTrayDocIds(state.spaces, state.recent, state.trash, state.deleted).forEach((id) => wanted.add(id));
    }
    const ids = Array.from(wanted).filter((id) => !previewFetchedRef.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => previewFetchedRef.current.add(id));
    // NOTE: intentionally NOT cancelled on effect re-run. This effect re-runs
    // whenever `state.spaces` changes identity — which happens on a new device
    // when the mount hydrate and the auth-confirmed resync BOTH setState the
    // spaces (often with identical content). A per-run `cancelled` flag would
    // then abort the in-flight `docStore.load` batch before it set
    // `previewResolved`, stranding those cards on the loading skeleton forever
    // (only a full remount — e.g. opening a map and coming back — cleared it).
    // The batch is deduped by `previewFetchedRef`, so letting it finish is safe;
    // we only skip the state update if the component actually unmounted.
    // `loadPreview` = 썸네일 전용 본문: Supabase는 이미지 데이터를 뗀 RPC +
    // (version, updatedAt) 키 로컬 캐시(같은 판이면 네트워크 생략 — egress
    // 절감), 로컬 모드는 localStorage 그대로. 자세한 계약은 ports.ts.
    void Promise.allSettled(ids.map((id) => docStore.loadPreview(id, docMetaRef.current.get(id)))).then((results) => {
      if (!mountedRef.current) return;
      const add: Record<string, string> = {};
      const resolved: Record<string, boolean> = {};
      results.forEach((r, i) => {
        const id = ids[i]!;
        resolved[id] = true; // resolved (whether or not a body came back)
        if (r.status === 'fulfilled' && r.value) add[id] = r.value;
      });
      // Mark the batch resolved even when nothing loaded, so cards for those
      // docs stop showing the loading skeleton and settle on their final preview.
      setState((prev) => ({ ...prev, previewDocs: { ...prev.previewDocs, ...add }, previewResolved: { ...prev.previewResolved, ...resolved } }));
    });
  }, [state.loaded, state.spaces, state.activeSpace, state.recent, state.trash, state.deleted, docStore]);

  /**
   * 첫 검색이 시작되면 **나머지 스페이스의 본문**을 마저 받아 온다.
   *
   * 썸네일 프리페치는 활성 스페이스(+최근 항목)만 받으므로, 검색이 전역이 된 지금은
   * 다른 스페이스가 제목으로만 걸린다. 검색은 의도적인 행동이라 그때 한 번 값을
   * 치르는 게 맞고, `loadPreview`가 (id, version, updatedAt) 키로 캐시하므로 사실상
   * **기기당 한 번**이다(홈에 들어오기만 해도 미리 받아 두면 검색하지 않는 사용자도
   * 전송량을 치른다 — 그래서 검색을 시작할 때로 미룬다).
   *
   * `previewFetchedRef`가 썸네일 경로와 같은 dedupe를 하므로 이미 받은 것은 건너뛴다.
   */
  useEffect(() => {
    if (!state.loaded || !state.search.trim()) return;
    const wanted: string[] = [];
    state.spaces.forEach((sp) => (Array.isArray(sp.maps) ? sp.maps : []).forEach((m) => {
      if (m.docId && !previewFetchedRef.current.has(m.docId)) wanted.push(m.docId);
    }));
    if (!wanted.length) return;
    wanted.forEach((id) => previewFetchedRef.current.add(id));
    setState((prev) => ({ ...prev, searchBodiesLoading: true }));
    void Promise.allSettled(wanted.map((id) => docStore.loadPreview(id, docMetaRef.current.get(id)))).then((results) => {
      if (!mountedRef.current) return;
      const add: Record<string, string> = {};
      const resolved: Record<string, boolean> = {};
      results.forEach((r, i) => {
        const id = wanted[i]!;
        resolved[id] = true;
        if (r.status === 'fulfilled' && r.value) add[id] = r.value;
      });
      setState((prev) => ({
        ...prev,
        previewDocs: { ...prev.previewDocs, ...add },
        previewResolved: { ...prev.previewResolved, ...resolved },
        searchBodiesLoading: false,
      }));
    });
  }, [state.loaded, state.search, state.spaces, docStore]);

  // Persist spaces (+ map→folder) via the `SpaceStore` port whenever they
  // actually change, so user-created spaces/folders survive a refresh AND (in
  // Supabase mode) sync across every device the user logs into. Two guards keep
  // a failed load from destroying data:
  //   1. `canPersistWorkspaceRef` — never write unless the mount load FULFILLED
  //      (a rejected load left us on the default seed; saving it would wipe the
  //      user's real workspace — the re-login data-loss bug).
  //   2. signature check — the hydration is baselined, so we only write on a
  //      genuine change and never re-save what we just loaded.
  // Saved immediately (not debounced) so a quick refresh right after a change
  // can't race a pending timer — space/folder edits are deliberate and infrequent.
  useEffect(() => {
    if (!state.loaded || !canPersistWorkspaceRef.current) return;
    const sig = JSON.stringify({ spaces: state.spaces, mapFolders: state.mapFolders, recent: state.recent, theme: state.theme });
    if (sig === savedWorkspaceSigRef.current) return;
    savedWorkspaceSigRef.current = sig;
    // A genuine user change is being persisted — from here on the auth-confirmed
    // resync must NOT re-hydrate (it would clobber this edit with backend state).
    workspaceMutatedRef.current = true;
    // `recent` rides along in the same per-user blob (opening a map bumps it), so
    // the recent-items list syncs across devices just like spaces/folders do.
    void spaceStore.save({ spaces: state.spaces, mapFolders: state.mapFolders, recent: state.recent, theme: state.theme }).catch(() => {
      /* save failed (offline, RLS, ...) — non-fatal; the next change retries */
    });
  }, [state.loaded, state.spaces, state.mapFolders, state.recent, state.theme, spaceStore]);

  // ---- drive (fake OAuth demo) ----
  const onDriveClick = () => patch({ activeSpace: 'drive', curFolder: null, driveFolder: null });
  const openDriveAuth = () => patch({ auth: 'choose' });
  const closeAuth = () => {
    if (state.auth !== 'connecting') patch({ auth: null });
  };
  const chooseAccount = () => {
    patch({ auth: 'connecting' });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => patch({ drive: 'connected', auth: null }), 1400);
  };
  const disconnectDrive = () => patch({ drive: 'idle' });

  // ---- account / settings ----
  const toggleSettings = () => patch({ settingsOpen: !state.settingsOpen });
  // Profile-name rename — a popup (like "스페이스 이름 변경"), driven by a draft so
  // 취소 discards and 변경 commits. Opening it closes the profile popover.
  const openProfileNameEdit = () => patch({ profileNameOpen: true, profileNameDraft: state.userName, settingsOpen: false });
  const onProfileNameInput = (v: string) => patch({ profileNameDraft: (v || '').slice(0, 20) });
  const submitProfileName = () => {
    const fallback = state.userEmail ? state.userEmail.split('@')[0] || 'mine' : 'mine';
    const name = state.profileNameDraft.trim() || fallback;
    // Local cache (fast display) + backend (Supabase — survives cache clear, syncs
    // across devices; a no-op in local mode).
    if (state.userEmail) writeSavedProfileName(state.userEmail, name);
    patch({ userName: name, profileNameOpen: false });
    void auth.setProfileName(name);
  };
  const cancelProfileName = () => patch({ profileNameOpen: false });
  const onProfileNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitProfileName();
    } else if (e.key === 'Escape') {
      cancelProfileName();
    }
  };
  const logout = () => patch({ settingsOpen: false, confirmLogout: true });
  const cancelLogout = () => patch({ confirmLogout: false });
  const confirmLogoutYes = () => {
    patch({ confirmLogout: false, creatingMap: true, loaderMsg: '로그아웃하고 있어요' });
    clearTimeout(loaderTimer.current);
    // `LocalAuth.signOut()` resolves instantly (demo, no network), so this
    // still lands on /login after the same ~900ms loader beat as before.
    void auth.signOut();
    // `replace` so a post-logout Forward can't return to the (now signed-out)
    // home and replay its loader/animation.
    loaderTimer.current = setTimeout(() => navigate('/login', { replace: true }), 900);
  };

  // ---- account settings / 회원 탈퇴 ----
  const openAccountSettings = () => patch({ settingsOpen: false, accountSettingsOpen: true });
  /** 홈 색상 테마 선택. 색은 CSS 변수라 **즉시** 반영하고(상태 반영을 기다리지 않는다
   * — 고르는 즉시 화면이 바뀌는 게 이 기능의 전부다), 이 기기 캐시에 적어 다음 부팅의
   * 첫 페인트를 맞추며, 상태 변경이 저장 효과를 태워 워크스페이스에 동기화된다. */
  const setTheme = (key: HomeThemeKey) => {
    applyHomeTheme(key);
    saveHomeThemeCache(key);
    patch({ theme: key });
  };

  const openFeedback = () => patch({ settingsOpen: false, feedbackOpen: true });
  const closeFeedback = () => patch({ feedbackOpen: false });
  const closeAccountSettings = () => patch({ accountSettingsOpen: false });
  const askDeleteAccount = () => patch({ accountSettingsOpen: false, confirmDeleteAccount: true, deleteAccountText: '', deleteAccountError: '' });
  const cancelDeleteAccount = () => patch({ confirmDeleteAccount: false, deleteAccountText: '', deleteAccountError: '' });
  const onDeleteAccountInput = (v: string) => patch({ deleteAccountText: v });
  /** The user must type this exact phrase to arm the destructive button — a
   * deliberate friction step for an irreversible action. */
  const DELETE_ACCOUNT_PHRASE = '탈퇴';
  const confirmDeleteAccountYes = () => {
    // Double-guard: the button is disabled unless the phrase matches, but never
    // trust the UI alone for a destructive, irreversible call.
    if (state.deleteAccountText.trim() !== DELETE_ACCOUNT_PHRASE) return;
    patch({ confirmDeleteAccount: false, creatingMap: true, loaderMsg: '회원 탈퇴를 처리하고 있어요' });
    clearTimeout(loaderTimer.current);
    void (async () => {
      const res = await auth.deleteAccount();
      if (res.error) {
        // Re-open the dialog with an error and let the user retry — half-deleted
        // is worse than not-deleted, so we surface the failure rather than
        // navigating away.
        patch({ creatingMap: false, confirmDeleteAccount: true, deleteAccountError: '탈퇴 처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      // Clear this browser's MindFlow caches too — in Supabase mode the server
      // rows are gone (cascade) but localStorage may still hold doc/workspace
      // copies; wiping them stops a stale workspace flashing on the next login.
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('mindflow_') || k.startsWith('mf_'))) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch {
        /* storage unavailable — non-fatal */
      }
      loaderTimer.current = setTimeout(() => navigate('/login', { replace: true }), 700);
    })();
  };

  // ---- spaces ----
  // The "새 스페이스 만들기" modal doubles as the rename dialog: `editingSpace === null`
  // is create mode, a space id is edit mode (pre-filled name + color). `submitSpace`
  // branches on it, so both flows share one popup (name + accent color).
  const openNewSpace = () => patch({ newSpaceOpen: true, editingSpace: null, newSpaceName: '', newSpaceColor: '#f0663f' });
  const closeNewSpace = () => patch({ newSpaceOpen: false, editingSpace: null });
  const onNewSpaceName = (v: string) => patch({ newSpaceName: (v || '').slice(0, 10) });
  const submitSpace = () => {
    const name = state.newSpaceName.trim();
    if (!name) return;
    const editId = state.editingSpace;
    if (editId) {
      setState((prev) => ({
        ...prev,
        spaces: prev.spaces.map((s) => (s.id === editId ? { ...s, name, color: prev.newSpaceColor } : s)),
        newSpaceOpen: false,
        editingSpace: null,
        newSpaceName: '',
      }));
      return;
    }
    const id = 's' + Date.now().toString(36);
    setState((prev) => ({
      ...prev,
      spaces: [...prev.spaces, { id, name, color: prev.newSpaceColor, maps: [] }],
      newSpaceOpen: false,
      newSpaceName: '',
    }));
  };
  const onNewSpaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submitSpace();
  };
  const pickSpaceColor = (c: string) => patch({ newSpaceColor: c });
  const setActiveSpace = (id: string) => patch({ activeSpace: id, curFolder: null, driveFolder: null });
  /** Rename now opens the shared "새 스페이스 만들기" popup in EDIT mode (name + color),
   * pre-filled from the space — instead of an inline sidebar input. */
  const startRenameSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    if (!sp) return;
    patch({ newSpaceOpen: true, editingSpace: id, newSpaceName: sp.name, newSpaceColor: sp.color || '#f0663f', ctxMenu: null });
  };
  const askDeleteSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    if (!sp || (Array.isArray(sp.maps) && sp.maps.some((m) => !state.deleted[m.title]))) return;
    if (state.spaces.length <= 1) return;
    patch({ confirmDeleteSpace: id, ctxMenu: null });
  };
  const cancelDeleteSpace = () => patch({ confirmDeleteSpace: null });
  const confirmDeleteSpaceYes = () => {
    const id = state.confirmDeleteSpace;
    if (!id) return;
    setState((prev) => {
      const spaces = prev.spaces.filter((s) => s.id !== id);
      if (!spaces.length) return prev;
      const first = spaces[0]!;
      const active = prev.activeSpace === id ? first.id : prev.activeSpace;
      return { ...prev, spaces, confirmDeleteSpace: null, activeSpace: active };
    });
  };

  // ---- favorites / trash / recent ----
  // Each of these flips the title-keyed local state (unchanged UI/behavior)
  // AND, when the card is doc-backed (`docId` present — a demo/Drive card has
  // none), fires-and-forgets the matching `DocStore` call so the change
  // survives a refresh. Failures are swallowed (non-fatal, matches this
  // file's other storage try/catch conventions) — the optimistic local state
  // already reflects the change either way.
  const toggleFav = (title: string, docId?: string) => {
    const key = cardKeyOf(title, docId);
    const nextFav = !state.favs[key];
    setState((prev) => {
      const favs = { ...prev.favs, [key]: !prev.favs[key] };
      if (!favs[key]) delete favs[key];
      return { ...prev, favs };
    });
    if (docId) {
      void docStore.setFavorite(docId, nextFav).catch(() => {
        /* backend unreachable — local state already flipped, non-fatal */
      });
    }
  };
  const toggleFavList = () => patch({ favOpen: !state.favOpen });
  const toggleSharedList = () => patch({ sharedOpen: !state.sharedOpen });
  /**
   * ☰ 버튼과 우클릭이 **같은 메뉴**를 연다(요청). 다른 점은 자리뿐이라, 여는 쪽이
   * 좌표를 주고 메뉴는 그 자리에 뜬다(화면 밖으로 나가면 안쪽으로 당긴다).
   * 같은 대상을 다시 누르면 닫힌다(☰ 토글 감각 유지).
   */
  const openCtxMenu = (x: number, y: number, target: HomeCtxTarget) => {
    const same = state.ctxMenu && ctxTargetKey(state.ctxMenu.target) === ctxTargetKey(target);
    patch({ ctxMenu: same ? null : { x, y, target } });
  };
  /** 우클릭 진입 — 같은 대상이라도 **새 자리**에 다시 연다(토글하지 않는다). */
  const openCtxMenuAt = (x: number, y: number, target: HomeCtxTarget) => patch({ ctxMenu: { x, y, target } });
  const closeMenu = () => patch({ ctxMenu: null });
  const askDelete = (title: string, docId?: string) => patch({ confirmDelete: title, confirmDeleteDocId: docId ?? null, ctxMenu: null });
  const cancelDelete = () => patch({ confirmDelete: null, confirmDeleteDocId: null });
  const confirmDeleteYes = () => {
    const title = state.confirmDelete;
    if (!title) return;
    const docId = state.confirmDeleteDocId;
    setState((prev) => {
      // Match the exact card: by docId when the card is doc-backed (avoids
      // touching a same-titled sibling like "새 마인드맵_1" vs "…_1 (2)"), else
      // a title-only card.
      const matches = (m: { title: string; docId?: string }) => (docId ? m.docId === docId : m.title === title && !m.docId);
      // Remember where it lived so restore can put it back.
      let spaceId: string | undefined;
      prev.spaces.forEach((s) => {
        if (Array.isArray(s.maps) && s.maps.some(matches)) spaceId = s.id;
      });
      const folder = prev.mapFolders[cardKeyOf(title, docId ?? undefined)];
      // REMOVE the card from the workspace (the synced source of truth) — not just
      // hide it — so it can't linger in `spaces.maps` and reappear after a refresh
      // (the previous title-keyed `deleted` flag was session-only for docId-less
      // cards, and the doc's `deletedAt` seed didn't cover them).
      const spaces = prev.spaces.map((s) => {
        if (!Array.isArray(s.maps)) return s;
        const maps = s.maps.filter((m) => !matches(m));
        return maps.length === s.maps.length ? s : { ...s, maps };
      });
      const mapFolders = { ...prev.mapFolders };
      delete mapFolders[cardKeyOf(title, docId ?? undefined)];
      const deleted = { ...prev.deleted, [title]: true };
      const favs = { ...prev.favs };
      delete favs[cardKeyOf(title, docId ?? undefined)];
      const src = sourceOf(title, DRIVE_FILES);
      // Dedupe by docId when we have one — trash policy allows two entries with
      // the same TITLE (they're different docs), just never the same doc twice.
      const already = prev.trash.some((t) => (docId ? t.docId === docId : t.title === title));
      const trash = already ? prev.trash : [...prev.trash, { title, source: src, docId: docId ?? undefined, spaceId, folder }];
      return { ...prev, spaces, mapFolders, deleted, favs, trash, confirmDelete: null, confirmDeleteDocId: null };
    });
    if (docId) {
      void docStore.remove(docId).catch(() => {
        // Backend delete failed (offline/RLS): the card is already gone locally,
        // but it isn't soft-deleted on the server — warn so the user can retry
        // rather than have it silently resurrect on another device/refresh.
        patch({ importError: '삭제가 서버에 반영되지 않았어요. 네트워크 확인 후 다시 시도해 주세요.' });
      });
    }
  };
  const deleteCard = (title: string, docId?: string) => {
    setState((prev) => {
      const deleted = { ...prev.deleted, [title]: true };
      const favs = { ...prev.favs };
      delete favs[cardKeyOf(title, docId)];
      return { ...prev, deleted, favs, ctxMenu: null };
    });
    if (docId) {
      void docStore.remove(docId).catch(() => {
        /* backend unreachable — local state already moved it to trash, non-fatal */
      });
    }
  };
  const toggleTrashList = () => patch({ trashOpen: !state.trashOpen });
  const toggleRecentList = () => patch({ recentOpen: !state.recentOpen });
  const askRestore = (title: string, docId?: string) => patch({ confirmRestore: title, confirmRestoreDocId: docId ?? null });
  const cancelRestore = () => patch({ confirmRestore: null, confirmRestoreDocId: null });
  const confirmRestoreYes = () => {
    const title = state.confirmRestore;
    if (!title) return;
    const docId = state.confirmRestoreDocId;
    const entry = state.trash.find((t) => (docId ? t.docId === docId : t.title === title));
    // Duplicate titles are fully allowed (XMind-style), so a restore keeps the
    // map's original name even when the destination space already has one —
    // identity is the docId, and every consumer (folders/favorites/recents/
    // selection) keys off it.
    const isDriveFile = DRIVE_FILES.some((f) => f.name === title);
    const present = (m: { title: string; docId?: string }) => (docId ? m.docId === docId : m.title === title);
    const needsPlacement = !isDriveFile && !state.spaces.some((s) => Array.isArray(s.maps) && s.maps.some(present));
    // Prefer the origin space captured at delete time; fall back to the home
    // space (then the first) if it's gone.
    const origin = entry?.spaceId && state.spaces.some((s) => s.id === entry.spaceId) ? entry.spaceId : undefined;
    const targetId = origin ?? state.spaces.find((s) => s.home)?.id ?? state.spaces[0]?.id;
    const target = state.spaces.find((s) => s.id === targetId);
    const toast = needsPlacement && target && !origin ? `원래 스페이스가 삭제되어 "${target.name}" 스페이스로 복원했어요` : '';
    setState((prev) => {
      // Remove exactly ONE trash entry (the restored doc) — with same-title
      // entries allowed in the trash, a title-wide filter would eat siblings.
      let removedOne = false;
      const trash = prev.trash.filter((t) => {
        if (removedOne) return true;
        const match = docId ? t.docId === docId : t.title === title;
        if (match) removedOne = true;
        return !match;
      });
      // The title-keyed fallback flag clears only when no OTHER trash entry
      // still holds this title (drive files / docId-less legacy entries).
      const deleted = { ...prev.deleted };
      if (!trash.some((t) => t.title === title)) delete deleted[title];
      let spaces = prev.spaces;
      let mapFolders = prev.mapFolders;
      if (needsPlacement && target) {
        spaces = spaces.map((s) => (s.id === targetId ? { ...s, maps: [...(s.maps || []), { title, when: '방금 복원됨', hue: '#f0663f', docId: docId ?? undefined }] } : s));
        // restore the folder assignment too, if that folder still exists
        if (entry?.folder && Array.isArray(target.folders) && target.folders.some((f) => f.id === entry.folder)) {
          mapFolders = { ...mapFolders, [cardKeyOf(title, docId ?? undefined)]: entry.folder };
        }
      }
      return { ...prev, deleted, trash, spaces, mapFolders, confirmRestore: null, confirmRestoreDocId: null, toast, toastTitle: toast ? '복원 완료' : '' };
    });
    if (docId) {
      void docStore.restore(docId).catch(() => {
        /* backend unreachable — local state already restored it, non-fatal */
      });
    }
  };
  // ---- permanent delete (휴지통 영구 삭제) ----
  const askPurge = (title: string, docId?: string) => patch({ confirmPurge: title, confirmPurgeDocId: docId ?? null });
  const cancelPurge = () => patch({ confirmPurge: null, confirmPurgeDocId: null });
  const confirmPurgeYes = () => {
    const title = state.confirmPurge;
    if (!title) return;
    const docId = state.confirmPurgeDocId;
    setState((prev) => {
      // Remove exactly ONE entry (same-title siblings may coexist in the trash).
      let removedOne = false;
      const trash = prev.trash.filter((t) => {
        if (removedOne) return true;
        const match = docId ? t.docId === docId : t.title === title;
        if (match) removedOne = true;
        return !match;
      });
      const deleted = { ...prev.deleted };
      // Drive demo files keep their title flag (that's what hides the static
      // card); doc-backed entries clear it unless a same-title sibling remains.
      const isDriveFile = DRIVE_FILES.some((f) => f.name === title);
      if (!isDriveFile && !trash.some((t) => t.title === title)) delete deleted[title];
      // The doc is gone for good — drop its recent entry (docId key always;
      // title/hash aliases only when no live map still carries the title) and
      // any stale favorite flag.
      let recent = prev.recent;
      const titleLives = prev.spaces.some((s) => (s.maps || []).some((m) => m.title === title));
      const dead = (e: string) => (docId ? e === docId : false) || (!titleLives && (e === title || e === mapId(title)));
      if (recent.some(dead)) {
        recent = recent.filter((e) => !dead(e));
        saveRecent(recent);
      }
      const favs = { ...prev.favs };
      delete favs[cardKeyOf(title, docId ?? undefined)];
      return { ...prev, trash, deleted, recent, favs, confirmPurge: null, confirmPurgeDocId: null };
    });
    if (docId) {
      // 첨부 실물도 함께 지운다 — 영구 삭제는 되돌릴 수 없으므로 여기서만 지운다
      // (편집 중 이미지를 지웠다 undo하는 경우를 대비해 그때는 남겨 둔다).
      void imageStore.removeForDoc(docId).catch(() => undefined);
      void docStore.purge(docId).catch(() => {
        // Backend purge failed (offline/RLS): the row will reappear via list()
        // on the next load — surface it so the user can retry.
        patch({ importError: '영구 삭제가 서버에 반영되지 않았어요. 네트워크 확인 후 다시 시도해 주세요.' });
      });
    }
  };
  const askEmptyTrash = () => patch({ confirmEmptyTrash: true });
  const cancelEmptyTrash = () => patch({ confirmEmptyTrash: false });
  const confirmEmptyTrashYes = () => {
    const entries = state.trash;
    if (!entries.length) {
      patch({ confirmEmptyTrash: false });
      return;
    }
    setState((prev) => {
      const deleted = { ...prev.deleted };
      const favs = { ...prev.favs };
      let recent = prev.recent;
      let recentChanged = false;
      prev.trash.forEach((t) => {
        const isDriveFile = DRIVE_FILES.some((f) => f.name === t.title);
        if (!isDriveFile) delete deleted[t.title];
        delete favs[cardKeyOf(t.title, t.docId)];
        const titleLives = prev.spaces.some((s) => (s.maps || []).some((m) => m.title === t.title));
        const dead = (e: string) => (t.docId ? e === t.docId : false) || (!titleLives && (e === t.title || e === mapId(t.title)));
        if (recent.some(dead)) {
          recent = recent.filter((e) => !dead(e));
          recentChanged = true;
        }
      });
      if (recentChanged) saveRecent(recent);
      return { ...prev, trash: [], deleted, favs, recent, confirmEmptyTrash: false };
    });
    const ids = entries.map((t) => t.docId).filter((id): id is string => !!id);
    if (ids.length) {
      void Promise.allSettled(ids.map((id) => imageStore.removeForDoc(id)));
      void Promise.allSettled(ids.map((id) => docStore.purge(id))).then((results) => {
        if (!mountedRef.current) return;
        if (results.some((r) => r.status === 'rejected')) {
          patch({ importError: '일부 항목의 영구 삭제가 서버에 반영되지 않았어요. 네트워크 확인 후 다시 시도해 주세요.' });
        }
      });
    }
  };

  const restoreCard = (title: string, docId?: string) => {
    setState((prev) => {
      // Same one-entry removal + conditional flag clear as confirmRestoreYes —
      // same-title siblings may remain in the trash.
      let removedOne = false;
      const trash = prev.trash.filter((t) => {
        if (removedOne) return true;
        const match = docId ? t.docId === docId : t.title === title;
        if (match) removedOne = true;
        return !match;
      });
      const deleted = { ...prev.deleted };
      if (!trash.some((t) => t.title === title)) delete deleted[title];
      return { ...prev, deleted, trash };
    });
    if (docId) {
      void docStore.restore(docId).catch(() => {
        /* backend unreachable — local state already restored it, non-fatal */
      });
    }
  };
  const closeToast = () => patch({ toast: '', toastTitle: '', importDone: null, importDoneFolder: null, importError: null });

  const recordRecent = (title: string, docId?: string) => {
    // Entries are card keys (docId, title fallback) — same identity the recent
    // tray resolves, so same-titled maps track independently.
    const key = cardKeyOf(title, docId);
    setState((prev) => {
      // Retention (RECENT_CAP) deliberately exceeds anything one row shows —
      // the tray decides how many to EXPOSE from the viewport width.
      const recent = [key, ...prev.recent.filter((t) => t !== key)].slice(0, RECENT_CAP);
      saveRecent(recent);
      return { ...prev, recent };
    });
  };

  // ---- open / create maps ----
  const mapHref = (title: string, docId?: string) => buildMapHref(title, docId);
  // Every new map is simply "새 마인드맵" — duplicate names are fully allowed
  // (XMind-style, #142/#143), identity is the fresh `new-…` doc id, so there's
  // nothing to uniquify against.
  const newMapHref = () => buildNewMapHref('새 마인드맵');

  const navigateAfterLoader = (href: string, msg: string) => {
    patch({ creatingMap: true, loaderMsg: msg });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => navigate(href), 900);
  };

  /** Home.dc.html `openWithLoader(e, title)` — records recent, shows the loader, then navigates. */
  const openWithLoader = (href: string, title: string, docId?: string) => {
    recordRecent(title, docId);
    navigateAfterLoader(href, '맵을 불러오고 있어요');
  };

  /**
   * 공유받은 맵을 연다 — 여는 순간 그 초대를 "봤다"로 표시해 배지에서 뺀다.
   *
   * 목록을 펼치기만 해도 지우지 않는 이유: 배지는 **아직 안 본 초대**를 세는
   * 우편함이다. 펼쳐서 훑는 것과 실제로 열어 보는 것은 다르고, 후자가 정직한 신호다.
   * 표시는 부수적이라 실패해도 여는 것을 막지 않는다(fire-and-forget).
   */
  const openSharedMap = (href: string, title: string, docId: string) => {
    setState((prev) => ({ ...prev, sharedMaps: prev.sharedMaps.map((m) => (m.docId === docId ? { ...m, isNew: false } : m)) }));
    void shareStore.markSharedSeen([docId]).catch(() => {});
    openWithLoader(href, title, docId);
  };

  /** Home.dc.html `onNewMapClick` (inline in `renderVals()`).
   *
   * Assigns the new map to the CURRENTLY-ACTIVE (non-drive) space so it's saved
   * there — otherwise the on-return `mergeDocMetasIntoSpaces` would default the
   * new doc into the home space. We register a card carrying the new doc's id
   * (parsed from the href) into the active space NOW; that's persisted by the
   * SpaceStore save effect, and when the doc comes back in `docStore.list()` the
   * merge sees its id as already-placed and leaves it in this space. */
  const onNewMapClick = (href: string) => {
    // 로더를 "먼저" 띄우고(같은 프레임에 카드가 함께 들어가면 로더가 완전히
    // 덮기 전에 새 카드가 배경에 번쩍인다 — 제보), 카드 등록은 로더가 실제로
    // 페인트된 다음 프레임에 수행한다. 로더는 `instant`라 첫 프레임부터 불투명.
    navigateAfterLoader(href, '새 마인드맵을 준비하고 있어요');

    const registerCard = () => {
      try {
        const params = new URLSearchParams(href.split('?')[1] || '');
        const docId = params.get('map') || '';
        const title = params.get('title') ? decodeURIComponent(params.get('title') as string) : '새 마인드맵';
        if (!docId) return;
        setState((prev) => {
          // active space if it's a real space (not the Drive view); else home.
          const targetId = prev.spaces.some((s) => s.id === prev.activeSpace) ? prev.activeSpace : (prev.spaces.find((s) => s.home)?.id ?? prev.spaces[0]?.id);
          if (!targetId) return prev;
          // Dedupe by docId only — duplicate TITLES are allowed (XMind-style).
          if (prev.spaces.some((s) => (s.maps || []).some((m) => m.docId === docId))) return prev;
          const spaces = prev.spaces.map((s) => (s.id === targetId ? { ...s, maps: [...(s.maps || []), { title, when: '방금', hue: '#f0663f', docId }] } : s));
          // If the user is currently INSIDE a folder (of the target space), file
          // the new map into that folder — otherwise it would land at the space's
          // top level (outside the folder they're viewing). Keyed by docId
          // (`cardKeyOf`), same as `moveMapToFolder`.
          let mapFolders = prev.mapFolders;
          if (prev.curFolder) {
            const sp = prev.spaces.find((s) => s.id === targetId);
            const folders = sp && Array.isArray(sp.folders) ? sp.folders : [];
            if (folders.some((f) => f.id === prev.curFolder)) {
              mapFolders = { ...prev.mapFolders, [cardKeyOf(title, docId)]: prev.curFolder };
            }
          }
          return { ...prev, spaces, mapFolders };
        });
      } catch {
        /* href parse failed — the plain navigate above still takes the user there */
      }
    };

    // 더블 rAF: 첫 rAF는 로더가 포함된 렌더의 커밋 직후, 두 번째는 그 프레임이
    // 화면에 그려진 뒤 실행된다 → 카드 추가는 항상 불투명한 로더 뒤에서 일어난다.
    // 저장(spaceStore.save)은 즉시(디바운스 없음) 걸리고 이동은 900ms 뒤라
    // 두 프레임 지연은 영속성에 영향이 없다. 테스트/비-브라우저 환경 폴백 포함.
    clearTimeout(cardRegisterTimer.current);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(registerCard));
    } else {
      cardRegisterTimer.current = setTimeout(registerCard, 0);
    }
  };

  // ---- 템플릿 갤러리 ----
  /** "새로 만들기"의 모든 진입점이 여기로 온다 — 빈 맵도 갤러리의 첫 칸이라,
   * 만드는 길이 하나뿐이고 어디서 시작하든 같은 선택지를 본다. */
  const openTemplates = () => patch({ templateOpen: true, ctxMenu: null });
  const closeTemplates = () => patch({ templateOpen: false });
  /**
   * 갤러리에서 고른 것으로 새 맵을 만든다. `templateId`가 없으면 예전 그대로 빈 맵.
   *
   * 이후 경로(로더 → 카드 등록 → 이동)는 `onNewMapClick` 하나를 그대로 쓴다 —
   * 템플릿이 바꾸는 것은 **주소에 실리는 씨앗 id뿐**이고, 문서를 만드는 것은
   * 에디터다(`buildTemplateDoc`). 홈이 문서를 조립해 저장하면 저장 경로가 둘이 된다.
   */
  const createFromTemplate = (templateId?: string) => {
    patch({ templateOpen: false });
    // 화이트보드 — MAP_TEMPLATES에 없는 특수 칸(빈 보드). 에디터의
    // `buildTemplateDoc('board')`가 tpl=board를 받아 트리 없는 문서를 시드한다.
    if (templateId === 'board') {
      onNewMapClick(buildNewMapHref('새 화이트보드', 'board'));
      return;
    }
    // 칸반 — 세 번째 문서 종류. 보드와 같은 길(주소에 tpl만, 시드는 에디터가).
    if (templateId === 'kanban') {
      onNewMapClick(buildNewMapHref('새 칸반 보드', 'kanban'));
      return;
    }
    // 화이트보드 템플릿(회고·우선순위·아이디어 스티커) — 맵 템플릿과 같은 길을 탄다:
    // 주소에는 tpl만 실리고 문서는 에디터가 `buildTemplateDoc`으로 시드한다.
    const bt = findBoardTemplate(templateId);
    if (bt) {
      onNewMapClick(buildNewMapHref(bt.name, bt.id));
      return;
    }
    const tpl = findTemplate(templateId);
    onNewMapClick(buildNewMapHref(tpl ? tpl.name : '새 마인드맵', tpl?.id));
  };

  // ---- import / export ----
  const setImportRef = (el: HTMLInputElement | null) => {
    importInputRef.current = el;
  };
  const openImport = () => {
    const el = importInputRef.current;
    if (el) {
      el.value = '';
      el.click();
    }
  };
  const docRawForExport = (title: string, docId?: string): string | null => {
    if (docId) {
      // Prefer the prefetched full doc body: in backend (Supabase) mode the
      // localStorage `mindflow_doc_*` cache is empty, but `previewDocs` holds
      // the canonical doc (nodes/floats/lines/zones/…) loaded via the DocStore.
      const pre = state.previewDocs[docId];
      if (pre) return pre;
      const raw = readDocRaw(docId);
      if (raw) return raw;
    }
    return readDocRawByTitle(title);
  };
  /**
   * 내보내기용 **전체 본문**.
   *
   * 카드가 들고 있는 본문(`previewDocs`)은 썸네일 전송량을 아끼려고 이미지 데이터를
   * 자리표시 문자열로 **지운** 것이다(`preview_doc` RPC, 0012). 썸네일에는 그걸로
   * 충분하지만 내보내기는 실물이 필요하다 — 그대로 내보내면 JSON에는 `"img":"stripped"`가
   * 담기고(가져오면 깨진 이미지), PNG에는 빈 상자만 남는다(제보).
   *
   * 그래서 지워진 흔적이 보일 때만 전문을 다시 받는다 — 이미지가 없는 맵은 왕복 0회고,
   * 로컬/데모 모드의 본문은 애초에 지워지지 않아 그대로 쓴다.
   */
  const fullDocForExport = async (title: string, docId?: string): Promise<Doc | null> => {
    const raw = docRawForExport(title, docId);
    let doc: Doc | null = null;
    if (raw) {
      try {
        doc = parseDoc(JSON.parse(raw));
      } catch {
        doc = null;
      }
    }
    if (docId && doc && hasStrippedImage(doc)) {
      try {
        const loaded = await docStore.load(docId);
        if (loaded?.doc) doc = loaded.doc;
      } catch {
        /* 네트워크 실패 — 있는 본문으로라도 내보낸다(이미지만 빈다) */
      }
    }
    return doc;
  };
  function readDocRawByTitle(title: string): string | null {
    const direct = readDocRaw(mapId(title));
    if (direct) return direct;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mindflow_doc_')) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        try {
          const d = JSON.parse(raw) as { nodes?: { root?: { text?: string } } };
          if ((d.nodes?.root?.text || '').trim() === title.trim()) return raw;
        } catch {
          /* ignore malformed doc */
        }
      }
    } catch {
      /* localStorage unavailable */
    }
    return null;
  }

  const exportMap = (title: string, docId?: string) => {
    patch({ ctxMenu: null });
    const raw = docRawForExport(title, docId);
    const safe = safeFileName(title);
    if (raw) {
      // Re-serialize through the core so the download is the canonical doc
      // (nodes tree + floats/lines/zones), pretty-printed. Falls back to the
      // raw string if it isn't parseable as a MindFlow doc.
      void (async () => {
        // 썸네일 본문이 아니라 **전문**으로 내보낸다(`fullDocForExport`) — 미리보기
        // 본문은 이미지가 지워져 있어 그대로 담으면 가져오기에서 깨진 이미지가 된다.
        const doc = await fullDocForExport(title, docId);
        if (!doc) {
          downloadFile(safe + '.json', raw);
          return;
        }
        // 이미지 실물은 Storage에 있고 본문에는 참조만 있다 — 내보내는 파일이 그
        // 자체로 완결되게 다시 담는다(에디터 내보내기와 같은 규칙, `imageExport.ts`).
        const { doc: full, missing } = await inlineImagesForExport(doc, imageStore);
        downloadFile(safe + '.json', JSON.stringify(serializeDoc(full), null, 2));
        if (missing > 0) patch({ importError: `이미지 ${missing}장을 내보내기 파일에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` });
      })();
      return;
    }
    downloadFile(
      safe + '.json',
      JSON.stringify(
        { v: 1, nodes: { root: { id: 'root', text: title, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' },
        null,
        2,
      ),
    );
  };

  /**
   * 마크다운 개요(.md)로 내보낸다 — 코어 `toMarkdown`. 무손실 백업은 JSON이고 이건
   * 다른 도구로 옮기거나 사람이 읽는 용도다(가져오기가 이 형식을 되읽는다 —
   * 노트·자유 도형·메모까지, `parseOutline` 참고).
   *
   * 본문이 없으면 PNG와 같은 이유로 만들 수 없다(제목만으로는 개요가 없다) — 같은
   * 문구로 안내한다.
   */
  const exportMapMarkdown = (title: string, docId?: string) => {
    patch({ ctxMenu: null });
    const raw = docRawForExport(title, docId);
    const safe = safeFileName(title);
    let doc: Doc | null = null;
    if (raw) {
      try {
        doc = parseDoc(JSON.parse(raw));
      } catch {
        doc = null;
      }
    }
    if (!doc) {
      patch({ importError: '내용이 없어 개요를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    downloadFile(safe + '.md', toMarkdown(doc), 'text/markdown');
  };

  /** Render the map's real doc to a full-resolution PNG (shared editor renderer). */
  const exportMapPNG = (title: string, docId?: string) => {
    patch({ ctxMenu: null });
    const raw = docRawForExport(title, docId);
    if (!raw) {
      patch({ importError: '미리보기가 없어 이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    void (async () => {
      try {
        // JSON과 같은 이유로 **전문**이 필요하다 — 썸네일 본문으로 그리면 사진 자리가
        // 빈 상자로 남는다(제보).
        const doc = await fullDocForExport(title, docId);
        if (!doc) throw new Error('unparseable');
        // 이미지는 본문이 아니라 별도 저장소에 있다 — 그리기 전에 URL을 받아 둔다
        // (참조가 없는 문서면 빈 요청 없이 그냥 지나간다).
        const refs = collectImageRefs(doc);
        const urls = refs.length ? await imageStore.resolve(refs) : {};
        const { missingImages } = await exportDocPng(doc, themeOf(doc.themeKey), safeFileName(title), urls);
        if (missingImages > 0) patch({ importError: `이미지 ${missingImages}장을 PNG에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` });
      } catch {
        patch({ importError: '이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      }
    })();
  };

  /** 벡터 SVG(.svg) — 에디터 내보내기와 같은 장면 렌더러(`exportScene`). 파일이
   * 자족적이어야 하므로 이미지는 JSON과 같은 규칙으로 데이터 URL 인라인. */
  const exportMapSVG = (title: string, docId?: string) => {
    patch({ ctxMenu: null });
    const raw = docRawForExport(title, docId);
    if (!raw) {
      patch({ importError: '내용이 없어 이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    void (async () => {
      try {
        const doc = await fullDocForExport(title, docId);
        if (!doc) throw new Error('unparseable');
        const { doc: full, missing } = await inlineImagesForExport(doc, imageStore);
        exportDocSvg(full, themeOf(full.themeKey), safeFileName(title));
        if (missing > 0) patch({ importError: `이미지 ${missing}장을 SVG에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` });
      } catch {
        patch({ importError: '이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      }
    })();
  };

  /** 단일 페이지 PDF(.pdf) — PNG와 같은 캔버스 래스터를 임베드(인쇄·공유용). */
  const exportMapPDF = (title: string, docId?: string) => {
    patch({ ctxMenu: null });
    const raw = docRawForExport(title, docId);
    if (!raw) {
      patch({ importError: '내용이 없어 PDF를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    void (async () => {
      try {
        const doc = await fullDocForExport(title, docId);
        if (!doc) throw new Error('unparseable');
        const refs = collectImageRefs(doc);
        const urls = refs.length ? await imageStore.resolve(refs) : {};
        const { missingImages } = await exportDocPdf(doc, themeOf(doc.themeKey), safeFileName(title), urls);
        if (missingImages > 0) patch({ importError: `이미지 ${missingImages}장을 PDF에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` });
      } catch {
        patch({ importError: 'PDF를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      }
    })();
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
      const text = String(reader.result || '');
      type ImportedDoc = { nodes: Record<string, { text?: string; [k: string]: unknown }>; needsLayout?: boolean; [k: string]: unknown };
      let doc: ImportedDoc | null = null;
      let title = file.name.replace(/\.(json|md|markdown|txt)$/i, '');
      if (/\.json$/i.test(file.name)) {
        try {
          const d = JSON.parse(text) as { nodes?: { root?: { text?: string } }; kind?: string };
          // 유효 조건: 루트가 있는 맵 **또는** 화이트보드(kind='board' — 루트가
          // 없는 것이 정상이다). 보드 제목은 본문에 없으므로 파일명을 쓴다.
          if (d && d.nodes && (d.nodes.root || d.kind === 'board')) {
            doc = d as ImportedDoc;
            title = (d.nodes.root?.text || title).trim() || title;
          }
        } catch {
          /* not valid JSON */
        }
        if (!doc) {
          patch({ toast: '', importError: '올바른 Geurio JSON 파일이 아니에요' });
          return;
        }
        doc.needsLayout = false;
      } else {
        const parsed = parseOutline(text, title);
        if (!parsed) {
          patch({ importError: '가져올 수 있는 개요 항목을 찾지 못했어요' });
          return;
        }
        doc = parsed as unknown as ImportedDoc;
        title = rootTextOf(parsed) || title;
      }
      if (!doc) return;
      const sp = state.spaces.find((s) => s.id === state.activeSpace) || state.spaces[0];
      const existing = new Set((sp?.maps || []).map((m) => m.title));
      let finalTitle = title;
      let i = 2;
      while (existing.has(finalTitle) || localStorage.getItem(docKey(mapId(finalTitle)))) {
        finalTitle = `${title} (${i++})`;
        if (i > 50) break;
      }
      if (finalTitle !== title && doc.nodes.root) doc.nodes.root.text = finalTitle;

      // 가져온 맵도 **다른 맵과 똑같이 백엔드에 올린다.** 예전엔 localStorage에만
      // 썼다. 카드(워크스페이스 블롭)는 동기화되니 다른 기기에도 보이는데 본문이
      // 없어서, 거기서 열면 에디터가 "새 문서"로 판단해 **빈 seed를 저장**하고,
      // 이후 원래 기기에서 열면 그 빈 문서를 내려받아 로컬 본문까지 덮어썼다
      // (= 가져온 내용이 사라지는 경로).
      //
      // id는 `mapId(제목)`이 아니라 새로 만들기와 같은 **랜덤 id**다. 제목 해시를 쓰면
      // 두 기기에서 같은 제목을 가져올 때 같은 행을 두고 다투게 된다(뒤에 저장한 쪽이
      // 앞의 내용을 지운다). 랜덤 id면 그 상황 자체가 생기지 않는다.
      const parsedDoc = parseDoc(doc);
      if (!parsedDoc) {
        patch({ toast: '', importError: '올바른 Geurio JSON 파일이 아니에요' });
        return;
      }
      // `createOnly`로 "없을 때만 만들기". 랜덤 id라 충돌은 사실상 없지만, 그 가정이
      // 깨져도 남의 문서를 덮지 않고 새 id로 다시 시도한다(내용 손실 0).
      let docId = '';
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = newDocId();
        const res = await docStore.save(candidate, parsedDoc, { title: finalTitle, createOnly: true });
        if (res.ok) {
          docId = candidate;
          break;
        }
        if (res.reason === 'error') lastError = res.message;
        // conflict면 다음 후보 id로 재시도한다.
      }
      if (!docId) {
        // 저장이 확인되지 않았으면 카드를 만들지 않는다 — 본문 없는 카드를 남기면
        // 다른 기기에서 그걸 열었을 때 위에 적은 손실 경로가 열린다.
        patch({ toast: '', importError: lastError ? `가져오기를 저장하지 못했어요. ${lastError}` : '가져오기를 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.' });
        return;
      }
      // 로컬 캐시(복구본 + 다음 열기 즉시 렌더). 백엔드 저장이 확인된 뒤에만 쓴다.
      try {
        localStorage.setItem(docKey(docId), JSON.stringify(serializeDoc(parsedDoc)));
      } catch {
        /* storage unavailable */
      }
      setState((prev) => {
        const target = prev.spaces.find((s) => s.id === prev.activeSpace) || prev.spaces[0];
        if (!target) return prev;
        const spaces = prev.spaces.map((s) => (s.id === target.id ? { ...s, maps: [...(s.maps || []), { title: finalTitle, when: '방금 가져옴', hue: '#f0663f', docId }] } : s));
        // 폴더 안에서 가져왔으면 그 폴더에 넣는다 — 안 그러면 스페이스 최상위로
        // 떨어져서, 보고 있는 폴더에는 **아무것도 나타나지 않는다**(가져오기가
        // 실패한 것처럼 보임). `registerCard`의 "새로 만들기"와 같은 규칙이다.
        // 배정 키는 docId다(`cardKeyOf`) — 제목 키는 제목이 겹치면 서로 가로챈다.
        let mapFolders = prev.mapFolders;
        let importDoneFolder: string | null = null;
        if (prev.curFolder) {
          const folders = Array.isArray(target.folders) ? target.folders : [];
          const open = folders.find((f) => f.id === prev.curFolder);
          if (open) {
            mapFolders = { ...prev.mapFolders, [cardKeyOf(finalTitle, docId)]: open.id };
            importDoneFolder = open.name;
          }
        }
        return { ...prev, spaces, mapFolders, activeSpace: target.id, importDone: finalTitle, importDoneFolder };
      });
      })();
    };
    reader.readAsText(file);
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleImport(f);
  };

  // ---- 맵 이름 변경 ----
  //
  // 맵의 이름은 두 곳에 있다: 목록이 읽는 **메타 제목**과, 에디터가 그리는 **루트
  // 도형의 글자**. 둘 중 하나만 바꾸면 어긋난다 — 메타만 고치면 열자마자 옛 이름이
  // 보이고, 다음 저장이 그 옛 이름을 메타에 도로 써 버린다. 그래서 본문까지 함께
  // 고친다(에디터에서 제목을 고칠 때와 같은 결과).
  //
  // docId가 없는 옛 카드는 **제목이 곧 식별자**라 이름을 바꾸면 그 카드를 잃는다 —
  // 그런 카드에는 메뉴 항목 자체를 내주지 않는다(`showRenameRow`).
  const findCardByKey = (key: string) => {
    for (const sp of state.spaces) {
      for (const m of sp.maps || []) {
        if (cardKeyOf(m.title, m.docId) === key) return m;
      }
    }
    return null;
  };
  const startRenameMap = (key: string) => {
    const card = findCardByKey(key);
    if (!card?.docId) return;
    patch({ renameMap: { key, docId: card.docId, name: card.title }, ctxMenu: null });
  };
  const closeRenameMap = () => patch({ renameMap: null });

  /**
   * 공유 팝업(카드 메뉴 → 공유) — 맵을 열지 않고 바로 초대한다.
   *
   * 팝업은 에디터가 쓰는 `ShareModal` **그대로**다(색만 홈 테마로 넘긴다). 그리드의
   * 카드는 언제나 내 맵이므로 `readOnly`는 아니다 — 공유받은 맵은 LNB 목록에만 있다.
   */
  const openShareFor = (docId: string) => patch({ shareDocId: docId, ctxMenu: null });
  const closeShare = () => {
    patch({ shareDocId: null });
    // 팝업에서 방금 초대를 걸거나 링크를 켰을 수 있다 — 카드 표식을 새로 읽는다.
    void shareStore.listSharedByMe().then((sharedByMe) => {
      if (mountedRef.current) patch({ sharedByMe });
    });
  };
  const onRenameMapName = (v: string) => setState((prev) => (prev.renameMap ? { ...prev, renameMap: { ...prev.renameMap, name: v.slice(0, 40), error: undefined } } : prev));

  /** 본문 루트 글자 + 메타 제목을 함께 바꾼다. 충돌하면 최신 판으로 한 번 다시 시도. */
  const applyMapTitle = async (docId: string, title: string): Promise<boolean> => {
    const writeBody = async (attempt: number): Promise<boolean> => {
      const loaded = await docStore.load(docId);
      // 본문이 없는 문서(아직 한 번도 저장 안 됨)는 메타 이름만 바꾼다.
      if (!loaded) {
        await docStore.rename(docId, title);
        return true;
      }
      const root = loaded.doc.nodes[ROOT_ID];
      if (!root) {
        await docStore.rename(docId, title);
        return true;
      }
      const next: Doc = { ...loaded.doc, nodes: { ...loaded.doc.nodes, [ROOT_ID]: { ...root, text: title } } };
      const res = await docStore.save(docId, next, { prevVersion: loaded.version, title });
      if (res.ok) {
        try {
          localStorage.setItem(docKey(docId), JSON.stringify(serializeDoc(next)));
        } catch {
          /* storage unavailable */
        }
        return true;
      }
      // 다른 기기/탭이 먼저 저장했다 → 그 판을 받아 한 번만 다시 시도한다.
      if (res.reason === 'conflict' && attempt === 0) return writeBody(1);
      return false;
    };
    try {
      return await writeBody(0);
    } catch {
      return false;
    }
  };

  const saveRenameMap = () => {
    const rm = state.renameMap;
    if (!rm || rm.saving) return;
    const title = rm.name.trim();
    if (!title) return;
    const current = findCardByKey(rm.key);
    if (current && current.title === title) {
      patch({ renameMap: null });
      return;
    }
    patch({ renameMap: { ...rm, saving: true, error: undefined } });
    void (async () => {
      const ok = await applyMapTitle(rm.docId, title);
      if (!ok) {
        setState((prev) => (prev.renameMap ? { ...prev, renameMap: { ...prev.renameMap, saving: false, error: '이름을 바꾸지 못했어요. 연결을 확인하고 다시 시도해 주세요.' } } : prev));
        return;
      }
      setState((prev) => ({
        ...prev,
        renameMap: null,
        spaces: prev.spaces.map((sp) => ({ ...sp, maps: (sp.maps || []).map((m) => (cardKeyOf(m.title, m.docId) === rm.key ? { ...m, title } : m)) })),
      }));
    })();
  };
  const onRenameMapKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRenameMap();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeRenameMap();
    }
  };

  // ---- folders ----
  const activeFolders = () => {
    const sp = state.spaces.find((s) => s.id === state.activeSpace);
    return sp && Array.isArray(sp.folders) ? sp.folders : [];
  };
  const mutateFolders = (spaces: HomeState['spaces'], fn: (folders: NonNullable<HomeState['spaces'][number]['folders']>) => NonNullable<HomeState['spaces'][number]['folders']>) =>
    spaces.map((s) => (s.id === state.activeSpace ? { ...s, folders: fn(Array.isArray(s.folders) ? s.folders : []) } : s));

  const openNewFolder = () => patch({ folderModal: { mode: 'new', id: null, name: '', drive: state.activeSpace === 'drive' } });
  const startRenameFolder = (id: string) => {
    const f = activeFolders().find((x) => x.id === id);
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '' }, ctxMenu: null });
  };
  const closeFolderModal = () => patch({ folderModal: null });
  const isDriveFolderId = (id: string) => state.driveFolders.some((f) => f.id === id);
  const onFolderModalName = (v: string) => setState((prev) => (prev.folderModal ? { ...prev, folderModal: { ...prev.folderModal, name: v.slice(0, 10) } } : prev));
  const onFolderModalKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveFolderModal();
  };
  const saveFolderModal = () => {
    const fm = state.folderModal;
    if (!fm) return;
    const name = fm.name.trim().slice(0, 10);
    if (!name) return;
    const isDrive = fm.drive || (fm.id != null && isDriveFolderId(fm.id));
    if (fm.mode === 'new') {
      if (isDrive) {
        const id = 'df' + Date.now().toString(36);
        setState((prev) => ({ ...prev, driveFolders: [...prev.driveFolders, { id, name }], folderModal: null }));
      } else {
        const id = 'f' + Date.now().toString(36);
        setState((prev) => {
          // 폴더 안에서 만들면 현재 폴더가 부모(중첩 폴더). 최상위면 parent 없음.
          const sp = prev.spaces.find((s) => s.id === prev.activeSpace);
          const fs = sp && Array.isArray(sp.folders) ? sp.folders : [];
          const parent = prev.curFolder && fs.some((f) => f.id === prev.curFolder) ? prev.curFolder : undefined;
          return { ...prev, spaces: mutateFolders(prev.spaces, (list) => [...list, parent ? { id, name, parent } : { id, name }]), folderModal: null };
        });
      }
    } else if (isDrive) {
      setState((prev) => ({ ...prev, driveFolders: prev.driveFolders.map((f) => (f.id === fm.id ? { ...f, name } : f)), folderModal: null }));
    } else {
      setState((prev) => ({ ...prev, spaces: mutateFolders(prev.spaces, (fs) => fs.map((f) => (f.id === fm.id ? { ...f, name } : f))), folderModal: null }));
    }
  };
  const startRenameDriveFolder = (id: string) => {
    const f = state.driveFolders.find((x) => x.id === id);
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '', drive: true } as FolderModalState, ctxMenu: null });
  };
  const folderCount = (id: string) => {
    // Count from the ACTUAL maps (assignments are docId-keyed via cardKeyOf,
    // so key iteration can't be resolved back to titles). Trashed maps are
    // removed from `spaces`, so no deleted-check is needed.
    let n = 0;
    state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
      if (state.mapFolders[cardKeyOf(m.title, m.docId)] === id) n++;
    }));
    return n;
  };
  const driveFolderCount = (id: string) => {
    const mf = state.driveMapFolders;
    return DRIVE_FILES.filter((f) => mf[f.name] === id && !state.deleted[f.name]).length;
  };
  /** 삭제 확인창이 보여 줄 내용 — 이 폴더에 **직접** 담긴 맵 수와 직속 하위 폴더 수,
   * 그리고 그것들이 올라갈 자리의 이름. 폴더는 이름표일 뿐이라 지워도 안의 것은
   * 지우지 않는다(아래 `confirmDeleteFolderYes`). */
  const folderDeleteSummary = (id: string): { name: string; maps: number; folders: number; upName: string } => {
    const isDrive = isDriveFolderId(id);
    if (isDrive) {
      const f = state.driveFolders.find((x) => x.id === id);
      return { name: f?.name || '', maps: driveFolderCount(id), folders: 0, upName: 'Google Drive' };
    }
    const fs = activeFolders();
    const f = fs.find((x) => x.id === id);
    const parent = f?.parent ? fs.find((x) => x.id === f.parent) : null;
    const sp = state.spaces.find((s) => s.id === state.activeSpace);
    return {
      name: f?.name || '',
      maps: folderCount(id),
      folders: fs.filter((x) => (x.parent ?? null) === id).length,
      upName: parent ? parent.name : sp?.name || '스페이스',
    };
  };
  // 내용이 있어도 삭제할 수 있다(요청) — 안의 맵·하위 폴더는 지워지지 않고 한 단계
  // 위로 올라온다(아래 `confirmDeleteFolderYes`). 폴더는 맵을 담는 그릇이 아니라
  // **이름표**라, 이름표를 떼는 일이 내용을 지울 이유가 되지 않는다.
  const askDeleteFolder = (id: string) => patch({ confirmDeleteFolder: id, ctxMenu: null });
  const cancelDeleteFolder = () => patch({ confirmDeleteFolder: null });
  const confirmDeleteFolderYes = () => {
    const id = state.confirmDeleteFolder;
    if (!id) return;
    if (isDriveFolderId(id)) {
      setState((prev) => {
        const driveMapFolders = { ...prev.driveMapFolders };
        for (const t in driveMapFolders) if (driveMapFolders[t] === id) delete driveMapFolders[t];
        return {
          ...prev,
          driveFolders: prev.driveFolders.filter((f) => f.id !== id),
          driveMapFolders,
          confirmDeleteFolder: null,
          driveFolder: prev.driveFolder === id ? null : prev.driveFolder,
        };
      });
      return;
    }
    setState((prev) => {
      const sp = prev.spaces.find((s) => s.id === prev.activeSpace);
      const fs = sp && Array.isArray(sp.folders) ? sp.folders : [];
      // 지운 폴더의 자리 = 그 부모(없으면 최상위). 안에 있던 것들이 여기로 올라온다.
      const up = fs.find((f) => f.id === id)?.parent ?? null;
      const mapFolders = { ...prev.mapFolders };
      for (const t in mapFolders) {
        if (mapFolders[t] !== id) continue;
        if (up) mapFolders[t] = up;
        else delete mapFolders[t]; // 최상위로
      }
      return {
        ...prev,
        spaces: mutateFolders(prev.spaces, (list) =>
          list
            .filter((f) => f.id !== id)
            // 직속 하위 폴더도 한 단계 올라온다 — 고아가 되지 않는다.
            .map((f) => ((f.parent ?? null) === id ? { ...f, parent: up ?? undefined } : f)),
        ),
        mapFolders,
        confirmDeleteFolder: null,
        curFolder: prev.curFolder === id ? up : prev.curFolder,
      };
    });
  };
  const moveMapToFolder = (key: string, folderId: string | null) => {
    if (state.activeSpace === 'drive') {
      setState((prev) => {
        // Drive demo files have no docId, so their key IS the title.
        const driveMapFolders = { ...prev.driveMapFolders };
        if (folderId) driveMapFolders[key] = folderId;
        else delete driveMapFolders[key];
        return { ...prev, driveMapFolders, ctxMenu: null };
      });
      return;
    }
    setState((prev) => {
      // `key` (cardKeyOf — carried by the card and the drag payload) IS the
      // mapFolders key, so the assignment binds exactly one doc even among
      // duplicate titles.
      const mapFolders = { ...prev.mapFolders };
      if (folderId) mapFolders[key] = folderId;
      else delete mapFolders[key];
      return { ...prev, mapFolders, ctxMenu: null };
    });
  };
  /**
   * 상위 폴더 타일에 드롭 — 지금 폴더의 **부모**(없으면 최상위)로 옮긴다.
   * 아래로 넣는 길(폴더 카드에 드롭)과 대칭인 위로 꺼내는 길이다(요청).
   */
  const moveMapUp = (key: string) => {
    if (state.activeSpace === 'drive') {
      moveMapToFolder(key, null); // Drive 데모 폴더는 한 단계뿐
      return;
    }
    const fs = activeFolders();
    const cur = state.curFolder ? fs.find((f) => f.id === state.curFolder) : null;
    const parent = cur?.parent && fs.some((f) => f.id === cur.parent) ? cur.parent : null;
    moveMapToFolder(key, parent);
  };
  /** Move a map from its current (real, non-Drive) space to another space. The
   * card moves to the target space's top level, and its per-space folder
   * assignment is dropped (folders belong to a single space). */
  const moveMapToSpace = (key: string, spaceId: string) => {
    setState((prev) => {
      // Resolve by card KEY so exactly ONE doc moves even among duplicate titles.
      const byKey = (m: { title: string; docId?: string }) => cardKeyOf(m.title, m.docId) === key;
      const src = prev.spaces.find((s) => Array.isArray(s.maps) && s.maps.some(byKey));
      const target = prev.spaces.find((s) => s.id === spaceId);
      // no-op if the map isn't in a real space, the target is gone, or it's already there
      if (!src || !target || src.id === spaceId) return { ...prev, ctxMenu: null };
      const card = (src.maps || []).find(byKey);
      if (!card) return { ...prev, ctxMenu: null };
      const spaces = prev.spaces.map((s) => {
        if (s.id === src.id) return { ...s, maps: (s.maps || []).filter((m) => !byKey(m)) };
        if (s.id === spaceId) return { ...s, maps: [...(s.maps || []), card] };
        return s;
      });
      const mapFolders = { ...prev.mapFolders };
      delete mapFolders[key];
      return { ...prev, spaces, mapFolders, ctxMenu: null, toast: `'${card.title}'을(를) '${target.name}' 스페이스로 옮겼어요`, toastTitle: '이동 완료' };
    });
  };
  // 뒤로가기 = 한 계층 위로: 하위 폴더 안이면 상위 폴더로, 최상위 폴더면 스페이스로.
  const backToSpace = () =>
    setState((prev) => {
      const sp = prev.spaces.find((s) => s.id === prev.activeSpace);
      const fs = sp && Array.isArray(sp.folders) ? sp.folders : [];
      const cur = prev.curFolder ? fs.find((f) => f.id === prev.curFolder) : null;
      const parent = cur?.parent && fs.some((f) => f.id === cur.parent) ? cur.parent : null;
      return { ...prev, curFolder: parent, driveFolder: null, ctxMenu: null };
    });
  const openFolder = (id: string) => patch({ curFolder: id, ctxMenu: null });
  const openDriveFolder = (id: string) => patch({ driveFolder: id, ctxMenu: null });

  // ---- drag & drop ----
  const setDraggingMap = (title: string | null) => patch({ draggingMap: title, ctxMenu: null });
  const clearDrag = () => patch({ draggingMap: null, dragOverFolder: null });
  const setDragOverFolder = (id: string | null) => {
    if (state.dragOverFolder !== id) patch({ dragOverFolder: id });
  };

  // ---- selection / search ----
  const selectCard = (title: string | null) => patch({ selectedCard: title });

  /**
   * 검색 입력 — 글자는 즉시 보이고(`searchInput`), **적용**은 입력이 잠깐 멎은
   * 뒤에 한다(`search`).
   *
   * 왜 디바운스인가(실측): 검색 계산 자체는 맵 수와 거의 무관하게 싸다(본문 파싱은
   * docId 캐시라 한 번뿐). 값비싼 것은 **결과가 바뀔 때 카드 목록을 다시 그리는
   * 것**이고, 그건 한 글자마다 일어날 이유가 없다. 맵 150개에서 키 입력당 59~83ms가
   * 들고 롱태스크가 잡혔다 — 타이핑 도중의 중간 결과는 아무도 읽지 않으므로 그냥
   * 건너뛴다.
   *
   * 비우기는 **즉시** 적용한다 — 지운 뒤에도 결과 화면이 남아 있으면 고장으로 읽힌다.
   */
  const applySearchNow = (v: string) => {
    clearTimeout(searchTimer.current);
    patch({ searchInput: v, search: v });
  };
  const setSearch = (v: string) => {
    clearTimeout(searchTimer.current);
    if (!v.trim()) {
      patch({ searchInput: v, search: v });
      return;
    }
    patch({ searchInput: v });
    searchTimer.current = setTimeout(() => setState((prev) => (prev.searchInput === v ? { ...prev, search: v } : prev)), SEARCH_DEBOUNCE_MS);
  };
  /** Enter(또는 입력창을 벗어남) — 기다리지 않고 바로 적용한다. */
  const flushSearch = () => applySearchNow(state.searchInput);

  return {
    state,
    importInputRef,
    setImportRef,
    onDriveClick,
    openDriveAuth,
    closeAuth,
    chooseAccount,
    disconnectDrive,
    toggleSettings,
    openProfileNameEdit,
    onProfileNameInput,
    onProfileNameKey,
    submitProfileName,
    cancelProfileName,
    logout,
    cancelLogout,
    confirmLogoutYes,
    openAccountSettings,
    openFeedback,
    closeFeedback,
    setTheme,
    closeAccountSettings,
    askDeleteAccount,
    cancelDeleteAccount,
    onDeleteAccountInput,
    confirmDeleteAccountYes,
    openNewSpace,
    closeNewSpace,
    onNewSpaceName,
    onNewSpaceKey,
    submitSpace,
    pickSpaceColor,
    setActiveSpace,
    startRenameSpace,
    askDeleteSpace,
    cancelDeleteSpace,
    confirmDeleteSpaceYes,
    toggleFav,
    toggleFavList,
    toggleSharedList,
    openCtxMenu,
    openCtxMenuAt,
    closeMenu,
    askDelete,
    cancelDelete,
    confirmDeleteYes,
    deleteCard,
    toggleTrashList,
    toggleRecentList,
    askRestore,
    cancelRestore,
    confirmRestoreYes,
    restoreCard,
    askPurge,
    cancelPurge,
    confirmPurgeYes,
    askEmptyTrash,
    cancelEmptyTrash,
    confirmEmptyTrashYes,
    closeToast,
    recordRecent,
    mapHref,
    newMapHref,
    openTemplates,
    closeTemplates,
    createFromTemplate,
    openWithLoader,
    openSharedMap,
    onNewMapClick,
    openImport,
    onImportFile,
    exportMap,
    exportMapMarkdown,
    exportMapPNG,
    exportMapSVG,
    exportMapPDF,
    activeFolders,
    openNewFolder,
    startRenameMap,
    closeRenameMap,
    openShareFor,
    closeShare,
    onRenameMapName,
    onRenameMapKey,
    saveRenameMap,
    startRenameFolder,
    startRenameDriveFolder,
    closeFolderModal,
    isDriveFolderId,
    onFolderModalName,
    onFolderModalKey,
    saveFolderModal,
    folderCount,
    driveFolderCount,
    askDeleteFolder,
    cancelDeleteFolder,
    confirmDeleteFolderYes,
    moveMapToFolder,
    moveMapUp,
    folderDeleteSummary,
    backToSpace,
    openFolder,
    openDriveFolder,
    setDraggingMap,
    clearDrag,
    setDragOverFolder,
    selectCard,
    moveMapToSpace,
    setSearch,
    flushSearch,
  };
}

export type HomeController = ReturnType<typeof useHomeController>;
