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
  /** Origin space id + folder captured at delete time — a deleted card is now
   * REMOVED from `spaces.maps` (so it can't linger/reappear), so restore uses
   * these to put it back where it was (falls back to the home space). */
  spaceId?: string;
  folder?: string;
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
  /** docId → 마지막 수정 시각(ISO). `DocStore.list()`의 메타에서 채워지며,
   * 맵 카드 하단의 "N시간 전"류 표기의 원천이다 (timeFormat.ts). */
  docTimes: Record<string, string>;
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
  /** Title of the trash entry pending PERMANENT deletion (confirm dialog). */
  confirmPurge: string | null;
  /** docId counterpart of `confirmPurge` — see `confirmDeleteDocId`. */
  confirmPurgeDocId: string | null;
  /** "휴지통 비우기" (purge everything) confirm dialog visibility. */
  confirmEmptyTrash: boolean;
  trash: TrashEntry[];
  trashOpen: boolean;
  recent: string[];
  recentOpen: boolean;
  userName: string;
  /** The signed-in user's email (from `AuthProvider.getSession()`), shown in the
   * LNB profile. Empty until the session resolves on mount. */
  userEmail: string;
  /** Avatar image URL from the identity provider (Google photo), or null for
   * email/demo accounts — the profile UI falls back to the initial circle. */
  userAvatar: string | null;
  settingsOpen: boolean;
  /** The "프로필명 변경" popup (opened from the profile popover). */
  profileNameOpen: boolean;
  /** Draft name in that popup — committed to `userName` on 변경, discarded on 취소. */
  profileNameDraft: string;
  confirmLogout: boolean;
  /** The 설정 (account settings) modal, opened from the profile popover. Hosts
   * the 회원 탈퇴 entry. */
  accountSettingsOpen: boolean;
  /** The 회원 탈퇴 confirmation dialog (opened from the settings modal). */
  confirmDeleteAccount: boolean;
  /** What the user has typed into the 회원 탈퇴 confirmation box — the destructive
   * action is gated on this matching the required phrase ("탈퇴"). */
  deleteAccountText: string;
  /** Error surfaced in the 회원 탈퇴 dialog when `deleteAccount()` fails, so the
   * user stays on the page and can retry instead of being half-deleted. */
  deleteAccountError: string;
  creatingMap: boolean;
  loaderMsg: string;

  spaces: SpaceData[];
  activeSpace: string;
  newSpaceOpen: boolean;
  newSpaceName: string;
  newSpaceColor: string;
  spaceMenu: string | null;
  /** When the shared new-space popup is open in RENAME mode, the id of the space
   * being edited (name + color pre-filled); `null` = create mode. */
  editingSpace: string | null;
  confirmDeleteSpace: string | null;

  curFolder: string | null;
  folderModal: FolderModalState | null;
  mapFolders: Record<string, string>;
  confirmDeleteFolder: string | null;

  driveFolders: DriveFolderData[];
  driveFolder: string | null;
  driveMapFolders: Record<string, string>;

  moveFor: string | null;
  /** Title of the card whose "스페이스로 이동" submenu is open (move a map to
   * another space), mirroring `moveFor` for the folder submenu. */
  moveSpaceFor: string | null;
  exportFor: string | null;
  selectedCard: string | null;
  draggingMap: string | null;
  dragOverFolder: string | null;

  importDone: string | null;
  importError: string | null;
  toast: string;
  /** Title shown above `toast` (the `toast` string is the body). Lets each toast
   * label itself — e.g. "이동 완료" vs "복원 완료" — instead of a hardcoded title. */
  toastTitle: string;

  /** Not present in the dc original (the search box there is a static placeholder) — added
   * per the M3 Home ticket so the search input actually filters the map grid. */
  search: string;

  /** False until the first `DocStore.list()` settles on mount. While false the
   * map grid renders skeleton placeholders (and the sidebar hides its empty-list
   * messages) instead of the "아직 만든 맵이 없어요" empty state — so a user with
   * saved maps doesn't see that empty state flash before their content loads
   * (the async list() is a network round-trip with a real backend). */
  loaded: boolean;

  /** docId → serialized doc JSON, prefetched via `DocStore.load()` so the map
   * card thumbnails can render the REAL map (its nodes) even when the document
   * body lives in a backend (Supabase) rather than localStorage — `realPreview`
   * reads localStorage only, so without this a backend-stored map always fell
   * back to the generic `miniPreview` sketch (identical-looking for every map). */
  previewDocs: Record<string, string>;

  /** docId → true once its body prefetch (`DocStore.load()`) has settled. Lets a
   * card show a neutral skeleton WHILE its real preview is still loading instead
   * of flashing the generic sketch first, then swapping to the real nodes. */
  previewResolved: Record<string, boolean>;
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
    docTimes: {},
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
    confirmPurge: null,
    confirmPurgeDocId: null,
    confirmEmptyTrash: false,
    trash: [],
    trashOpen: false,
    recent: [],
    recentOpen: false,
    userName: 'mine',
    userEmail: '',
    userAvatar: null,
    settingsOpen: false,
    profileNameOpen: false,
    profileNameDraft: '',
    confirmLogout: false,
    accountSettingsOpen: false,
    confirmDeleteAccount: false,
    deleteAccountText: '',
    deleteAccountError: '',
    creatingMap: false,
    loaderMsg: '',

    spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: DEFAULT_MAPS }],
    activeSpace: 'general',
    newSpaceOpen: false,
    newSpaceName: '',
    newSpaceColor: '#f0663f',
    spaceMenu: null,
    editingSpace: null,
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
    moveSpaceFor: null,
    exportFor: null,
    selectedCard: null,
    draggingMap: null,
    dragOverFolder: null,

    importDone: null,
    importError: null,
    toast: '',
    toastTitle: '',

    search: '',
    loaded: false,
    previewDocs: {},
    previewResolved: {},
  };
}
