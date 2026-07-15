import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelTitle, RenameButton, SectionLabel, SegButton, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface LinePanelProps {
  controller: EditorController;
  /** One or more selected line ids — port of `lineTargets()` (MindFlow.dc.html:1558).
   * 선 종류/화살표/텍스트 스타일 bulk-apply to every target; 곡률 and 이름 편집 stay
   * single-reference-only (matching `singleLineSel`, MindFlow.dc.html:302, 342). */
  lineIds: string[];
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
}

/**
 * Selected-line property panel — port of the `lineSelected` panel body
 * (MindFlow.dc.html:264-348): 선 종류(점선/실선) / 시작·끝 화살표 / 곡률①② /
 * 텍스트 스타일(B·크기·색) / 이름 편집. With 2+ ids (`multiLineSel`,
 * MindFlow.dc.html:269) the header switches to a "다중 선택" count and the
 * 곡률/이름 편집 sections (single-only) are hidden.
 */
export function LinePanel({ controller, lineIds, isMobile = false }: LinePanelProps) {
  const th = controller.theme;
  const ids = lineIds.filter((id) => controller.doc.lines.some((x) => x.id === id));
  const refId = ids[0];
  const l = refId ? controller.doc.lines.find((x) => x.id === refId) : undefined;
  if (!l || !refId) return null;
  const multi = ids.length > 1;
  const name = l.label && l.label.trim() ? l.label : l.dashed === false ? '실선' : '점선';

  return (
    <div style={panelWrapStyle(th, isMobile)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>선 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 선" name={name} />
        )}

        <SectionLabel theme={th}>선 스타일</SectionLabel>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>선 종류</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <SegButton label="점선" active={!!l.dashed} theme={th} onClick={() => controller.setLineDashed(true)} />
          <SegButton label="실선" active={!l.dashed} theme={th} onClick={() => controller.setLineDashed(false)} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>시작점 화살표</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <SegButton label="화살표" active={l.startArrow} theme={th} onClick={() => controller.setLineArrow(1, true)} />
          <SegButton label="없음" active={!l.startArrow} theme={th} onClick={() => controller.setLineArrow(1, false)} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>끝점 화살표</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <SegButton label="화살표" active={l.endArrow} theme={th} onClick={() => controller.setLineArrow(2, true)} />
          <SegButton label="없음" active={!l.endArrow} theme={th} onClick={() => controller.setLineArrow(2, false)} />
        </div>

        {!multi && (
          <>
            <Divider theme={th} />
            <SectionLabel theme={th}>곡률</SectionLabel>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
              <span>곡률 ①</span>
              <span style={{ color: th.subtext, fontWeight: 500 }}>{Math.round(l.c1 != null ? l.c1 : l.curve || 0)}</span>
            </div>
            <input
              type="range"
              min={-500}
              max={500}
              step={1}
              value={Math.round(l.c1 != null ? l.c1 : l.curve || 0)}
              onChange={(e) => controller.setLineCurve(refId, 1, Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ width: '100%', margin: '0 0 10px', accentColor: th.accent }}
            />
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
              <span>곡률 ②</span>
              <span style={{ color: th.subtext, fontWeight: 500 }}>{Math.round(l.c2 != null ? l.c2 : l.curve || 0)}</span>
            </div>
            <input
              type="range"
              min={-500}
              max={500}
              step={1}
              value={Math.round(l.c2 != null ? l.c2 : l.curve || 0)}
              onChange={(e) => controller.setLineCurve(refId, 2, Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ width: '100%', margin: '0 0 16px', accentColor: th.accent }}
            />
          </>
        )}

        <Divider theme={th} />
        <SectionLabel theme={th}>텍스트 스타일</SectionLabel>
        <BoldSizeRow theme={th} bold={!!l.lbold} size={l.lsize} onToggleBold={controller.toggleLineBold} onSetSize={controller.setLineTsize} />
        <SectionLabel theme={th}>글자 색상</SectionLabel>
        <SwatchRow
          theme={th}
          palette={[th.panel, th.text, ...th.palette]}
          current={l.ltextColor}
          onPick={(hex) => controller.setLineTextColor(hex)}
          onReset={() => controller.setLineTextColor(null)}
        />

        {!multi && (
          <>
            <Divider theme={th} />
            <RenameButton theme={th} onClick={() => controller.startEditLineLabel(refId)} />
          </>
        )}
      </div>
    </div>
  );
}
