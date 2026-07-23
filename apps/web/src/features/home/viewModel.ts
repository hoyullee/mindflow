import { RECENT_RENDER_MAX, docRawForTitle, cardKeyOf, hexA, mapHref, mapId, readDocRaw } from './storage';
import { miniPreview, previewSkeleton, realPreview } from './mapPreview';
import type { DriveFolderData, FolderData, HomeState, MapCardData } from './types';
import { DRIVE_FILES } from './types';

export interface CardViewData {
  /** Card identity (`cardKeyOf` — docId, title fallback). Duplicate TITLES are
   * fully allowed (XMind-style), so every per-card UI state (selection, open
   * menu, drag source, export/move flyouts) keys off THIS, never the title. */
  key: string;
  title: string;
  when: string;
  /** 마지막 수정 시각(ISO, `state.docTimes[docId]`) — 카드 하단 표기의 원천.
   * docId 없는 카드(Drive 데모)는 undefined → 표기 생략. */
  updatedAt?: string;
  hue: string;
  docId?: string;
  href: string;
  sketch: JSX.Element;
  badge: string;
  openable: boolean;
  isFav: boolean;
  isDrive: boolean;
  menuOpen: boolean;
  selected: boolean;
  dragging: boolean;
  dragOverTarget: boolean;
  exportOpen: boolean;
  moveOpen: boolean;
  spaceMoveOpen: boolean;
  showFavRow: boolean;
  showMoveRow: boolean;
  showSpaceMoveRow: boolean;
  showUnfolderRow: boolean;
  showDivider: boolean;
  moveTargets: { id: string; name: string }[];
  spaceMoveTargets: { id: string; name: string }[];
  /** Owning space's color — set only for the cross-space "최근 항목" strip, where a
   * small dot on each card shows which space the map lives in. */
  spaceColor?: string;
  /** Owning space's name, paired with `spaceColor` — the dot alone is
   * color-only information (invisible to screen readers, low-contrast for some
   * palette colors), so the card exposes the name as its accessible label. */
  spaceName?: string;
}

export interface FolderCardViewData {
  id: string;
  name: string;
  count: number;
  menuOpen: boolean;
  dragOver: boolean;
  canDelete: boolean;
  isDrive: boolean;
}

export interface HomeViewModel {
  connected: boolean;
  isDriveSpace: boolean;
  activeSpaceName: string;
  isHome: boolean;
  spaceTitle: string;
  curFolder: FolderData | null;
  driveFolder: DriveFolderData | null;
  folders: FolderData[];
  driveFoldersVisible: DriveFolderData[];
  allCards: CardViewData[];
  folderCards: FolderCardViewData[];
  recentCards: CardViewData[];
  favItems: { title: string; isDrive: boolean; href: string; docId?: string }[];
  favCount: string;
  trashItems: { title: string; isDrive: boolean; badge: string; docId?: string }[];
  trashCount: string;
  loading: boolean;
  isEmpty: boolean;
  folderEmpty: boolean;
  showDriveConnect: boolean;
  backVisible: boolean;
  newFolderVisible: boolean;
  importVisible: boolean;
  recentSectionVisible: boolean;
  foldersSectionVisible: boolean;
  mapsSectionVisible: boolean;
  userInitial: string;
}

function sourceIsDrive(title: string): boolean {
  return DRIVE_FILES.some((f) => f.name === title);
}

function cardSketch(title: string, hue: string, docId: string | undefined, previewDocs: Record<string, string>, previewResolved: Record<string, boolean>): JSX.Element {
  // A docId-backed card's body is keyed by that id alone: the prefetched
  // DocStore body (covers backend-stored maps), then the localStorage copy.
  // NEVER fall through to a title match — a brand-new, never-saved map (the
  // seed doc isn't persisted until the first edit or an explicit save on
  // leaving) is also titled "새 마인드맵", and the root-text scan would capture
  // some OTHER map's body (repro: modified map A → 새로 만들기 → browser back →
  // the new card showed A's preview). The title scan remains only for legacy
  // docId-less cards, whose body was stored under a `new-…` id.
  const raw = docId ? previewDocs[docId] || readDocRaw(docId) : docRawForTitle(title);
  if (raw) return realPreview(raw, hue) || miniPreview(hue, title);
  // No body available yet: if this card's backend body is still being fetched
  // (docId not yet resolved), show a neutral skeleton instead of the generic
  // sketch — this is what removes the "old preview flashes, then real nodes"
  // flicker. Once resolved with no body, fall back to the generic sketch.
  if (docId && !previewResolved[docId]) return previewSkeleton();
  return miniPreview(hue, title);
}

function matchesSearch(title: string, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q);
}

export function deriveHomeView(state: HomeState): HomeViewModel {
  const connected = state.drive === 'connected';
  const isDriveSpace = state.activeSpace === 'drive';
  const activeSpaceObj = state.spaces.find((s) => s.id === state.activeSpace) || state.spaces[0];
  const isHome = !isDriveSpace && !!activeSpaceObj?.home;
  const activeMaps: MapCardData[] = !isDriveSpace && activeSpaceObj && Array.isArray(activeSpaceObj.maps) ? activeSpaceObj.maps : [];

  const driveFolder = state.driveFolder && state.driveFolders.find((f) => f.id === state.driveFolder) ? state.driveFolders.find((f) => f.id === state.driveFolder)! : null;
  const dmf = state.driveMapFolders;
  const driveCardsRaw = DRIVE_FILES.filter((f) => (dmf[f.name] || null) === (driveFolder ? driveFolder.id : null));

  const folders = !isDriveSpace && activeSpaceObj && Array.isArray(activeSpaceObj.folders) ? activeSpaceObj.folders : [];
  const curFolder = state.curFolder && folders.find((f) => f.id === state.curFolder) ? folders.find((f) => f.id === state.curFolder)! : null;
  const mapFolders = state.mapFolders;

  // Trash policy: names do NOT interfere between the trash and the spaces — a
  // trashed map and a live map may share a title. So "is this hidden?" is
  // decided by the card's own docId (is THAT doc in the trash?), never by its
  // title alone; the title-keyed `deleted` flag remains only as the fallback
  // for docId-less entries (Drive demo files), which can't collide with docs.
  const trashedIds = new Set(state.trash.map((t) => t.docId).filter((id): id is string => !!id));
  const isTrashedCard = (title: string, docId?: string): boolean => (docId ? trashedIds.has(docId) : !!state.deleted[title]);

  const baseCards: { title: string; when: string; hue: string; docId?: string; openable: boolean }[] = isDriveSpace
    ? connected
      ? driveCardsRaw.map((f) => ({ title: f.name, when: /\.xmind$/.test(f.name) ? 'Google Drive' : '이 형식은 열 수 없어요', hue: '#34A853', openable: /\.xmind$/.test(f.name) }))
      : []
    : activeMaps.map((m) => ({ title: m.title, when: m.when, hue: m.hue, docId: m.docId, openable: true }));

  const allCardsFiltered = baseCards
    .filter((c) => !isTrashedCard(c.title, c.docId))
    .filter((c) => {
      if (isDriveSpace) return true;
      // Folder assignments are docId-keyed (title fallback for docId-less
      // cards) so same-titled maps can't capture each other's assignment.
      const assigned = mapFolders[cardKeyOf(c.title, c.docId)];
      return curFolder ? assigned === curFolder.id : !assigned || !folders.find((f) => f.id === assigned);
    })
    .filter((c) => matchesSearch(c.title, state.search));

  const favs = state.favs;
  // Other real spaces a map can be moved to (excludes the current space and the
  // Drive pseudo-space). Available whenever the user has more than one space.
  const spaceMoveTargets = state.spaces.filter((s) => s.id !== state.activeSpace).map((s) => ({ id: s.id, name: s.name }));
  const canMoveSpace = !isDriveSpace && spaceMoveTargets.length > 0;
  const allCards: CardViewData[] = allCardsFiltered.map((c) => {
    const hasFav = c.openable;
    const hasMove = isDriveSpace ? !driveFolder && state.driveFolders.length > 0 : !curFolder && folders.length > 0;
    const hasUnfolder = isDriveSpace ? !!driveFolder : !!curFolder;
    const key = cardKeyOf(c.title, c.docId);
    return {
      key,
      title: c.title,
      when: c.when,
      updatedAt: c.docId ? state.docTimes[c.docId] : undefined,
      hue: c.hue,
      docId: c.docId,
      href: mapHref(c.title, c.docId),
      sketch: cardSketch(c.title, c.hue, c.docId, state.previewDocs, state.previewResolved),
      badge: isDriveSpace ? 'Drive' : '',
      openable: c.openable,
      isFav: !!favs[key],
      isDrive: isDriveSpace,
      // Per-card UI state keys off the card KEY, not the title — duplicate
      // titles are allowed, and selecting/opening one must not light up its
      // same-named sibling.
      menuOpen: state.openMenu === key,
      selected: state.selectedCard === key,
      dragging: state.draggingMap === key,
      dragOverTarget: false,
      exportOpen: state.exportFor === key,
      moveOpen: state.moveFor === key,
      spaceMoveOpen: state.moveSpaceFor === key,
      showFavRow: hasFav,
      showMoveRow: hasMove,
      showSpaceMoveRow: canMoveSpace,
      showUnfolderRow: hasUnfolder,
      showDivider: hasFav || hasMove || canMoveSpace || hasUnfolder,
      moveTargets: (isDriveSpace ? state.driveFolders : folders).map((f) => ({ id: f.id, name: f.name })),
      spaceMoveTargets,
    };
  });

  const driveFolderCardsRaw: FolderCardViewData[] =
    isDriveSpace && connected && !driveFolder
      ? state.driveFolders.map((f) => ({
          id: f.id,
          name: f.name,
          count: DRIVE_FILES.filter((file) => dmf[file.name] === f.id && !state.deleted[file.name]).length,
          menuOpen: state.openMenu === 'folder:' + f.id,
          dragOver: state.dragOverFolder === f.id,
          canDelete: DRIVE_FILES.filter((file) => dmf[file.name] === f.id && !state.deleted[file.name]).length === 0,
          isDrive: true,
        }))
      : [];
  const localFolderCards: FolderCardViewData[] =
    !isDriveSpace && !curFolder
      ? folders.map((f) => {
          // Count from the space's ACTUAL maps (assignments are docId-keyed, so
          // key iteration can't be matched back to titles) — trashed maps are
          // already out of `spaces`, so no deleted-check is needed.
          const cnt = activeMaps.filter((m) => mapFolders[cardKeyOf(m.title, m.docId)] === f.id).length;
          return {
            id: f.id,
            name: f.name,
            count: cnt,
            menuOpen: state.openMenu === 'folder:' + f.id,
            dragOver: state.dragOverFolder === f.id,
            canDelete: cnt === 0,
            isDrive: false,
          };
        })
      : [];
  const folderCards = isDriveSpace ? driveFolderCardsRaw : localFolderCards;

  // Favorites are keyed by `cardKeyOf` (docId, title fallback), so the list is
  // built by resolving each LIVE map against the flags — a docId key can't be
  // matched back to a title by key iteration. A trashed map never appears (it
  // lives only in the trash until restored), and a same-titled map in another
  // space keeps its own independent star.
  const favItems: { title: string; isDrive: boolean; href: string; docId?: string }[] = [];
  const favConsumed = new Set<string>();
  state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    const k = cardKeyOf(m.title, m.docId);
    if (favs[k] && !favConsumed.has(k) && !isTrashedCard(m.title, m.docId)) {
      favConsumed.add(k);
      favItems.push({ title: m.title, isDrive: false, href: mapHref(m.title, m.docId), docId: m.docId });
    }
  }));
  // Title-keyed leftovers: Drive demo files (never in `spaces`). Anything else
  // unmatched is a stale flag for a doc that no longer exists — skip it.
  Object.keys(favs).forEach((k) => {
    if (!favs[k] || favConsumed.has(k) || !sourceIsDrive(k)) return;
    if (state.deleted[k]) return;
    favItems.push({ title: k, isDrive: true, href: mapHref(k, undefined), docId: undefined });
  });

  // "최근 항목" is a GLOBAL, cross-space list shown at the top of Home. Entries
  // are card keys (docId; title or `mapId(title)` for docId-less/legacy
  // entries) — resolve every alias of every live map, so a docId entry pins the
  // EXACT doc (same-titled maps in different spaces each keep their own entry)
  // while legacy title entries still land on their first-titled match.
  const recentResolve = new Map<string, { title: string; when: string; hue: string; docId?: string; spaceColor: string; spaceName: string }>();
  state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    const info = { ...m, spaceColor: s.color || '#f0663f', spaceName: s.name };
    const aliases = m.docId ? [m.docId, m.title] : [m.title, mapId(m.title)];
    aliases.forEach((k) => {
      if (!recentResolve.has(k)) recentResolve.set(k, info);
    });
  }));
  driveCardsRaw.forEach((f) => {
    if (!recentResolve.has(f.name)) recentResolve.set(f.name, { title: f.name, when: 'Google Drive', hue: '#34A853', spaceColor: '#34A853', spaceName: 'Google Drive' });
  });
  // Recent cards render as the compact variant (no ☰ menu), so the move/export/
  // favorite menu rows don't apply — they'd also be ambiguous for a cross-space
  // list. Keep them off; the card is a click-to-open shortcut.
  const seenRecentDocs = new Set<string>();
  const recentCards: CardViewData[] = state.recent
    .map((e) => recentResolve.get(e))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .filter((b) => !isTrashedCard(b.title, b.docId))
    // Collapse aliases of the same doc (a docId entry + a legacy title entry
    // recorded before the key migration) into the most recent occurrence.
    .filter((b) => {
      const k = cardKeyOf(b.title, b.docId);
      if (seenRecentDocs.has(k)) return false;
      seenRecentDocs.add(k);
      return true;
    })
    // History retention (RECENT_CAP=100) deliberately exceeds what any screen
    // shows; only materialize as many CARDS (sketch build is per-card work) as
    // the widest row / mobile swipe depth could ever display.
    .slice(0, RECENT_RENDER_MAX)
    .map((base) => {
      const key = cardKeyOf(base.title, base.docId);
      return {
        key,
        title: base.title,
        when: base.when,
        updatedAt: base.docId ? state.docTimes[base.docId] : undefined,
        hue: base.hue,
        docId: base.docId,
        href: mapHref(base.title, base.docId),
        sketch: cardSketch(base.title, base.hue, base.docId, state.previewDocs, state.previewResolved),
        badge: '',
        openable: true,
        isFav: !!favs[key],
        isDrive: sourceIsDrive(base.title),
        menuOpen: false,
        selected: state.selectedCard === key,
        dragging: false,
        dragOverTarget: false,
        exportOpen: false,
        moveOpen: false,
        spaceMoveOpen: false,
        showFavRow: false,
        showMoveRow: false,
        showSpaceMoveRow: false,
        showUnfolderRow: false,
        showDivider: false,
        moveTargets: [],
        spaceMoveTargets: [],
        spaceColor: base.spaceColor,
        spaceName: base.spaceName,
      };
    });

  // While the first DocStore.list() is still in flight, show a skeleton instead
  // of the "empty" states so real content doesn't flash-replace them. The drive
  // space is fed by static data (no list() dependency), so it never "loads".
  const loading = !state.loaded && !isDriveSpace;
  const showDriveConnect = isDriveSpace && !connected;
  // "아직 만든 맵이 없어요" + 새로 만들기 CTA is only for a genuinely empty space —
  // one with neither top-level maps NOR folders. A space that has folders (but no
  // loose maps) shows just its folder section, no empty-state prompt.
  const isEmpty = !loading && !showDriveConnect && allCards.length === 0 && !curFolder && folderCards.length === 0;
  const folderEmpty = !loading && !!curFolder && allCards.length === 0;

  return {
    connected,
    isDriveSpace,
    activeSpaceName: activeSpaceObj ? activeSpaceObj.name : '일반 공간',
    isHome,
    spaceTitle: isDriveSpace ? 'Google Drive' + (driveFolder ? ' / ' + driveFolder.name : '') : curFolder ? `${activeSpaceObj ? activeSpaceObj.name : ''} / ${curFolder.name}` : activeSpaceObj ? activeSpaceObj.name : '일반 공간',
    curFolder,
    driveFolder,
    folders,
    driveFoldersVisible: state.driveFolders,
    allCards,
    folderCards,
    recentCards,
    favItems,
    favCount: favItems.length ? String(favItems.length) : '',
    trashItems: state.trash.map((t) => ({ title: t.title, isDrive: t.source === 'drive', badge: t.source === 'drive' ? 'Drive' : '내 공간', docId: t.docId })),
    trashCount: state.trash.length ? String(state.trash.length) : '',
    loading,
    isEmpty,
    folderEmpty,
    showDriveConnect,
    backVisible: !!(curFolder || driveFolder),
    newFolderVisible: !((isDriveSpace && (!connected || driveFolder)) || curFolder),
    importVisible: !(isDriveSpace || curFolder),
    // Global cross-space tray at the top of Home. It's GLOBAL — independent of
    // which space OR folder is being browsed — so it stays visible inside
    // folders too (hiding it there made "이어하기" vanish mid-navigation). Hidden
    // only while searching (it sits above the results and isn't filtered by the
    // query) and on the Drive-connect prompt (a full-screen empty state).
    recentSectionVisible: !loading && !state.search && !showDriveConnect && recentCards.length > 0,
    foldersSectionVisible: !loading && folderCards.length > 0,
    // Only render the "맵" section when there are actually maps to show — a space
    // with folders but no loose maps must not render an empty "맵" header.
    mapsSectionVisible: !loading && !showDriveConnect && allCards.length > 0,
    userInitial: (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M',
  };
}

export { hexA, mapId };
