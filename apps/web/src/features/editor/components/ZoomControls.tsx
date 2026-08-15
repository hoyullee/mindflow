import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import { Minimap } from './Minimap';
import { BOARD_BAR_LIFT } from './BoardToolbar';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { CARD_SHADOW, MONO_FONT, glassCard } from '../chrome';

interface ZoomControlsProps {
  controller: EditorController;
  /** M6-mobile: true when a property panel is open. On mobile that panel is a
   * bottom sheet (max 55dvh) that would otherwise cover this bottom-right
   * cluster, so we lift the cluster just above the sheet. */
  panelOpen?: boolean;
}

/**
 * Bottom-right zoom controls + minimap — port of MindFlow.dc.html:406-427
 * (`notOutlineMode`'s panel: `showMinimap` + the zoom cluster). `showMinimap`
 * was a design-time prop in the original; this port exposes it as an in-app
 * toggle button next to the zoom controls instead (no props/config screen here).
 *
 * M6: on mobile the minimap shrinks (see `Minimap`'s `isMobile`) and every
 * button grows to a >=44px touch target (still visually compact via padding,
 * not a full 44px box, for the divider-separated zoom-percent readout).
 */
export function ZoomControls({ controller, panelOpen = false }: ZoomControlsProps) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  // On mobile, the bottom-sheet property panel owns the lower screen; hide the
  // minimap/zoom cluster entirely while it's open (the selected object is
  // re-centered into the area above the sheet — see Editor). On desktop, or
  // with no panel, the cluster stays pinned bottom-right.
  if (isMobile && panelOpen) return null;
  // 아래 버튼 줄은 이제 데스크톱 전용이다(폰 분기는 미니맵만 그리고 일찍 돌아간다).
  // 디자인 원본: 28px 정사각 · 라운드 8 · 면 없는 아이콘 버튼.
  const btnStyle = {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: th.subtext,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  } as const;

  // 자리는 **언제나 우측 하단**이다(우측 상단으로 올려 봤다가 되돌렸다). 다만
  // 폰의 화이트보드에서는 도구 막대가 바닥 전폭을 쓰므로(시안) 그 높이만큼 위로
  // 올라앉는다 — 좌우가 아니라 위아래로 비켜서는 배치.
  const liftForBoard = isMobile && controller.isBoard && !controller.readOnly;
  const anchor: CSSProperties = { bottom: liftForBoard ? BOARD_BAR_LIFT : 16 };

  // 폰에서는 미니맵 **아래 버튼 줄(최소화·화면 맞춤)을 두지 않는다**(요청) —
  // 좁은 화면에서 지도만 남기는 편이 깔끔하고, 그 자리는 이제 도구 막대·독칩이
  // 쓴다. 확대/축소는 원래 핀치가 맡고, 화면 맞춤은 열 때 자동으로 한 번 돈다.
  // 버튼이 없으면 미니맵을 껐을 때 껍데기만 남으므로 아예 그리지 않는다.
  if (isMobile) {
    if (!controller.showMinimap) return null;
    return (
      <div data-zoom-cluster style={{ position: 'absolute', right: 16, ...anchor, ...glassCard(th), borderRadius: 14, boxShadow: CARD_SHADOW, zIndex: 15, padding: 6 }}>
        <Minimap controller={controller} isMobile />
      </div>
    );
  }

  return (
    <div
      data-zoom-cluster
      style={{
        position: 'absolute',
        right: 18,
        ...anchor,
        ...glassCard(th),
        borderRadius: 14,
        boxShadow: CARD_SHADOW,
        zIndex: 15,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {controller.showMinimap && (
        // 지도는 카드 **위쪽 칸**을 통째로 쓰고 아래 줄과 선으로 갈린다(디자인 원본).
        <div style={{ padding: 7, borderBottom: `1px solid ${th.border}`, background: th.panel2 }}>
          <Minimap controller={controller} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '6px 7px' }}>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.toggleMinimap}
          title="미니맵 표시/숨기기"
          aria-pressed={controller.showMinimap}
          style={{ ...btnStyle, color: controller.showMinimap ? th.accent : th.text }}
        >
          <MinimapIcon />
        </button>
        <div style={{ width: 1, height: 16, background: th.border, margin: '0 3px' }} />
        <button type="button" className="mf-ed-btn" onClick={controller.zoomOut} title="축소" style={btnStyle}>
          −
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomReset} title="100%로" style={{ ...btnStyle, width: 'auto', minWidth: 52, padding: '0 6px', fontFamily: MONO_FONT, fontSize: 11.5, fontWeight: 500, color: th.text }}>
          {controller.zoomPct}%
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomIn} title="확대" style={btnStyle}>
          ＋
        </button>
        <div style={{ width: 1, height: 16, background: th.border, margin: '0 3px' }} />
        <button type="button" className="mf-ed-btn" onClick={controller.fitView} title="화면 맞춤" style={btnStyle}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function MinimapIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={4} width={18} height={16} rx={2} />
      <circle cx={8} cy={9} r={1.2} fill="currentColor" stroke="none" />
      <circle cx={15} cy={11} r={1.2} fill="currentColor" stroke="none" />
      <circle cx={11} cy={16} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}
