import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { HomeState, SpaceData } from '../types';
import type { HomeController } from '../useHomeController';
import type { CardViewData, FolderCardViewData, HomeViewModel } from '../viewModel';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { docKindOf } from '../viewModel';
import { isCalItem, sizesFor } from '../dashboard/model';
import { mapHref } from '../storage';

/**
 * 홈의 **단 하나뿐인** 메뉴 — 맵 카드·폴더·빈 배경이 모두 이걸 쓴다.
 *
 * 여는 길은 둘(카드의 ☰ 버튼, 마우스 우클릭)이고 다른 건 뜨는 자리뿐이다. 예전에는
 * 카드마다 자기 메뉴를 품고 있었고 하위 메뉴(내보내기·이동)는 패널 안을 **갈아 끼우는**
 * 드릴다운이었다 — "‹ 뒤로"로 되돌아가야 했고, 배경 우클릭처럼 카드가 없는 자리는
 * 아예 메뉴를 열 데가 없었다. 지금은 에디터 우클릭 메뉴와 같은 문법이다:
 * 커서 자리에 뜨고, 하위 메뉴는 **옆으로 뻗는 플라이아웃**이다.
 *
 * 자리·닫기·키보드는 **Radix DropdownMenu**가 맡는다(`components/Menu.tsx`와 같은
 * 판단): 예전에는 클릭 지점에서 화면 밖으로 나가지 않게 높이를 행 수로 **어림해**
 * 당겼고(그래서 힌트가 붙은 행이 있으면 어림이 틀렸다), 바깥 클릭·Escape 리스너를
 * 손으로 달았고, **키보드로는 아무것도 할 수 없었다**. 트리거는 클릭 지점에 놓인
 * 0×0 자리표시자이고 메뉴는 그 자리를 기준으로 실제 크기를 재서 선다.
 *
 * 좁은 화면(폰)만 예외다 — 플라이아웃이 양옆 어디에도 못 뻗으므로 부모 **아래로**
 * 펼친다(모바일 메뉴의 흔한 꼴). 그건 `Sub`로 표현할 수 없어 같은 패널 안에 항목을
 * 이어 그린다(그래도 항목이라 화살표 이동에 함께 걸린다).
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
/** 손가락용 행 높이 — 앱 전체가 지켜 온 44px 터치 타깃 규칙. */
const TOUCH_ROW_H = 44;
const MARGIN = 8;

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

/** 행 내용 — 항목과 플라이아웃 부모가 같은 모양을 쓴다. */
function RowBody({ item }: { item: HomeMenuItem }) {
  return (
    <>
      {item.icon && <span style={{ display: 'flex', flexShrink: 0, color: item.danger ? 'inherit' : 'var(--mf-subtext)' }}>{item.icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {item.submenu && <span style={{ color: 'var(--mf-faint)', flexShrink: 0 }}>›</span>}
    </>
  );
}

const SEP_STYLE: CSSProperties = { height: 1, background: 'var(--mf-border-soft)', margin: '4px 0' };

/** 플라이아웃(하위 메뉴) 패널 — 본 메뉴와 같은 면·라운드·그늘. */
const SUB_PANEL: CSSProperties = {
  width: SUB_W,
  maxHeight: 'calc(100dvh - 24px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  background: 'var(--mf-panel)',
  border: '1px solid var(--mf-border)',
  borderRadius: 11,
  boxShadow: '0 12px 32px rgba(0,0,0,.18)',
  padding: '5px 0',
  zIndex: 141,
};

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
}

export function HomeContextMenu({ state, view, controller }: Props) {
  const ctx = state.ctxMenu;
  const isMobile = useIsMobile();
  const [openSub, setOpenSub] = useState<string | null>(null);

  // 대상이 바뀌면(다른 카드를 우클릭) 열려 있던 플라이아웃은 접는다.
  const targetKey = ctx ? JSON.stringify(ctx.target) : '';
  useEffect(() => {
    setOpenSub(null);
  }, [targetKey]);

  if (!ctx) return null;
  const items = buildItems(ctx.target, state, view, controller);
  if (!items.length) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  // 좁은 화면(폰)에서는 플라이아웃이 양옆 어디에도 못 뻗는다 — 그때는 부모 **아래로
  // 펼친다**(모바일 메뉴의 흔한 꼴). 안 그러면 하위 목록이 화면 밖으로 나간다.
  const subInline = MENU_W + SUB_W + MARGIN * 2 > vw;

  const run = (item: HomeMenuItem) => {
    item.onSelect?.();
    controller.closeMenu();
  };

  /** 잎 항목 — 고르면 실행하고 메뉴는 Radix가 닫는다. */
  const leaf = (item: HomeMenuItem) => (
    <DropdownMenu.Item
      key={item.key}
      className="menu-row"
      disabled={item.disabled}
      onSelect={() => run(item)}
      style={rowStyle(item, isMobile)}
    >
      <RowBody item={item} />
    </DropdownMenu.Item>
  );

  return (
    <DropdownMenu.Root
      open
      onOpenChange={(next) => {
        if (!next) controller.closeMenu();
      }}
      modal={false}
    >
      {/* 트리거는 **클릭 지점에 놓인 0×0 자리표시자**다 — 메뉴가 그 자리를 기준으로
          자기 실제 크기를 재서 서므로, 예전처럼 높이를 행 수로 어림할 필요가 없다.
          포인터를 받지 않으므로 이 자리표시자가 클릭을 가로채지도 않는다. */}
      <DropdownMenu.Trigger
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'fixed', left: ctx.x, top: ctx.y, width: 0, height: 0, padding: 0, border: 'none', background: 'none', pointerEvents: 'none' }}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // `.mf-home-ctx`는 계속 붙인다 — 마퀴 시작 가드와 "카드 밖 클릭이면 선택
          // 해제" 가드가 이 이름으로 메뉴 안을 알아본다(포털로 나가도 `closest`는
          // DOM 조상을 보므로 그 판단은 그대로 성립한다).
          className="mf-home-ctx"
          data-home-ctx={ctx.target.kind}
          align="start"
          side="bottom"
          sideOffset={0}
          collisionPadding={MARGIN}
          onContextMenu={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={{
            width: MENU_W,
            boxSizing: 'border-box',
            maxHeight: 'calc(100dvh - 16px)',
            overflowY: 'auto',
            background: 'var(--mf-panel)',
            border: '1px solid var(--mf-border)',
            borderRadius: 11,
            boxShadow: '0 12px 32px rgba(0,0,0,.18)',
            padding: '5px 0',
            zIndex: 140,
          }}
        >
          {items.map((item) => {
            if (item.key.startsWith('sep')) return <DropdownMenu.Separator key={item.key} style={SEP_STYLE} />;
            if (!item.submenu) {
              return (
                <div key={item.key}>
                  {leaf(item)}
                  {/* 비활성 사유 — 행 아래 작은 글씨. 항목이 아니므로 화살표 이동에서 건너뛴다. */}
                  {item.hint && <div style={{ padding: '0 12px 7px', fontSize: 11, color: 'var(--mf-faint2)', lineHeight: 1.4 }}>{item.hint}</div>}
                </div>
              );
            }
            if (subInline) {
              const open = openSub === item.key;
              return (
                <div key={item.key}>
                  <DropdownMenu.Item
                    className="menu-row"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    // 부모 행은 **열기만** 한다 — 고르면 메뉴가 닫히는 기본 동작을 막는다.
                    onSelect={(e) => {
                      e.preventDefault();
                      setOpenSub(open ? null : item.key);
                    }}
                    style={{ ...rowStyle(item, isMobile), background: open ? 'var(--mf-accent-soft)' : 'transparent' }}
                  >
                    <RowBody item={item} />
                  </DropdownMenu.Item>
                  {open && (
                    <div role="group" data-home-ctx-sub={item.key} data-inline="true" style={{ background: 'var(--mf-sunken)', borderTop: '1px solid var(--mf-border-soft)', borderBottom: '1px solid var(--mf-border-soft)', padding: '4px 0 4px 14px', maxHeight: 220, overflowY: 'auto' }}>
                      {item.submenu.map((sub) => (sub.key.startsWith('sep') ? <DropdownMenu.Separator key={sub.key} style={SEP_STYLE} /> : leaf(sub)))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <DropdownMenu.Sub key={item.key} open={openSub === item.key} onOpenChange={(next) => setOpenSub(next ? item.key : null)}>
                <DropdownMenu.SubTrigger className="menu-row" style={{ ...rowStyle(item, isMobile), background: openSub === item.key ? 'var(--mf-accent-soft)' : 'transparent' }}>
                  <RowBody item={item} />
                </DropdownMenu.SubTrigger>
                {/* 포털을 쓰지 않는다 — 하위 메뉴가 본 메뉴 안(`.mf-home-ctx`)에 남아야
                    위 두 가드와 기존 조회(`menu.querySelector('[data-home-ctx-sub]')`)가
                    그대로 성립한다. 자리는 팝퍼가 잡으므로 잘리지 않는다. */}
                <DropdownMenu.SubContent data-home-ctx-sub={item.key} sideOffset={-4} alignOffset={-5} collisionPadding={MARGIN} style={SUB_PANEL}>
                  {item.submenu.map((sub) => (sub.key.startsWith('sep') ? <DropdownMenu.Separator key={sub.key} style={SEP_STYLE} /> : leaf(sub)))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Sub>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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

// ── 대시보드 위젯 메뉴 아이콘(디자인 원본 CTX_ICON 계열) ──────────────────
const OpenIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
const RefreshIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 12a9 9 0 1 0 2.6-6.3L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
const FrontIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="m5 11 7-7 7 7" />
    <path d="M12 4v16" />
  </svg>
);
const SizeIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="M15 3h6v6M9 21H3v-6" />
    <path d="M21 3 3 21" />
  </svg>
);
const CheckIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
    <path d="m5 13 4.5 4.5L19 7" />
  </svg>
);
const DotIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="2" fill="currentColor" />
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
    // 여러 장을 골라 두고 그중 하나를 우클릭 → 일괄 메뉴(요청). 우클릭이 선택 밖에서
    // 오면 `MapCard`가 먼저 그 카드 하나로 선택을 바꾸므로 여기서는 늘 참이다.
    const sel = state.selectedCards;
    if (sel.length > 1 && sel.includes(target.key)) {
      const cards = sel.map((k) => findCard(view, k)).filter((c): c is CardViewData => !!c);
      if (cards.length > 1) return multiItems(cards, controller);
    }
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
  if (target.kind === 'dash') {
    return dashItems(target.id, controller);
  }
  if (target.kind === 'widget') {
    return widgetItems(target.id, state, view, controller);
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

/**
 * 여러 장을 골라 두고 그중 하나를 우클릭했을 때의 메뉴(요청).
 *
 * 한 장에만 뜻이 있는 항목(이름 변경·공유·내보내기)은 내주지 않는다 — 여러 장에
 * 걸치면 무엇이 일어날지 예측되지 않는다. **즐겨찾기도 뺐다**(사용자 결정).
 * 폴더 이동은 **선택이 한 스페이스 안일 때만** — 폴더 id는 그 스페이스에서만
 * 유효해서, 전역 검색 결과처럼 여러 스페이스가 섞이면 미아가 생긴다(단일 카드
 * 메뉴의 `showMoveRow` 규칙과 같은 이유).
 */
function multiItems(cards: CardViewData[], controller: HomeController): HomeMenuItem[] {
  const items: HomeMenuItem[] = [];
  const keys = cards.map((c) => c.key);
  const n = cards.length;
  // 모두 같은 목록에서 왔고 그 목록이 폴더 이동을 내주는 경우에만.
  const first = cards[0]!;
  const sameTargets = cards.every((c) => c.showMoveRow && c.moveTargets.length === first.moveTargets.length && c.moveTargets.every((t, i) => t.id === first.moveTargets[i]?.id));
  if (sameTargets && first.moveTargets.length) {
    items.push({
      key: 'move',
      icon: FolderIcon,
      label: '폴더로 이동',
      submenu: first.moveTargets.map((ft) => ({ key: `move-${ft.id}`, icon: FolderIcon, label: ft.name, onSelect: () => controller.moveMapsToFolder(keys, ft.id) })),
    });
  }
  const spaceTargets = cards.every((c) => c.showSpaceMoveRow) ? first.spaceMoveTargets : [];
  if (spaceTargets.length) {
    items.push({
      key: 'space',
      icon: SpaceMoveIcon,
      label: '스페이스로 이동',
      submenu: spaceTargets.map((sp) => ({ key: `space-${sp.id}`, icon: <SpaceDot color={sp.color} />, label: sp.name, onSelect: () => controller.moveMapsToSpace(keys, sp.id) })),
    });
  }
  if (cards.every((c) => c.showUnfolderRow)) {
    items.push({ key: 'unfolder', icon: FolderOutIcon, label: '폴더에서 꺼내기', onSelect: () => controller.moveMapsToFolder(keys, null) });
  }
  if (items.length) items.push({ key: 'sep-1', label: '' });
  items.push({
    key: 'delete',
    icon: TrashIcon,
    label: `삭제하기 (${n}개)`,
    danger: true,
    onSelect: () => controller.askDeleteMany(cards.map((c) => ({ key: c.key, title: c.title, docId: c.docId }))),
  });
  return items;
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
        // 칸반에는 그릴 캔버스가 없다(좌표 없는 열·카드) — 그림 형식 셋은 빈
        // 파일이 되므로 내주지 않는다. 에디터 내보내기 메뉴와 같은 규칙.
        ...(card.isKanban
          ? []
          : [
              { key: 'export-png', icon: PngIcon, label: 'PNG 이미지', onSelect: () => controller.exportMapPNG(card.title, card.docId) },
              { key: 'export-svg', icon: SvgIcon, label: 'SVG 이미지 (.svg)', onSelect: () => controller.exportMapSVG(card.title, card.docId) },
              { key: 'export-pdf', icon: PdfIcon, label: 'PDF 문서 (.pdf)', onSelect: () => controller.exportMapPDF(card.title, card.docId) },
            ]),
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

/** LNB 대시보드 행 — 스페이스 행과 같은 문법(이름 변경·삭제). 삭제는 **배치만**
 * 지우므로(문서는 스페이스에 그대로) 스페이스처럼 "비어야만" 잠그지 않는다. */
function dashItems(id: string, controller: HomeController): HomeMenuItem[] {
  return [
    { key: 'rename', icon: PencilIcon, label: '이름 변경', onSelect: () => controller.openDashRename(id) },
    { key: 'sep-1', label: '' },
    { key: 'delete', icon: TrashIcon, label: '대시보드 삭제', danger: true, onSelect: () => controller.askDeleteDash(id) },
  ];
}

/**
 * 대시보드 위젯 메뉴 — 디자인 원본의 넷(열기·새로 불러오기·맨 앞으로·내리기) +
 * 크기 하위 목록. 크기는 종류별 최소(칸반 3×2) 아래를 잠근다.
 */
function widgetItems(itemId: string, state: HomeState, view: HomeViewModel, controller: HomeController): HomeMenuItem[] {
  const dash = state.dashboards.find((d) => d.id === state.activeDash);
  const item = dash?.items.find((it) => it.id === itemId);
  if (!item) return [];
  // 일정 위젯에는 가리킬 문서가 없다 — 여는 곳도 새로 불러올 것도 다르다.
  const cal = isCalItem(item);
  const docId = item.docId ?? '';
  const kind = cal ? 'cal' : docKindOf('', docId, state.previewDocs);
  const allowed = sizesFor(kind);
  const items: HomeMenuItem[] = [
    cal
      ? { key: 'open', icon: OpenIcon, label: '일정 화면 열기', onSelect: controller.openCalendar }
      : {
          key: 'open',
          icon: OpenIcon,
          label: '에디터에서 열기',
          onSelect: () => {
            const title = view.dashDocTitles[docId] ?? '';
            controller.openWithLoader(mapHref(title, docId), title, docId);
          },
        },
    ...(cal ? [] : [{ key: 'refresh', icon: RefreshIcon, label: '최신 내용 불러오기', onSelect: () => controller.refreshDashItem(docId) } as HomeMenuItem]),
    { key: 'front', icon: FrontIcon, label: '맨 앞으로 옮기기', onSelect: () => controller.dashItemToFront(item.id) },
    {
      key: 'size',
      icon: SizeIcon,
      label: '크기',
      submenu: allowed.map((sz) => ({
        key: `size-${sz}`,
        icon: item.size === sz ? CheckIcon : DotIcon,
        label: sz.replace('x', '×'),
        onSelect: () => controller.setDashItemSize(item.id, sz),
      })),
    },
    { key: 'sep-1', label: '' },
    { key: 'remove', icon: TrashIcon, label: '대시보드에서 내리기', danger: true, onSelect: () => controller.removeDashItem(item.id) },
  ];
  return items;
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
