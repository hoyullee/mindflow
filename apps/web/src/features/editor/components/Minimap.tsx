import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf } from '../tree';
import { hexA, mixHex } from '../theme';
import type { EditorController } from '../useEditorState';

interface MinimapProps {
  controller: EditorController;
  /** M6: a smaller box on mobile, where screen space is scarce. */
  isMobile?: boolean;
}

// 시안 실측(요청 ③): 카드 폭 260 · 지도 148 · 도트 간격 15 · 뷰포트 파랑.
// 지도는 카드 안에서 **여백 없이** 꽉 찬다(예전에는 7px 안쪽 여백이 있었다).
const W_DESKTOP = 260;
const H_DESKTOP = 148;
const W_MOBILE = 140;
const H_MOBILE = 84;
/** 내용이 지도 가장자리에 붙지 않게 두는 안쪽 여유(그리기 좌표계 전용). */
const PAD = 12;
/** 도트 격자 — 캔버스와 같은 결의 texture라 배율과 무관한 화면 단위다(시안 15px). */
const DOT_STEP = 15;
const DOT_PATTERN_ID = 'mf-minimap-dots';
/**
 * 뷰포트 사각형의 파랑(시안 실측 `#7fa6e8`, 채움 알파 0.10).
 *
 * 테마 강조색을 쓰지 않는다 — 시안은 코랄 테마인데도 이 사각형만 파랑이다
 * (강조색은 "선택한 것"을 뜻하는데 이건 **지금 보고 있는 자리**라 뜻이 다르다).
 */
const VIEW_BLUE = '#7fa6e8';
/** 미니맵의 메모 색 — 캔버스 기본 노랑(`#fff6cf`)은 이 크기에서 배경에 묻혀
 * 보이지 않는다. 시안이 쓰는 한 톤 진한 노랑을 기본값으로 둔다(직접 색을 고른
 * 메모는 그 색 그대로). */
const MEMO_MINI = '#ead893';
const MEMO_MINI_DARK = '#5a4a2f';

/**
 * Bottom-right minimap — port of `Component#renderMinimap`/`#minimapCenterTo`/`#onMinimapDown`
 * (MindFlow.dc.html:1512-1545): the whole map scaled to fit a small `W`×`H` box, a dot per node
 * (root slightly larger), the current viewport traced as a rectangle, and click/drag-to-pan.
 */
export function Minimap({ controller, isMobile = false }: MinimapProps) {
  const { geom, theme: th, pan, zoom, vw, vh } = controller;
  const W = isMobile ? W_MOBILE : W_DESKTOP;
  const H = isMobile ? H_MOBILE : H_DESKTOP;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  // The mapped bounds (below) depend on the viewport *size* but not its
  // position, so panning doesn't move the minimap's coordinate system — except
  // that a minimap drag also nudges zoom-independent state, and any future
  // change to the bounds mid-drag would shift the mapping under the pointer.
  // Freezing the bounds snapshot for the whole drag keeps the mapping (and the
  // node dots) rock-steady so the viewport rect tracks the pointer 1:1.
  const [frozen, setFrozen] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // 캔버스 준비(첫 센터링·폰트 측정) 전에는 내용 없이 캔버스색 박스만 —
  // 준비 전 지오메트리로 점/뷰포트 사각형을 그렸다가 정착 후 튀는 깜빡임을
  // 캔버스 커튼과 같은 타이밍에 함께 숨긴다. 프레임(ZoomControls)은 그대로.
  if (!controller.canvasReady) {
    return <div aria-hidden="true" data-minimap-holding style={{ width: W, height: H }} />;
  }

  // 내용 = 노드 geom ∪ 메모 박스 ∪ 영역 ∪ 연결선 — 예전엔 노드만 봐서 화이트보드
  // (트리 없는 문서)에서는 미니맵이 통째로 사라졌고, 맵에서도 멀리 둔 메모가
  // 지도 밖이었다. 영역·연결선이 보드 어휘가 되면서(요청) 프레임만 있는 보드도
  // 지도에 나와야 한다 — 여기 빠지면 "지도에 아무것도 없는데 화면에는 있다"가 된다.
  const ids = Object.keys(geom);
  const floats = controller.doc.floats;
  const zones = controller.doc.zones;
  const lines = controller.doc.lines;
  if (!ids.length && !floats.length && !zones.length && !lines.length) return null;

  let cMinX = Infinity;
  let cMinY = Infinity;
  let cMaxX = -Infinity;
  let cMaxY = -Infinity;
  ids.forEach((id) => {
    const n = geom[id];
    if (!n) return;
    cMinX = Math.min(cMinX, n.x - n.w / 2);
    cMaxX = Math.max(cMaxX, n.x + n.w / 2);
    cMinY = Math.min(cMinY, n.y - n.h / 2);
    cMaxY = Math.max(cMaxY, n.y + n.h / 2);
  });
  const floatH = (f: (typeof floats)[number]): number => controller.floatHeights[f.id] ?? f.h ?? 44;
  floats.forEach((f) => {
    const h = floatH(f);
    cMinX = Math.min(cMinX, f.x);
    cMaxX = Math.max(cMaxX, f.x + f.w);
    cMinY = Math.min(cMinY, f.y);
    cMaxY = Math.max(cMaxY, f.y + h);
  });
  zones.forEach((z) => {
    cMinX = Math.min(cMinX, z.x);
    cMaxX = Math.max(cMaxX, z.x + z.w);
    cMinY = Math.min(cMinY, z.y);
    cMaxY = Math.max(cMaxY, z.y + z.h);
  });
  // 앵커가 걸린 선은 대상 박스를 따라가므로 저장된 좌표가 아니라 **해석된**
  // 끝점을 본다(에디터가 그리는 것과 같은 값 — `controller.resolveLine`).
  const lineEnds = lines.map((l) => ({ l, ...controller.resolveLine(l) }));
  lineEnds.forEach((e) => {
    cMinX = Math.min(cMinX, e.x1, e.x2);
    cMaxX = Math.max(cMaxX, e.x1, e.x2);
    cMinY = Math.min(cMinY, e.y1, e.y2);
    cMaxY = Math.max(cMaxY, e.y1, e.y2);
  });

  // viewport rect, in canvas coordinates (port of MindFlow.dc.html:1525-1527)
  const vx0 = -pan.x / zoom;
  const vy0 = -pan.y / zoom;
  const vx1 = (vw - pan.x) / zoom;
  const vy1 = (vh - pan.y) / zoom;

  // Choose the mapped region so the orange viewport rectangle reads as a small
  // inner box, not a slab filling the whole minimap. It's centered on the
  // CONTENT midpoint and sized to comfortably contain both the node cluster and
  // a REFERENCE viewport, times `OVERVIEW` (so whichever is larger occupies
  // only ~1/OVERVIEW of the minimap). The reference viewport is the screen size
  // at zoom 1 (vw/vh, NOT ÷ the live zoom): tall portrait phones show a much
  // taller visible area than the short content, so a content-only margin
  // couldn't shrink the rect vertically — folding the screen size in fixes
  // that. Crucially the mapping depends on neither pan NOR zoom, so it never
  // shifts while panning and never rescales while zooming — which is what lets
  // the orange rect itself grow/shrink with 1/zoom. (An earlier version divided
  // by the live zoom here; that made the mapping scale cancel the rect's own
  // 1/zoom exactly, so the rect looked FROZEN at every zoom level.) The rect is
  // still CLAMPED to the box below as a backstop when zoomed far out.
  const OVERVIEW = 1.9;
  const cCx = (cMinX + cMaxX) / 2;
  const cCy = (cMinY + cMaxY) / 2;
  const halfW = Math.max((cMaxX - cMinX) / 2, vw / 2) * OVERVIEW + 20;
  const halfH = Math.max((cMaxY - cMinY) / 2, vh / 2) * OVERVIEW + 20;
  const liveMinX = cCx - halfW;
  const liveMinY = cCy - halfH;
  const liveMaxX = cCx + halfW;
  const liveMaxY = cCy + halfH;

  const minX = frozen ? frozen.minX : liveMinX;
  const minY = frozen ? frozen.minY : liveMinY;
  const maxX = frozen ? frozen.maxX : liveMaxX;
  const maxY = frozen ? frozen.maxY : liveMaxY;

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const s = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  const ox = PAD + (W - PAD * 2 - bw * s) / 2;
  const oy = PAD + (H - PAD * 2 - bh * s) / 2;
  const mx = (x: number): number => ox + (x - minX) * s;
  const my = (y: number): number => oy + (y - minY) * s;

  // Viewport rectangle, clamped to the minimap box so it never spills outside
  // (when zoomed out past the content it simply fills the box).
  const clampBox = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));
  const rx0 = clampBox(mx(vx0), W);
  const ry0 = clampBox(my(vy0), H);
  const rx1 = clampBox(mx(vx1), W);
  const ry1 = clampBox(my(vy1), H);

  const centerFromEvent = (clientX: number, clientY: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = (clientX - r.left - ox) / s + minX;
    const cy = (clientY - r.top - oy) / s + minY;
    controller.panToCanvasPoint(cx, cy);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    // Freeze the current bounds so the whole drag maps against one stable
    // coordinate system (see `frozen`). Snapshot the live values, not the
    // already-frozen ones, since we're just entering a drag.
    setFrozen({ minX: liveMinX, minY: liveMinY, maxX: liveMaxX, maxY: liveMaxY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not implemented in some environments (e.g. jsdom) — non-fatal */
    }
    centerFromEvent(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!draggingRef.current) return;
    centerFromEvent(e.clientX, e.clientY);
  };
  const onPointerUp = (): void => {
    draggingRef.current = false;
    setFrozen(null);
  };

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      data-testid="minimap"
      // `touch-action: none` is essential for drag-to-pan on touch devices:
      // without it the browser claims a one-finger drag on the SVG as a
      // scroll/zoom gesture and fires `pointercancel` instead of delivering
      // `pointermove`, so the drag dies the moment the finger moves (the main
      // canvas `.mf-ed-vp` sets this in editor.css for the same reason).
      // 면은 카드의 유리질 배경이 그대로 비치게 둔다(시안의 지도 바탕 `#fdf8f4`가
      // 곧 그 값이다) — 여기서 canvasBg를 칠하면 카드보다 어두운 판이 생긴다.
      style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* 도트 격자 — 지도가 "캔버스의 축소판"으로 읽히게 하는 바탕 texture(시안 ③). */}
      <defs>
        <pattern id={DOT_PATTERN_ID} width={DOT_STEP} height={DOT_STEP} patternUnits="userSpaceOnUse">
          <path
            d={`M${DOT_STEP / 2} ${DOT_STEP / 2 - 1.5}v3M${DOT_STEP / 2 - 1.5} ${DOT_STEP / 2}h3`}
            stroke={th.dot}
            strokeWidth={1}
            strokeLinecap="round"
            opacity={0.5}
          />
        </pattern>
      </defs>
      <rect data-minimap-dots x={0} y={0} width={W} height={H} fill={`url(#${DOT_PATTERN_ID})`} />
      {/* 영역(프레임) — 캔버스와 같은 순서로 맨 뒤에, 테두리만(면을 칠하면 그 위의
          점·사각이 묻힌다). 연결선은 그 위, 노드·메모 아래. */}
      {zones.map((z) => (
        <rect
          key={z.id}
          data-minimap-zone={z.id}
          x={mx(z.x)}
          y={my(z.y)}
          width={Math.max(2, z.w * s)}
          height={Math.max(2, z.h * s)}
          rx={2}
          fill="none"
          stroke={z.color || th.subtext}
          strokeWidth={1}
          opacity={0.5}
        />
      ))}
      {lineEnds.map(({ l, x1, y1, x2, y2 }) => (
        <line
          key={l.id}
          data-minimap-line={l.id}
          x1={mx(x1)}
          y1={my(y1)}
          x2={mx(x2)}
          y2={my(y2)}
          stroke={l.color || th.subtext}
          strokeWidth={1}
          opacity={0.6}
        />
      ))}
      {ids.map((id) => {
        const n = geom[id];
        if (!n) return null;
        return <circle key={id} cx={mx(n.x)} cy={my(n.y)} r={id === ROOT_ID ? 3.4 : 2.2} fill={colorOf(id, controller.doc.nodes, th)} opacity={0.9} />;
      })}
      {/* 메모/이미지 — **자기 색 그대로**의 둥근 카드(시안 ③: 가운데 노란 사각).
          예전에는 회색 점처럼 그려 무슨 물건인지 알 수 없었다. */}
      {floats.map((f) => {
        const h = floatH(f);
        const w = Math.max(4, f.w * s);
        const hh = Math.max(3, h * s);
        const fill = f.bg || (th.appBg === '#191512' || th.canvasBg === '#201b16' ? MEMO_MINI_DARK : MEMO_MINI);
        return (
          <rect
            key={f.id}
            data-minimap-float={f.id}
            x={mx(f.x)}
            y={my(f.y)}
            width={w}
            height={hh}
            rx={Math.min(5, hh / 3)}
            fill={fill}
            stroke={mixHex(fill, '#000000', 0.09)}
            strokeWidth={1}
          />
        );
      })}
      <rect
        data-testid="minimap-viewport"
        x={rx0}
        y={ry0}
        width={Math.max(0, rx1 - rx0)}
        height={Math.max(0, ry1 - ry0)}
        fill={hexA(VIEW_BLUE, 0.1)}
        stroke={VIEW_BLUE}
        strokeWidth={1}
        rx={4}
      />
    </svg>
  );
}
