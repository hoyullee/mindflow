import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelTitle, SectionLabel, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface FloatPanelProps {
  controller: EditorController;
  floatId: string;
}

/**
 * Selected-memo property panel — port of the `floatPanelSel` panel body
 * (MindFlow.dc.html:350-401): 배경 스타일 / 텍스트 스타일(B·크기·색).
 * Multi-select is out of scope (Editor-c: marquee).
 */
export function FloatPanel({ controller, floatId }: FloatPanelProps) {
  const th = controller.theme;
  const f = controller.doc.floats.find((x) => x.id === floatId);
  if (!f) return null;
  const name = f.text ? f.text.split('\n')[0]?.trim() || '빈 메모' : '빈 메모';

  return (
    <div style={panelWrapStyle(th)}>
      <div style={panelBodyStyle()}>
        <PanelTitle theme={th} kicker="선택한 메모" name={name} />

        <SectionLabel theme={th}>메모 스타일</SectionLabel>
        <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={f.bg} onPick={(hex) => controller.setFloatBg(hex)} onReset={() => controller.setFloatBg(null)} />

        <Divider theme={th} />
        <SectionLabel theme={th}>텍스트 스타일</SectionLabel>
        <BoldSizeRow
          theme={th}
          bold={!!f.bold}
          size={f.tsize}
          onToggleBold={() => controller.toggleFloatBold(floatId)}
          onSetSize={(v) => controller.setFloatTsize(floatId, v)}
        />
        <SectionLabel theme={th}>글자 색상</SectionLabel>
        <SwatchRow
          theme={th}
          palette={[th.panel, th.text, ...th.palette]}
          current={f.textColor}
          onPick={(hex) => controller.setFloatTextColor(floatId, hex)}
          onReset={() => controller.setFloatTextColor(floatId, null)}
        />
      </div>
    </div>
  );
}
