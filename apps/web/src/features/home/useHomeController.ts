import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import { exportDocPng } from '../editor/png';
import { themeOf } from '../editor/theme';
import { useBackend } from '../../adapters/BackendContext';
import {
  DRIVE_FILES,
  initialHomeState,
  type FolderModalState,
  type HomeState,
} from './types';
import {
  coerceSpaces,
  docKey,
  downloadFile,
  ensureHomeSpace,
  loadActiveView,
  loadRecent,
  saveActiveView,
  mapId,
  mapHref as buildMapHref,
  mergeDocMetasIntoSpaces,
  mergeRecent,
  newMapHref as buildNewMapHref,
  parseOutline,
  readDocRaw,
  readSavedProfileName,
  rootTextOf,
  safeFileName,
  saveRecent,
  seedFavAndTrashFromMetas,
  sourceOf,
  uniqueTitle,
  writeSavedProfileName,
} from './storage';

/**
 * React port of Home.dc.html's `class Component extends DCLogic`. Every exported
 * method below corresponds 1:1 to a method on the original controller; `patch()`
 * stands in for `this.setState`. `renderVals()`'s derived fields live in `viewModel.ts`.
 */
export function useHomeController() {
  const [state, setState] = useState<HomeState>(() => initialHomeState());
  const navigate = useNavigate();
  const { auth, docStore, spaceStore } = useBackend();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const loaderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spaceMenuAnchor = useRef<{ top: number; left: number } | null>(null);
  // docIds whose body we've already fetched (or are fetching) for card previews,
  // so the prefetch effect never re-requests the same doc.
  const previewFetchedRef = useRef<Set<string>>(new Set());
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
  // back empty and only the default 일반 공간 shows (a manual refresh then works,
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
    const res = await Promise.allSettled([spaceStore.load(), docStore.list()]);
    if (!mountedRef.current) return;
    // Only allow persisting the workspace once the load actually SUCCEEDED. If
    // it rejected (network/RLS/transient), we must not save — otherwise the
    // default-seed fallback below would clobber the user's stored spaces.
    canPersistWorkspaceRef.current = res[0].status === 'fulfilled';
    const ws = res[0].status === 'fulfilled' ? res[0].value : null;
    const metas = res[1].status === 'fulfilled' ? res[1].value : [];
    if (ws && Array.isArray(ws.spaces)) workspaceLoadedRef.current = true;
    setState((prev) => {
      let base = prev.spaces;
      let mapFolders = prev.mapFolders;
      if (ws && Array.isArray(ws.spaces)) {
        base = ensureHomeSpace(coerceSpaces(ws.spaces));
        if (ws.mapFolders && Object.keys(ws.mapFolders).length) mapFolders = ws.mapFolders;
      }
      const { spaces, renamed } = mergeDocMetasIntoSpaces(base, metas);
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
      const recent = mergeRecent(prev.recent, ws?.recent);
      // Baseline the just-hydrated workspace so the save effect treats it as
      // already-persisted (no re-save of what we just loaded/seeded).
      savedWorkspaceSigRef.current = JSON.stringify({ spaces, mapFolders, recent });
      // Always flip `loaded` so the grid drops its loading skeleton and
      // renders the real (possibly empty) state.
      return { ...prev, spaces, activeSpace, curFolder, mapFolders, favs, deleted, trash, recent, loaded: true };
    });
  }, [docStore, spaceStore]);

  // ---- mount: restore recent list, pick up docs saved from the editor ----
  useEffect(() => {
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const closest = (sel: string) => !!(target && target.closest && target.closest(sel));
      setState((prev) => {
        let next = prev;
        if (prev.openMenu && !closest('.menu-btn,.menu-row')) next = { ...next, openMenu: null, moveFor: null, moveSpaceFor: null, exportFor: null };
        if (prev.selectedCard && !closest('.map-card')) next = { ...next, selectedCard: null };
        if (prev.settingsOpen && !closest('.settings-pop,.settings-btn')) next = { ...next, settingsOpen: false };
        if (prev.spaceMenu && !closest('.space-dot,.menu-row,.space-row')) next = { ...next, spaceMenu: null };
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

    const recent = loadRecent();
    if (recent.length) patch({ recent });

    // Kick off the initial workspace + doc hydration (see `hydrateFromBackend`).
    void hydrateFromBackend();

    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('pageshow', onPageShow);
      clearTimeout(loaderTimer.current);
    };
  }, [hydrateFromBackend]);

  // Track mounted state so a late hydrate/resync never `setState`s after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cross-device first-login fix: re-hydrate ONCE when auth first confirms a
  // session. On a fresh login the mount hydrate above can run before Supabase has
  // applied the session token, so its RLS-scoped reads return empty and only the
  // default 일반 공간 shows until a manual refresh. `onAuthChange` fires an
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
      if (!email) return;
      // Show the locally-cached name (or email default) immediately, no flash…
      const name0 = readSavedProfileName(email) || email.split('@')[0] || email;
      setState((prev) => ({ ...prev, userEmail: email, userName: name0 }));
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
  // Scope: only the CURRENTLY-ACTIVE space's maps — those are the only cards that
  // render a real preview (the grid shows the active space; recent cards are a
  // subset of it; folder cards are folder thumbnails; favorites/trash are text
  // lists). This avoids firing one request per map across the WHOLE workspace on
  // home load (a fan-out that scaled badly with many maps). Switching spaces
  // re-runs this and prefetches that space on demand (`state.activeSpace` dep).
  useEffect(() => {
    if (!state.loaded) return;
    const active = state.spaces.find((s) => s.id === state.activeSpace);
    const ids = Array.from(new Set((Array.isArray(active?.maps) ? active!.maps : []).map((m) => m.docId).filter((id): id is string => !!id))).filter(
      (id) => !previewFetchedRef.current.has(id),
    );
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
    void Promise.allSettled(ids.map((id) => docStore.load(id))).then((results) => {
      if (!mountedRef.current) return;
      const add: Record<string, string> = {};
      const resolved: Record<string, boolean> = {};
      results.forEach((r, i) => {
        const id = ids[i]!;
        resolved[id] = true; // resolved (whether or not a body came back)
        if (r.status === 'fulfilled' && r.value) {
          try {
            // `LoadedDoc.doc` is already the canonical persisted shape (nodes/
            // floats/lines/zones/layoutMode/themeKey) that `realPreview` parses.
            add[id] = JSON.stringify(r.value.doc);
          } catch {
            /* non-serializable doc — skip; card keeps the generic sketch */
          }
        }
      });
      // Mark the batch resolved even when nothing loaded, so cards for those
      // docs stop showing the loading skeleton and settle on their final preview.
      setState((prev) => ({ ...prev, previewDocs: { ...prev.previewDocs, ...add }, previewResolved: { ...prev.previewResolved, ...resolved } }));
    });
  }, [state.loaded, state.spaces, state.activeSpace, docStore]);

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
    const sig = JSON.stringify({ spaces: state.spaces, mapFolders: state.mapFolders, recent: state.recent });
    if (sig === savedWorkspaceSigRef.current) return;
    savedWorkspaceSigRef.current = sig;
    // A genuine user change is being persisted — from here on the auth-confirmed
    // resync must NOT re-hydrate (it would clobber this edit with backend state).
    workspaceMutatedRef.current = true;
    // `recent` rides along in the same per-user blob (opening a map bumps it), so
    // the recent-items list syncs across devices just like spaces/folders do.
    void spaceStore.save({ spaces: state.spaces, mapFolders: state.mapFolders, recent: state.recent }).catch(() => {
      /* save failed (offline, RLS, ...) — non-fatal; the next change retries */
    });
  }, [state.loaded, state.spaces, state.mapFolders, state.recent, spaceStore]);

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
  // Profile-name rename — a popup (like "공간 이름 변경"), driven by a draft so
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
  // The "새 공간 만들기" modal doubles as the rename dialog: `editingSpace === null`
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
  const toggleSpaceMenu = (id: string, anchor?: { top: number; left: number }) => {
    if (anchor) spaceMenuAnchor.current = anchor;
    patch({ spaceMenu: state.spaceMenu === id ? null : id });
  };
  /** Rename now opens the shared "새 공간 만들기" popup in EDIT mode (name + color),
   * pre-filled from the space — instead of an inline sidebar input. */
  const startRenameSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    if (!sp) return;
    patch({ newSpaceOpen: true, editingSpace: id, newSpaceName: sp.name, newSpaceColor: sp.color || '#f0663f', spaceMenu: null });
  };
  const askDeleteSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    if (!sp || (Array.isArray(sp.maps) && sp.maps.some((m) => !state.deleted[m.title]))) return;
    if (state.spaces.length <= 1) return;
    patch({ confirmDeleteSpace: id, spaceMenu: null });
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
    const nextFav = !state.favs[title];
    setState((prev) => {
      const favs = { ...prev.favs, [title]: !prev.favs[title] };
      if (!favs[title]) delete favs[title];
      return { ...prev, favs };
    });
    if (docId) {
      void docStore.setFavorite(docId, nextFav).catch(() => {
        /* backend unreachable — local state already flipped, non-fatal */
      });
    }
  };
  const toggleFavList = () => patch({ favOpen: !state.favOpen });
  const toggleMenu = (title: string) => patch({ openMenu: state.openMenu === title ? null : title, moveFor: null, moveSpaceFor: null, exportFor: null });
  const closeMenu = () => patch({ openMenu: null, moveFor: null, moveSpaceFor: null, exportFor: null });
  const askDelete = (title: string, docId?: string) => patch({ confirmDelete: title, confirmDeleteDocId: docId ?? null, openMenu: null });
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
      const folder = prev.mapFolders[title];
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
      delete mapFolders[title];
      const deleted = { ...prev.deleted, [title]: true };
      const favs = { ...prev.favs };
      delete favs[title];
      const src = sourceOf(title, DRIVE_FILES);
      const trash = prev.trash.some((t) => t.title === title) ? prev.trash : [...prev.trash, { title, source: src, docId: docId ?? undefined, spaceId, folder }];
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
      delete favs[title];
      return { ...prev, deleted, favs, openMenu: null };
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
    setState((prev) => {
      const deleted = { ...prev.deleted };
      delete deleted[title];
      const trash = prev.trash.filter((t) => t.title !== title);
      const isDriveFile = DRIVE_FILES.some((f) => f.name === title);
      let spaces = prev.spaces;
      let mapFolders = prev.mapFolders;
      let toast = '';
      const present = (m: { title: string; docId?: string }) => (docId ? m.docId === docId : m.title === title);
      if (!isDriveFile && !spaces.some((s) => Array.isArray(s.maps) && s.maps.some(present))) {
        // Prefer the origin space captured at delete time; fall back to the home
        // space (then the first) if it's gone.
        const origin = entry?.spaceId && spaces.some((s) => s.id === entry.spaceId) ? entry.spaceId : undefined;
        const targetId = origin ?? spaces.find((s) => s.home)?.id ?? spaces[0]?.id;
        const target = spaces.find((s) => s.id === targetId);
        if (target) {
          spaces = spaces.map((s) => (s.id === targetId ? { ...s, maps: [...(s.maps || []), { title, when: '방금 복원됨', hue: '#f0663f', docId: docId ?? undefined }] } : s));
          // restore the folder assignment too, if that folder still exists
          if (entry?.folder && Array.isArray(target.folders) && target.folders.some((f) => f.id === entry.folder)) {
            mapFolders = { ...mapFolders, [title]: entry.folder };
          }
          if (!origin) toast = `원래 공간이 삭제되어 "${target.name}" 공간으로 복원했어요`;
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
  const restoreCard = (title: string, docId?: string) => {
    setState((prev) => {
      const deleted = { ...prev.deleted };
      delete deleted[title];
      const trash = prev.trash.filter((t) => t.title !== title);
      return { ...prev, deleted, trash };
    });
    if (docId) {
      void docStore.restore(docId).catch(() => {
        /* backend unreachable — local state already restored it, non-fatal */
      });
    }
  };
  const closeToast = () => patch({ toast: '', toastTitle: '', importDone: null, importError: null });

  const recordRecent = (title: string) => {
    setState((prev) => {
      const recent = [title, ...prev.recent.filter((t) => t !== title)].slice(0, 4);
      saveRecent(recent);
      return { ...prev, recent };
    });
  };

  // ---- open / create maps ----
  const mapHref = (title: string, docId?: string) => buildMapHref(title, docId);
  /** A new map gets an auto-uniquified default title ("새 마인드맵", "새 마인드맵_1",
   * …) so it never collides with an existing map's filename — Home dedups cards
   * by title, so a colliding new map would otherwise be hidden/overwritten. */
  const newMapHref = () => {
    const taken: string[] = [];
    state.spaces.forEach((s) => (s.maps || []).forEach((m) => taken.push(m.title)));
    state.trash.forEach((t) => taken.push(t.title));
    return buildNewMapHref(uniqueTitle('새 마인드맵', taken));
  };

  const navigateAfterLoader = (href: string, msg: string) => {
    patch({ creatingMap: true, loaderMsg: msg });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => navigate(href), 900);
  };

  /** Home.dc.html `openWithLoader(e, title)` — records recent, shows the loader, then navigates. */
  const openWithLoader = (href: string, title: string) => {
    recordRecent(title);
    navigateAfterLoader(href, '맵을 불러오고 있어요');
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
    try {
      const params = new URLSearchParams(href.split('?')[1] || '');
      const docId = params.get('map') || '';
      const title = params.get('title') ? decodeURIComponent(params.get('title') as string) : '새 마인드맵';
      if (docId) {
        setState((prev) => {
          // active space if it's a real space (not the Drive view); else home.
          const targetId = prev.spaces.some((s) => s.id === prev.activeSpace) ? prev.activeSpace : (prev.spaces.find((s) => s.home)?.id ?? prev.spaces[0]?.id);
          if (!targetId) return prev;
          if (prev.spaces.some((s) => (s.maps || []).some((m) => m.docId === docId || m.title === title))) return prev;
          const spaces = prev.spaces.map((s) => (s.id === targetId ? { ...s, maps: [...(s.maps || []), { title, when: '방금', hue: '#f0663f', docId }] } : s));
          // If the user is currently INSIDE a folder (of the target space), file
          // the new map into that folder — otherwise it would land at the space's
          // top level (outside the folder they're viewing). mapFolders is keyed by
          // title, same as `moveMapToFolder`.
          let mapFolders = prev.mapFolders;
          if (prev.curFolder) {
            const sp = prev.spaces.find((s) => s.id === targetId);
            const folders = sp && Array.isArray(sp.folders) ? sp.folders : [];
            if (folders.some((f) => f.id === prev.curFolder)) {
              mapFolders = { ...prev.mapFolders, [title]: prev.curFolder };
            }
          }
          return { ...prev, spaces, mapFolders };
        });
      }
    } catch {
      /* href parse failed — fall through to a plain navigate */
    }
    navigateAfterLoader(href, '새 마인드맵을 준비하고 있어요');
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
    patch({ openMenu: null, moveFor: null, exportFor: null });
    const raw = docRawForExport(title, docId);
    const safe = safeFileName(title);
    if (raw) {
      // Re-serialize through the core so the download is the canonical doc
      // (nodes tree + floats/lines/zones), pretty-printed. Falls back to the
      // raw string if it isn't parseable as a MindFlow doc.
      try {
        const doc = parseDoc(JSON.parse(raw));
        downloadFile(safe + '.json', doc ? JSON.stringify(serializeDoc(doc), null, 2) : raw);
        return;
      } catch {
        downloadFile(safe + '.json', raw);
        return;
      }
    }
    downloadFile(
      safe + '.json',
      JSON.stringify(
        { v: 1, nodes: { root: { id: 'root', text: title, emoji: '🎯', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' },
        null,
        2,
      ),
    );
  };

  /** Render the map's real doc to a full-resolution PNG (shared editor renderer). */
  const exportMapPNG = (title: string, docId?: string) => {
    patch({ openMenu: null, moveFor: null, exportFor: null });
    const raw = docRawForExport(title, docId);
    if (!raw) {
      patch({ importError: '미리보기가 없어 이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    try {
      const doc = parseDoc(JSON.parse(raw));
      if (!doc) throw new Error('unparseable');
      exportDocPng(doc, themeOf(doc.themeKey), safeFileName(title));
    } catch {
      patch({ importError: '이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
    }
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      type ImportedDoc = { nodes: Record<string, { text?: string; [k: string]: unknown }>; needsLayout?: boolean; [k: string]: unknown };
      let doc: ImportedDoc | null = null;
      let title = file.name.replace(/\.(json|md|markdown|txt)$/i, '');
      if (/\.json$/i.test(file.name)) {
        try {
          const d = JSON.parse(text) as { nodes?: { root?: { text?: string } } };
          if (d && d.nodes && d.nodes.root) {
            doc = d as ImportedDoc;
            title = (d.nodes.root.text || title).trim() || title;
          }
        } catch {
          /* not valid JSON */
        }
        if (!doc) {
          patch({ toast: '', importError: '올바른 MindFlow JSON 파일이 아니에요' });
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
      try {
        localStorage.setItem(docKey(mapId(finalTitle)), JSON.stringify(doc));
      } catch {
        /* storage unavailable */
      }
      setState((prev) => {
        const target = prev.spaces.find((s) => s.id === prev.activeSpace) || prev.spaces[0];
        if (!target) return prev;
        const spaces = prev.spaces.map((s) => (s.id === target.id ? { ...s, maps: [...(s.maps || []), { title: finalTitle, when: '방금 가져옴', hue: '#f0663f' }] } : s));
        return { ...prev, spaces, activeSpace: target.id, importDone: finalTitle };
      });
    };
    reader.readAsText(file);
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleImport(f);
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
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '' }, openMenu: null });
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
        setState((prev) => ({ ...prev, spaces: mutateFolders(prev.spaces, (fs) => [...fs, { id, name }]), folderModal: null }));
      }
    } else if (isDrive) {
      setState((prev) => ({ ...prev, driveFolders: prev.driveFolders.map((f) => (f.id === fm.id ? { ...f, name } : f)), folderModal: null }));
    } else {
      setState((prev) => ({ ...prev, spaces: mutateFolders(prev.spaces, (fs) => fs.map((f) => (f.id === fm.id ? { ...f, name } : f))), folderModal: null }));
    }
  };
  const startRenameDriveFolder = (id: string) => {
    const f = state.driveFolders.find((x) => x.id === id);
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '', drive: true } as FolderModalState, openMenu: null });
  };
  const folderCount = (id: string) => {
    const mf = state.mapFolders;
    return Object.keys(mf).filter((t) => mf[t] === id && !state.deleted[t]).length;
  };
  const driveFolderCount = (id: string) => {
    const mf = state.driveMapFolders;
    return DRIVE_FILES.filter((f) => mf[f.name] === id && !state.deleted[f.name]).length;
  };
  const askDeleteFolder = (id: string) => {
    const isDrive = isDriveFolderId(id);
    const cnt = isDrive ? driveFolderCount(id) : folderCount(id);
    if (cnt > 0) return;
    patch({ confirmDeleteFolder: id, openMenu: null });
  };
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
      const mapFolders = { ...prev.mapFolders };
      for (const t in mapFolders) if (mapFolders[t] === id) delete mapFolders[t];
      return {
        ...prev,
        spaces: mutateFolders(prev.spaces, (fs) => fs.filter((f) => f.id !== id)),
        mapFolders,
        confirmDeleteFolder: null,
        curFolder: prev.curFolder === id ? null : prev.curFolder,
      };
    });
  };
  const moveMapToFolder = (title: string, folderId: string | null) => {
    if (state.activeSpace === 'drive') {
      setState((prev) => {
        const driveMapFolders = { ...prev.driveMapFolders };
        if (folderId) driveMapFolders[title] = folderId;
        else delete driveMapFolders[title];
        return { ...prev, driveMapFolders, openMenu: null, moveFor: null };
      });
      return;
    }
    setState((prev) => {
      const mapFolders = { ...prev.mapFolders };
      if (folderId) mapFolders[title] = folderId;
      else delete mapFolders[title];
      return { ...prev, mapFolders, openMenu: null, moveFor: null };
    });
  };
  /** Move a map from its current (real, non-Drive) space to another space. The
   * card moves to the target space's top level, and its per-space folder
   * assignment is dropped (folders belong to a single space). */
  const moveMapToSpace = (title: string, spaceId: string) => {
    setState((prev) => {
      const src = prev.spaces.find((s) => Array.isArray(s.maps) && s.maps.some((m) => m.title === title));
      const target = prev.spaces.find((s) => s.id === spaceId);
      // no-op if the map isn't in a real space, the target is gone, or it's already there
      if (!src || !target || src.id === spaceId) return { ...prev, openMenu: null, moveFor: null, moveSpaceFor: null };
      const card = (src.maps || []).find((m) => m.title === title);
      if (!card) return { ...prev, openMenu: null, moveFor: null, moveSpaceFor: null };
      const spaces = prev.spaces.map((s) => {
        if (s.id === src.id) return { ...s, maps: (s.maps || []).filter((m) => m.title !== title) };
        if (s.id === spaceId) return { ...s, maps: [...(s.maps || []), card] };
        return s;
      });
      const mapFolders = { ...prev.mapFolders };
      delete mapFolders[title];
      return { ...prev, spaces, mapFolders, openMenu: null, moveFor: null, moveSpaceFor: null, toast: `'${title}'을(를) '${target.name}' 공간으로 옮겼어요`, toastTitle: '이동 완료' };
    });
  };
  const backToSpace = () => patch({ curFolder: null, driveFolder: null, openMenu: null });
  const openFolder = (id: string) => patch({ curFolder: id, openMenu: null });
  const openDriveFolder = (id: string) => patch({ driveFolder: id, openMenu: null });

  // ---- drag & drop ----
  const setDraggingMap = (title: string | null) => patch({ draggingMap: title, openMenu: null, moveFor: null, moveSpaceFor: null });
  const clearDrag = () => patch({ draggingMap: null, dragOverFolder: null });
  const setDragOverFolder = (id: string | null) => {
    if (state.dragOverFolder !== id) patch({ dragOverFolder: id });
  };

  // ---- selection / search ----
  const selectCard = (title: string | null) => patch({ selectedCard: title });
  // Opening one submenu closes the others (only one flyout panel at a time).
  const setExportFor = (title: string | null) => patch({ exportFor: title, moveFor: null, moveSpaceFor: null });
  const setMoveFor = (title: string | null) => patch({ moveFor: title, exportFor: null, moveSpaceFor: null });
  const setMoveSpaceFor = (title: string | null) => patch({ moveSpaceFor: title, exportFor: null, moveFor: null });
  const setSearch = (v: string) => patch({ search: v });

  const setSpaceMenuAnchor = (anchor: { top: number; left: number }) => {
    spaceMenuAnchor.current = anchor;
  };

  return {
    state,
    importInputRef,
    spaceMenuAnchor,
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
    toggleSpaceMenu,
    setSpaceMenuAnchor,
    startRenameSpace,
    askDeleteSpace,
    cancelDeleteSpace,
    confirmDeleteSpaceYes,
    toggleFav,
    toggleFavList,
    toggleMenu,
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
    closeToast,
    recordRecent,
    mapHref,
    newMapHref,
    openWithLoader,
    onNewMapClick,
    openImport,
    onImportFile,
    exportMap,
    exportMapPNG,
    activeFolders,
    openNewFolder,
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
    backToSpace,
    openFolder,
    openDriveFolder,
    setDraggingMap,
    clearDrag,
    setDragOverFolder,
    selectCard,
    setExportFor,
    setMoveFor,
    setMoveSpaceFor,
    moveMapToSpace,
    setSearch,
  };
}

export type HomeController = ReturnType<typeof useHomeController>;
