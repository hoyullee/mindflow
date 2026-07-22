import { RECENT_RENDER_MAX, docRawForTitle, hexA, mapHref, mapId, readDocRaw } from './storage';
import { miniPreview, previewSkeleton, realPreview } from './mapPreview';
import type { DriveFolderData, FolderData, HomeState, MapCardData } from './types';
import { DRIVE_FILES } from './types';

export interface CardViewData {
  title: string;
  when: string;
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
  // Prefer the body prefetched from the DocStore (covers backend-stored maps),
  // then any localStorage copy, then a title match.
  const raw = (docId && (previewDocs[docId] || readDocRaw(docId))) || docRawForTitle(title);
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

  const baseCards: { title: string; when: string; hue: string; docId?: string; openable: boolean }[] = isDriveSpace
    ? connected
      ? driveCardsRaw.map((f) => ({ title: f.name, when: /\.xmind$/.test(f.name) ? 'Google Drive' : '이 형식은 열 수 없어요', hue: '#34A853', openable: /\.xmind$/.test(f.name) }))
      : []
    : activeMaps.map((m) => ({ title: m.title, when: m.when, hue: m.hue, docId: m.docId, openable: true }));

  const allCardsFiltered = baseCards
    .filter((c) => !state.deleted[c.title])
    .filter((c) => (isDriveSpace ? true : curFolder ? mapFolders[c.title] === curFolder.id : !mapFolders[c.title] || !folders.find((f) => f.id === mapFolders[c.title])))
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
    return {
      title: c.title,
      when: c.when,
      hue: c.hue,
      docId: c.docId,
      href: mapHref(c.title, c.docId),
      sketch: cardSketch(c.title, c.hue, c.docId, state.previewDocs, state.previewResolved),
      badge: isDriveSpace ? 'Drive' : '',
      openable: c.openable,
      isFav: !!favs[c.title],
      isDrive: isDriveSpace,
      menuOpen: state.openMenu === c.title,
      selected: state.selectedCard === c.title,
      dragging: state.draggingMap === c.title,
      dragOverTarget: false,
      exportOpen: state.exportFor === c.title,
      moveOpen: state.moveFor === c.title,
      spaceMoveOpen: state.moveSpaceFor === c.title,
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
          const cnt = Object.keys(mapFolders).filter((t) => mapFolders[t] === f.id && !state.deleted[t]).length;
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

  // A trashed map must never appear in the favorites list — it lives only in
  // the trash until restored (see `seedFavAndTrashFromMetas`).
  // A favorited map can live in ANY space, so resolve its real docId from every
  // space's maps (not just the active one) — the editor href needs the actual
  // doc id, since the title-hash fallback (`mapId`) points at a different slot
  // than an editor-created `new-…` doc.
  const favDocIdByTitle = new Map<string, string>();
  state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId && !favDocIdByTitle.has(m.title)) favDocIdByTitle.set(m.title, m.docId);
  }));
  const favItems = Object.keys(favs)
    .filter((k) => favs[k] && !state.deleted[k])
    // `docId` rides along so the LNB's unfavorite star can persist the flip via
    // `DocStore.setFavorite` (drive files have none — local-only favorites).
    .map((t) => ({ title: t, isDrive: sourceIsDrive(t), href: mapHref(t, favDocIdByTitle.get(t)), docId: favDocIdByTitle.get(t) }));

  // "최근 항목" is a GLOBAL, cross-space list shown at the top of Home, so resolve
  // each recent map's card data from EVERY space (not just the active one), plus
  // Drive files. First occurrence wins (a title should be unique across spaces).
  const recentByTitle = new Map<string, { title: string; when: string; hue: string; docId?: string; spaceColor: string; spaceName: string }>();
  state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (!recentByTitle.has(m.title)) recentByTitle.set(m.title, { ...m, spaceColor: s.color || '#f0663f', spaceName: s.name });
  }));
  driveCardsRaw.forEach((f) => {
    if (!recentByTitle.has(f.name)) recentByTitle.set(f.name, { title: f.name, when: 'Google Drive', hue: '#34A853', spaceColor: '#34A853', spaceName: 'Google Drive' });
  });
  // Recent cards render as the compact variant (no ☰ menu), so the move/export/
  // favorite menu rows don't apply — they'd also be ambiguous for a cross-space
  // list. Keep them off; the card is a click-to-open shortcut.
  const recentCards: CardViewData[] = state.recent
    .filter((t) => recentByTitle.has(t) && !state.deleted[t])
    // History retention (RECENT_CAP=100) deliberately exceeds what any screen
    // shows; only materialize as many CARDS (sketch build is per-card work) as
    // the widest row / mobile swipe depth could ever display.
    .slice(0, RECENT_RENDER_MAX)
    .map((t) => {
      const base = recentByTitle.get(t)!;
      return {
        title: t,
        when: base.when,
        hue: base.hue,
        docId: base.docId,
        href: mapHref(t, base.docId),
        sketch: cardSketch(t, base.hue, base.docId, state.previewDocs, state.previewResolved),
        badge: '',
        openable: true,
        isFav: !!favs[t],
        isDrive: sourceIsDrive(t),
        menuOpen: false,
        selected: state.selectedCard === t,
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
