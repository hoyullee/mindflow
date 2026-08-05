import type { EditorController } from '../../useEditorState';
import { PanelTitle, RenameButton, SectionLabel, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface ZonePanelProps {
  controller: EditorController;
  zoneId: string;
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
  /** 가로로 돌린 폰(낮은 화면) — 바텀시트 대신 오른쪽 사이드 시트. */
  short?: boolean;
}

/** Selected-zone property panel — port of the `zoneSelected` panel body (MindFlow.dc.html:247-262). */
export function ZonePanel({ controller, zoneId, isMobile = false, short = false }: ZonePanelProps) {
  const th = controller.uiTheme;
  // 스와치 팔레트도 **고정** `uiTheme`을 쓴다(`th`) — 문서 테마를 바꿔도 패널이 제안하는
  // 색은 변하지 않는다. 예전엔 문서 테마(`controller.theme`)의 팔레트를 썼는데, 테마를
  // 바꾸는 순간 방금 적용한 색이 목록에서 사라져 되돌리기 어려웠다. 서식 팝업
  // (`TextToolbar`)과도 같은 규칙이라 두 진입점이 늘 같은 색을 제안한다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 여기서 고를 수 없다.)
  const z = controller.doc.zones.find((x) => x.id === zoneId);
  if (!z) return null;

  return (
    <div style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
      <div style={panelBodyStyle(isMobile)}>
        <PanelTitle theme={th} kicker="선택한 영역" name={z.label || '영역'} />
        <SectionLabel theme={th}>영역 색상</SectionLabel>
        <SwatchRow theme={th} palette={th.palette} current={z.color} onPick={(hex) => controller.setZoneColor(zoneId, hex)} onReset={() => controller.setZoneColor(zoneId, null)} />
        <RenameButton theme={th} onClick={() => controller.startEditZoneLabel(zoneId)} />
      </div>
    </div>
  );
}
