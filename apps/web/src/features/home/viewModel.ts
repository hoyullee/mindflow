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
  trashItems: { title: string; isDrive: boolean; badge: string }[];
  trashCount: string;
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

function cardSketch(title: string, hue: string, docId: string | undefined): JSX.Element {
  const raw = (docId && readDocRaw(docId)) || docRawForTitle(title);
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
      sketch: cardSketch(c.title, c.hue, c.docId),
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

  const favItems = Object.keys(favs)
    .filter((k) => favs[k])
    .map((t) => ({ title: t, isDrive: sourceIsDrive(t) }));

  const baseByTitle = new Map<string, { title: string; when: string; hue: string; docId?: string }>();
  activeMaps.forEach((m) => baseByTitle.set(m.title, m));
  driveCardsRaw.forEach((f) => baseByTitle.set(f.name, { title: f.name, when: 'Google Drive', hue: '#34A853' }));
  const recentCards: CardViewData[] = state.recent
    .filter((t) => baseByTitle.has(t) && !state.deleted[t])
    .filter((t) => matchesSearch(t, state.search))
    .map((t) => {
      const base = baseByTitle.get(t)!;
      return {
        title: t,
        when: base.when,
        hue: base.hue,
        docId: base.docId,
        href: mapHref(t, base.docId),
        sketch: cardSketch(t, base.hue, base.docId),
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
        showFavRow: false,
        showMoveRow: false,
        showUnfolderRow: false,
        showDivider: false,
        moveTargets: [],
      };
    });

  const showDriveConnect = isDriveSpace && !connected;
  const isEmpty = !showDriveConnect && allCards.length === 0 && !curFolder;
  const folderEmpty = !!curFolder && allCards.length === 0;

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
    trashItems: state.trash.map((t) => ({ title: t.title, isDrive: t.source === 'drive', badge: t.source === 'drive' ? 'Drive' : '내 공간' })),
    trashCount: state.trash.length ? String(state.trash.length) : '',
    isEmpty,
    folderEmpty,
    showDriveConnect,
    backVisible: !!(curFolder || driveFolder),
    newFolderVisible: !((isDriveSpace && (!connected || driveFolder)) || curFolder),
    importVisible: !(isDriveSpace || curFolder),
    recentSectionVisible: !isDriveSpace && !curFolder && recentCards.length > 0,
    foldersSectionVisible: folderCards.length > 0,
    mapsSectionVisible: !(isEmpty || showDriveConnect || folderEmpty),
    userInitial: (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M',
  };
}

export { hexA, mapId };
