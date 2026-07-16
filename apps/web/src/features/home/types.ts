/** Mirrors the data shapes threaded through Home.dc.html's `class Component extends DCLogic`. */

export interface MapCardData {
  title: string;
  when: string;
  hue: string;
  /** Present for maps created in the editor (`mindflow_doc_<docId>`). Home.dc.html:541. */
  docId?: string;
}

export interface FolderData {
  id: string;
  name: string;
}

export interface DriveFolderData {
  id: string;
  name: string;
}

export interface DriveFileData {
  name: string;
  icon: string;
  folder: string | null;
}

export interface SpaceData {
  id: string;
  name: string;
  home?: boolean;
  color?: string;
  maps: MapCardData[];
  folders?: FolderData[];
}

export interface TrashEntry {
  title: string;
  source: 'local' | 'drive';
  /** Present for doc-backed maps (Home ticket: DocStore-wired trash) so restoring
   * from the trash list can call `DocStore.restore(docId)` in addition to the
   * local title-keyed state flip. */
  docId?: string;
}

export type FolderModalMode = 'new' | 'rename';

export interface FolderModalState {
  mode: FolderModalMode;
  id: string | null;
  name: string;
  drive?: boolean;
}

export type AuthPhase = null | 'choose' | 'connecting';
export type DriveConnection = 'idle' | 'connected';

/** Mirrors `this.state` in Home.dc.html's constructor + the fields it adds via `setState`. */
export interface HomeState {
  drive: DriveConnection;
  auth: AuthPhase;
  favs: Record<string, boolean>;
  favOpen: boolean;
  openMenu: string | null;
  deleted: Record<string, boolean>;
  confirmDelete: string | null;
  /** docId of the card behind `confirmDelete`, if it's a doc-backed map — carried
   * alongside the title so `confirmDeleteYes` can call `DocStore.remove(docId)`. */
  confirmDeleteDocId: string | null;
  confirmRestore: string | null;
  /** docId counterpart of `confirmRestore` — see `confirmDeleteDocId`. */
  confirmRestoreDocId: string | null;
  trash: TrashEntry[];
  trashOpen: boolean;
  recent: string[];
  recentOpen: boolean;
  userName: string;
  settingsOpen: boolean;
  nameEditing: boolean;
  confirmLogout: boolean;
  creatingMap: boolean;
  loaderMsg: string;

  spaces: SpaceData[];
  activeSpace: string;
  newSpaceOpen: boolean;
  newSpaceName: string;
  newSpaceColor: string;
  spaceMenu: string | null;
  editingSpace: string | null;
  editingSpaceName: string;
  confirmDeleteSpace: string | null;

  curFolder: string | null;
  folderModal: FolderModalState | null;
  mapFolders: Record<string, string>;
  confirmDeleteFolder: string | null;

  driveFolders: DriveFolderData[];
  driveFolder: string | null;
  driveMapFolders: Record<string, string>;

  moveFor: string | null;
  exportFor: string | null;
  selectedCard: string | null;
  draggingMap: string | null;
  dragOverFolder: string | null;

  importDone: string | null;
  importError: string | null;
  toast: string;

  /** Not present in the dc original (the search box there is a static placeholder) — added
   * per the M3 Home ticket so the search input actually filters the map grid. */
  search: string;

  /** False until the first `DocStore.list()` settles on mount. While false the
   * map grid renders skeleton placeholders (and the sidebar hides its empty-list
   * messages) instead of the "아직 만든 맵이 없어요" empty state — so a user with
   * saved maps doesn't see that empty state flash before their content loads
   * (the async list() is a network round-trip with a real backend). */
  loaded: boolean;
}

export const SPACE_COLORS = ['#f0663f', '#e0a53c', '#3fae9e', '#3f8fd0', '#8a6bd1', '#d0568f'];

// 회원가입 시 노출되던 데모 시드 맵 3종은 제거됨. 이 카드들은 docId가 없어
// DocStore(즐겨찾기/삭제/복원)에 영속되지 않아 새로고침 시 항상 일반 공간으로
// 되돌아가는 이슈가 있었음. 일반 공간은 이제 실제 저장된 문서(`DocStore.list()`)
// 로만 채워진다.
export const DEFAULT_MAPS: MapCardData[] = [];

export const DRIVE_FOLDERS: DriveFolderData[] = [
  { id: 'df1', name: '팀 프로젝트' },
  { id: 'df2', name: '개인 문서' },
];

export const DRIVE_FILES: DriveFileData[] = [
  { name: '제품 로드맵 2026.xmind', icon: '🧠', folder: null },
  { name: '마케팅 전략.pdf', icon: '📄', folder: null },
  { name: '팀 회의록.xmind', icon: '🧠', folder: 'df1' },
  { name: '디자인 시스템.xmind', icon: '🧠', folder: 'df1' },
  { name: '스프린트 계획.xlsx', icon: '📊', folder: 'df1' },
  { name: '사용자 리서치.docx', icon: '📝', folder: 'df2' },
  { name: '아이디어 스케치.xmind', icon: '🧠', folder: 'df2' },
];

export function initialHomeState(): HomeState {
  return {
    drive: 'idle',
    auth: null,
    favs: {},
    favOpen: false,
    openMenu: null,
    deleted: {},
    confirmDelete: null,
    confirmDeleteDocId: null,
    confirmRestore: null,
    confirmRestoreDocId: null,
    trash: [],
    trashOpen: false,
    recent: [],
    recentOpen: false,
    userName: 'mine',
    settingsOpen: false,
    nameEditing: false,
    confirmLogout: false,
    creatingMap: false,
    loaderMsg: '',

    spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: DEFAULT_MAPS }],
    activeSpace: 'general',
    newSpaceOpen: false,
    newSpaceName: '',
    newSpaceColor: '#f0663f',
    spaceMenu: null,
    editingSpace: null,
    editingSpaceName: '',
    confirmDeleteSpace: null,

    curFolder: null,
    folderModal: null,
    mapFolders: {},
    confirmDeleteFolder: null,

    driveFolders: DRIVE_FOLDERS,
    driveFolder: null,
    driveMapFolders: DRIVE_FILES.reduce<Record<string, string>>((acc, f) => {
      if (f.folder) acc[f.name] = f.folder;
      return acc;
    }, {}),

    moveFor: null,
    exportFor: null,
    selectedCard: null,
    draggingMap: null,
    dragOverFolder: null,

    importDone: null,
    importError: null,
    toast: '',

    search: '',
    loaded: false,
  };
}
