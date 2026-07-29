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
  /** 남이 나에게 공유한 맵들(0009). 내 스페이스·폴더에 속하지 않으므로 별도 섹션으로
   * 그린다 — 카드에 ☰ 메뉴·드래그는 없다(내 문서가 아니라 옮기거나 지울 수 없다). */
  sharedCards: CardViewData[];
  sharedSectionVisible: boolean;
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
  const isEmpty = !loading && !showDriveConnect && allCards.length === 0 && !curFolder && folderCards.length === 0;
  const folderEmpty = !loading && !!curFolder && allCards.length === 0;

  // 제목 줄 = [상위(스페이스), 현재(폴더)] 중 폴더 안일 때만 두 조각.
  const rootName = isDriveSpace ? 'Google Drive' : activeSpaceObj ? activeSpaceObj.name : '일반 공간';
  const openFolderName = isDriveSpace ? driveFolder?.name : curFolder?.name;
  const titleParent = openFolderName ? rootName : null;
  const titleLeaf = openFolderName || rootName;

  // 공유받은 맵 — `state.sharedMaps`(DocStore.list의 남의 문서)로만 만든다. 내
  // 워크스페이스에는 없는 문서라 스페이스/폴더 필터를 타지 않는다.
  const sharedCards: CardViewData[] = state.sharedMaps
    .filter((m) => !isTrashedCard(m.title, m.docId))
    .map((m) => ({
      key: m.docId,
      title: m.title,
      when: '공유받은 맵',
      updatedAt: m.updatedAt,
      hue: '#3f8fd0',
      docId: m.docId,
      href: mapHref(m.title, m.docId),
      sketch: cardSketch(m.title, '#3f8fd0', m.docId, state.previewDocs, state.previewResolved),
      badge: '',
      openable: true,
      isFav: false,
      isDrive: false,
      menuOpen: false,
      selected: state.selectedCard === m.docId,
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
      pathLabel: m.role === 'view' ? '보기 전용' : '함께 편집',
      pathFull: m.role === 'view' ? '공유받은 맵 · 보기 전용' : '공유받은 맵 · 함께 편집',
    }));

  return {
    connected,
    isDriveSpace,
    activeSpaceName: activeSpaceObj ? activeSpaceObj.name : '일반 공간',
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
    sharedCards,
    // 폴더 안이나 검색 중에는 감춘다 — 그 화면은 "지금 보고 있는 목록"에 집중해야 하고,
    // 공유받은 맵은 스페이스/폴더에 속하지 않아 그 목록의 일부가 아니다.
    sharedSectionVisible: !loading && !state.search && !curFolder && !driveFolder && !showDriveConnect && sharedCards.length > 0,
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
    // 폴더 안에서도 가져올 수 있다 — 가져온 맵은 그 폴더에 들어간다
    // (`useHomeController`의 import 커밋). 예전엔 폴더 안에서 버튼이 사라져,
    // 폴더에 파일을 넣으려면 최상위로 나가서 가져온 뒤 다시 옮겨야 했다.
    // `새 폴더`는 계속 최상위 전용이다 — 폴더 모델이 한 단계(스페이스 → 폴더 → 맵)라
    // 폴더 안에서 만든 폴더는 최상위에 생겨 방금 만든 게 사라진 것처럼 보인다.
    importVisible: !isDriveSpace,
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
