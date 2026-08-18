import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import { Minimap } from './Minimap';
import { BOARD_BAR_LIFT } from './BoardToolbar';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { CARD_SHADOW, glassCard } from '../chrome';
import { hexA, mixHex } from '../theme';

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
      <div data-zoom-cluster style={{ position: 'absolute', right: 16, ...anchor, ...glassCard(th), borderRadius: 14, boxShadow: CARD_SHADOW, zIndex: 15, overflow: 'hidden' }}>
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
        // 지도는 카드 위쪽 칸을 **여백 없이** 채우고(시안 ③) 아래 줄과 선으로 갈린다.
        // 면을 따로 칠하지 않는다 — 카드의 유리질 배경이 그대로 지도 바탕이 된다.
        <div
          style={{
            borderBottom: `1px solid ${hexA(th.border, 0.65)}`,
            lineHeight: 0,
            // 시안의 지도 바탕은 카드보다 **한 톤 따뜻하다**(실측 #fdf8f4) — 캔버스색을
            // 흰 면에 살짝 섞은 값이라, 아래 흰 줄과 두 톤으로 갈린다.
            background: mixHex(th.panel, th.canvasBg, 0.35),
          }}
        >
          <Minimap controller={controller} />
        </div>
      )}
      {/* 아래 줄: [미니맵][−][배율][＋][화면 맞춤] — 시안에는 구분선이 없고 다섯이
          같은 간격으로 퍼진다(지도를 켜면 카드 폭에 맞춰 space-evenly). */}
      <div
        data-zoom-bar
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: controller.showMinimap ? 'space-evenly' : 'center',
          gap: controller.showMinimap ? 0 : 6,
          height: 50, // 시안 실측
          padding: '0 8px',
          // 시안은 지도 바탕(유리질)보다 **한 톤 밝은 흰 줄**이다(실측 #fffdfb).
          background: th.panel,
        }}
      >
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.toggleMinimap}
          title="미니맵 표시/숨기기"
          aria-pressed={controller.showMinimap}
          // 시안에서 이 아이콘은 옆의 다른 아이콘과 **같은 회색**이다(실측 #8a8078) —
          // 켜짐 여부는 지도가 있는지로 이미 보이므로 색으로 또 말하지 않는다.
          style={btnStyle}
        >
          <MinimapIcon />
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomOut} title="축소" style={btnStyle} aria-label="축소">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.zoomReset}
          title="100%로"
          style={{ ...btnStyle, width: 'auto', minWidth: 46, padding: '0 4px', fontSize: 14, fontWeight: 600, color: mixHex(th.text, th.panel, 0.12), letterSpacing: '-0.2px' }}
        >
          {controller.zoomPct}%
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.zoomIn} title="확대" style={btnStyle} aria-label="확대">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button type="button" className="mf-ed-btn" onClick={controller.fitView} title="화면 맞춤" style={btnStyle} aria-label="화면 맞춤">
          {/* 시안의 자름표(crop mark) — 네 귀퉁이의 각진 ㄱ자. */}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5" />
            <path d="M15 4h5v5" />
            <path d="M20 15v5h-5" />
            <path d="M9 20H4v-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** 시안의 미니맵 글리프 — 둥근 사각 안에 작은 채운 사각(지도 안의 뷰포트). */
function MinimapIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3.5} y={3.5} width={17} height={17} rx={4} />
      <rect x={9.5} y={9.5} width={5} height={5} rx={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}
