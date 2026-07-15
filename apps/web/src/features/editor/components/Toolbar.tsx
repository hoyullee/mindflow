import { useEffect, useRef, useState } from 'react';
import type { EditorController } from '../useEditorState';
import { StyleMenu } from './StyleMenu';
import { ExportMenu } from './ExportMenu';
import { useIsMobile } from '../../../hooks/useMediaQuery';

interface ToolbarProps {
  controller: EditorController;
}

/**
 * Top bar — port of `.mf-topbar` (MindFlow.dc.html:36-96). Editor-b wires
 * undo/redo, the shape/memo/line/zone add buttons, and the export dropdown
 * (view switch and the 스타일 dropdown were already wired in Editor-a).
 *
 * M6: horizontal scroll for narrow screens was already in place
 * (`.mf-ed-topbar`'s `overflowX: auto`, `editor.css`'s thin scrollbar); this
 * adds >=44px touch targets on mobile for every icon button in this bar.
 */
export function Toolbar({ controller }: ToolbarProps) {
  const { theme: th } = controller;
  const isMobile = useIsMobile();
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const styleWrapRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!styleMenuOpen && !exportMenuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (styleMenuOpen && styleWrapRef.current && !styleWrapRef.current.contains(e.target as Node)) setStyleMenuOpen(false);
      if (exportMenuOpen && exportWrapRef.current && !exportWrapRef.current.contains(e.target as Node)) setExportMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [styleMenuOpen, exportMenuOpen]);

  const addBtnStyle = {
    width: isMobile ? 44 : 34,
    height: isMobile ? 44 : 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${th.border}`,
    borderRadius: 9,
    background: th.panel,
    color: th.text,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  } as const;

  const historyBtnStyle = (enabled: boolean) =>
    ({
      width: isMobile ? 44 : 32,
      height: isMobile ? 44 : 32,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `1px solid ${th.border}`,
      borderRadius: 9,
      background: th.panel,
      color: enabled ? th.text : `${th.subtext}73`,
      cursor: enabled ? 'pointer' : 'default',
      fontFamily: 'inherit',
      padding: 0,
    }) as const;

  return (
    <div
      className="mf-ed-topbar"
      style={{
        height: 56,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 16px',
        background: th.panel,
        borderBottom: `1px solid ${th.border}`,
        zIndex: 20,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 6 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: th.accentInk, fontWeight: 800, fontSize: 15 }}>
          M
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.01em' }}>MindFlow</div>
      </div>

      <Divider theme={th} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className="mf-ed-btn" disabled={!controller.canUndo} onClick={controller.undo} title="실행 취소 (Ctrl+Z)" style={historyBtnStyle(controller.canUndo)}>
          <UndoIcon />
        </button>
        <button type="button" className="mf-ed-btn" disabled={!controller.canRedo} onClick={controller.redo} title="다시 실행 (Ctrl+Shift+Z)" style={historyBtnStyle(controller.canRedo)}>
          <RedoIcon />
        </button>
      </div>

      <Divider theme={th} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: th.panel2, border: `1px solid ${th.border}`, borderRadius: 10, padding: 3 }}>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={() => controller.setView('map')}
          aria-pressed={controller.view === 'map'}
          style={viewBtnStyle(controller.view === 'map', th, isMobile)}
        >
          <MapIcon /> 맵
        </button>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={() => controller.setView('outline')}
          aria-pressed={controller.view === 'outline'}
          style={viewBtnStyle(controller.view === 'outline', th, isMobile)}
        >
          <OutlineIcon /> 아웃라인
        </button>
      </div>

      <Divider theme={th} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className="mf-ed-btn" onClick={controller.addFreeNodeAt} title="도형 추가" style={addBtnStyle}>
          <ShapeIcon />
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.addFloatAt} title="메모 추가" style={addBtnStyle}>
          <MemoIcon />
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.addLineAt} title="선 추가" style={addBtnStyle}>
          <LineIcon />
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.addZoneAt} title="영역 추가" style={addBtnStyle}>
          <ZoneIcon />
        </button>
      </div>

      <div style={{ flex: '1 1 auto' }} />

      <div ref={styleWrapRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={() => setStyleMenuOpen((v) => !v)}
          title="맵 스타일 (레이아웃 · 연결선 · 테마)"
          aria-expanded={styleMenuOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: isMobile ? 44 : 34,
            padding: '0 12px',
            border: `1px solid ${styleMenuOpen ? th.accent : th.border}`,
            borderRadius: 9,
            background: styleMenuOpen ? th.panel2 : th.panel,
            color: th.text,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: 'conic-gradient(#f0663f,#e0b23c,#3fae9e,#3f8fd0,#8a6bd1,#f0663f)',
              flexShrink: 0,
            }}
          />
          스타일
        </button>
        {styleMenuOpen && <StyleMenu controller={controller} />}
      </div>

      <Divider theme={th} />

      <div ref={exportWrapRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={() => setExportMenuOpen((v) => !v)}
          title="내보내기"
          aria-expanded={exportMenuOpen}
          style={{ ...addBtnStyle, border: `1px solid ${exportMenuOpen ? th.accent : th.border}`, background: exportMenuOpen ? th.panel2 : th.panel }}
        >
          <ExportIcon />
        </button>
        {exportMenuOpen && <ExportMenu controller={controller} onDone={() => setExportMenuOpen(false)} />}
      </div>
    </div>
  );
}

function Divider({ theme: th }: { theme: EditorController['theme'] }) {
  return <div style={{ width: 1, height: 24, background: th.border }} />;
}

function viewBtnStyle(active: boolean, th: EditorController['theme'], isMobile = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: isMobile ? 44 : 28,
    padding: '0 10px',
    border: 'none',
    borderRadius: 8,
    background: active ? th.panel : 'transparent',
    color: active ? th.text : th.subtext,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,.10)' : 'none',
  } as const;
}

function UndoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <circle cx={4} cy={5} r={2} />
      <circle cx={20} cy={5} r={2} />
      <circle cx={4} cy={19} r={2} />
      <circle cx={20} cy={19} r={2} />
      <path d="M10 10 5.5 6.5M14 10l4.5-3.5M10 14l-4.5 3.5M14 14l4.5 3.5" />
    </svg>
  );
}
function OutlineIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1={8} y1={6} x2={21} y2={6} />
      <line x1={10} y1={12} x2={21} y2={12} />
      <line x1={12} y1={18} x2={21} y2={18} />
      <line x1={3} y1={6} x2={3.01} y2={6} />
      <line x1={5} y1={12} x2={5.01} y2={12} />
      <line x1={7} y1={18} x2={7.01} y2={18} />
    </svg>
  );
}
function ShapeIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={6} width={18} height={12} rx={3} />
    </svg>
  );
}
function MemoIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}
function LineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="3.5 3.5">
      <path d="M4 20C9 18 15 6 20 4" />
    </svg>
  );
}
function ZoneIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3">
      <rect x={3} y={5} width={18} height={14} rx={3} />
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1={12} y1={15} x2={12} y2={3} />
    </svg>
  );
}
