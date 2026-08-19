import type { EditorController } from '../../useEditorState';
import { DeleteButton, PanelTitle, SectionLabel, SegButton, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';
import { HL_COLORS, HL_WIDTHS, PEN_COLORS, PEN_WIDTHS, isHighlighter } from '../../boardTools';

interface StrokePanelProps {
  controller: EditorController;
  /** 선택한 획들 — 단일 선택은 원소 하나(마퀴 다중 선택과 같은 패널을 쓴다). */
  strokeIds: string[];
  isMobile?: boolean;
  short?: boolean;
}

/**
 * 선택한 그리기 획의 속성 패널(화이트보드).
 *
 * 획에는 글자도 자식도 없으므로 다룰 것이 색·굵기·삭제뿐이다. 팔레트와 굵기
 * 선택지는 **그 획을 그린 도구의 것**을 그대로 쓴다(형광펜 획에 검정 2px을
 * 제안하면 형광펜이 아니게 된다) — 도구 막대와 같은 상수를 공유하므로 "그릴 때
 * 고를 수 있던 값"과 "나중에 고칠 수 있는 값"이 어긋나지 않는다.
 *
 * **다중 선택**(마퀴, 요청)에서는 색·굵기에 **아무 값도 활성 표시하지 않는다** —
 * 고른 획들의 값이 제각각인데 하나를 켜 두면 "이미 그 색이다"라는 거짓말이 된다.
 * 누르면 고른 획 전부에 적용되고, 삭제도 전부를 지운다(단일과 같은 버튼).
 * 팔레트는 **첫 대상 기준**(굵게·기울임 등 기존 bulk 규칙과 같다): 형광펜 획을
 * 먼저 담았으면 형광 팔레트가 뜬다.
 */
export function StrokePanel({ controller, strokeIds, isMobile = false, short = false }: StrokePanelProps) {
  const th = controller.uiTheme;
  const all = controller.doc.strokes ?? [];
  const ids = strokeIds.filter((id) => all.some((s) => s.id === id));
  const first = ids.length ? all.find((s) => s.id === ids[0]) : undefined;
  if (!first) return null;
  const multi = ids.length > 1;
  const hl = isHighlighter(first);
  const palette = hl ? HL_COLORS : PEN_COLORS;
  const widths = hl ? HL_WIDTHS : PEN_WIDTHS;
  // 다중이면 활성 값이 없다 — 팔레트의 어느 스와치도, 굵기의 어느 칸도 켜지지 않는다.
  const curColor = multi ? null : first.color;
  const curWidth = multi ? null : first.w;

  return (
    <div data-props-panel style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>그림 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 그림" name={hl ? '형광펜 획' : '펜 획'} swatch={first.color} onClose={controller.clearSelection} />
        )}
        <SectionLabel theme={th}>색상</SectionLabel>
        <SwatchRow theme={th} palette={palette} current={curColor} onPick={(hex) => controller.setStrokeColor(ids, hex)} />
        <SectionLabel theme={th}>굵기</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${widths.length}, 1fr)`, gap: 6, marginBottom: 16 }}>
          {widths.map((w) => (
            <SegButton
              key={w}
              label={
                <span
                  // 형광펜 심(12~30)은 그대로 그리면 버튼을 넘는다 — 비율만 보이게 줄인다
                  // (도구 막대의 굵기 버튼과 같은 규칙).
                  style={{ display: 'block', width: 18, height: hl ? Math.round(w / 4) : w, minHeight: 2, borderRadius: 99, background: curWidth === w ? th.accent : th.subtext }}
                />
              }
              active={curWidth === w}
              theme={th}
              onClick={() => controller.setStrokeWidth(ids, w)}
              title={`굵기 ${w}`}
            />
          ))}
        </div>
        <DeleteButton theme={th} onClick={() => controller.deleteStrokes(ids)} />
      </div>
    </div>
  );
}
