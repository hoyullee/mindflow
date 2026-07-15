import type { EditorController } from '../../useEditorState';
import { PanelTitle, RenameButton, SectionLabel, SwatchRow } from './panelPrimitives';

interface ZonePanelProps {
  controller: EditorController;
  zoneId: string;
}

/** Selected-zone property panel — port of the `zoneSelected` panel body (MindFlow.dc.html:247-262). */
export function ZonePanel({ controller, zoneId }: ZonePanelProps) {
  const th = controller.theme;
  const z = controller.doc.zones.find((x) => x.id === zoneId);
  if (!z) return null;

  return (
    <div style={{ position: 'absolute', left: 16, top: 80, width: 236, border: `1px solid ${th.border}`, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.10)', zIndex: 15, overflow: 'hidden', background: th.panel }}>
      <div style={{ padding: 14 }}>
        <PanelTitle theme={th} kicker="선택한 영역" name={z.label || '영역'} />
        <SectionLabel theme={th}>영역 색상</SectionLabel>
        <SwatchRow theme={th} palette={th.palette} current={z.color} onPick={(hex) => controller.setZoneColor(zoneId, hex)} onReset={() => controller.setZoneColor(zoneId, null)} />
        <RenameButton theme={th} onClick={() => controller.startEditZoneLabel(zoneId)} />
      </div>
    </div>
  );
}
