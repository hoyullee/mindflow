import { RECENT_RENDER_MAX, docRawForTitle, cardKeyOf, hexA, mapHref, mapId, readDocRaw } from './storage';
import { miniPreview, previewSkeleton, realPreview } from './mapPreview';
import { docSearchText, matchesQuery } from './searchIndex';
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
  /** 마지막으로 **저장한 사람**의 이름 — 그게 내가 아닐 때만 채워진다(0015).
   * 카드 하단이 "수정일 · 3시간 전 · 홍길동"이 된다. */
  editorName?: string;
  /** 이 맵이 공유돼 있으면 그 요약("2명과 공유 중" 등) — 있으면 카드 제목 옆에
   * 사람 아이콘 표식이 뜨고 이 문구가 툴팁이 된다(`sharedLabelOf`). */
  sharedLabel?: string;
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
  /** 이름 변경 가능 여부 — 문서로 뒷받침되는 내 맵만. 제목이 곧 식별자인 옛
   * 카드(docId 없음)와 Drive 데모는 이름을 바꾸면 그 카드를 잃는다. */
  showRenameRow: boolean;
  /** 공유 가능 여부 — 서버 문서를 가리킬 docId가 있어야 초대·링크가 성립한다.
   * (Drive 데모 파일과 docId 없는 옛 카드는 가리킬 문서가 없다.) */
  showShareRow: boolean;
  showFavRow: boolean;
  showMoveRow: boolean;
  showSpaceMoveRow: boolean;
  showUnfolderRow: boolean;
  showDivider: boolean;
  moveTargets: { id: string; name: string }[];
  /** `color`는 LNB의 스페이스 점과 같은 색 — 메뉴에서도 같은 표식으로 알아본다. */
  spaceMoveTargets: { id: string; name: string; color: string }[];
  /** Owning space's color — set only for the cross-space "최근 항목" strip, where a
   * small dot on each card shows which space the map lives in. */
  spaceColor?: string;
  /** Owning space's name, paired with `spaceColor` — the dot alone is
   * color-only information (invisible to screen readers, low-contrast for some
   * palette colors), so the card exposes the name as its accessible label. */
  spaceName?: string;
  /** 최근 항목 전용 — 카드에 보이는 위치 라벨. 최근 트레이는 스페이스를 가로지르는
   * 목록이라 제목만으로는 어느 위치의 맵인지 알 수 없어서 표시한다.
   * **가장 구체적인 한 조각만** 담는다: 폴더가 있으면 폴더명, 없으면 스페이스명
   * (스페이스는 앞의 색 점이 나타낸다 — `buildCardPath` 참고). 생략된 스페이스명을
   * 포함한 전체 경로는 `pathFull`에 있다.
   * 위치를 알 수 없으면 빈 문자열 — 카드는 줄 높이만 유지하고 아무것도 그리지
   * 않는다(행 안에서 카드 높이가 어긋나지 않도록). */
  pathLabel?: string;
  /** 말줄임 없는 전체 경로("스페이스 › 폴더 › 제목") — 툴팁용. `pathLabel`이
   * 비면 이것도 비어 툴팁을 달지 않는다. */
  pathFull?: string;
}

export interface FolderCardViewData {
  id: string;
  name: string;
  count: number;
  menuOpen: boolean;
  dragOver: boolean;
  canDelete: boolean;
  isDrive: boolean;
  /** 맵 카드와 같은 "한 번 = 선택" 표시. 선택 상태는 맵과 **한 칸**(`selectedCard`)을
   * 나눠 쓰므로 폴더를 고르면 맵 선택이 풀리고 그 반대도 같다 — 그리드 안에서
   * 선택된 것은 언제나 하나다. */
  selected: boolean;
}

/** 폴더의 선택/메뉴 키 — 맵 카드 키(제목·docId)와 섞이지 않게 접두를 붙인다.
 * 메뉴(`ctxMenu`)가 이미 쓰던 규칙을 선택에도 그대로 쓴다. */
export function folderCardKey(id: string): string {
  return 'folder:' + id;
}

/** 검색 결과 한 묶음 = 한 스페이스. 헤더에 색 점 + 이름이 붙는다. */
export interface SearchGroupViewData {
  spaceId: string;
  spaceName: string;
  spaceColor: string;
  /** 지금 보고 있는 스페이스인가 — 폴더 이동 메뉴를 내줄지 가른다. */
  isActive: boolean;
  cards: CardViewData[];
  folders: FolderCardViewData[];
}

export interface HomeViewModel {
  connected: boolean;
  isDriveSpace: boolean;
  activeSpaceName: string;
  isHome: boolean;
  spaceTitle: string;
  /** 제목 줄의 상위 경로(스페이스명) — 폴더 안일 때만 채워진다. 헤더는 이 값을
   * 그대로 쓰지 않고 `…`로 접는다(`Toolbar`): 긴 이름이 들어오면 "스페이스 / 폴더"
   * 전체가 두 줄로 접혀 헤더 높이가 들썩였다. 전체 경로는 `spaceTitle`에 남아
   * 툴팁/스크린리더로 제공된다. */
  titleParent: string | null;
  /** 제목 줄에서 실제로 보여 줄 조각 — 폴더 안이면 폴더명, 아니면 스페이스명. */
  titleLeaf: string;
  curFolder: FolderData | null;
  driveFolder: DriveFolderData | null;
  folders: FolderData[];
  driveFoldersVisible: DriveFolderData[];
  allCards: CardViewData[];
  folderCards: FolderCardViewData[];
  recentCards: CardViewData[];
  /**
   * 남이 나에게 공유한 맵들(0009). **LNB 항목**으로 그린다 — 즐겨찾기·휴지통과 같은
   * 접이식 목록이다.
   *
   * 처음엔 본문 상단에 최근 항목과 같은 카드 트레이로 놓았는데, 스페이스 목록보다
   * 위에서 화면을 크게 차지한다는 제보를 받았다("상단을 너무 많이 잡아먹고 있어").
   * 공유받은 맵은 내 스페이스·폴더에 속하지 않는 **다른 출처**이므로, 목록 안의 한
   * 구획이 아니라 사이드바의 출처 하나로 두는 게 정보 구조에도 맞는다.
   */
  sharedItems: { docId: string; title: string; href: string; role: 'edit' | 'view'; isNew: boolean }[];
  /** 아직 확인하지 않은 초대 수 — LNB "공유받음"의 알림 배지. 0이면 배지 없음. */
  sharedUnread: number;
  /** LNB에 "공유받음" 구획을 그릴지. 처음엔 공유받은 게 없으면 숨겼는데, 항상
   * 보이는 고정 항목으로 바꿨다(사용자 결정) — 기능이 있다는 것 자체가 보여야
   * 공유를 써 볼 수 있다. 비어 있으면 즐겨찾기처럼 빈 안내를 편다. 로딩 중에만
   * 감춘다(스켈레톤과 겹치지 않게). */
  sharedVisible: boolean;
  favItems: { title: string; isDrive: boolean; href: string; docId?: string }[];
  favCount: string;
  trashItems: { title: string; isDrive: boolean; badge: string; docId?: string }[];
  trashCount: string;
  loading: boolean;
  isEmpty: boolean;
  folderEmpty: boolean;
  /** 검색 결과가 하나도 없을 때 — 빈 스페이스 안내와는 다른 문구를 쓴다. */
  searchEmpty: boolean;
  /** 검색 중이면 그 질의(원문). 결과 안내 줄과 빈 결과 문구가 쓴다. */
  searchQuery: string;
  /** 검색 결과 개수(맵 + 폴더). 안내 줄에 쓴다. */
  searchCount: number;
  /** 전역 검색 결과 — 스페이스별 묶음. 검색 중이 아니면 빈 배열. */
  searchGroups: SearchGroupViewData[];
  /** 다른 스페이스 본문을 아직 받는 중인가 — 그동안은 제목으로만 걸린다. */
  searchLoading: boolean;
  showDriveConnect: boolean;
  backVisible: boolean;
  newFolderVisible: boolean;
  importVisible: boolean;
  recentSectionVisible: boolean;
  foldersSectionVisible: boolean;
  mapsSectionVisible: boolean;
  userInitial: string;
}


/** 카드의 "공유 중" 표식 문구 — 공유돼 있지 않으면 undefined(표식 없음).
 * 초대와 링크는 성격이 달라 나눠 말한다: 초대는 "누구와", 링크는 "누구든". */
export function sharedLabelOf(docId: string | undefined, sharedByMe: Record<string, { invitees: number; link: boolean }>): string | undefined {
  if (!docId) return undefined;
  const s = sharedByMe[docId];
  if (!s) return undefined;
  if (s.invitees > 0) return `${s.invitees}명과 공유 중` + (s.link ? ' · 링크 공유 켜짐' : '');
  return s.link ? '링크가 있는 사람이 열람 가능' : undefined;
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

/**
 * 최근 항목 카드의 위치 표기를 만든다.
 * - `label`: 카드에 보이는 짧은 형태 — **가장 구체적인 한 조각만**. 폴더가 있으면
 *   폴더명, 없으면 스페이스명. 스페이스는 라벨 앞의 색 점이 이미 나타내므로,
 *   128px밖에 안 되는 카드 폭을 더 변별력 있는 폴더명에 양보한다("스페이스 · 폴더"를
 *   그대로 쓰면 둘 다 길 때 폴더명이 먼저 잘려 나갔다).
 * - `full`: 툴팁·스크린리더용 전체 경로("스페이스 › 폴더 › 제목") — 라벨에서 생략된
 *   스페이스명은 여기에 항상 남는다.
 *
 * 스페이스명이 비어 있는 등 위치를 구성할 수 없으면 둘 다 빈 문자열 — 호출부는
 * 줄 높이만 유지하고 아무것도 그리지 않는다(툴팁도 달지 않는다).
 */
function buildCardPath(spaceName: string | undefined, folderName: string | undefined, title: string): { label: string; full: string } {
  const parts = [spaceName, folderName].filter((p): p is string => !!p && !!p.trim()).map((p) => p.trim());
  if (!parts.length) return { label: '', full: '' };
  return { label: parts[parts.length - 1] ?? '', full: [...parts, title].join(' › ') };
}

/**
 * 카드가 질의에 걸리는가 — **제목과 본문 둘 다** 본다.
 *
 * 본문은 썸네일이 이미 받아 둔 그 문자열(`previewDocs`, 없으면 이 기기의
 * localStorage 사본)이라 검색을 위해 새로 내려받는 것이 없다. 아직 본문이 도착하지
 * 않은 카드는 제목으로만 걸린다(도착하면 다시 걸러진다).
 */
function matchesSearch(
  title: string,
  docId: string | undefined,
  query: string,
  previewDocs: Record<string, string>,
): boolean {
  if (!query) return true;
  const raw = docId ? previewDocs[docId] || readDocRaw(docId) : docRawForTitle(title);
  return matchesQuery(title, docSearchText(docId || title, raw ?? undefined), query);
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

  // ---- 중첩 폴더 헬퍼 ----
  /** 상위 폴더 체인(가까운 것부터). parent가 지워진 폴더를 만나면 거기서 끊는다. */
  const folderAncestors = (f: FolderData): FolderData[] => {
    const out: FolderData[] = [];
    let cur: FolderData | undefined = f;
    let guard = 0;
    while (cur?.parent && guard++ < 30) {
      cur = folders.find((x) => x.id === cur!.parent);
      if (!cur) break;
      out.push(cur);
    }
    return out;
  };
  /** 이동 메뉴 등에 보여줄 경로 이름("상위 / 하위"). 최상위 폴더면 이름 그대로. */
  const folderPathName = (f: FolderData): string => [...folderAncestors(f).reverse().map((a) => a.name), f.name].join(' / ');
  /** 해당 폴더와 그 아래 모든 하위 폴더의 id — 재귀 맵 개수 집계용. */
  const folderTreeIds = (id: string): Set<string> => {
    const ids = new Set<string>([id]);
    let grew = true;
    let guard = 0;
    while (grew && guard++ < 30) {
      grew = false;
      folders.forEach((f) => {
        if (f.parent && ids.has(f.parent) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      });
    }
    return ids;
  };
  const hasSubfolders = (id: string): boolean => folders.some((f) => (f.parent ?? null) === id);

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

  /** 검색어(소문자·trim). 있으면 화면이 "찾는 중"으로 바뀐다. */
  const query = state.search.trim().toLowerCase();
  const searching = !!query;

  // 검색은 이제 이 그리드를 거르지 않는다 — 질의가 있으면 화면 자체가 **전역 검색
  // 결과**로 바뀌고(아래 `searchGroups`), 이 목록은 그 뒤에 그대로 남아 있다가
  // 검색을 지우면 되돌아온다.
  const allCardsFiltered = baseCards
    .filter((c) => !isTrashedCard(c.title, c.docId))
    .filter((c) => {
      if (isDriveSpace) return true;
      // Folder assignments are docId-keyed (title fallback for docId-less
      // cards) so same-titled maps can't capture each other's assignment.
      const assigned = mapFolders[cardKeyOf(c.title, c.docId)];
      return curFolder ? assigned === curFolder.id : !assigned || !folders.find((f) => f.id === assigned);
    });

  const favs = state.favs;
  // Other real spaces a map can be moved to (excludes the current space and the
  // Drive pseudo-space). Available whenever the user has more than one space.
  const spaceMoveTargets = state.spaces.filter((s) => s.id !== state.activeSpace).map((s) => ({ id: s.id, name: s.name, color: s.color || '#f0663f' }));
  const canMoveSpace = !isDriveSpace && spaceMoveTargets.length > 0;
  // 폴더로 이동 대상: 지금 보고 있는 폴더(이미 그 안에 있음)만 뺀 전체 폴더 —
  // 중첩 폴더가 생기면서 폴더 안에서도 다른(하위 포함) 폴더로 옮길 수 있다.
  // 이름은 경로("상위 / 하위")로 보여 같은 이름의 폴더를 구별한다.
  const localMoveTargets = folders.filter((f) => !curFolder || f.id !== curFolder.id).map((f) => ({ id: f.id, name: folderPathName(f) }));
  const allCards: CardViewData[] = allCardsFiltered.map((c) => {
    const hasFav = c.openable;
    const hasMove = isDriveSpace ? !driveFolder && state.driveFolders.length > 0 : localMoveTargets.length > 0;
    const hasUnfolder = isDriveSpace ? !!driveFolder : !!curFolder;
    const key = cardKeyOf(c.title, c.docId);
    return {
      key,
      title: c.title,
      when: c.when,
      updatedAt: c.docId ? state.docTimes[c.docId] : undefined,
      editorName: c.docId ? state.editorNames[c.docId] : undefined,
      sharedLabel: sharedLabelOf(c.docId, state.sharedByMe),
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
      menuOpen: state.ctxMenu?.target.kind === 'map' && state.ctxMenu.target.key === key,
      selected: state.selectedCard === key,
      dragging: state.draggingMap === key,
      dragOverTarget: false,
      showRenameRow: !isDriveSpace && !!c.docId,
      showShareRow: !isDriveSpace && !!c.docId,
      showFavRow: hasFav,
      showMoveRow: hasMove,
      showSpaceMoveRow: canMoveSpace,
      showUnfolderRow: hasUnfolder,
      showDivider: hasFav || hasMove || canMoveSpace || hasUnfolder,
      moveTargets: isDriveSpace ? state.driveFolders.map((f) => ({ id: f.id, name: f.name })) : localMoveTargets,
      spaceMoveTargets,
    };
  });

  const driveFolderCardsRaw: FolderCardViewData[] =
    isDriveSpace && connected && !driveFolder
      ? state.driveFolders.map((f) => ({
          id: f.id,
          name: f.name,
          count: DRIVE_FILES.filter((file) => dmf[file.name] === f.id && !state.deleted[file.name]).length,
          menuOpen: state.ctxMenu?.target.kind === 'folder' && state.ctxMenu.target.id === f.id,
          dragOver: state.dragOverFolder === f.id,
          selected: state.selectedCard === folderCardKey(f.id),
          canDelete: DRIVE_FILES.filter((file) => dmf[file.name] === f.id && !state.deleted[file.name]).length === 0,
          isDrive: true,
        }))
      : [];
  // 중첩 폴더: 지금 보고 있는 계층의 폴더만 — 최상위에선 parent 없는 폴더,
  // 폴더 안에선 그 폴더를 parent로 갖는 하위 폴더. (기존 데이터는 parent가
  // 없으므로 전부 최상위 — 무회귀.)
  const localFolderCards: FolderCardViewData[] = !isDriveSpace
    ? folders
        .filter((f) => (f.parent ?? null) === (curFolder ? curFolder.id : null))
        .map((f) => {
          // Count from the space's ACTUAL maps (assignments are docId-keyed, so
          // key iteration can't be matched back to titles) — trashed maps are
          // already out of `spaces`, so no deleted-check is needed. 하위 폴더에
          // 든 맵까지 재귀 집계한다(폴더 타일의 "맵 N개"가 실제 담긴 양을 말하도록).
          const treeIds = folderTreeIds(f.id);
          const cnt = activeMaps.filter((m) => {
            const a = mapFolders[cardKeyOf(m.title, m.docId)];
            return !!a && treeIds.has(a);
          }).length;
          const directCnt = activeMaps.filter((m) => mapFolders[cardKeyOf(m.title, m.docId)] === f.id).length;
          return {
            id: f.id,
            name: f.name,
            count: cnt,
            menuOpen: state.ctxMenu?.target.kind === 'folder' && state.ctxMenu.target.id === f.id,
            dragOver: state.dragOverFolder === f.id,
            selected: state.selectedCard === folderCardKey(f.id),
            // 삭제는 "직접 담긴 맵 0 + 하위 폴더 0"일 때만 — 하위 폴더가 있으면
            // 지웠을 때 그 안의 것들이 고아가 되므로 막는다.
            canDelete: directCnt === 0 && !hasSubfolders(f.id),
            isDrive: false,
          };
        })
    : [];
  const folderCards = isDriveSpace ? driveFolderCardsRaw : localFolderCards;

  // ---- 전역 검색 결과 (스페이스별 묶음) ----
  /**
   * 질의가 있으면 **모든 스페이스**를 뒤져 스페이스별로 묶어 돌려준다.
   *
   * 왜 화면을 바꾸나: 검색이 전역이 된 순간, 스페이스 헤더 아래에서 그리드를 거르는
   * 방식은 거짓말이 된다(다른 스페이스 것이 이 스페이스의 목록인 척한다). 그래서
   * 검색 중에는 본문이 통째로 "검색 결과" 화면으로 바뀌고, 결과는 어느 스페이스의
   * 것인지 헤더로 드러난다.
   *
   * 메뉴 가림: 다른 스페이스의 결과 카드는 **폴더 이동/폴더에서 빼기**를 내주지
   * 않는다 — `mapFolders`는 폴더 id만 들고 있어서, A 스페이스의 맵을 B 스페이스의
   * 폴더에 배정하면 어느 목록에도 나타나지 않는 미아가 된다. 스페이스 이동은
   * 안전하다(`moveMapToSpace`가 key로 원본 스페이스를 스스로 찾는다).
   */
  const searchGroups: SearchGroupViewData[] = [];
  if (searching) {
    for (const sp of state.spaces) {
      const spFolders = Array.isArray(sp.folders) ? sp.folders : [];
      const ancestorsOf = (f: FolderData): FolderData[] => {
        const out: FolderData[] = [];
        let cur: FolderData | undefined = f;
        let guard = 0;
        while (cur?.parent && guard++ < 30) {
          cur = spFolders.find((x) => x.id === cur!.parent);
          if (!cur) break;
          out.push(cur);
        }
        return out;
      };
      const pathNameOf = (f: FolderData): string => [...ancestorsOf(f).reverse().map((a) => a.name), f.name].join(' / ');
      const spMaps = Array.isArray(sp.maps) ? sp.maps : [];
      const isActive = sp.id === state.activeSpace;
      const spColor = sp.color || '#f0663f';
      // 다른 스페이스로 이동: **그 카드가 지금 있는 스페이스**만 뺀다(활성 스페이스가
      // 아니라). 검색 결과는 여러 스페이스에서 오므로 대상이 카드마다 다르다.
      const moveTargets = state.spaces.filter((x) => x.id !== sp.id).map((x) => ({ id: x.id, name: x.name, color: x.color || '#f0663f' }));

      const cards: CardViewData[] = spMaps
        .filter((m) => !isTrashedCard(m.title, m.docId))
        .filter((m) => matchesSearch(m.title, m.docId, query, state.previewDocs))
        .map((m) => {
          const key = cardKeyOf(m.title, m.docId);
          const assigned = state.mapFolders[key];
          const f = assigned ? spFolders.find((x) => x.id === assigned) : undefined;
          return {
            key,
            title: m.title,
            when: m.when,
            updatedAt: m.docId ? state.docTimes[m.docId] : undefined,
            editorName: m.docId ? state.editorNames[m.docId] : undefined,
            sharedLabel: sharedLabelOf(m.docId, state.sharedByMe),
            hue: m.hue,
            docId: m.docId,
            href: mapHref(m.title, m.docId),
            sketch: cardSketch(m.title, m.hue, m.docId, state.previewDocs, state.previewResolved),
            badge: '',
            openable: true,
            isFav: !!state.favs[key],
            isDrive: false,
            menuOpen: state.ctxMenu?.target.kind === 'map' && state.ctxMenu.target.key === key,
            selected: state.selectedCard === key,
            dragging: false,
            dragOverTarget: false,
            showRenameRow: !!m.docId,
            showShareRow: !!m.docId,
            showFavRow: true,
            // 폴더 이동은 **같은 스페이스를 보고 있을 때만** — 위 주석 참고.
            showMoveRow: isActive && spFolders.length > 0,
            showSpaceMoveRow: moveTargets.length > 0,
            showUnfolderRow: isActive && !!f,
            showDivider: true,
            moveTargets: isActive ? spFolders.map((x) => ({ id: x.id, name: pathNameOf(x) })) : [],
            spaceMoveTargets: moveTargets,
            pathLabel: f ? pathNameOf(f) : '',
          };
        });

      const folderResults: FolderCardViewData[] = spFolders
        .filter((f) => f.name.toLowerCase().includes(query))
        .map((f) => {
          const ids = new Set<string>([f.id]);
          let grew = true;
          let guard = 0;
          while (grew && guard++ < 30) {
            grew = false;
            spFolders.forEach((x) => {
              if (x.parent && ids.has(x.parent) && !ids.has(x.id)) {
                ids.add(x.id);
                grew = true;
              }
            });
          }
          return {
            id: f.id,
            name: pathNameOf(f),
            count: spMaps.filter((m) => {
              const a = state.mapFolders[cardKeyOf(m.title, m.docId)];
              return !!a && ids.has(a);
            }).length,
            menuOpen: false,
            dragOver: false,
            selected: false,
            // 검색 결과의 폴더 타일은 "여기 있어요"를 알려 주는 바로가기다 —
            // 삭제 같은 조작은 그 스페이스로 들어가서 한다.
            canDelete: false,
            isDrive: false,
          };
        });

      if (cards.length || folderResults.length) {
        searchGroups.push({ spaceId: sp.id, spaceName: sp.name, spaceColor: spColor, isActive, cards, folders: folderResults });
      }
    }
  }
  const searchTotal = searchGroups.reduce((n, g) => n + g.cards.length + g.folders.length, 0);

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
  const recentResolve = new Map<string, { title: string; when: string; hue: string; docId?: string; spaceColor: string; spaceName: string; folderName?: string }>();
  state.spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    // 폴더 배정(`mapFolders`)은 카드키로 저장되고 폴더 id는 스페이스별로 스코프되므로,
    // 이름은 반드시 이 맵을 소유한 스페이스의 `folders`에서만 찾는다(다른 스페이스에
    // 같은 id가 있어도 오염되지 않도록). 배정이 없거나 폴더가 지워졌으면 undefined →
    // 경로는 스페이스명만으로 구성된다.
    const fid = state.mapFolders[cardKeyOf(m.title, m.docId)];
    const folderName = fid ? (Array.isArray(s.folders) ? s.folders : []).find((f) => f.id === fid)?.name : undefined;
    const info = { ...m, spaceColor: s.color || '#f0663f', spaceName: s.name, folderName };
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
      const path = buildCardPath(base.spaceName, base.folderName, base.title);
      return {
        key,
        title: base.title,
        when: base.when,
        updatedAt: base.docId ? state.docTimes[base.docId] : undefined,
        editorName: base.docId ? state.editorNames[base.docId] : undefined,
        sharedLabel: sharedLabelOf(base.docId, state.sharedByMe),
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
        showRenameRow: false,
        showShareRow: false,
        showFavRow: false,
        showMoveRow: false,
        showSpaceMoveRow: false,
        showUnfolderRow: false,
        showDivider: false,
        moveTargets: [],
        spaceMoveTargets: [],
        spaceColor: base.spaceColor,
        spaceName: base.spaceName,
        pathLabel: path.label,
        pathFull: path.full,
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
  const isEmpty = !loading && !searching && !showDriveConnect && allCards.length === 0 && !curFolder && folderCards.length === 0;
  // "이 폴더는 비어 있어요"는 맵도 하위 폴더도 없을 때만 — 하위 폴더가 있으면
  // 폴더 구획이 그려지므로 빈 안내가 그 위에 겹치면 안 된다.
  const folderEmpty = !loading && !searching && !!curFolder && allCards.length === 0 && folderCards.length === 0;
  /** 검색 결과 없음 — "아직 만든 맵이 없어요"(+새로 만들기 CTA)를 여기 쓰면
   * 맵이 있는데도 없다고 말하는 셈이 된다. */
  const searchEmpty = !loading && searching && searchTotal === 0 && !state.searchBodiesLoading;

  // 제목 줄 = [상위 경로, 현재 폴더] — 중첩 폴더면 상위 경로가
  // "스페이스 / 상위폴더 / …"로 깊어진다(헤더는 …로 접고 전체는 툴팁에).
  const rootName = isDriveSpace ? 'Google Drive' : activeSpaceObj ? activeSpaceObj.name : '일반 스페이스';
  const openFolderName = isDriveSpace ? driveFolder?.name : curFolder?.name;
  const parentChain = curFolder ? folderAncestors(curFolder).reverse().map((f) => f.name) : [];
  const titleParent = openFolderName ? [rootName, ...parentChain].join(' / ') : null;
  const titleLeaf = openFolderName || rootName;

  // 공유받은 맵 — `state.sharedMaps`(DocStore.list의 남의 문서)로만 만든다. 내
  // 워크스페이스에는 없는 문서라 스페이스/폴더 필터를 타지 않는다.
  const sharedItems = state.sharedMaps
    .filter((m) => !isTrashedCard(m.title, m.docId))
    .map((m) => ({ docId: m.docId, title: m.title, href: mapHref(m.title, m.docId), role: m.role, isNew: m.isNew }));
  const sharedUnread = sharedItems.filter((m) => m.isNew).length;

  return {
    connected,
    isDriveSpace,
    activeSpaceName: activeSpaceObj ? activeSpaceObj.name : '일반 스페이스',
    isHome,
    spaceTitle: titleParent ? `${titleParent} / ${titleLeaf}` : titleLeaf,
    titleParent,
    titleLeaf,
    curFolder,
    driveFolder,
    folders,
    driveFoldersVisible: state.driveFolders,
    allCards,
    folderCards,
    recentCards,
    sharedItems,
    sharedUnread,
    // LNB 항목이므로 폴더/검색 화면에서도 그대로 있다 — 사이드바는 "지금 보고 있는
    // 목록"이 아니라 어디로든 가는 길이다.
    sharedVisible: !loading,
    favItems,
    favCount: favItems.length ? String(favItems.length) : '',
    trashItems: state.trash.map((t) => ({ title: t.title, isDrive: t.source === 'drive', badge: t.source === 'drive' ? 'Drive' : '내 스페이스', docId: t.docId })),
    trashCount: state.trash.length ? String(state.trash.length) : '',
    loading,
    isEmpty,
    folderEmpty,
    searchEmpty,
    searchQuery: searching ? state.search.trim() : '',
    searchCount: searchTotal,
    searchGroups,
    searchLoading: searching && state.searchBodiesLoading,
    showDriveConnect,
    backVisible: !!(curFolder || driveFolder),
    // `새 폴더`는 폴더 안에서도 쓸 수 있다(중첩 폴더) — 현재 폴더가 부모가 된다
    // (`useHomeController.saveFolderModal`). Drive 데모 폴더만 한 단계 유지.
    newFolderVisible: !(isDriveSpace && (!connected || driveFolder)),
    // 폴더 안에서도 가져올 수 있다 — 가져온 맵은 그 폴더에 들어간다
    // (`useHomeController`의 import 커밋). 예전엔 폴더 안에서 버튼이 사라져,
    // 폴더에 파일을 넣으려면 최상위로 나가서 가져온 뒤 다시 옮겨야 했다.
    importVisible: !isDriveSpace,
    // Global cross-space tray at the top of Home. It's GLOBAL — independent of
    // which space OR folder is being browsed — so it stays visible inside
    // folders too (hiding it there made "이어하기" vanish mid-navigation). Hidden
    // only while searching (it sits above the results and isn't filtered by the
    // query) and on the Drive-connect prompt (a full-screen empty state).
    recentSectionVisible: !loading && !state.search && !showDriveConnect && recentCards.length > 0,
    foldersSectionVisible: !loading && !searching && folderCards.length > 0,
    // Only render the "맵" section when there are actually maps to show — a space
    // with folders but no loose maps must not render an empty "맵" header.
    mapsSectionVisible: !loading && !searching && !showDriveConnect && allCards.length > 0,
    userInitial: (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M',
  };
}

export { hexA, mapId };
