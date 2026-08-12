import type { EditorController } from '../../useEditorState';
import { DeleteButton, PanelTitle, SectionLabel, SegButton, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';
import { HL_COLORS, HL_WIDTHS, PEN_COLORS, PEN_WIDTHS, isHighlighter } from '../../boardTools';

interface StrokePanelProps {
  controller: EditorController;
  strokeId: string;
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
 */
export function StrokePanel({ controller, strokeId, isMobile = false, short = false }: StrokePanelProps) {
  const th = controller.uiTheme;
  const s = (controller.doc.strokes ?? []).find((x) => x.id === strokeId);
  if (!s) return null;
  const hl = isHighlighter(s);
  const palette = hl ? HL_COLORS : PEN_COLORS;
  const widths = hl ? HL_WIDTHS : PEN_WIDTHS;

  return (
    <div style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
      <div style={panelBodyStyle(isMobile)}>
        <PanelTitle theme={th} kicker="선택한 그림" name={hl ? '형광펜 획' : '펜 획'} />
        <SectionLabel theme={th}>색상</SectionLabel>
        <SwatchRow theme={th} palette={palette} current={s.color} onPick={(hex) => controller.setStrokeColor(strokeId, hex)} />
        <SectionLabel theme={th}>굵기</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${widths.length}, 1fr)`, gap: 6, marginBottom: 16 }}>
          {widths.map((w) => (
            <SegButton
              key={w}
              label={
                <span
                  // 형광펜 심(12~30)은 그대로 그리면 버튼을 넘는다 — 비율만 보이게 줄인다
                  // (도구 막대의 굵기 버튼과 같은 규칙).
                  style={{ display: 'block', width: 18, height: hl ? Math.round(w / 4) : w, minHeight: 2, borderRadius: 99, background: s.w === w ? th.accent : th.subtext }}
                />
              }
              active={s.w === w}
              theme={th}
              onClick={() => controller.setStrokeWidth(strokeId, w)}
              title={`굵기 ${w}`}
            />
          ))}
        </div>
        <DeleteButton theme={th} onClick={() => controller.deleteStroke(strokeId)} />
      </div>
    </div>
  );
}
