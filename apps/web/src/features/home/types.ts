/** Mirrors the data shapes threaded through Home.dc.html's `class Component extends DCLogic`. */

import { loadHomeThemeCache, type HomeThemeKey } from './theme';

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
  /** 상위 폴더 id — 없으면(기존 데이터 포함) 스페이스 최상위. 폴더 안에서
   * "새 폴더"로 만들면 현재 폴더가 부모가 된다(중첩 폴더). 폴더 자체를 다른
   * 폴더로 옮기는 조작은 없으므로 순환은 생기지 않는다. */
  parent?: string | null;
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

/**
 * 지금 메뉴가 가리키는 대상. 셋을 한 상태로 묶은 이유: 화면에 메뉴는 언제나
 * 하나뿐이고, 그 하나를 여는 길이 ☰ 버튼과 우클릭 두 가지일 뿐이다.
 */
export type HomeCtxTarget =
  | { kind: 'map'; key: string }
  | { kind: 'folder'; id: string }
  /** LNB의 스페이스 행 — ⋮ 버튼과 우클릭이 같은 메뉴를 연다(카드와 같은 규칙). */
  | { kind: 'space'; id: string }
  /** 카드가 없는 빈 자리 — "새로 만들기 · 새 폴더 · 가져오기 · 설정". */
  | { kind: 'bg' };

export interface HomeCtxMenu {
  /** 뷰포트 좌표(우클릭 지점 또는 ☰ 버튼 아래). */
  x: number;
  y: number;
  target: HomeCtxTarget;
}

export interface RenameMapState {
  /** 대상 카드의 key(`cardKeyOf`) — 제목은 중복될 수 있어 이걸로 찾는다. */
  key: string;
  docId: string;
  name: string;
  /** 저장 중이면 버튼을 잠근다(문서 본문까지 고쳐야 해서 왕복이 있다). */
  saving?: boolean;
  error?: string;
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
  /** LNB "공유받은 맵" 목록의 펼침 상태. 처음엔 펼쳐 둔다 — 섹션 자체가 공유받은
   * 문서가 있을 때만 생기므로, 새로 공유받은 맵이 한 번의 클릭 없이 눈에 띈다. */
  sharedOpen: boolean;
  /**
   * 지금 열려 있는 카드/배경 메뉴 — **☰ 버튼과 우클릭이 같은 메뉴를 쓴다**(요청).
   * 위치(x·y)를 함께 들고 있어서 우클릭은 커서 자리에, ☰은 버튼 아래에 뜬다.
   * `null`이면 닫힌 상태. 하위 메뉴(내보내기·폴더/스페이스로 이동)는 이제 화면을
   * 갈아 끼우는 드릴다운이 아니라 옆으로 뻗는 플라이아웃이라, 그 열림 상태는
   * 메뉴 컴포넌트의 지역 상태다(예전 `exportFor`/`moveFor`/`moveSpaceFor` 대체).
   */
  ctxMenu: HomeCtxMenu | null;
  /** 맵 이름 변경 팝업(카드 메뉴 → 이름 변경). `null`이면 닫힘. */
  renameMap: RenameMapState | null;
  /** 공유 팝업을 연 맵의 문서 id(카드 메뉴 → 공유). `null`이면 닫힘.
   *  에디터와 **같은 `ShareModal`**을 쓴다 — 맵을 열지 않고 바로 초대·링크 공유. */
  shareDocId: string | null;
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
  /** 세션 조회(getSession)가 끝나 프로필(이름/아바타)을 보여줄 수 있는 상태.
   * false인 동안 LNB 프로필 블록은 스켈레톤 — 'mine' 플레이스홀더가 실제
   * 이름으로 바뀌며 깜빡이던 것을 막는다. */
  profileLoaded: boolean;
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
  /** 피드백 보내기 모달(LNB 최하단에서 연다). */
  feedbackOpen: boolean;
  /** 템플릿 갤러리 — "새로 만들기"의 세 진입점(툴바·빈 자리 우클릭·빈 상태 CTA)이
   * 전부 이걸 연다. 빈 맵도 갤러리의 첫 칸이다. */
  templateOpen: boolean;
  /** 홈 색상 테마(LNB 최하단에서 고른다). 정본은 워크스페이스 블롭이라 기기 간에
   * 따라오고, 첫 페인트용 캐시는 `theme.ts`의 localStorage에 둔다. */
  theme: HomeThemeKey;
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

  selectedCard: string | null;
  /**
   * Shift 범위의 **기준점**(앵커) — 수정 키 없이 누르거나 Ctrl/⌘로 토글한 카드.
   *
   * `selectedCard`와 따로 두는 이유(제보): Shift+클릭을 이어서 하면 그때마다
   * `selectedCard`(=지금 초점)가 끝점으로 옮겨 가는데, 앵커까지 함께 옮기면
   * C → B → A로 고를 때 마지막 범위가 B..A가 되어 **C가 빠진다**. 앵커는 다음
   * 평범한 클릭까지 제자리에 있어야 파일 탐색기와 같은 감각이 된다.
   */
  selectAnchor: string | null;
  /**
   * 다중 선택된 **맵 카드**의 key 목록(요청).
   *
   * 단일 선택은 길이 1인 다중 선택이다 — 진실의 원천이 하나여서 "화면엔 선택돼
   * 보이는데 메뉴는 다른 카드의 것"이 생기지 않는다. `selectedCard`는 그중 **지금
   * 초점**(마지막에 누른 카드)이고 폴더 카드도 이 칸을 쓴다.
   * 폴더는 다중 선택 대상이 아니다 — 이동·삭제의 뜻이 맵과 달라 섞이면 메뉴가
   * 모호해진다. 최근 항목 트레이 카드도 제외(원래 메뉴 없는 바로가기, #345).
   */
  selectedCards: string[];
  /**
   * 모바일 **선택 모드**(요청) — 카드를 길게 눌러 들어간다.
   *
   * `selectedCards.length > 0`을 모드로 삼지 않는 이유: 모바일에서 탭 한 번은 이미
   * '선택'이라(☰·★이 드러난다) 평범한 탭에도 선택 바가 떠 버린다. 모드 밖에서는
   * 지금 그대로(탭=선택 표시, 더블탭=열기), 모드 안에서는 탭이 체크 토글이고
   * 더블탭 열기는 꺼진다. 마지막 하나를 해제해 0개가 되면 스스로 나간다 — 상태
   * 둘(모드/선택)이 어긋나지 않게.
   */
  selectMode: boolean;
  /** 여러 장을 한 번에 지울 때의 확인 대상 — 한 장이면 기존 `confirmDelete` 경로. */
  confirmDeleteMulti: { key: string; title: string; docId?: string }[] | null;
  /** 문서별 **마지막으로 저장한 사람**의 표시 이름(docId → 이름). 마지막 저장자가
   * 나이거나 알 수 없으면 키가 없다 — 그때 카드는 이름을 붙이지 않는다(0015). */
  editorNames: Record<string, string>;
  draggingMap: string | null;
  dragOverFolder: string | null;

  /** 남이 나에게 공유한 맵들(0009의 `document_shares`). 내 워크스페이스 블롭에는
   * 없고 `DocStore.list()`가 돌려주는 메타에서만 온다 — 그래서 스페이스·폴더와
   * 섞이지 않는 별도 목록으로 들고 있다. */
  /** `isNew` = 아직 확인하지 않은 초대(0019의 `seen_at`이 null) — LNB 배지의 근거. */
  sharedMaps: { docId: string; title: string; updatedAt: string; role: 'edit' | 'view'; isNew: boolean }[];
  /** **내가 공유해 둔** 문서 요약(docId → 초대 수·링크 여부) — 맵 카드의
   * "공유 중" 표식 원천(`ShareStore.listSharedByMe`). */
  sharedByMe: Record<string, { invitees: number; link: boolean }>;

  importDone: string | null;
  /** 가져온 맵이 폴더 안에 들어갔다면 그 폴더 이름 — 완료 토스트가 "현재 스페이스에
   * 추가했어요" 대신 어느 폴더인지 말할 수 있게. 최상위로 들어갔으면 null. */
  importDoneFolder: string | null;
  importError: string | null;
  toast: string;
  /** Title shown above `toast` (the `toast` string is the body). Lets each toast
   * label itself — e.g. "이동 완료" vs "복원 완료" — instead of a hardcoded title. */
  toastTitle: string;

  /** Not present in the dc original (the search box there is a static placeholder) — added
   * per the M3 Home ticket so the search input actually filters the map grid.
   *
   * **적용된** 질의 — 화면(뷰모델)이 읽는 값이고, 입력이 잠깐 멎은 뒤에 갱신된다.
   * 입력창이 보여 주는 즉시값은 `searchInput`이다. 둘을 가른 이유는 타이핑 도중
   * 매 글자마다 카드 목록을 다시 그리지 않기 위해서다(#360 후속). */
  search: string;
  /** 입력창의 즉시값 — 타이핑은 늘 지체 없이 보인다. */
  searchInput: string;
  /** 다른 스페이스의 본문을 받아 오는 중인가. 검색은 전역이지만 본문은 활성
   * 스페이스 것만 미리 받아 두므로(썸네일), **첫 검색 때** 나머지를 마저 받는다.
   * 받는 동안에도 제목 결과는 이미 보이고, 도착하면 본문 결과가 더해진다. */
  searchBodiesLoading: boolean;

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
// DocStore(즐겨찾기/삭제/복원)에 영속되지 않아 새로고침 시 항상 일반 스페이스로
// 되돌아가는 이슈가 있었음. 일반 스페이스는 이제 실제 저장된 문서(`DocStore.list()`)
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
    sharedOpen: true,
    ctxMenu: null,
    renameMap: null,
    shareDocId: null,
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
    profileLoaded: false,
    userEmail: '',
    userAvatar: null,
    settingsOpen: false,
    profileNameOpen: false,
    profileNameDraft: '',
    confirmLogout: false,
    accountSettingsOpen: false,
    feedbackOpen: false,
    templateOpen: false,
    // 이 기기의 마지막 선택으로 시작한다 — 워크스페이스(정본)가 도착하면 그 값으로
    // 맞춘다. 부팅 때 이미 같은 캐시로 CSS 변수를 입혀 뒀으므로 첫 페인트와 일치한다.
    theme: loadHomeThemeCache(),
    confirmDeleteAccount: false,
    deleteAccountText: '',
    deleteAccountError: '',
    creatingMap: false,
    loaderMsg: '',

    spaces: [{ id: 'general', name: '일반 스페이스', home: true, color: '#f0663f', maps: DEFAULT_MAPS }],
    activeSpace: 'general',
    newSpaceOpen: false,
    newSpaceName: '',
    newSpaceColor: '#f0663f',
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

    selectedCard: null,
    selectAnchor: null,
    selectedCards: [],
    selectMode: false,
    confirmDeleteMulti: null,
    editorNames: {},
    draggingMap: null,
    dragOverFolder: null,

    sharedMaps: [],
    sharedByMe: {},

    importDone: null,
    importDoneFolder: null,
    importError: null,
    toast: '',
    toastTitle: '',

    search: '',
    searchInput: '',
    searchBodiesLoading: false,
    loaded: false,
    previewDocs: {},
    previewResolved: {},
  };
}
