import { useEffect, useState } from 'react';
import type { Doc } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { NodeLayer } from './NodeLayer';
import { EdgeLayer } from './EdgeLayer';
import { FloatLayer } from './FloatLayer';
import { LineLayer } from './LineLayer';
import { ZoneLayer } from './ZoneLayer';
import { MarqueeLayer } from './MarqueeLayer';
import { PresenceLayer } from './PresenceLayer';
import { StrokeLayer } from './StrokeLayer';
import { BoardDrawLayer } from './BoardDrawLayer';
import { BoardToolbar } from './BoardToolbar';
import { ContextMenu } from './ContextMenu';
import { TextToolbar } from './TextToolbar';
import { MoveHandle } from './MoveHandle';
import { useIsMobile } from '../../../hooks/useMediaQuery';

interface ViewportProps {
  doc: Doc;
  controller: EditorController;
}

/**
 * The pan/zoom canvas — port of the `.mf-vp` viewport + `Component#renderCanvas`'s
 * outer transform group (MindFlow.dc.html:99-101, 1303-1304). Pan (background
 * drag) and zoom (wheel/pinch/buttons) live in `useEditorState`; this component
 * only applies the resulting CSS transform. Effective paint order (via per-layer
 * z-index, bottom→top): tree edges → nodes → zones (z 8) → floats/memos (z 10/20)
 * → free connector lines (z 25) — connectors sit on top so an arrow landing on a
 * memo isn't hidden behind it.
 */
export function Viewport({ doc, controller }: ViewportProps) {
  const { theme, geom, layoutMode, edgeStyle, pan, zoom } = controller;
  const isMobile = useIsMobile();
  // Show the move grip only for a true single selection that isn't being edited
  // (an active text edit owns the object; a marquee multi-selection has no single box).
  const showMoveHandle =
    isMobile && !!controller.selection && !controller.editingNodeId && !controller.editingFloatId && !controller.editingLineId && !controller.editingZoneId;

  return (
    <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden' }}>
      <div
        className="mf-ed-vp"
        ref={controller.setViewportEl}
        onPointerDown={controller.onBackgroundPointerDown}
        onPointerMove={(e) => controller.reportPointerPosition(e.clientX, e.clientY)}
        onPointerLeave={controller.clearPointerPosition}
        onContextMenu={controller.onContextMenu}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'default',
          touchAction: 'none',
        }}
      >
        {/* 캔버스 배경(색 + 도트)을 **자기 레이어**로 분리한다.
            예전엔 이 배경이 `.mf-ed-vp` 자신에 있었다: 그 안의 팬/줌 레이어가
            움직일 때마다 브라우저가 뷰포트 **전체를 다시 래스터**했고(20스텝 팬에
            전면 리페인트 10회 — CDP LayerTree 실측), 매 프레임 다시 그려지는
            그라디언트가 실기기에서 배경이 깨져 보이는 원인이었다(제보).
            `translateZ(0)`으로 한 번만 래스터해 두고 재사용한다. */}
        <div
          aria-hidden="true"
          data-canvas-bg
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            backgroundColor: theme.canvasBg,
            backgroundImage: `radial-gradient(${theme.dot} 1.2px, transparent 1.2px)`,
            backgroundSize: '26px 26px',
            transform: 'translateZ(0)',
          }}
        />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          {/* Hold the canvas (background only) until the real doc has loaded, so
              the placeholder seed never flashes before the actual tree. On a load
              FAILURE, show an error+retry instead of the empty seed — the doc
              didn't load, so editing/saving it would risk clobbering the backend. */}
          {controller.loadError ? (
            <LoadErrorCanvas theme={theme} onRetry={controller.retryLoad} />
          ) : controller.hydrating ? (
            <LoadingCanvas theme={theme} />
          ) : (
            <>
              {/* 이 레이어에 `will-change: transform`을 걸면 **안 된다**(제보: 에디터에
                  들어가면 텍스트·객체가 전부 흐릿하고, 편집한 객체만 선명해진다).
                  브라우저가 승격된 레이어의 래스터 배율을 첫 프레임 배율에 고정하는데,
                  에디터는 `scale(1)`로 마운트한 뒤 **한 프레임 뒤** 중앙 정렬 배율(기본
                  1.25)로 바뀐다(실측: 154ms scale(1) → 167ms scale(1.25)). 그래서 화면
                  전체가 1배로 그린 텍스처를 1.25배로 늘린 모습이 되고, 객체를 편집하면
                  그 객체만 무효화돼 다시 그려지니 그것만 또렷해진다.
                  배경 재래스터 문제는 위 `data-canvas-bg` 분리만으로 이미 해결된다 —
                  20스텝 팬에서 콘텐츠 레이어는 21회 다시 칠해지지만 배경 레이어는
                  **1회**뿐이다(CDP LayerTree 실측). 합성 힌트는 필요 없다. */}
              <div
                data-pan-layer
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                }}
              >
                <ZoneLayer zones={doc.zones} theme={theme} controller={controller} />
                <EdgeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} edgeStyle={edgeStyle} theme={theme} />
                <NodeLayer nodes={doc.nodes} geom={geom} mode={layoutMode} theme={theme} controller={controller} />
                <LineLayer lines={doc.lines} theme={theme} controller={controller} />
                <FloatLayer floats={doc.floats} theme={theme} controller={controller} />
                {/* 그리기 획(화이트보드 M4) — 손으로 그은 잉크는 **언제나 객체 위**다
                    (제보: 메모 뒤로 숨었다). 종이에 펜으로 덧그리는 감각이기도 하고,
                    가려지면 방금 그은 획이 사라진 것처럼 보인다. DOM 순서만으로는
                    부족해 z-index로 못박는다 — 객체 쪽에 z-index를 쓰는 요소가 있다
                    (노드 40·라인 25~28·메모 10/20·배지 81). 편집 박스(100)와 끌어
                    올린 노드(200)만 잉크 위로 올라온다(지금 만지는 것이 보여야 한다). */}
                <StrokeLayer strokes={doc.strokes} live={controller.liveStroke ? { pts: controller.liveStroke, color: controller.penColor, w: controller.penWidth } : null} />
                <MarqueeLayer rect={controller.marquee} theme={theme} />
                <GroupGhostLayer doc={doc} controller={controller} />
                <PresenceLayer controller={controller} />
              </div>
              {/* Move grip (mobile) — screen-space so it stays a constant tap size at any zoom. */}
              {showMoveHandle && <MoveHandle controller={controller} theme={theme} />}
              {/* 그리기 입력 오버레이(펜/지우개 도구가 켜진 동안만) — 화면 좌표계. */}
              <BoardDrawLayer controller={controller} />
            </>
          )}
        </div>
        {/* 화이트보드 도구 막대 — 하단 중앙 알약(보드에서만). */}
        <BoardToolbar controller={controller} />
        {/* 준비 커튼 — 첫 센터링·폰트 측정·하이드레이션이 끝날 때까지 캔버스를
            같은 배경(도트 포함)으로 가렸다가 짧게 페이드아웃. 새로고침 시
            좌상단에 그려졌다 중앙으로 점프하는 깜빡임을 여기서 흡수한다.
            로드 에러 화면은 가리면 안 되므로 제외. */}
        {!controller.loadError && <CanvasCurtain theme={theme} ready={controller.canvasReady} />}
        {/* NOT inside the pan/zoom transform above — `ctxMenu.sx/sy` are already screen
            (viewport-relative) coordinates (port of `Component#openCtxAt`'s `sx`/`sy`,
            MindFlow.dc.html:2794-2795), so this sits in the SAME untransformed box `.mf-ed-vp`
            itself occupies. */}
        <ContextMenu controller={controller} />
        {/* Same untransformed screen-coordinate box as `ContextMenu` above — `textCtx.sx/sy`
            are already viewport-relative (`NodeEditBox`'s `openTextCtx` call). */}
        <TextToolbar controller={controller} />
      </div>
    </div>
  );
}

/** 캔버스 준비 커튼 — `canvasReady`가 될 때까지 캔버스와 똑같은 배경(도트
 * 패턴 포함)으로 전체를 덮고 스피너를 띄웠다가, 준비되면 짧게 페이드아웃 후
 * 스스로 사라진다. 노드들은 커튼 아래에서 이미 렌더/센터링되므로 공개 순간
 * 완성된 화면이 그대로 드러난다. */
function CanvasCurtain({ theme, ready }: { theme: import('../theme').Theme; ready: boolean }) {
  // 페이드아웃이 끝난 뒤 완전히 언마운트(gone) — 투명 커튼을 남기지 않는다.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setGone(true), 240);
    return () => window.clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div
      aria-hidden="true"
      data-canvas-curtain
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 12, // 캔버스 콘텐츠 위, 독칩(16)·컨텍스트 메뉴보다는 아래
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.canvasBg,
        backgroundImage: `radial-gradient(${theme.dot} 1.2px, transparent 1.2px)`,
        backgroundSize: '26px 26px',
        opacity: ready ? 0 : 1,
        transition: 'opacity .2s ease',
        pointerEvents: 'none',
      }}
    >
      <svg width={30} height={30} viewBox="0 0 50 50" style={{ opacity: ready ? 0 : 1, transition: 'opacity .1s ease' }}>
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.border} strokeWidth={5} />
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.accent} strokeWidth={5} strokeLinecap="round" strokeDasharray="31 126">
          <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

/** Shown over the canvas background while the real doc loads (see `hydrating`) —
 * a subtle centered spinner instead of the placeholder tree. Uses SVG
 * `animateTransform` so it needs no CSS keyframes. */
function LoadingCanvas({ theme }: { theme: import('../theme').Theme }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <svg width={30} height={30} viewBox="0 0 50 50" aria-label="불러오는 중" role="img">
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.border} strokeWidth={5} />
        <circle cx={25} cy={25} r={20} fill="none" stroke={theme.accent} strokeWidth={5} strokeLinecap="round" strokeDasharray="31 126">
          <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

/** Shown when the initial doc load FAILED — an error message + retry, instead of
 * the empty seed. Editing/saving stays blocked (see `canPersistDocRef`) so a
 * failed load can never let the empty canvas overwrite the real backend doc.
 * (본문을 아예 못 찾은 맵은 여기가 아니라 전용 화면이다 — `MapUnavailable`.) */
function LoadErrorCanvas({ theme, onRetry }: { theme: import('../theme').Theme; onRetry: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>맵을 불러오지 못했어요</div>
      <div style={{ fontSize: 13, color: theme.subtext, maxWidth: 320, lineHeight: 1.6 }}>
        네트워크 문제로 저장된 내용을 불러오지 못했습니다. 데이터 보호를 위해 편집·저장을 잠시 멈췄어요. 다시 시도해 주세요.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{ marginTop: 4, padding: '9px 18px', borderRadius: 10, border: 'none', background: theme.accent, color: theme.accentInk, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        다시 시도
      </button>
    </div>
  );
}

/**
 * 그룹(다중 선택) 드래그 고스트 — 단일 드래그의 점선 고스트(NodeLayer)와 같은
 * 모델(요청: "단일 도형 이동하는 것처럼"). 멤버들의 점선 윤곽이 (dx,dy)만큼
 * 이동해 보이고, 실물은 드롭에서 한 번에 옮겨진다(`useEditorState`의 'group'
 * onMove/onUp 참고). 노드는 geom 박스, 메모는 x/y(좌상단)+w(+측정 h가 없으니
 * 저장 h 폴백), 선은 두 끝점의 bbox — 전부 윤곽 힌트라 근사로 충분하다.
 */
function GroupGhostLayer({ doc, controller }: { doc: Doc; controller: EditorController }) {
  const gg = controller.groupGhost;
  const { theme, geom } = controller;
  if (!gg) return null;
  const boxes: { key: string; l: number; t: number; w: number; h: number; r: number }[] = [];
  // 멤버 노드는 **서브트리째** — 단일 드래그 고스트(NodeLayer)와 같은 규칙(요청:
  // 다중 선택 이동에서도 하위 도형 고스트). 접힌 가지의 자식은 geom에 없어 빠진다.
  gg.nodes.forEach((id) => {
    const walk = (nid: string): void => {
      const g = geom[nid];
      if (g) boxes.push({ key: `n-${nid}`, l: g.x - g.w / 2 + gg.dx, t: g.y - g.h / 2 + gg.dy, w: g.w, h: g.h, r: 10 });
      doc.nodes[nid]?.children.forEach((c) => {
        if (doc.nodes[c]) walk(c);
      });
    };
    walk(id);
  });
  gg.floats.forEach((id) => {
    const f = doc.floats.find((x) => x.id === id);
    if (f) boxes.push({ key: `f-${id}`, l: f.x + gg.dx, t: f.y + gg.dy, w: f.w ?? 180, h: f.h ?? 44, r: 12 });
  });
  gg.lines.forEach((id) => {
    const l = doc.lines.find((x) => x.id === id);
    if (!l) return;
    const x0 = Math.min(l.x1, l.x2);
    const y0 = Math.min(l.y1, l.y2);
    boxes.push({ key: `l-${id}`, l: x0 + gg.dx - 4, t: y0 + gg.dy - 4, w: Math.abs(l.x2 - l.x1) + 8, h: Math.abs(l.y2 - l.y1) + 8, r: 6 });
  });
  return (
    <>
      {boxes.map((b) => (
        <div
          key={b.key}
          aria-hidden="true"
          data-group-ghost
          style={{
            position: 'absolute',
            left: b.l,
            top: b.t,
            width: b.w,
            height: b.h,
            borderRadius: b.r,
            border: `2px dashed ${theme.accent}`,
            background: 'rgba(240,102,63,.08)',
            opacity: 0.85,
            pointerEvents: 'none',
            zIndex: 40,
            boxSizing: 'border-box',
          }}
        />
      ))}
    </>
  );
}
