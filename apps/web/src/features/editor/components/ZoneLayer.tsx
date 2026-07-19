import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Zone } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import { peersSelecting } from '../presenceSelection';
import { RemotePeerTag } from './RemotePeerTag';

interface ZoneLayerProps {
  zones: Zone[];
  theme: Theme;
  controller: EditorController;
}

/**
 * Background grouping rectangles — port of `Component#renderZones`
 * (MindFlow.dc.html:2323-2367): drag-to-move, resize handle, delete badge,
 * and double-click/F2 label editing are wired (Editor-b).
 */
export function ZoneLayer({ zones, theme: th, controller }: ZoneLayerProps) {
  if (!zones.length) return null;
  return (
    <>
      {zones.map((z) => {
        const col = z.color || th.accent;
        const selected = controller.selection?.kind === 'zone' && controller.selection.id === z.id;
        const editing = controller.editingZoneId === z.id;
        // presence: a remote peer's selection ring (see `NodeLayer`'s identical pattern).
        const remotePeer = peersSelecting(controller.presence.peers, 'zones', z.id)[0];
        return (
          <div
            key={z.id}
            data-zone-id={z.id}
            // Select/drag the zone by clicking ANYWHERE in its area — not just the
            // label (matches the dc original's whole-box hit test,
            // MindFlow.dc.html:2822). Objects inside the zone render as
            // higher-z-index siblings, so clicking a node/memo/line still targets
            // that object; only clicks on the zone's own (empty) area hit this.
            // `beginZoneDrag` stops propagation, so this doesn't also start a
            // background marquee; the label/handles/delete children stop their
            // own pointerdowns, so they aren't double-handled.
            onPointerDown={editing ? undefined : (e) => controller.beginZoneDrag(e, z.id)}
            style={{
              position: 'absolute',
              left: z.x,
              top: z.y,
              width: z.w,
              height: z.h,
              background: hexA(col, 0.07),
              border: `2px dashed ${hexA(col, selected ? 0.9 : 0.55)}`,
              borderRadius: 16,
              boxSizing: 'border-box',
              boxShadow: remotePeer ? `0 0 0 3px ${hexA(remotePeer.user.color, 0.85)}` : 'none',
              cursor: editing ? 'default' : 'grab',
              zIndex: 8,
            }}
          >
            {editing ? (
              <ZoneLabelEdit z={z} theme={th} onCommit={(t) => controller.commitZoneLabel(z.id, t)} onCancel={controller.cancelZoneLabelEdit} />
            ) : (
              <div
                onPointerDown={(e) => controller.beginZoneDrag(e, z.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  controller.startEditZoneLabel(z.id);
                }}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: -14,
                  height: 27,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 13px',
                  borderRadius: 999,
                  background: col,
                  color: z.color ? '#fff' : th.accentInk,
                  fontSize: 12.5,
                  fontWeight: 700,
                  fontFamily: 'Pretendard, sans-serif',
                  boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  maxWidth: 'calc(100% - 20px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  zIndex: 3,
                  cursor: 'grab',
                }}
              >
                {z.label || '영역'}
              </div>
            )}
            {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ right: 10, top: -14 }} />}
            {selected && !editing && (
              <>
                <div
                  title="삭제"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    controller.deleteZone(z.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: -9,
                    right: -9,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: th.accent,
                    color: th.accentInk,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,.25)',
                    zIndex: 5,
                  }}
                >
                  ×
                </div>
                <div
                  title="크기 조절"
                  onPointerDown={(e) => controller.beginZoneResize(e, z.id)}
                  style={{
                    position: 'absolute',
                    right: -13,
                    bottom: -13,
                    width: 13,
                    height: 13,
                    borderRadius: 4,
                    background: th.panel,
                    border: `2px solid ${th.accent}`,
                    cursor: 'nwse-resize',
                    boxShadow: '0 1px 4px rgba(0,0,0,.2)',
                    zIndex: 6,
                    boxSizing: 'border-box',
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function ZoneLabelEdit({ z, theme, onCommit, onCancel }: { z: Zone; theme: Theme; onCommit: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const sizerRef = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(z.label || '');
  // Width tracks the text (variable, like a shape) instead of a fixed 150px, so the
  // editor matches the committed pill. Capped at the zone's width (minus the same
  // 20px inset the committed label uses) — past that the input scrolls, and the
  // committed pill ellipsizes (whiteSpace/overflow/textOverflow, above).
  const maxW = Math.max(56, z.w - 20);
  const [width, setWidth] = useState(90);
  useLayoutEffect(() => {
    const s = sizerRef.current;
    if (s) setWidth(Math.min(maxW, Math.max(48, s.offsetWidth + 28)));
  }, [val, maxW]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const font = { fontSize: 12.5, fontWeight: 700, fontFamily: 'Pretendard, sans-serif' } as const;
  return (
    <>
      {/* hidden text-width probe (same font as the input) */}
      <span ref={sizerRef} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', left: -9999, top: -9999, ...font }}>
        {val || '영역'}
      </span>
      <input
        ref={ref}
        className="mf-edit"
        value={val}
        maxLength={24}
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            if (e.key === 'Enter') onCommit(e.currentTarget.value);
            else onCancel();
          }
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        style={{
          position: 'absolute',
          left: 10,
          top: -14,
          height: 27,
          padding: '0 11px',
          borderRadius: 999,
          border: `1.5px solid ${z.color || theme.accent}`,
          background: theme.panel,
          color: theme.text,
          ...font,
          outline: 'none',
          width,
          boxSizing: 'border-box',
          textOverflow: 'ellipsis',
          zIndex: 3,
        }}
      />
    </>
  );
}
