import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelSection, PanelTitle, SectionLabel, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

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
 * (MindFlow.dc.html:350-401): 배경 스타일 / 텍스트 스타일(B·크기·색). With 2+
 * ids (`multiFloatSel`, MindFlow.dc.html:3009) the header switches to a
 * "다중 선택" count.
 */
export function FloatPanel({ controller, floatIds, isMobile = false }: FloatPanelProps) {
  const th = controller.uiTheme;
  // 색 스와치 "값"은 캔버스에 칠할 색이므로 문서 테마 팔레트를 쓴다
  const ct = controller.theme;
  const ids = floatIds.filter((id) => controller.doc.floats.some((x) => x.id === id));
  const refId = ids[0];
  const f = refId ? controller.doc.floats.find((x) => x.id === refId) : undefined;
  const [openSec, setOpenSec] = useState<string | null>(null);
  if (!f || !refId) return null;
  const multi = ids.length > 1;
  const isImage = !multi && !!f.img;
  const name = isImage ? '이미지' : f.text ? f.text.split('\n')[0]?.trim() || '빈 메모' : '빈 메모';
  const toggle = (k: string) => setOpenSec((cur) => (cur === k ? null : k));

  // 이미지 플로트: 메모용 배경/텍스트 스타일이 적용되지 않으므로 컨트롤 없이
  // 정보만 — 크기 조절은 캔버스의 코너 핸들(비율 고정), 삭제는 Del/우클릭.
  if (isImage) {
    return (
      <div style={panelWrapStyle(th, isMobile)}>
        <div style={panelBodyStyle(isMobile)}>
          <PanelTitle theme={th} kicker="선택한 이미지" name="이미지" />
          <div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.65 }}>
            모서리 핸들로 크기를 조절할 수 있어요 (비율 유지).
            <br />
            삭제는 Delete 키 또는 우클릭 메뉴에서.
          </div>
        </div>
      </div>
    );
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
          <SwatchRow theme={th} palette={[ct.panel, ct.text, ...ct.palette]} current={f.bg} onPick={(hex) => controller.setFloatBg(hex)} onReset={() => controller.setFloatBg(null)} />
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="텍스트 스타일" open={openSec === 'ftext'} onToggle={() => toggle('ftext')}>
          <BoldSizeRow theme={th} bold={!!f.bold} size={f.tsize} onToggleBold={controller.toggleFloatBold} onSetSize={controller.setFloatTsize} />
          <SectionLabel theme={th}>글자 색상</SectionLabel>
          <SwatchRow
            theme={th}
            palette={[ct.panel, ct.text, ...ct.palette]}
            current={f.textColor}
            onPick={(hex) => controller.setFloatTextColor(hex)}
            onReset={() => controller.setFloatTextColor(null)}
          />
        </PanelSection>
      </div>
    </div>
  );
}
