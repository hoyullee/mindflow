import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelSection, PanelTitle, SectionLabel, SwatchRow, TileIcon, panelBodyStyle, panelWrapStyle } from './panelPrimitives';
import { MobilePanelSheet, type MobileGroup } from './MobilePanelSheet';

interface FloatPanelProps {
  controller: EditorController;
  /** One or more selected memo ids — port of `floatTargets()` (MindFlow.dc.html:2732).
   * Style setters bulk-apply to every target. */
  floatIds: string[];
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
}

/**
 * Selected-memo property panel — port of the `floatPanelSel` panel body
 * (MindFlow.dc.html:350-401): 배경 스타일 / 텍스트 스타일(B·크기·색). Desktop keeps
 * the accordion; mobile uses the drill-down sheet (`MobilePanelSheet`). With 2+
 * ids (`multiFloatSel`, MindFlow.dc.html:3009) the header switches to a
 * "다중 선택" count.
 */
export function FloatPanel({ controller, floatIds, isMobile = false }: FloatPanelProps) {
  const th = controller.theme;
  const ids = floatIds.filter((id) => controller.doc.floats.some((x) => x.id === id));
  const refId = ids[0];
  const f = refId ? controller.doc.floats.find((x) => x.id === refId) : undefined;
  const [openSec, setOpenSec] = useState<string | null>(null);
  if (!f || !refId) return null;
  const multi = ids.length > 1;
  const name = f.text ? f.text.split('\n')[0]?.trim() || '빈 메모' : '빈 메모';
  const toggle = (k: string) => setOpenSec((cur) => (cur === k ? null : k));

  const bgContent = <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={f.bg} onPick={(hex) => controller.setFloatBg(hex)} onReset={() => controller.setFloatBg(null)} />;

  const textContent = (
    <>
      <BoldSizeRow theme={th} bold={!!f.bold} size={f.tsize} onToggleBold={controller.toggleFloatBold} onSetSize={controller.setFloatTsize} />
      <SectionLabel theme={th}>글자 색상</SectionLabel>
      <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={f.textColor} onPick={(hex) => controller.setFloatTextColor(hex)} onReset={() => controller.setFloatTextColor(null)} />
    </>
  );

  if (isMobile) {
    const groups: MobileGroup[] = [
      { key: 'fbg', label: '배경', icon: TileIcon.palette, content: bgContent },
      { key: 'ftext', label: '텍스트', icon: TileIcon.text, content: textContent },
    ];
    return <MobilePanelSheet theme={th} kicker={multi ? '다중 선택' : '선택한 메모'} name={multi ? `메모 ${ids.length}개` : name} groups={groups} onClose={controller.closeProps} />;
  }

  return (
    <div style={panelWrapStyle(th, isMobile)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>메모 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 메모" name={name} />
        )}

        <PanelSection theme={th} title="메모 스타일" open={openSec === 'fbg'} onToggle={() => toggle('fbg')}>
          {bgContent}
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="텍스트 스타일" open={openSec === 'ftext'} onToggle={() => toggle('ftext')}>
          {textContent}
        </PanelSection>
      </div>
    </div>
  );
}
