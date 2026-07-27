import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { ContextMenuState } from '../types';
// 이미지/영역 아이콘은 상단 툴바 '삽입' 메뉴와 같은 SVG를 공유 — 두 진입점이
// 같은 동작이므로 같은 그림이어야 한다.
import { ImageIcon, ZoneIcon } from './ToolbarMenus';

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
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu, controller]);

  if (!ctxMenu) return null;

  const vw = controller.vw || 600;
  const vh = controller.vh || 400;

  // port of `ctxMenuStyle` (MindFlow.dc.html:3101-3104): clamped to the viewport so the
  // menu never overflows past the right/bottom edge (pushes it left/up as it nears one).
  const menuStyle: CSSProperties = {
    position: 'absolute',
    left: Math.min(ctxMenu.sx, vw - 160),
    top: Math.min(ctxMenu.sy, vh - 150),
    width: 150,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.18)',
    padding: 5,
    zIndex: 60,
  };

  const items = buildItems(controller, ctxMenu, (top) => controller.toggleCtxSub(top), !!ctxSub);

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
      {items.map((it, i) =>
        it === 'divider' ? (
          <div key={i} style={{ height: 1, background: th.border, margin: '5px 4px' }} />
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
            style={itemStyle(th, it.danger, it.active)}
          >
            <span style={iconStyle(th, it.danger, it.active)}>{it.icon}</span>
            <span style={{ flex: '1 1 auto', textAlign: 'left' }}>{it.label}</span>
            {it.arrow && <span style={{ fontSize: 11, color: it.active ? th.accent : th.subtext, flexShrink: 0 }}>{it.arrow}</span>}
          </button>
        ),
      )}
      {ctxSub && <AlignFlyout controller={controller} ctxMenu={ctxMenu} top={ctxSub.top} />}
    </div>
  );
}

function itemStyle(th: Theme, danger?: boolean, active?: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '8px 11px',
    border: 'none',
    borderRadius: 7,
    fontSize: 13,
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
 * Builds the item list for `ctxMenu.kind` — port of `Component#ctxMenuItems`
 * (MindFlow.dc.html:3105-3146). `'divider'` stands in for the original's blank
 * separator row.
 */
function buildItems(controller: EditorController, ctxMenu: ContextMenuState, toggleAlignSub: (top: number) => void, alignSubOpen: boolean): (MenuItem | 'divider')[] {
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

  if (ctxMenu.kind === 'node') {
    const nodeId = controller.selection?.kind === 'node' ? controller.selection.id : null;
    if (!nodeId) return [];
    const isRoot = nodeId === ROOT_ID;
    const items: (MenuItem | 'divider')[] = [
      {
        icon: '＋',
        label: '자식 주제',
        onSelect: () => {
          close();
          controller.addChild();
        },
      },
    ];
    if (!isRoot) {
      items.push({
        icon: '＋',
        label: '형제 주제',
        onSelect: () => {
          close();
          controller.addSibling();
        },
      });
    }
    items.push('divider');
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
      active: alignSubOpen,
      // does NOT close the menu — toggles the flyout submenu instead, port of
      // `alignParent`'s `onClick` (MindFlow.dc.html:3120).
      onSelect: (e) => toggleAlignSub(e.currentTarget.offsetTop),
    });
    // 루트는 복사/잘라내기 대상이 아니다(삭제와 같은 규칙 — 맵 전체 복제는 의미가 없다).
    // 붙여넣기는 루트에도 허용 — 루트의 자식으로 붙는다.
    const nodeClip = [...(isRoot ? [] : copyItems({ cut: true })), ...pasteItem()];
    if (nodeClip.length) {
      items.push('divider');
      items.push(...nodeClip);
    }
    if (!isRoot) {
      items.push('divider');
      items.push({
        icon: '🗑',
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
    return [
      {
        icon: '✎',
        label: '이름 편집',
        onSelect: () => {
          close();
          controller.startEditZoneLabel(zoneId);
        },
      },
      'divider',
      ...copyItems({ cut: true }),
      {
        icon: '🗑',
        label: '삭제',
        danger: true,
        onSelect: () => {
          close();
          controller.deleteZone(zoneId);
        },
      },
    ];
  }

  if (ctxMenu.kind === 'float') {
    const floatId = controller.selection?.kind === 'float' ? controller.selection.id : null;
    if (!floatId) return [];
    return [
      ...copyItems({ cut: true }),
      {
        icon: '🗑',
        label: '삭제',
        danger: true,
        onSelect: () => {
          close();
          controller.deleteFloat(floatId);
        },
      },
    ];
  }

  if (ctxMenu.kind === 'line') {
    const lineId = controller.selection?.kind === 'line' ? controller.selection.id : null;
    if (!lineId) return [];
    return [
      ...copyItems({ cut: true }),
      {
        icon: '🗑',
        label: '삭제',
        danger: true,
        onSelect: () => {
          close();
          controller.deleteLine(lineId);
        },
      },
    ];
  }

  if (ctxMenu.kind === 'multi') {
    const ms = controller.multiSelection;
    const count = ms ? ms.nodes.length + ms.lines.length + ms.floats.length : 0;
    return [
      ...copyItems({ cut: true }),
      {
        icon: '🗑',
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
  const at = { x: ctxMenu.cx, y: ctxMenu.cy };
  return [
    {
      icon: '▢',
      label: '도형 추가',
      onSelect: () => {
        close();
        controller.addFreeNodeAt(at);
      },
    },
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
      label: '선 추가',
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
