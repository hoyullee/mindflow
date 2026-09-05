import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { ContextMenuState } from '../types';
import type { ArrangeOp } from '../arrange';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { colorOf } from '../tree';
import { panelTitleLine } from './panel/panelPrimitives';
import { comboLabel, deleteKeyLabel, enterKeyLabel, renameKeyLabel } from '../shortcutLabels';
// 이미지/영역 아이콘은 상단 툴바 '삽입' 메뉴와 같은 SVG를 공유 — 두 진입점이
// 같은 동작이므로 같은 그림이어야 한다.
import { CommentIcon, ImageIcon, ZoneIcon } from './ToolbarMenus';
import { BOARD_BAR_LIFT } from './BoardToolbar';
import { editorMenuTone } from './menuTone';
import {
  MENU_GLYPH_STYLE,
  MENU_HEAD_DOT_STYLE,
  MENU_HEAD_STYLE,
  MENU_LABEL_STYLE,
  MENU_ROW_H,
  MENU_TOUCH_ROW_H,
  menuDividerStyle,
  menuHeadTitleStyle,
  menuKeyStyle,
  menuPanelStyle,
  menuRowStyle,
} from '../../../components/menuDesign';

/** 폭만 이 메뉴가 정한다 — 나머지(행 높이·글자·간격·그림자·hover)는 앱의 우클릭
 * 메뉴 디자인 한곳(`components/menuDesign.ts`)에서 온다. 기준은 칸반 카드 메뉴다
 * (제보: 같은 우클릭인데 화면마다 글자 크기·간격·굵기가 달랐다).
 * 폭은 244다 — 행 글자가 13.5px로 커지고 단축키가 함께 서므로 226에서는 라벨이
 * 말줄임으로 접힌다. */
const MENU_W = 244;
const ROW_HEIGHT = MENU_ROW_H;
const SUB_W = 176;
const GAP = 12;

interface ContextMenuProps {
  controller: EditorController;
}

interface MenuItem {
  icon: ReactNode;
  label: string;
  /** 플라이아웃이 딸린 행 — 오른쪽에 셰브론이 붙는다(디자인 원본). */
  sub?: boolean;
  /** 오른쪽에 등폭으로 적는 단축키. 터치 기기에서는 그리지 않는다(`shortcutLabels`). */
  keys?: string;
  danger?: boolean;
  /** Highlights the row accent-colored (the "텍스트 정렬 ▸" parent while its flyout is open,
   * or the currently-active alignment inside the flyout) — port of the original's
   * `this.state.ctxSub ? th.accent : th.text` / `alignOf === v ? th.accent : ...` (MindFlow.dc.html:3121, 3163). */
  active?: boolean;
  onSelect: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * Right-click context menu — port of `Component#ctxMenuItems`/`ctxSubItems` +
 * the `.mf-ctx` template block (MindFlow.dc.html:445-458, 3101-3167). Opens at
 * the right-clicked screen point (`controller.ctxMenu`, set by
 * `useEditorState`'s `onContextMenu`/`openCtxAt`/`hitTestAll`); closes on an
 * outside click, Escape, or after any item runs.
 */
export function ContextMenu({ controller }: ContextMenuProps) {
  const { ctxMenu, ctxSub, uiTheme: th } = controller;
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 모바일: 손가락에 맞는 행 높이 + 선택 바와 겹치는 항목(하위/형제/삭제) 제외.
  const isMobile = useIsMobile();

  // Outside click / Escape close it — port of the original's window `mousedown` capture
  // listener + `.mf-ctx` `closest()` check (MindFlow.dc.html:818-819, 824). Escape-closes
  // is an explicit addition over the original (which never actually clears `ctxMenu` on
  // Escape, only whatever selection happens to be underneath) — a reasonable safety net
  // requested alongside outside-click/auto-close-on-select.
  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) controller.closeCtxMenu();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') controller.closeCtxMenu();
    }
    // ⚠️ 캡처 단계로 듣는다. 버블 리스너였을 때: 노드 텍스트 편집 박스는
    // mousedown을 stopPropagation한다(배경 마퀴 누수 차단 — NodeEditBox 참고).
    // React는 루트 컨테이너에서 위임 처리하므로 그 stopPropagation이 window까지의
    // 네이티브 버블도 끊고, 편집 중 우클릭으로 메뉴를 연 뒤 편집 박스 안에서
    // 텍스트를 선택하면 이 리스너가 아예 안 불려 메뉴가 계속 떠 있었다(제보).
    // 캡처는 어떤 stopPropagation보다 먼저 내려오면서 실행된다.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ctxMenu, controller]);

  if (!ctxMenu) return null;

  const vw = controller.vw || 600;
  const vh = controller.vh || 400;
  const anchor = ctxMenu.anchor;
  // 머리 줄 — [무엇을 겨누고 있는가]를 그 대상의 색 점과 함께 적는다(디자인 원본의
  // `ctxTitle`/`ctxDot`). 이름이 있는 대상은 그 이름을, 없으면 종류 이름을 쓴다.
  const head = menuHead(controller, ctxMenu);
  const title = head?.label ?? '';

  // 모바일 선택 바의 '메뉴(⋯)'에서 열린 경우: 클릭 지점에 뜨는 우클릭 메뉴가 아니라
  // **바에서 뻗어 나온 팝오버**로 그린다 — 바와 같은 패널/테두리/라운드(16)에
  // 손가락에 맞는 행 높이, 그리고 ⋯ 버튼을 가리키는 꼬리(caret)를 붙인다.
  // 디자인 원본(`Geurio 마인드맵 리디자인`)의 메뉴 폭·행 높이. 모바일은 손가락에
  // 맞춰 행을 키우고(44) 폭은 좁은 화면에 들어가게 조금 줄인다.
  const MW = isMobile ? 208 : MENU_W;
  const ROW_H = isMobile ? MENU_TOUCH_ROW_H : ROW_HEIGHT;
  let left: number;
  let top: number;
  let flipped = false;
  if (anchor) {
    const M = 8;
    // 메뉴 높이는 행 수로 추정(행 44 + 구분선 11 + 패딩 12) — 아래 공간이 부족하면
    // 바 위로 뒤집는다. 렌더 후 재측정 없이도 화면 밖으로 나가지 않게 하는 보수적 추정.
    const rows = buildItems(controller, ctxMenu, () => {}, null, isMobile);
    const estH = rows.reduce((h, it) => h + (it === 'divider' ? 13 : ROW_H), 14);
    left = Math.min(Math.max(anchor.x - MW / 2, M), Math.max(M, vw - MW - M));
    const below = anchor.bottom + 10;
    flipped = below + estH > vh - M && anchor.top - 10 - estH > M;
    top = flipped ? anchor.top - 10 - estH : below;
  } else {
    // port of `ctxMenuStyle` (MindFlow.dc.html:3101-3104): clamped to the viewport so the
    // menu never overflows past the right/bottom edge (pushes it left/up as it nears one).
    // 화면 밖으로 나가지 않게 당긴다 — 높이는 행 수로 어림한다(디자인 원본의
    // `ctxPos`와 같은 계산: 행 34 + 구분선 13 + 패딩 14 + 제목 줄 27).
    const rows = buildItems(controller, ctxMenu, () => {}, null, isMobile);
    const estH = rows.reduce((h, it) => h + (it === 'divider' ? 13 : ROW_H), 14) + (title ? 27 : 0);
    // 아래 여유 — 화이트보드·맵에는 하단 도구 막대가 떠 있고 그쪽 z가 더 높다.
    // 막대 높이를 비워 두지 않으면 마지막 행이 막대 뒤로 숨는다(실브라우저에서 확인).
    const bottomInset = controller.readOnly ? GAP : BOARD_BAR_LIFT + GAP;
    left = Math.max(GAP, Math.min(ctxMenu.sx, vw - MW - GAP));
    top = Math.max(GAP, Math.min(ctxMenu.sy, vh - estH - bottomInset));
  }

  const tone = editorMenuTone(th);
  const menuStyle: CSSProperties = {
    ...menuPanelStyle(tone, MW),
    position: 'absolute',
    left,
    top,
    zIndex: 60,
  };

  const subKind = ctxSub?.kind ?? 'text';
  const items = buildItems(controller, ctxMenu, (top2, kind) => controller.toggleCtxSub(top2, kind), ctxSub ? subKind : null, isMobile);

  return (
    <div
      ref={rootRef}
      className="mf-ctx mf-menu-pop"
      style={menuStyle}
      // The menu is a child of `.mf-ed-vp` (which owns `onPointerDown={onBackgroundPointerDown}`).
      // Buttons stop `mousedown`, but a real click fires `pointerdown` FIRST — and that would
      // bubble to the viewport, start a background (marquee) drag, and its no-move `pointerup`
      // would CLEAR the selection (useEditorState `onUp`). For a single-button action that's
      // harmless (it ran on mousedown), but the "텍스트 정렬 ▸" flyout is two clicks: the first
      // click's pointerup would wipe the selection, so the second (an alignment) would target
      // nothing. Stopping `pointerdown` here keeps menu interaction from ever touching the canvas.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 꼬리(caret) — 바의 ⋯ 버튼을 가리켜 "이 바에서 나온 메뉴"로 읽히게 한다.
          패널과 같은 배경 + 두 변만 테두리를 준 사각형을 45° 돌려, 메뉴 테두리에
          자연스럽게 이어 붙인다(아래로 뒤집혔으면 반대쪽 변). */}
      {anchor && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: Math.min(Math.max(anchor.x - left - 5, 14), MW - 24),
            [flipped ? 'bottom' : 'top']: -6,
            width: 10,
            height: 10,
            background: th.panel,
            borderLeft: `1px solid ${th.border}`,
            borderTop: `1px solid ${th.border}`,
            transform: flipped ? 'rotate(225deg)' : 'rotate(45deg)',
            borderRadius: 2,
          }}
        />
      )}
      {/* 머리 — 색 점 + 대상 이름(디자인 원본). 어느 것을 겨눠서 열린 메뉴인지
          한 줄로 알려 준다. 이름이 길면 말줄임. */}
      {head && (
        <div data-ctx-head style={MENU_HEAD_STYLE}>
          <span aria-hidden="true" style={{ ...MENU_HEAD_DOT_STYLE, background: head.dot }} />
          <span style={menuHeadTitleStyle(tone)}>{head.label}</span>
        </div>
      )}
      {items.map((it, i) =>
        it === 'divider' ? (
          <div key={i} role="separator" style={menuDividerStyle(tone)} />
        ) : (
          <button
            key={i}
            type="button"
            className="mf-menu-row"
            data-danger={it.danger ? '1' : undefined}
            data-active={it.active ? '1' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              it.onSelect(e);
            }}
            style={itemStyle(th, it.danger, it.active, isMobile)}
          >
            <span style={iconStyle()}>{it.icon}</span>
            <span style={MENU_LABEL_STYLE}>{it.label}</span>
            {/* 단축키 — 등폭으로 오른쪽 끝에(원본). 터치 기기에는 물리 키보드가 없어
                아예 적지 않는다(`shortcutLabels` 머리말). */}
            {it.keys && !isMobile && (
              <span data-ctx-keys style={menuKeyStyle(tone)}>{it.keys}</span>
            )}
            {it.sub && <ChevronRight />}
          </button>
        ),
      )}
      {ctxSub && subKind === 'text' && <AlignFlyout controller={controller} ctxMenu={ctxMenu} top={ctxSub.top} />}
      {ctxSub && subKind === 'arrange' && <ArrangeFlyout controller={controller} ctxMenu={ctxMenu} top={ctxSub.top} />}
    </div>
  );
}

/** `touch`: 모바일 선택 바에서 열린 팝오버 — 행을 44px 터치 타겟으로 키운다.
 * 활성(플라이아웃이 열린 부모) 행은 `data-active`가 CSS로 칠한다(hover와 같은 모양). */
function itemStyle(th: Theme, danger?: boolean, _active?: boolean, touch?: boolean): CSSProperties {
  return menuRowStyle(editorMenuTone(th), { touch, danger });
}

/** 플라이아웃이 있는 행의 셰브론 — 원본은 12px 화살표에 opacity .6. */
function ChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: '0 0 auto', opacity: 0.6 }}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}

function iconStyle(): CSSProperties {
  // 아이콘 색은 **글자를 따른다**(`color: inherit`) — hover에서 라벨과 함께 강조색이
  // 된다(칸반 카드 메뉴의 규칙).
  return {
    ...MENU_GLYPH_STYLE,
    textAlign: 'center',
    fontSize: 13,
  };
}

/** Port of the "메모 추가" item's inline SVG (MindFlow.dc.html:3142) — a folded-corner note. */
function FloatIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}

/** Port of the "선 추가" item's inline SVG (MindFlow.dc.html:3143) — a dashed diagonal line. */
function LineIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="3.5 3.5">
      <path d="M4 20C9 18 15 6 20 4" />
    </svg>
  );
}

/** 복사/잘라내기/붙여넣기 아이콘 — 다른 메뉴 아이콘과 같은 14px 라인 스타일. */
function CopyIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

/** 내용에 맞추기 — 안쪽으로 모이는 화살표 넷(축소·맞춤의 관용 기호). */
function FitIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3v6H3" />
      <path d="M15 3v6h6" />
      <path d="M9 21v-6H3" />
      <path d="M15 21v-6h6" />
    </svg>
  );
}

/** 복제 — 겹쳐 놓인 같은 모양 둘(복사와 달리 "그 자리에 하나 더"라는 뜻). */
function DuplicateIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M8 20h10a2 2 0 0 0 2-2V8" />
    </svg>
  );
}

function CutIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.1 15.9 19 3" />
      <path d="M15.9 15.9 5 3" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v3H9z" />
      <path d="M15 4.5h2.5A1.5 1.5 0 0 1 19 6v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6a1.5 1.5 0 0 1 1.5-1.5H9" />
    </svg>
  );
}

/**
 * 삭제 아이콘 — 이전에는 이모지 `🗑`였다. 이모지는 OS·브라우저마다 모양과 색이
 * 제각각이라(안드로이드/윈도우에서 컬러 그림으로 뜬다) 나머지 14px 라인
 * 아이콘들과 따로 놀았고, `iconStyle`의 위험(빨강) 색도 먹지 않았다.
 * `currentColor`를 쓰므로 이제 danger 색을 그대로 따라간다.
 */
function TrashIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z" />
      <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </svg>
  );
}

/**
 * Builds the item list for `ctxMenu.kind` — port of `Component#ctxMenuItems`
 * (MindFlow.dc.html:3105-3146). `'divider'` stands in for the original's blank
 * separator row.
 */
function buildItems(
  controller: EditorController,
  ctxMenu: ContextMenuState,
  toggleSub: (top: number, kind: 'text' | 'arrange') => void,
  subOpen: 'text' | 'arrange' | null,
  touch = false,
): (MenuItem | 'divider')[] {
  const close = () => controller.closeCtxMenu();

  // 복사/잘라내기/붙여넣기 — 모바일에는 키보드가 없어서 이 메뉴(길게 누르기)가
  // 유일한 진입점이다. 데스크톱에서는 Ctrl/Cmd+C·X·V와 같은 동작.
  const copyItems = (opts: { cut: boolean }): (MenuItem | 'divider')[] => {
    const out: (MenuItem | 'divider')[] = [
      {
        icon: <CopyIcon />,
        label: '복사',
        keys: comboLabel('C'),
        onSelect: () => {
          close();
          controller.copySelection();
        },
      },
    ];
    if (opts.cut) {
      out.push({
        icon: <CutIcon />,
        label: '잘라내기',
        keys: comboLabel('X'),
        onSelect: () => {
          close();
          controller.cutSelection();
        },
      });
    }
    // 복제 — 클립보드를 건드리지 않고 그 자리에 하나 더(Ctrl/⌘+D와 같은 동작).
    out.push({
      icon: <DuplicateIcon />,
      label: '복제',
      keys: comboLabel('D'),
      onSelect: () => {
        close();
        controller.duplicateSelection();
      },
    });
    return out;
  };

  /** 붙여넣기 행 — 클립보드가 비어 있으면 아예 노출하지 않는다. */
  const pasteItem = (at?: { x: number; y: number }): MenuItem[] =>
    controller.canPaste
      ? [
          {
            icon: <PasteIcon />,
            label: controller.clipboardSize > 1 ? `붙여넣기 (${controller.clipboardSize}개)` : '붙여넣기',
            keys: comboLabel('V'),
            onSelect: () => {
              close();
              controller.pasteClipboardAt(at);
            },
          },
        ]
      : [];

  // 댓글은 이제 **댓글 핀**에만 붙는다(요청 ⑧) — 주제·메모·선·영역의 우클릭 메뉴에는
  // 댓글 항목이 없다. 캔버스 어디든 댓글을 남기는 길은 배경 메뉴의 '댓글 추가'(아래)와
  // 화이트보드 도구 막대의 댓글 도구다.

  if (ctxMenu.kind === 'node') {
    const nodeId = controller.selection?.kind === 'node' ? controller.selection.id : null;
    if (!nodeId) return [];
    const isRoot = nodeId === ROOT_ID;
    // 보기 전용(#22): 변이 항목이 전부라 열 것이 없다(댓글은 이제 핀에만 붙는다).
    if (controller.readOnly) return [];
    const items: (MenuItem | 'divider')[] = [];
    // 모바일에선 자식/형제 추가와 삭제를 넣지 않는다 — 선택 바(MobileSelectBar)에
    // 하위·형제·삭제 버튼이 이미 있어 같은 동작이 두 번 나온다. 데스크톱은 바가
    // 없으므로 그대로 유지.
    if (!touch) {
      items.push({
        icon: <Ico d={ICO.plus} />,
        label: '하위 주제 추가',
        keys: 'Tab',
        onSelect: () => {
          close();
          controller.addChild();
        },
      });
      if (!isRoot) {
        items.push({
          icon: <Ico d={ICO.plus} />,
          label: '형제 주제 추가',
          keys: enterKeyLabel(),
          onSelect: () => {
            close();
            controller.addSibling();
          },
        });
      }
      items.push('divider');
    }
    const hasImg = !!controller.doc.nodes[nodeId]?.img;
    items.push({
      icon: <ImageIcon />,
      label: hasImg ? '이미지 변경' : '이미지 추가',
      onSelect: () => {
        close();
        controller.promptNodeImage(nodeId);
      },
    });
    if (hasImg) {
      items.push({
        icon: <Ico d={ICO.close} />,
        label: '이미지 제거',
        onSelect: () => {
          close();
          controller.clearNodeImage(nodeId);
        },
      });
    }
    items.push({
      icon: <Ico d={ICO.align} />,
      label: '텍스트 정렬',
      sub: true,
      active: subOpen === 'text',
      // does NOT close the menu — toggles the flyout submenu instead, port of
      // `alignParent`'s `onClick` (MindFlow.dc.html:3120).
      onSelect: (e) => toggleSub(e.currentTarget.offsetTop, 'text'),
    });
    // 루트는 복사/잘라내기 대상이 아니다(삭제와 같은 규칙 — 맵 전체 복제는 의미가 없다).
    // 붙여넣기는 루트에도 허용 — 루트의 자식으로 붙는다.
    const nodeClip = [...(isRoot ? [] : copyItems({ cut: true })), ...pasteItem()];
    if (nodeClip.length) {
      if (items.length) items.push('divider'); // 앞이 비었으면 선행 구분선을 만들지 않는다
      items.push(...nodeClip);
    }
    if (!isRoot && !touch) {
      items.push('divider');
      items.push({
        icon: <TrashIcon />,
        label: '삭제',
        danger: true,
        keys: deleteKeyLabel(),
        onSelect: () => {
          close();
          controller.deleteSelection();
        },
      });
    }
    return items;
  }

  if (ctxMenu.kind === 'zone') {
    const zoneId = controller.selection?.kind === 'zone' ? controller.selection.id : null;
    if (!zoneId) return [];
    if (controller.readOnly) return []; // 보기 전용 — 변이 항목뿐이라 열 것이 없다
    // 프레임 = 그릇(내용에 맞추기·내용째 삭제)은 **화이트보드의 어휘**다(요청:
    // 맵과 보드는 별개). 맵의 영역은 표식이라 담긴 내용 개념 자체가 없다 —
    // 메뉴는 이름 편집·복사·삭제만, 삭제 라벨도 그냥 '삭제'(내용은 원래 무관).
    if (!controller.isBoard) {
      return [
        {
          icon: <Ico d={ICO.rename} />,
          label: '이름 편집',
          keys: renameKeyLabel(),
          onSelect: () => {
            close();
            controller.startEditZoneLabel(zoneId);
          },
        },
        'divider',
        ...copyItems({ cut: true }),
        // 모바일은 선택 바에 삭제가 있어 중복이라 뺀다(다른 객체 메뉴와 같은 규칙).
        ...(touch
          ? []
          : ([
              {
                icon: <TrashIcon />,
                label: '삭제',
                danger: true,
                keys: deleteKeyLabel(),
                onSelect: () => {
                  close();
                  controller.deleteZone(zoneId);
                },
              },
            ] as MenuItem[])),
      ];
    }
    return [
      {
        icon: <Ico d={ICO.rename} />,
        label: '이름 편집',
        keys: renameKeyLabel(),
        onSelect: () => {
          close();
          controller.startEditZoneLabel(zoneId);
        },
      },
      {
        // 프레임은 그릇이다 — 안에 든 것을 감싸도록 크기를 맞춘다(빈 프레임은 no-op).
        icon: <FitIcon />,
        label: '내용에 맞추기',
        onSelect: () => {
          close();
          controller.fitFrameToContents(zoneId);
        },
      },
      'divider',
      ...copyItems({ cut: true }),
      'divider',
      // 삭제는 둘로 나뉜다: 평범한 삭제는 **비파괴**(프레임만 사라지고 내용은 제자리),
      // 내용째 삭제는 열 하나를 통째로 버릴 때. 모바일은 선택 바에 삭제가 있어
      // 프레임만 삭제는 중복이라 빼고, 내용째 삭제는 그 바에 없으므로 남긴다.
      ...(touch
        ? []
        : ([
            {
              icon: <TrashIcon />,
              label: '프레임만 삭제',
              danger: true,
              keys: deleteKeyLabel(),
              onSelect: () => {
                close();
                controller.deleteZone(zoneId);
              },
            },
          ] as MenuItem[])),
      {
        icon: <TrashIcon />,
        label: '내용까지 삭제',
        danger: true,
        onSelect: () => {
          close();
          controller.deleteFrameWithContents(zoneId);
        },
      },
    ];
  }

  if (ctxMenu.kind === 'float') {
    const floatId = controller.selection?.kind === 'float' ? controller.selection.id : null;
    if (!floatId) return [];
    if (controller.readOnly) return []; // 보기 전용 — 변이 항목뿐이라 열 것이 없다
    return [
      ...copyItems({ cut: true }),
      // 삭제는 성격이 다른 묶음이라 구분선으로 가른다(디자인 원본 — 맵·보드 공통).
      ...(touch
        ? []
        : (['divider',
            {
              icon: <TrashIcon />,
              label: '삭제',
              danger: true,
              keys: deleteKeyLabel(),
              onSelect: () => {
                close();
                controller.deleteFloat(floatId);
              },
            },
          ] as (MenuItem | 'divider')[])),
    ];
  }

  if (ctxMenu.kind === 'line') {
    const lineId = controller.selection?.kind === 'line' ? controller.selection.id : null;
    if (!lineId) return [];
    if (controller.readOnly) return []; // 보기 전용 — 변이 항목뿐이라 열 것이 없다
    return [
      ...copyItems({ cut: true }),
      // 삭제는 성격이 다른 묶음이라 구분선으로 가른다(디자인 원본 — 맵·보드 공통).
      ...(touch
        ? []
        : (['divider',
            {
              icon: <TrashIcon />,
              label: '삭제',
              danger: true,
              keys: deleteKeyLabel(),
              onSelect: () => {
                close();
                controller.deleteLine(lineId);
              },
            },
          ] as (MenuItem | 'divider')[])),
    ];
  }

  if (ctxMenu.kind === 'stroke') {
    // 그리기 획 — 색·굵기는 속성 패널, 댓글은 붙지 않는다(획은 글자가 없어
    // "무엇에 대한 논의인지"를 목록에서 가리킬 이름이 없다). 복사·복제·삭제만.
    const strokeId = controller.selection?.kind === 'stroke' ? controller.selection.id : null;
    if (!strokeId || controller.readOnly) return [];
    return [
      ...copyItems({ cut: true }),
      ...pasteItem(),
      'divider',
      {
        icon: <TrashIcon />,
        label: '삭제',
        danger: true,
        keys: deleteKeyLabel(),
        onSelect: () => {
          close();
          controller.deleteStrokes([strokeId]);
        },
      },
    ];
  }

  if (ctxMenu.kind === 'multi') {
    const ms = controller.multiSelection;
    const count = ms ? ms.nodes.length + ms.lines.length + ms.floats.length + ms.strokes.length : 0;
    return [
      // 정렬·분배(요청) — 옮길 수 있는 대상이 둘 이상일 때만 내준다(트리에 붙은
      // 주제는 레이아웃이 자리를 정하므로 대상이 아니다: `arrangeTargetCount`).
      ...(controller.arrangeTargetCount >= 2 && !controller.readOnly
        ? ([
            {
              icon: <ArrangeGlyph kind="left" />,
              label: '정렬',
              sub: true,
              active: subOpen === 'arrange',
              onSelect: (e) => toggleSub(e.currentTarget.offsetTop, 'arrange'),
            },
            'divider',
          ] as (MenuItem | 'divider')[])
        : []),
      ...copyItems({ cut: true }),
      {
        icon: <TrashIcon />,
        label: `삭제 (${count}개)`,
        danger: true,
        keys: deleteKeyLabel(),
        onSelect: () => {
          close();
          controller.deleteSelection();
        },
      },
    ];
  }

  // 'bg' — port of MindFlow.dc.html:3140-3145: each item creates its object EXACTLY at the
  // right-clicked canvas point (`ctxMenu.cx/cy`).
  // 화이트보드도 메모·이미지·연결선·영역(삽입 메뉴와 같은 어휘) — 주제만 없다.
  const at = { x: ctxMenu.cx, y: ctxMenu.cy };
  return [
    ...(controller.isBoard
      ? []
      : [
          {
            icon: <Ico d={ICO.topic} />,
            label: '주제 추가',
            onSelect: () => {
              close();
              controller.addFreeNodeAt(at);
            },
          } as const,
        ]),
    {
      icon: <FloatIcon />,
      label: '메모 추가',
      onSelect: () => {
        close();
        controller.addFloatAt(at);
      },
    },
    {
      icon: <ImageIcon />,
      label: '이미지 추가',
      onSelect: () => {
        close();
        controller.promptAddImage(at);
      },
    },
    {
      icon: <LineIcon />,
      label: controller.isBoard ? '연결선 추가' : '선 추가',
      onSelect: () => {
        close();
        controller.addLineAt(at);
      },
    },
    {
      icon: controller.isBoard ? <Ico d={ICO.frame} /> : <ZoneIcon />,
      label: '영역 추가',
      onSelect: () => {
        close();
        controller.addZoneAt(at);
      },
    },
    // 댓글 핀 — 다른 객체와 같은 자리에서 만든다(요청). 누른 자리에 **첫 댓글
    // 말풍선**이 뜨고, 한 마디를 남겨야 핀이 문서에 들어간다(요청 ④·⑤).
    ...(controller.canComment
      ? [
          {
            icon: <CommentIcon size={15} />,
            label: '스레드 추가',
            onSelect: () => {
              close();
              controller.startCommentDraft(at);
            },
          },
        ]
      : []),
    // 빈 캔버스에 붙여넣기 — 클릭(길게 누른) 지점을 기준으로 배치된다.
    ...(controller.canPaste ? (['divider'] as const) : []),
    ...pasteItem(at),
  ];
}

/**
 * 메뉴 머리 — [색 점 · 이름]. 디자인 원본의 `ctxTitle`/`ctxDot`을 우리 문서에 맞게:
 * 원본은 종류 이름을 고정 표로 들고 있지만, 우리는 **그 대상의 실제 이름**을 쓴다
 * (이름이 비어 있으면 종류 이름으로 떨어진다 — 속성 패널 머리와 같은 규칙).
 * 점 색도 그 대상의 색이라 "지금 무엇을 겨눴는지"가 색으로도 읽힌다.
 */
function menuHead(controller: EditorController, ctxMenu: ContextMenuState): { label: string; dot: string } | null {
  const th = controller.uiTheme;
  const kind = ctxMenu.kind;
  const sel = controller.selection;
  if (kind === 'bg') return { label: controller.isBoard ? '화이트보드' : '캔버스', dot: th.border };
  if (kind === 'multi') {
    const ms = controller.multiSelection;
    const n = ms ? ms.nodes.length + ms.lines.length + ms.floats.length + ms.strokes.length : 0;
    return { label: `${n}개 선택`, dot: th.accent };
  }
  if (kind === 'node' && sel?.kind === 'node') {
    const node = controller.doc.nodes[sel.id];
    return { label: panelTitleLine(node?.text ?? '') || '주제', dot: colorOf(sel.id, controller.doc.nodes, th) };
  }
  if (kind === 'float' && sel?.kind === 'float') {
    const f = controller.doc.floats.find((x) => x.id === sel.id);
    if (f?.img) return { label: '이미지', dot: f.bg || th.accent };
    return { label: panelTitleLine(f?.text ?? '') || '메모', dot: f?.bg || th.accent };
  }
  if (kind === 'line' && sel?.kind === 'line') {
    const l = controller.doc.lines.find((x) => x.id === sel.id);
    return { label: panelTitleLine(l?.label ?? '') || '연결선', dot: l?.color || th.accent };
  }
  if (kind === 'zone' && sel?.kind === 'zone') {
    const z = controller.doc.zones.find((x) => x.id === sel.id);
    return { label: panelTitleLine(z?.label ?? '') || (controller.isBoard ? '프레임' : '영역'), dot: z?.color || th.accent };
  }
  if (kind === 'stroke' && sel?.kind === 'stroke') {
    const st = controller.doc.strokes?.find((x) => x.id === sel.id);
    return { label: '그리기', dot: st?.color || th.accent };
  }
  return null;
}

/** 디자인 원본 `ICO`의 아이콘들 — 15px·stroke 1.9의 같은 선 언어. */
function Ico({ d, dash }: { d: string; dash?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICO = {
  plus: 'M12 5v14M5 12h14',
  /** 화이트보드 디자인의 프레임 — 네 모서리 괄호. 맵의 '영역'은 표식이라 점선
   * 사각(`ZoneIcon`)을 그대로 쓴다: 두 디자인이 서로 다른 그림을 쓰고, 개념도 다르다
   * (보드의 프레임은 **그릇**이라 안에 든 것을 함께 옮긴다). */
  frame: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2',
  align: 'M4 6h16M4 12h11M4 18h16',
  rename: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  close: 'M18 6 6 18M6 6l12 12',
  topic: 'M7 6h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z',
} as const;

interface AlignFlyoutProps {
  controller: EditorController;
  ctxMenu: ContextMenuState;
  top: number;
}

/** 다중 선택의 "정렬 ▸" 플라이아웃(요청) — 줄 맞춤 6가지 + 간격 균등 2가지.
 *
 * 텍스트 정렬 플라이아웃과 같은 자리·같은 기하를 쓴다(부모 행에 붙고, 오른쪽이
 * 모자라면 왼쪽으로 뒤집는다). 분배는 3개부터 뜻이 있으므로 대상이 둘뿐이면
 * 그 두 줄을 아예 그리지 않는다 — 눌러도 아무 일 없는 항목을 두지 않는다.
 */
function ArrangeFlyout({ controller, ctxMenu, top }: AlignFlyoutProps) {
  const th = controller.uiTheme;
  const vw = controller.vw || 600;
  const menuLeft = Math.max(GAP, Math.min(ctxMenu.sx, vw - MENU_W - GAP));
  // 오른쪽에 자리가 없으면 메뉴 왼쪽으로 뒤집는다(원본 `ctxSubLeft`와 같은 계산).
  const flip = menuLeft + MENU_W - 8 + SUB_W + GAP > vw;
  const tone = editorMenuTone(th);
  const style: CSSProperties = {
    ...menuPanelStyle(tone, SUB_W),
    position: 'absolute',
    left: flip ? -SUB_W - 4 : MENU_W - 8,
    top: top - 7,
    zIndex: 41,
  };
  const rows: ({ op: ArrangeOp; label: string; icon: JSX.Element } | 'divider')[] = [
    { op: 'left', label: '왼쪽 맞춤', icon: <ArrangeGlyph kind="left" /> },
    { op: 'hcenter', label: '가로 가운데', icon: <ArrangeGlyph kind="hcenter" /> },
    { op: 'right', label: '오른쪽 맞춤', icon: <ArrangeGlyph kind="right" /> },
    'divider',
    { op: 'top', label: '위쪽 맞춤', icon: <ArrangeGlyph kind="top" /> },
    { op: 'vcenter', label: '세로 가운데', icon: <ArrangeGlyph kind="vcenter" /> },
    { op: 'bottom', label: '아래쪽 맞춤', icon: <ArrangeGlyph kind="bottom" /> },
    ...(controller.arrangeTargetCount >= 3
      ? (['divider', { op: 'hspace' as const, label: '가로 간격 균등', icon: <ArrangeGlyph kind="hspace" /> }, { op: 'vspace' as const, label: '세로 간격 균등', icon: <ArrangeGlyph kind="vspace" /> }] as const)
      : []),
  ];
  return (
    <div className="mf-ctx mf-menu-fly" data-arrange-flyout style={style}>
      {rows.map((r, i) =>
        r === 'divider' ? (
          <div key={`d${i}`} role="separator" style={menuDividerStyle(tone)} />
        ) : (
          <button
            key={r.op}
            type="button"
            className="mf-menu-row"
            data-arrange={r.op}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.arrangeSelection(r.op);
              controller.closeCtxMenu();
            }}
            style={{ ...itemStyle(th), minHeight: 34, gap: 9 }}
          >
            <span style={iconStyle()}>{r.icon}</span>
            <span style={MENU_LABEL_STYLE}>{r.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/** 정렬 항목의 작은 도형 아이콘 — 기준선(강조색)과 그 선에 붙는 박스 둘. */
function ArrangeGlyph({ kind }: { kind: ArrangeOp }) {
  const line = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const };
  const box = { fill: 'currentColor', opacity: 0.42 };
  if (kind === 'left' || kind === 'right' || kind === 'hcenter') {
    const gx = kind === 'left' ? 3.5 : kind === 'right' ? 14.5 : 9;
    const bx = (w: number) => (kind === 'left' ? 4.5 : kind === 'right' ? 13.5 - w : 9 - w / 2);
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d={`M${gx} 2.5V15.5`} {...line} />
        <rect x={bx(9)} y={4} width={9} height={4} rx={1.2} {...box} />
        <rect x={bx(6)} y={10} width={6} height={4} rx={1.2} {...box} />
      </svg>
    );
  }
  if (kind === 'top' || kind === 'bottom' || kind === 'vcenter') {
    const gy = kind === 'top' ? 3.5 : kind === 'bottom' ? 14.5 : 9;
    const by = (h: number) => (kind === 'top' ? 4.5 : kind === 'bottom' ? 13.5 - h : 9 - h / 2);
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d={`M2.5 ${gy}H15.5`} {...line} />
        <rect x={4} y={by(9)} width={4} height={9} rx={1.2} {...box} />
        <rect x={10} y={by(6)} width={4} height={6} rx={1.2} {...box} />
      </svg>
    );
  }
  // 간격 균등 — 같은 간격으로 놓인 세 조각.
  const horiz = kind === 'hspace';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {[2.5, 7.5, 12.5].map((v) =>
        horiz ? <rect key={v} x={v} y={4} width={3} height={10} rx={1.2} {...box} /> : <rect key={v} x={4} y={v} width={10} height={3} rx={1.2} {...box} />,
      )}
    </svg>
  );
}

/** The "텍스트 정렬 ▸" flyout — port of `ctxSubStyle`/`ctxSubItems` (MindFlow.dc.html:3149-3167):
 * anchored to the parent row's `top`, flipping to the LEFT of the main menu when it's too
 * close to the right edge of the viewport to fit the flyout on the right. */
function AlignFlyout({ controller, ctxMenu, top }: AlignFlyoutProps) {
  const th = controller.uiTheme;
  const vw = controller.vw || 600;
  const menuLeft = Math.max(GAP, Math.min(ctxMenu.sx, vw - MENU_W - GAP));
  // 오른쪽에 자리가 없으면 메뉴 왼쪽으로 뒤집는다(원본 `ctxSubLeft`와 같은 계산).
  const flip = menuLeft + MENU_W - 8 + SUB_W + GAP > vw;
  const tone = editorMenuTone(th);
  const style: CSSProperties = {
    ...menuPanelStyle(tone, SUB_W),
    position: 'absolute',
    left: flip ? -SUB_W - 4 : MENU_W - 8,
    top: top - 7,
    zIndex: 41,
  };
  const nodeId = controller.selection?.kind === 'node' ? controller.selection.id : null;
  const align = (nodeId && controller.doc.nodes[nodeId]?.align) || 'center';
  // 아이콘도 원본의 `alignL/C/R` — 기준선 하나에 길이가 다른 두 줄.
  const opts: { icon: JSX.Element; label: string; v: 'left' | 'center' | 'right' }[] = [
    { icon: <Ico d="M4 5v14 M8 9h9M8 15h5" />, label: '좌측 정렬', v: 'left' },
    { icon: <Ico d="M12 4v16 M7 9h10M9 15h6" />, label: '중앙 정렬', v: 'center' },
    { icon: <Ico d="M20 5v14 M7 9h9M11 15h5" />, label: '우측 정렬', v: 'right' },
  ];
  return (
    <div className="mf-ctx mf-menu-fly" style={style}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          className="mf-menu-row"
          data-active={align === o.v ? '1' : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            controller.setTextAlign(o.v);
            controller.closeCtxMenu();
          }}
          style={{ ...itemStyle(th, false, align === o.v), minHeight: 34, gap: 9 }}
        >
          <span style={iconStyle()}>{o.icon}</span>
          <span style={MENU_LABEL_STYLE}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
