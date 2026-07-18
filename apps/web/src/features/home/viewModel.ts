import { docRawForTitle, hexA, mapHref, mapId, readDocRaw } from './storage';
import { miniPreview, realPreview } from './mapPreview';
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
  showFavRow: boolean;
  showMoveRow: boolean;
  showUnfolderRow: boolean;
  showDivider: boolean;
  moveTargets: { id: string; name: string }[];
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
  favItems: { title: string; isDrive: boolean }[];
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

function cardSketch(title: string, hue: string, docId: string | undefined, previewDocs: Record<string, string>): JSX.Element {
  // Prefer the body prefetched from the DocStore (covers backend-stored maps),
  // then any localStorage copy, then a title match — finally the generic sketch.
  const raw = (docId && (previewDocs[docId] || readDocRaw(docId))) || docRawForTitle(title);
  return realPreview(raw, hue) || miniPreview(hue, title);
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
      sketch: cardSketch(c.title, c.hue, c.docId, state.previewDocs),
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
      showFavRow: hasFav,
      showMoveRow: hasMove,
      showUnfolderRow: hasUnfolder,
      showDivider: hasFav || hasMove || hasUnfolder,
      moveTargets: (isDriveSpace ? state.driveFolders : folders).map((f) => ({ id: f.id, name: f.name })),
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
  const favItems = Object.keys(favs)
    .filter((k) => favs[k] && !state.deleted[k])
    .map((t) => ({ title: t, isDrive: sourceIsDrive(t) }));

  const baseByTitle = new Map<string, { title: string; when: string; hue: string; docId?: string }>();
  activeMaps.forEach((m) => baseByTitle.set(m.title, m));
  driveCardsRaw.forEach((f) => baseByTitle.set(f.name, { title: f.name, when: 'Google Drive', hue: '#34A853' }));
  const recentCards: CardViewData[] = state.recent
    .filter((t) => baseByTitle.has(t) && !state.deleted[t])
    .filter((t) => matchesSearch(t, state.search))
    .map((t) => {
      const base = baseByTitle.get(t)!;
      // The recent section only renders in a non-Drive space at the top level
      // (see `recentSectionVisible`), so — like a top-level map card — it can
      // favorite, export, and move-to-folder. These must read the SAME open/
      // export/move state as `allCards`; hardcoding them false (as before) left
      // the ☰ menu unable to open on a recent card.
      const hasMove = folders.length > 0;
      return {
        title: t,
        when: base.when,
        hue: base.hue,
        docId: base.docId,
        href: mapHref(t, base.docId),
        sketch: cardSketch(t, base.hue, base.docId, state.previewDocs),
        badge: '',
        openable: true,
        isFav: !!favs[t],
        isDrive: sourceIsDrive(t),
        menuOpen: state.openMenu === t,
        selected: state.selectedCard === t,
        dragging: false,
        dragOverTarget: false,
        exportOpen: state.exportFor === t,
        moveOpen: state.moveFor === t,
        showFavRow: true,
        showMoveRow: hasMove,
        showUnfolderRow: false,
        showDivider: true,
        moveTargets: folders.map((f) => ({ id: f.id, name: f.name })),
      };
    });

  // While the first DocStore.list() is still in flight, show a skeleton instead
  // of the "empty" states so real content doesn't flash-replace them. The drive
  // space is fed by static data (no list() dependency), so it never "loads".
  const loading = !state.loaded && !isDriveSpace;
  const showDriveConnect = isDriveSpace && !connected;
  const isEmpty = !loading && !showDriveConnect && allCards.length === 0 && !curFolder;
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
    recentSectionVisible: !loading && !isDriveSpace && !curFolder && recentCards.length > 0,
    foldersSectionVisible: !loading && folderCards.length > 0,
    mapsSectionVisible: !loading && !(isEmpty || showDriveConnect || folderEmpty),
    userInitial: (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M',
  };
}

export { hexA, mapId };
