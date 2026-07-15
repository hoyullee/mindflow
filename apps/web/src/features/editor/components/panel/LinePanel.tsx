import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelTitle, RenameButton, SectionLabel, SegButton, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface LinePanelProps {
  controller: EditorController;
  lineId: string;
}

/**
 * Selected-line property panel — port of the `lineSelected` panel body
 * (MindFlow.dc.html:264-348): 선 종류(점선/실선) / 시작·끝 화살표 / 곡률①② /
 * 텍스트 스타일(B·크기·색) / 이름 편집. Multi-select (`multiLineSel`) is out
 * of scope (Editor-c: marquee).
 */
export function LinePanel({ controller, lineId }: LinePanelProps) {
  const th = controller.theme;
  const l = controller.doc.lines.find((x) => x.id === lineId);
  if (!l) return null;
  const name = l.label && l.label.trim() ? l.label : l.dashed === false ? '실선' : '점선';

  return (
    <div style={panelWrapStyle(th)}>
      <div style={panelBodyStyle()}>
        <PanelTitle theme={th} kicker="선택한 선" name={name} />

        <SectionLabel theme={th}>선 스타일</SectionLabel>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>선 종류</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <SegButton label="점선" active={!!l.dashed} theme={th} onClick={() => controller.setLineDashed(lineId, true)} />
          <SegButton label="실선" active={!l.dashed} theme={th} onClick={() => controller.setLineDashed(lineId, false)} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>시작점 화살표</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <SegButton label="화살표" active={l.startArrow} theme={th} onClick={() => controller.setLineArrow(lineId, 1, true)} />
          <SegButton label="없음" active={!l.startArrow} theme={th} onClick={() => controller.setLineArrow(lineId, 1, false)} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>끝점 화살표</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <SegButton label="화살표" active={l.endArrow} theme={th} onClick={() => controller.setLineArrow(lineId, 2, true)} />
          <SegButton label="없음" active={!l.endArrow} theme={th} onClick={() => controller.setLineArrow(lineId, 2, false)} />
        </div>

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
          onChange={(e) => controller.setLineCurve(lineId, 1, Number(e.target.value))}
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
          onChange={(e) => controller.setLineCurve(lineId, 2, Number(e.target.value))}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: '100%', margin: '0 0 16px', accentColor: th.accent }}
        />

        <Divider theme={th} />
        <SectionLabel theme={th}>텍스트 스타일</SectionLabel>
        <BoldSizeRow theme={th} bold={!!l.lbold} size={l.lsize} onToggleBold={() => controller.toggleLineBold(lineId)} onSetSize={(v) => controller.setLineTsize(lineId, v)} />
        <SectionLabel theme={th}>글자 색상</SectionLabel>
        <SwatchRow
          theme={th}
          palette={[th.panel, th.text, ...th.palette]}
          current={l.ltextColor}
          onPick={(hex) => controller.setLineTextColor(lineId, hex)}
          onReset={() => controller.setLineTextColor(lineId, null)}
        />

        <Divider theme={th} />
        <RenameButton theme={th} onClick={() => controller.startEditLineLabel(lineId)} />
      </div>
    </div>
  );
}
