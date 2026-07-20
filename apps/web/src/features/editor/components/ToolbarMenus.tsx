import type { CSSProperties, ReactNode } from 'react';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';

/**
 * Dropdown menu bodies for the editor's top menu bar (GNB) — 편집 / 삽입 / 보기.
 * (스타일 and 내보내기 keep their own bodies in `StyleMenu`/`ExportMenu`.) Each
 * is a plain list of `MenuItem` rows inside a `MenuShell`; positioning/stacking
 * is handled by the `AnchoredMenu` portal wrapper the toolbar puts around them.
 */

/** Bordered dropdown container — shared chrome for the list menus. */
export function MenuShell({ theme: th, children, minWidth = 200 }: { theme: Theme; children: ReactNode; minWidth?: number }) {
  return (
    <div
      style={{
        width: '100%',
        minWidth,
        boxSizing: 'border-box',
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,.16)',
        padding: 5,
      }}
    >
      {children}
    </div>
  );
}

/** A single menu row: leading icon, label, optional trailing check (for a
 * currently-active choice) or shortcut hint. Disabled rows are greyed + inert. */
export function MenuItem({
  theme: th,
  icon,
  label,
  hint,
  active,
  disabled,
  isMobile,
  onClick,
}: {
  theme: Theme;
  icon?: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  isMobile?: boolean;
  onClick: () => void;
}) {
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    height: isMobile ? 44 : 38,
    padding: '0 10px',
    border: 'none',
    borderRadius: 8,
    background: active ? th.panel2 : 'transparent',
    color: disabled ? `${th.subtext}73` : th.text,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'left',
  };
  return (
    <button type="button" className={disabled ? undefined : 'mf-ed-btn'} disabled={disabled} onClick={onClick} style={row}>
      {icon != null && <span style={{ display: 'flex', width: 18, justifyContent: 'center', color: disabled ? `${th.subtext}73` : active ? th.accent : th.subtext }}>{icon}</span>}
      <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {active && (
        <span style={{ display: 'flex', color: th.accent }} aria-hidden="true">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
      {hint && !active && <span style={{ fontSize: 11, color: `${th.subtext}b0`, whiteSpace: 'nowrap' }}>{hint}</span>}
    </button>
  );
}

export function EditMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.theme;
  return (
    <MenuShell theme={th}>
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<UndoIcon />}
        label="실행 취소"
        hint="Ctrl+Z"
        disabled={!controller.canUndo}
        onClick={() => {
          controller.undo();
          onDone();
        }}
      />
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<RedoIcon />}
        label="다시 실행"
        hint="Ctrl+Shift+Z"
        disabled={!controller.canRedo}
        onClick={() => {
          controller.redo();
          onDone();
        }}
      />
    </MenuShell>
  );
}

export function InsertMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.theme;
  const items: { icon: ReactNode; label: string; run: () => void }[] = [
    { icon: <ShapeIcon />, label: '도형 추가', run: () => controller.addFreeNodeAt() },
    { icon: <MemoIcon />, label: '메모 추가', run: () => controller.addFloatAt() },
    { icon: <LineIcon />, label: '선 추가', run: () => controller.addLineAt() },
    { icon: <ZoneIcon />, label: '영역 추가', run: () => controller.addZoneAt() },
  ];
  return (
    <MenuShell theme={th}>
      {items.map((it) => (
        <MenuItem
          key={it.label}
          theme={th}
          isMobile={isMobile}
          icon={it.icon}
          label={it.label}
          onClick={() => {
            it.run();
            onDone();
          }}
        />
      ))}
    </MenuShell>
  );
}

export function ViewMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.theme;
  return (
    <MenuShell theme={th}>
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<MapIcon />}
        label="맵"
        active={controller.view === 'map'}
        onClick={() => {
          controller.setView('map');
          onDone();
        }}
      />
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<OutlineIcon />}
        label="아웃라인"
        active={controller.view === 'outline'}
        onClick={() => {
          controller.setView('outline');
          onDone();
        }}
      />
    </MenuShell>
  );
}

/** Small uppercase section label inside a dropdown (used by `MoreMenu`). */
function MenuSectionLabel({ theme: th, children }: { theme: Theme; children: ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: th.subtext, padding: '6px 10px 3px' }}>{children}</div>;
}
function MenuDivider({ theme: th }: { theme: Theme }) {
  return <div style={{ height: 1, background: th.border, margin: '5px 6px' }} />;
}

/**
 * Combined overflow menu for the mobile toolbar's ☰ button — folds the 보기 and
 * 내보내기 menus into ONE dropdown (with section headers) so those two triggers
 * don't need their own room on the narrow bar (which otherwise scrolled). Desktop
 * keeps 보기/내보내기 as separate top-level triggers.
 */
export function MoreMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.theme;
  return (
    <MenuShell theme={th}>
      <MenuSectionLabel theme={th}>보기</MenuSectionLabel>
      <MenuItem theme={th} isMobile={isMobile} icon={<MapIcon />} label="맵" active={controller.view === 'map'} onClick={() => { controller.setView('map'); onDone(); }} />
      <MenuItem theme={th} isMobile={isMobile} icon={<OutlineIcon />} label="아웃라인" active={controller.view === 'outline'} onClick={() => { controller.setView('outline'); onDone(); }} />
      <MenuDivider theme={th} />
      <MenuSectionLabel theme={th}>내보내기</MenuSectionLabel>
      <MenuItem theme={th} isMobile={isMobile} icon={<PngIcon />} label="PNG 이미지" onClick={() => { controller.exportPNG(); onDone(); }} />
      <MenuItem theme={th} isMobile={isMobile} icon={<JsonIcon />} label="JSON 파일 (.json)" onClick={() => { controller.exportJSON(); onDone(); }} />
    </MenuShell>
  );
}

// ---- icons (shared by the menu bar triggers + rows) ----
export function PngIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <circle cx={8.5} cy={8.5} r={1.5} />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
export function JsonIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
export function UndoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}
export function RedoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}
export function MapIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <circle cx={4} cy={5} r={2} />
      <circle cx={20} cy={5} r={2} />
      <circle cx={4} cy={19} r={2} />
      <circle cx={20} cy={19} r={2} />
      <path d="M10 10 5.5 6.5M14 10l4.5-3.5M10 14l-4.5 3.5M14 14l4.5 3.5" />
    </svg>
  );
}
export function OutlineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1={8} y1={6} x2={21} y2={6} />
      <line x1={10} y1={12} x2={21} y2={12} />
      <line x1={12} y1={18} x2={21} y2={18} />
      <line x1={3} y1={6} x2={3.01} y2={6} />
      <line x1={5} y1={12} x2={5.01} y2={12} />
      <line x1={7} y1={18} x2={7.01} y2={18} />
    </svg>
  );
}
export function ShapeIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={6} width={18} height={12} rx={3} />
    </svg>
  );
}
export function MemoIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}
export function LineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="3.5 3.5">
      <path d="M4 20C9 18 15 6 20 4" />
    </svg>
  );
}
export function ZoneIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3">
      <rect x={3} y={5} width={18} height={14} rx={3} />
    </svg>
  );
}
export function ExportIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1={12} y1={15} x2={12} y2={3} />
    </svg>
  );
}
