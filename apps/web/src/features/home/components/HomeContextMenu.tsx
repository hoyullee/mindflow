import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { HomeState, SpaceData } from '../types';
import type { HomeController } from '../useHomeController';
import type { CardViewData, FolderCardViewData, HomeViewModel } from '../viewModel';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/**
 * 홈의 **단 하나뿐인** 메뉴 — 맵 카드·폴더·빈 배경이 모두 이걸 쓴다.
 *
 * 여는 길은 둘(카드의 ☰ 버튼, 마우스 우클릭)이고 다른 건 뜨는 자리뿐이다. 예전에는
 * 카드마다 자기 메뉴를 품고 있었고 하위 메뉴(내보내기·이동)는 패널 안을 **갈아 끼우는**
 * 드릴다운이었다 — "‹ 뒤로"로 되돌아가야 했고, 배경 우클릭처럼 카드가 없는 자리는
 * 아예 메뉴를 열 데가 없었다. 지금은 에디터 우클릭 메뉴와 같은 문법이다:
 * 커서 자리에 뜨고, 하위 메뉴는 **옆으로 뻗는 플라이아웃**이다.
 *
 * 위치는 뷰포트 좌표(`position: fixed`)라 카드의 transform·스크롤과 무관하게 선다.
 */

export interface HomeMenuItem {
  key: string;
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** 비활성 사유 — 행 아래 작은 글씨(예: "맵이 있는 폴더는 삭제할 수 없어요"). */
  hint?: string;
  submenu?: HomeMenuItem[];
  onSelect?: () => void;
}

const MENU_W = 184;
const SUB_W = 196;
const ROW_H = 34;
/** 손가락용 행 높이 — 앱 전체가 지켜 온 44px 터치 타깃 규칙. */
const TOUCH_ROW_H = 44;
const MARGIN = 8;

/** 행 수로 높이를 어림해 화면 밖으로 나가지 않게 당긴다(에디터 메뉴와 같은 방식). */
function estimateHeight(items: HomeMenuItem[], rowH: number): number {
  return items.reduce((h, it) => h + (it.key.startsWith('sep') ? 9 : rowH) + (it.hint ? 26 : 0), 10);
}

const rowStyle = (item: HomeMenuItem, isMobile: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  width: '100%',
  minHeight: isMobile ? TOUCH_ROW_H : undefined,
  padding: isMobile ? '10px 14px' : '8px 12px',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  lineHeight: 1.3,
  cursor: item.disabled ? 'not-allowed' : 'pointer',
  color: item.disabled ? 'var(--mf-faint2)' : item.danger ? 'var(--mf-danger)' : 'var(--mf-text)',
});

function Row({ item, open, isMobile, onOpenSub, onRun }: { item: HomeMenuItem; open: boolean; isMobile: boolean; onOpenSub: (key: string | null) => void; onRun: (item: HomeMenuItem) => void }) {
  return (
    <button
      type="button"
      className="menu-row"
      role="menuitem"
      aria-haspopup={item.submenu ? 'menu' : undefined}
      aria-expanded={item.submenu ? open : undefined}
      // 하위 메뉴는 마우스를 얹기만 해도 열린다(데스크톱 메뉴 관례). 클릭으로도
      // 열리게 두는 이유는 터치 — 터치에는 hover가 없다.
      onMouseEnter={() => onOpenSub(item.submenu ? item.key : null)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.disabled) return;
        // 하위 메뉴 부모는 클릭해도 **열기만** 한다. hover로 이미 열린 뒤의 클릭이
        // 토글로 다시 닫아 버리면(마우스는 얹은 채인데) 아무것도 안 되는 것처럼 보인다.
        if (item.submenu) {
          onOpenSub(item.key);
          return;
        }
        onRun(item);
      }}
      style={{ ...rowStyle(item, isMobile), background: open ? 'var(--mf-accent-soft)' : 'transparent' }}
    >
      {item.icon && <span style={{ display: 'flex', flexShrink: 0, color: item.danger ? 'inherit' : 'var(--mf-subtext)' }}>{item.icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {item.submenu && <span style={{ color: 'var(--mf-faint)', flexShrink: 0 }}>›</span>}
    </button>
  );
}

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
}

export function HomeContextMenu({ state, view, controller }: Props) {
  const ctx = state.ctxMenu;
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  // 대상이 바뀌면(다른 카드를 우클릭) 열려 있던 플라이아웃은 접는다.
  const targetKey = ctx ? JSON.stringify(ctx.target) : '';
  useEffect(() => {
    setOpenSub(null);
  }, [targetKey]);

  useEffect(() => {
    if (!ctx) return;
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) controller.closeMenu();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') controller.closeMenu();
    }
    // 캡처 단계 — 카드가 mousedown을 멈춰 세워도 메뉴는 닫힌다.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ctx, controller]);

  if (!ctx) return null;
  const items = buildItems(ctx.target, state, view, controller);
  if (!items.length) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(MARGIN, Math.min(ctx.x, vw - MENU_W - MARGIN));
  const rowH = isMobile ? TOUCH_ROW_H : ROW_H;
  const estH = estimateHeight(items, rowH);
  // 아래로 안 들어가면 클릭 지점 **위**로 뒤집는다(그래도 안 되면 위쪽 여백에 붙인다).
  const top = ctx.y + estH + MARGIN <= vh ? ctx.y : Math.max(MARGIN, Math.min(ctx.y - estH, vh - estH - MARGIN));
  // 플라이아웃은 기본 오른쪽. 오른쪽 공간이 모자라면 왼쪽으로 뒤집는다.
  const subOnLeft = left + MENU_W + SUB_W + MARGIN > vw;
  // 좁은 화면(폰)에서는 양옆 어디에도 못 뻗는다 — 그때는 부모 **아래로 펼친다**
  // (모바일 메뉴의 흔한 꼴). 안 그러면 하위 목록이 화면 밖으로 나간다.
  const subInline = MENU_W + SUB_W + MARGIN * 2 > vw;

  const run = (item: HomeMenuItem) => {
    item.onSelect?.();
    controller.closeMenu();
  };

  return (
    <div
      ref={rootRef}
      className="mf-home-ctx"
      role="menu"
      data-home-ctx={ctx.target.kind}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left,
        top,
        width: MENU_W,
        background: 'var(--mf-panel)',
        border: '1px solid var(--mf-border)',
        borderRadius: 11,
        boxShadow: '0 12px 32px rgba(0,0,0,.18)',
        padding: '5px 0',
        zIndex: 140,
      }}
    >
      {items.map((item, i) =>
        item.key.startsWith('sep') ? (
          <div key={item.key} style={{ height: 1, background: 'var(--mf-border-soft)', margin: '4px 0' }} />
        ) : (
          <div key={item.key} style={{ position: 'relative' }}>
            <Row item={item} open={openSub === item.key} isMobile={isMobile} onOpenSub={setOpenSub} onRun={run} />
            {item.hint && <div style={{ padding: '0 12px 7px', fontSize: 11, color: 'var(--mf-faint2)', lineHeight: 1.4 }}>{item.hint}</div>}
            {item.submenu && openSub === item.key && (
              <div
                role="menu"
                data-home-ctx-sub={item.key}
                data-inline={subInline ? 'true' : undefined}
                style={
                  subInline
                    ? { background: 'var(--mf-sunken)', borderTop: '1px solid var(--mf-border-soft)', borderBottom: '1px solid var(--mf-border-soft)', padding: '4px 0 4px 14px', maxHeight: 220, overflowY: 'auto' }
                    : {
                        position: 'absolute',
                        top: -5,
                        ...(subOnLeft ? { right: MENU_W - 4 } : { left: MENU_W - 4 }),
                        width: SUB_W,
                        maxHeight: Math.max(160, vh - top - i * rowH - MARGIN * 2),
                        overflowY: 'auto',
                        background: 'var(--mf-panel)',
                        border: '1px solid var(--mf-border)',
                        borderRadius: 11,
                        boxShadow: '0 12px 32px rgba(0,0,0,.18)',
                        padding: '5px 0',
                      }
                }
              >
                {item.submenu.map((sub) =>
                  sub.key.startsWith('sep') ? (
                    <div key={sub.key} style={{ height: 1, background: 'var(--mf-border-soft)', margin: '4px 0' }} />
                  ) : (
                    <Row key={sub.key} item={sub} open={false} isMobile={isMobile} onOpenSub={() => undefined} onRun={run} />
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

// ── 아이콘 ────────────────────────────────────────────────────────────────
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** 공유 — 에디터 툴바의 `ShareGlyph`(사람 + 더하기)와 같은 도형. 같은 동작은
 * 같은 표식으로 알아본다. */
const ShareIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="22" y1="11" x2="16" y2="11" />
  </svg>
);
const PencilIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const TrashIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const DownloadIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const UploadIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const FolderIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const FolderPlusIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <path d="M12 17v-6M9 14h6" />
  </svg>
);
const FolderOutIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <path d="M12 17v-6" />
    <path d="M9 13.5 12 11l3 2.5" />
  </svg>
);
const SpaceMoveIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M17.5 14v7M14 17.5h7" />
  </svg>
);
const PlusIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const GearIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09A1.65 1.65 0 0 0 21 10h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.6 1z" />
  </svg>
);
const PngIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);
const JsonIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const OutlineIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="11" y1="12" x2="20" y2="12" />
    <line x1="13" y1="18" x2="20" y2="18" />
    <circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
// 벡터(곡선+제어점) — 에디터 내보내기 메뉴의 SVG 아이콘과 같은 도형
const SvgIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M5 7c4 8 10 8 14 0" />
    <rect x="3" y="5" width="4" height="4" rx="1" />
    <rect x="17" y="5" width="4" height="4" rx="1" />
    <rect x="10" y="13" width="4" height="4" rx="1" />
  </svg>
);
// 인쇄물(문서+본문 줄) — 에디터 내보내기 메뉴의 PDF 아이콘과 같은 도형
const PdfIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

/**
 * 스페이스 표식 — LNB의 스페이스 행과 **같은 색 사각 점**이다. 예전엔 어느 스페이스든
 * 똑같은 격자 글리프였는데, 이 앱에서 스페이스를 알아보는 표식은 색이다(제보).
 */
function SpaceDot({ color }: { color: string }) {
  return <span style={{ width: 13, height: 13, borderRadius: 4, background: color, display: 'inline-block', flexShrink: 0 }} />;
}

// ── 대상별 항목 ───────────────────────────────────────────────────────────
function buildItems(target: NonNullable<HomeState['ctxMenu']>['target'], state: HomeState, view: HomeViewModel, controller: HomeController): HomeMenuItem[] {
  if (target.kind === 'map') {
    const card = findCard(view, target.key);
    return card ? mapItems(card, controller) : [];
  }
  if (target.kind === 'folder') {
    const folder = view.folderCards.find((f) => f.id === target.id);
    return folder ? folderItems(folder, controller) : [];
  }
  if (target.kind === 'space') {
    const space = state.spaces.find((sp) => sp.id === target.id);
    return space ? spaceItems(space, state, controller) : [];
  }
  return bgItems(controller);
}

function findCard(view: HomeViewModel, key: string): CardViewData | undefined {
  // 검색 결과 카드도 찾아야 한다 — 전역 검색 중에는 그리드(`allCards`)에 없고
  // 스페이스별 묶음 안에만 있으며, 그쪽 카드는 메뉴 항목이 다르다(폴더 이동 가림).
  return (
    view.allCards.find((c) => c.key === key) ||
    view.searchGroups.flatMap((g) => g.cards).find((c) => c.key === key) ||
    view.recentCards.find((c) => c.key === key)
  );
}

function mapItems(card: CardViewData, controller: HomeController): HomeMenuItem[] {
  const items: HomeMenuItem[] = [];
  // "새 탭에서 열기"는 #345에서 넣었다가 사용자 결정으로 뺐다 — 안 쓰는 항목은
  // 목록만 늘린다. 새 탭이 필요하면 카드 링크를 Ctrl/⌘+클릭하면 된다(카드는
  // 여전히 `<a href>`다).
  if (card.showFavRow) {
    items.push({
      key: 'fav',
      icon: <span style={{ color: 'var(--mf-star)' }}>★</span>,
      label: card.isFav ? '즐겨찾기 해제' : '즐겨찾기',
      onSelect: () => controller.toggleFav(card.title, card.docId),
    });
  }
  if (card.showRenameRow) {
    items.push({ key: 'rename', icon: PencilIcon, label: '이름 변경', onSelect: () => controller.startRenameMap(card.key) });
  }
  // 공유(요청) — 맵을 열지 않고 여기서 바로 초대·링크 공유. 팝업은 에디터가 쓰는
  // 그 `ShareModal` 그대로다(색만 홈 테마).
  if (card.showShareRow && card.docId) {
    const docId = card.docId;
    items.push({ key: 'share', icon: ShareIcon, label: '공유', onSelect: () => controller.openShareFor(docId) });
  }
  if (card.showFavRow) {
    items.push({
      key: 'export',
      icon: DownloadIcon,
      label: '내보내기',
      submenu: [
        { key: 'export-png', icon: PngIcon, label: 'PNG 이미지', onSelect: () => controller.exportMapPNG(card.title, card.docId) },
        { key: 'export-svg', icon: SvgIcon, label: 'SVG 이미지 (.svg)', onSelect: () => controller.exportMapSVG(card.title, card.docId) },
        { key: 'export-pdf', icon: PdfIcon, label: 'PDF 문서 (.pdf)', onSelect: () => controller.exportMapPDF(card.title, card.docId) },
        { key: 'export-json', icon: JsonIcon, label: 'JSON 파일 (.json)', onSelect: () => controller.exportMap(card.title, card.docId) },
        { key: 'export-md', icon: OutlineIcon, label: 'Markdown 개요 (.md)', onSelect: () => controller.exportMapMarkdown(card.title, card.docId) },
      ],
    });
  }
  if (card.showMoveRow) {
    items.push({
      key: 'move',
      icon: FolderIcon,
      label: '폴더로 이동',
      submenu: card.moveTargets.map((ft) => ({ key: `move-${ft.id}`, icon: FolderIcon, label: ft.name, onSelect: () => controller.moveMapToFolder(card.key, ft.id) })),
    });
  }
  if (card.showSpaceMoveRow) {
    items.push({
      key: 'space',
      icon: SpaceMoveIcon,
      label: '스페이스로 이동',
      submenu: card.spaceMoveTargets.map((sp) => ({ key: `space-${sp.id}`, icon: <SpaceDot color={sp.color} />, label: sp.name, onSelect: () => controller.moveMapToSpace(card.key, sp.id) })),
    });
  }
  if (card.showUnfolderRow) {
    items.push({ key: 'unfolder', icon: FolderOutIcon, label: '폴더에서 꺼내기', onSelect: () => controller.moveMapToFolder(card.key, null) });
  }
  if (items.length) items.push({ key: 'sep-1', label: '' });
  items.push({ key: 'delete', icon: TrashIcon, label: '삭제하기', danger: true, onSelect: () => controller.askDelete(card.title, card.docId) });
  return items;
}

function folderItems(folder: FolderCardViewData, controller: HomeController): HomeMenuItem[] {
  return [
    {
      key: 'rename',
      icon: PencilIcon,
      label: '이름 변경',
      onSelect: () => (folder.isDrive ? controller.startRenameDriveFolder(folder.id) : controller.startRenameFolder(folder.id)),
    },
    { key: 'sep-1', label: '' },
    {
      key: 'delete',
      icon: TrashIcon,
      label: '폴더 삭제',
      danger: true,
      // 내용이 있어도 지울 수 있다(요청) — 안의 맵·하위 폴더는 지워지지 않고 한 단계
      // 위로 올라온다. 무엇이 어디로 가는지는 확인창이 말해 준다.
      onSelect: () => controller.askDeleteFolder(folder.id),
    },
  ];
}

/**
 * 스페이스 행 메뉴 — LNB의 ⋮ 버튼이 열던 팝오버를 그대로 옮겨 왔다(같은 두 항목,
 * 같은 삭제 불가 안내). 이제 홈의 다른 메뉴들과 한 컴포넌트를 쓴다.
 */
function spaceItems(space: SpaceData, state: HomeState, controller: HomeController): HomeMenuItem[] {
  const hasMaps = Array.isArray(space.maps) && space.maps.some((m) => !state.deleted[m.title]);
  const isLastSpace = state.spaces.length <= 1;
  return [
    { key: 'rename', icon: PencilIcon, label: '이름 변경', onSelect: () => controller.startRenameSpace(space.id) },
    { key: 'sep-1', label: '' },
    {
      key: 'delete',
      icon: TrashIcon,
      label: '스페이스 삭제',
      danger: true,
      disabled: hasMaps || isLastSpace,
      hint: hasMaps ? '맵이 없는 스페이스만 삭제할 수 있어요' : isLastSpace ? '마지막 스페이스는 삭제할 수 없어요' : undefined,
      onSelect: () => controller.askDeleteSpace(space.id),
    },
  ];
}

/**
 * 빈 자리 메뉴 — 지금 이 화면이 **실제로 할 수 있는 일**만 담는다.
 *
 * 검토하고 뺀 것: "붙여넣기"(홈에는 맵 클립보드가 없다), "정렬·보기 바꾸기"(그런
 * 설정 자체가 없다), "새로 고침"(브라우저가 이미 한다). 열어 봐야 아무 일도 없는
 * 항목은 없느니만 못하다.
 */
function bgItems(controller: HomeController): HomeMenuItem[] {
  return [
    { key: 'new-map', icon: PlusIcon, label: '새로 만들기', onSelect: controller.openTemplates },
    { key: 'new-folder', icon: FolderPlusIcon, label: '새 폴더', onSelect: controller.openNewFolder },
    { key: 'import', icon: UploadIcon, label: '가져오기', onSelect: controller.openImport },
    { key: 'sep-1', label: '' },
    { key: 'settings', icon: GearIcon, label: '설정', onSelect: controller.openAccountSettings },
  ];
}
