import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ResizeHandle } from './ResizeHandle';
import type { Zone } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import { isPanButton } from '../pointerButtons';
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
/** 영역(프레임)의 **테두리·라벨** 레이어 z — 그리기 획(90)보다 위, 편집 박스(100)
 * 아래. 요청: "영역을 최상위 레이어로". 화이트보드에서 영역은 "이 구획은 여기까지"를
 * 긋는 표식이라, 안의 스티커·잉크에 경계가 가려지면 알아볼 수 없다.
 *
 * 올리는 건 **테두리와 라벨뿐**이다 — 옅은 채움(7%)까지 위로 올리면 그 안의
 * 노란 스티커·잉크가 통째로 물들어 색이 달라 보인다(실브라우저 확인). 채움은
 * 예전 자리(맨 아래)에 남아 "면은 배경, 경계는 앞"이 된다. */
const ZONE_FRAME_Z = 95;
/** 채움 + 히트(선택·드래그) 레이어 z — 예전 그대로 **맨 아래**. 히트를 위로
 * 올리지 않는 이유: 영역이 덮은 넓은 사각이 안의 메모·주제 클릭을 통째로
 * 삼킨다(빈 영역 클릭 = 영역 선택이라는 dc 원본 규칙도 그 자리에서 깨진다). */
const ZONE_BASE_Z = 8;

export function ZoneLayer({ zones, theme: th, controller }: ZoneLayerProps) {
  if (!zones.length) return null;
  // **작은 영역이 위**로 오게 그린다(큰 것부터). 히트 판은 전부 같은 z(8)라 승자를
  // 정하는 것은 DOM 순서인데, 배열 순서대로 그리면 나중에 만든 큰 영역이 작은 영역을
  // 통째로 덮어 안쪽 영역을 영영 집을 수 없다(제보). 겹친 프레임에서 안쪽이 위라는
  // 규칙은 히트 테스트(`innermostFrameAt`)와도 같은 방향이다.
  const stacked = [...zones].sort((a, b) => b.w * b.h - a.w * a.h);
  return (
    <>
      {/* 면 + 히트 판 — 콘텐츠(메모 10 / 주제 40 …)보다 아래라 영역 안의 객체
          클릭이 먼저 잡히고, 빈 자리 클릭만 여기 닿는다. */}
      {stacked.map((z) => (
        <div
          key={`base${z.id}`}
          data-zone-hit={z.id}
          onPointerDown={controller.editingZoneId === z.id ? undefined : (e) => controller.beginZoneDrag(e, z.id)}
          style={{
            position: 'absolute',
            left: z.x,
            top: z.y,
            width: z.w,
            height: z.h,
            background: hexA(z.color || th.accent, 0.07),
            borderRadius: 16,
            cursor: controller.editingZoneId === z.id ? 'default' : 'grab',
            zIndex: ZONE_BASE_Z,
          }}
        />
      ))}
      {stacked.map((z) => {
        const col = z.color || th.accent;
        const selected = controller.selection?.kind === 'zone' && controller.selection.id === z.id;
        const editing = controller.editingZoneId === z.id;
        // 지금 끌고 있는 것이 이 프레임에 담기는 중 — 테두리를 채워 "여기에 들어간다"를
        // 알린다(프레임 = 그릇). 소속은 기하로 정해지므로 이건 순수한 어포던스다.
        const dropping = controller.frameDrop === z.id;
        // presence: a remote peer's selection ring (see `NodeLayer`'s identical pattern).
        const remotePeer = peersSelecting(controller.presence.peers, 'zones', z.id)[0];
        return (
          <div
            key={z.id}
            data-zone-id={z.id}
            data-frame-drop={dropping ? '1' : undefined}
            // 테두리·라벨 판 — 맨 위에 그리되 **포인터는 받지 않는다**(아래 면
            // 판이 받는다). 선택/드래그는 여전히 영역의 빈 자리를 클릭하는 것이고
            // (dc 원본의 whole-box 히트 테스트, MindFlow.dc.html:2822), 안의
            // 객체 클릭은 그 객체가 먼저 가져간다. 라벨·핸들·배지 같은 자식은
            // 각자 `pointerEvents: 'auto'`로 되살린다(pointer-events는 상속).
            style={{
              position: 'absolute',
              left: z.x,
              top: z.y,
              width: z.w,
              height: z.h,
              background: 'transparent', // 면은 아래 판이 그린다(안의 색을 물들이지 않게)
              border: dropping ? `2px solid ${hexA(col, 1)}` : `2px dashed ${hexA(col, selected ? 0.9 : 0.55)}`,
              borderRadius: 16,
              boxSizing: 'border-box',
              boxShadow: remotePeer ? `0 0 0 3px ${hexA(remotePeer.user.color, 0.85)}` : dropping ? `0 0 0 4px ${hexA(col, 0.18)}` : 'none',
              pointerEvents: 'none',
              zIndex: ZONE_FRAME_Z,
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
                  // Vertical-centre via line-height, NOT `display:flex` — a flex
                  // container turns the label into an anonymous flex item, which
                  // `text-overflow: ellipsis` never applies to (the text just hard-
                  // clips with no "…"). A plain block keeps the ellipsis working.
                  lineHeight: '27px',
                  padding: '0 13px',
                  boxSizing: 'border-box',
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
                  pointerEvents: 'auto', // 시각 판은 none — 누를 수 있는 자식만 되살린다
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
                    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동 (오른쪽 버튼으로 삭제되지 않게)
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
                    pointerEvents: 'auto',
                  }}
                >
                  ×
                </div>
                {/* pointer-events는 상속된다 — 시각 판(none) 아래에서 핸들만 되살린다 */}
                <div style={{ pointerEvents: 'auto' }}>
                  <ResizeHandle title="크기 조절" accent={th.accent} panel={th.panel} right={-13} bottom={-13} zIndex={6} onPointerDown={(e) => controller.beginZoneResize(e, z.id)} />
                </div>
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
          pointerEvents: 'auto', // 시각 판이 none이라 입력창은 따로 되살린다
          textOverflow: 'ellipsis',
          zIndex: 3,
        }}
      />
    </>
  );
}
