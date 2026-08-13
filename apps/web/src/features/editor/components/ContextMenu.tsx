import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { ContextMenuState } from '../types';
import type { ArrangeOp } from '../arrange';
import { useIsMobile } from '../../../hooks/useMediaQuery';
// 이미지/영역 아이콘은 상단 툴바 '삽입' 메뉴와 같은 SVG를 공유 — 두 진입점이
// 같은 동작이므로 같은 그림이어야 한다.
import { CommentIcon, ImageIcon, ZoneIcon } from './ToolbarMenus';

interface ContextMenuProps {
  controller: EditorController;
}

interface MenuItem {
  icon: ReactNode;
  label: string;
  arrow?: string;
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

  // 모바일 선택 바의 '메뉴(⋯)'에서 열린 경우: 클릭 지점에 뜨는 우클릭 메뉴가 아니라
  // **바에서 뻗어 나온 팝오버**로 그린다 — 바와 같은 패널/테두리/라운드(16)에
  // 손가락에 맞는 행 높이, 그리고 ⋯ 버튼을 가리키는 꼬리(caret)를 붙인다.
  const MW = isMobile ? 190 : 150;
  let left: number;
  let top: number;
  let flipped = false;
  if (anchor) {
    const M = 8;
    // 메뉴 높이는 행 수로 추정(행 44 + 구분선 11 + 패딩 12) — 아래 공간이 부족하면
    // 바 위로 뒤집는다. 렌더 후 재측정 없이도 화면 밖으로 나가지 않게 하는 보수적 추정.
    const rows = buildItems(controller, ctxMenu, () => {}, null, isMobile);
    const estH = rows.reduce((h, it) => h + (it === 'divider' ? 11 : 44), 12);
    left = Math.min(Math.max(anchor.x - MW / 2, M), Math.max(M, vw - MW - M));
    const below = anchor.bottom + 10;
    flipped = below + estH > vh - M && anchor.top - 10 - estH > M;
    top = flipped ? anchor.top - 10 - estH : below;
  } else {
    // port of `ctxMenuStyle` (MindFlow.dc.html:3101-3104): clamped to the viewport so the
    // menu never overflows past the right/bottom edge (pushes it left/up as it nears one).
    left = Math.min(ctxMenu.sx, vw - 160);
    top = Math.min(ctxMenu.sy, vh - 150);
  }

  const menuStyle: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: MW,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: anchor ? 16 : 11,
    boxShadow: anchor ? '0 8px 26px rgba(0,0,0,.18)' : '0 10px 30px rgba(0,0,0,.18)',
    padding: anchor ? 6 : 5,
    zIndex: 60,
    ...(anchor ? { animation: 'mf-ctx-pop .13s ease-out' } : {}),
  };

  const subKind = ctxSub?.kind ?? 'text';
  const items = buildItems(controller, ctxMenu, (top2, kind) => controller.toggleCtxSub(top2, kind), ctxSub ? subKind : null, isMobile);

  return (
    <div
      ref={rootRef}
      className="mf-ctx"
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
      {items.map((it, i) =>
        it === 'divider' ? (
          <div key={i} style={{ height: 1, background: th.border, margin: anchor ? '5px 8px' : '5px 4px' }} />
        ) : (
          <button
            key={i}
            type="button"
            className="mf-ed-btn"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              it.onSelect(e);
            }}
            style={itemStyle(th, it.danger, it.active, isMobile)}
          >
            <span style={iconStyle(th, it.danger, it.active)}>{it.icon}</span>
            <span style={{ flex: '1 1 auto', textAlign: 'left' }}>{it.label}</span>
            {it.arrow && <span style={{ fontSize: 11, color: it.active ? th.accent : th.subtext, flexShrink: 0 }}>{it.arrow}</span>}
          </button>
        ),
      )}
      {ctxSub && subKind === 'text' && <AlignFlyout controller={controller} ctxMenu={ctxMenu} top={ctxSub.top} />}
      {ctxSub && subKind === 'arrange' && <ArrangeFlyout controller={controller} ctxMenu={ctxMenu} top={ctxSub.top} />}
    </div>
  );
}

/** `touch`: 모바일 선택 바에서 열린 팝오버 — 행을 44px 터치 타겟으로 키운다. */
function itemStyle(th: Theme, danger?: boolean, active?: boolean, touch?: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: touch ? 11 : 9,
    width: '100%',
    padding: touch ? '0 12px' : '8px 11px',
    ...(touch ? { height: 44 } : {}),
    border: 'none',
    borderRadius: touch ? 11 : 7,
    fontSize: touch ? 14 : 13,
    fontWeight: 600,
    cursor: 'pointer',
    color: danger ? '#d64545' : active ? th.accent : th.text,
    background: active ? hexA(th.accent, 0.08) : 'transparent',
    fontFamily: 'inherit',
    textAlign: 'left',
  };
}

function iconStyle(th: Theme, danger?: boolean, active?: boolean): CSSProperties {
  return {
    width: 16,
    textAlign: 'center',
    fontSize: 13,
    flexShrink: 0,
    color: danger ? '#d64545' : active ? th.accent : th.subtext,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
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

/** 열 모드 — 세로로 쌓인 카드 셋(칸반 열). */
function ColumnIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="5" rx="1.5" />
      <rect x="5" y="10" width="14" height="5" rx="1.5" />
      <rect x="5" y="17" width="14" height="4" rx="1.5" />
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
            onSelect: () => {
              close();
              controller.pasteClipboardAt(at);
            },
          },
        ]
      : [];

  // 댓글 항목 — **모든 객체**(주제·메모·선·영역)가 같은 항목을 쓴다(요청).
  // 링크 뷰어는 서버가 댓글을 내주지 않으므로 항목도 없다(0020).
  const commentItem = (targetId: string): MenuItem[] => {
    if (!controller.canComment) return [];
    const n = controller.commentCounts[targetId] ?? 0;
    return [
      {
        icon: <CommentIcon size={14} />,
        label: n > 0 ? `댓글 (${n})` : '댓글',
        onSelect: () => {
          close();
          controller.openComments(targetId);
        },
      },
    ];
  };

  if (ctxMenu.kind === 'node') {
    const nodeId = controller.selection?.kind === 'node' ? controller.selection.id : null;
    if (!nodeId) return [];
    const isRoot = nodeId === ROOT_ID;
    // 보기 전용(#22): 변이 항목은 없고 댓글만 — openCtxAt이 이 조합일 때만 메뉴를 연다.
    if (controller.readOnly) return commentItem(nodeId);
    const items: (MenuItem | 'divider')[] = [];
    // 모바일에선 자식/형제 추가와 삭제를 넣지 않는다 — 선택 바(MobileSelectBar)에
    // 하위·형제·삭제 버튼이 이미 있어 같은 동작이 두 번 나온다. 데스크톱은 바가
    // 없으므로 그대로 유지.
    if (!touch) {
      items.push({
        icon: '＋',
        label: '하위 주제 추가',
        onSelect: () => {
          close();
          controller.addChild();
        },
      });
      if (!isRoot) {
        items.push({
          icon: '＋',
          label: '형제 주제 추가',
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
        icon: '✕',
        label: '이미지 제거',
        onSelect: () => {
          close();
          controller.clearNodeImage(nodeId);
        },
      });
    }
    items.push({
      icon: '≡',
      label: '텍스트 정렬',
      arrow: '▸',
      active: subOpen === 'text',
      // does NOT close the menu — toggles the flyout submenu instead, port of
      // `alignParent`'s `onClick` (MindFlow.dc.html:3120).
      onSelect: (e) => toggleSub(e.currentTarget.offsetTop, 'text'),
    });
    // 댓글 — 그 주제의 논의를 바로 연다. 보기 메뉴에만 있으면 "이 주제에 다는"
    // 물건인데 진입점이 화면 반대편에 숨는다(제보).
    items.push(...commentItem(nodeId));
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
    if (controller.readOnly) return commentItem(zoneId); // 보기 전용 — 댓글만(주제와 동일)
    return [
      {
        icon: '✎',
        label: '이름 편집',
        onSelect: () => {
          close();
          controller.startEditZoneLabel(zoneId);
        },
      },
      {
        // 열 모드(칸반) — 켜면 이 프레임 안의 카드가 세로로 쌓이고 폭이 열에 맞는다.
        icon: <ColumnIcon />,
        label: '열 모드',
        active: controller.doc.zones.find((z) => z.id === zoneId)?.stack === 'column',
        onSelect: () => {
          close();
          controller.toggleColumnMode(zoneId);
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
      ...commentItem(zoneId),
      'divider',
      ...copyItems({ cut: true }),
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
    if (controller.readOnly) return commentItem(floatId); // 보기 전용 — 댓글만(주제와 동일)
    return [
      ...commentItem(floatId),
      ...copyItems({ cut: true }),
      ...(touch
        ? []
        : ([
            {
              icon: <TrashIcon />,
              label: '삭제',
              danger: true,
              onSelect: () => {
                close();
                controller.deleteFloat(floatId);
              },
            },
          ] as MenuItem[])),
    ];
  }

  if (ctxMenu.kind === 'line') {
    const lineId = controller.selection?.kind === 'line' ? controller.selection.id : null;
    if (!lineId) return [];
    if (controller.readOnly) return commentItem(lineId); // 보기 전용 — 댓글만(주제와 동일)
    return [
      ...commentItem(lineId),
      ...copyItems({ cut: true }),
      ...(touch
        ? []
        : ([
            {
              icon: <TrashIcon />,
              label: '삭제',
              danger: true,
              onSelect: () => {
                close();
                controller.deleteLine(lineId);
              },
            },
          ] as MenuItem[])),
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
              arrow: '▸',
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
            icon: '▢',
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
      icon: <ZoneIcon />,
      label: '영역 추가',
      onSelect: () => {
        close();
        controller.addZoneAt(at);
      },
    },
    // 빈 캔버스에 붙여넣기 — 클릭(길게 누른) 지점을 기준으로 배치된다.
    ...(controller.canPaste ? (['divider'] as const) : []),
    ...pasteItem(at),
  ];
}

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
  const menuLeft = Math.min(ctxMenu.sx, vw - 160);
  const flip = menuLeft + 150 + 150 > vw;
  const style: CSSProperties = {
    position: 'absolute',
    left: flip ? -146 : 144,
    top: top - 5,
    width: 142,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.14)',
    padding: 5,
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
    <div className="mf-ctx" data-arrange-flyout style={style}>
      {rows.map((r, i) =>
        r === 'divider' ? (
          <div key={`d${i}`} style={{ height: 1, background: th.border, margin: '4px 6px' }} />
        ) : (
          <button
            key={r.op}
            type="button"
            className="mf-ed-btn"
            data-arrange={r.op}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.arrangeSelection(r.op);
              controller.closeCtxMenu();
            }}
            style={itemStyle(th)}
          >
            <span style={iconStyle(th)}>{r.icon}</span>
            <span style={{ textAlign: 'left' }}>{r.label}</span>
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
  const menuLeft = Math.min(ctxMenu.sx, vw - 160);
  const flip = menuLeft + 150 + 140 > vw;
  const style: CSSProperties = {
    position: 'absolute',
    left: flip ? -136 : 144,
    top: top - 5,
    width: 132,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.14)',
    padding: 5,
    zIndex: 41,
  };
  const nodeId = controller.selection?.kind === 'node' ? controller.selection.id : null;
  const align = (nodeId && controller.doc.nodes[nodeId]?.align) || 'center';
  const opts: { icon: string; label: string; v: 'left' | 'center' | 'right' }[] = [
    { icon: '◧', label: '좌측 정렬', v: 'left' },
    { icon: '◪', label: '중앙 정렬', v: 'center' },
    { icon: '◨', label: '우측 정렬', v: 'right' },
  ];
  return (
    <div className="mf-ctx" style={style}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          className="mf-ed-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            controller.setTextAlign(o.v);
            controller.closeCtxMenu();
          }}
          style={itemStyle(th, false, align === o.v)}
        >
          <span style={iconStyle(th, false, align === o.v)}>{o.icon}</span>
          <span style={{ textAlign: 'left' }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
