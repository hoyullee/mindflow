import type { EditorController } from '../../useEditorState';
import { PanelTitle, RenameButton, SectionLabel, SwatchRow, TileIcon, panelBodyStyle, panelWrapStyle } from './panelPrimitives';
import { MobilePanelSheet, type MobileGroup } from './MobilePanelSheet';

interface ZonePanelProps {
  controller: EditorController;
  zoneId: string;
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
}

/** Selected-zone property panel — port of the `zoneSelected` panel body
 * (MindFlow.dc.html:247-262). Desktop shows the controls inline; mobile uses the
 * drill-down sheet (`MobilePanelSheet`) for a consistent tap-a-tile flow. */
export function ZonePanel({ controller, zoneId, isMobile = false }: ZonePanelProps) {
  const th = controller.theme;
  const z = controller.doc.zones.find((x) => x.id === zoneId);
  if (!z) return null;

  const colorContent = (
    <>
      <SectionLabel theme={th}>영역 색상</SectionLabel>
      <SwatchRow theme={th} palette={th.palette} current={z.color} onPick={(hex) => controller.setZoneColor(zoneId, hex)} onReset={() => controller.setZoneColor(zoneId, null)} />
    </>
  );

  if (isMobile) {
    const groups: MobileGroup[] = [
      { key: 'zcolor', label: '색상', icon: TileIcon.palette, content: colorContent },
      { key: 'rename', label: '이름 편집', icon: TileIcon.edit, kind: 'action', onSelect: () => { controller.closeProps(); controller.startEditZoneLabel(zoneId); } },
    ];
    return <MobilePanelSheet theme={th} kicker="선택한 영역" name={z.label || '영역'} groups={groups} onClose={controller.closeProps} />;
  }

  return (
    <div style={panelWrapStyle(th, isMobile)}>
      <div style={panelBodyStyle(isMobile)}>
        <PanelTitle theme={th} kicker="선택한 영역" name={z.label || '영역'} />
        {colorContent}
        <RenameButton theme={th} onClick={() => controller.startEditZoneLabel(zoneId)} />
      </div>
    </div>
  );
}
