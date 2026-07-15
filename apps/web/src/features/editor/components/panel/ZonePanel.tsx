import type { EditorController } from '../../useEditorState';
import { PanelTitle, RenameButton, SectionLabel, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface ZonePanelProps {
  controller: EditorController;
  zoneId: string;
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
}

/** Selected-zone property panel — port of the `zoneSelected` panel body (MindFlow.dc.html:247-262). */
export function ZonePanel({ controller, zoneId, isMobile = false }: ZonePanelProps) {
  const th = controller.theme;
  const z = controller.doc.zones.find((x) => x.id === zoneId);
  if (!z) return null;

  return (
    <div style={panelWrapStyle(th, isMobile)}>
      <div style={panelBodyStyle(isMobile)}>
        <PanelTitle theme={th} kicker="선택한 영역" name={z.label || '영역'} />
        <SectionLabel theme={th}>영역 색상</SectionLabel>
        <SwatchRow theme={th} palette={th.palette} current={z.color} onPick={(hex) => controller.setZoneColor(zoneId, hex)} onReset={() => controller.setZoneColor(zoneId, null)} />
        <RenameButton theme={th} onClick={() => controller.startEditZoneLabel(zoneId)} />
      </div>
    </div>
  );
}
