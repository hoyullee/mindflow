import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
import { FLOAT_CAPTION_MAX } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelSection, PanelTitle, SectionLabel, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';
import { floatFullyRich } from '../../mutations';

interface FloatPanelProps {
  controller: EditorController;
  /** One or more selected memo ids — port of `floatTargets()` (MindFlow.dc.html:2732).
   * Style setters bulk-apply to every target. */
  floatIds: string[];
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
  /** 가로로 돌린 폰(낮은 화면) — 바텀시트 대신 오른쪽 사이드 시트. */
  short?: boolean;
}

/**
 * Selected-memo property panel — port of the `floatPanelSel` panel body
 * (MindFlow.dc.html:350-401): 배경 스타일 / 텍스트 스타일(B·크기·색). With 2+
 * ids (`multiFloatSel`, MindFlow.dc.html:3009) the header switches to a
 * "다중 선택" count.
 */
export function FloatPanel({ controller, floatIds, isMobile = false, short = false }: FloatPanelProps) {
  const th = controller.uiTheme;
  // 스와치 팔레트도 **고정** `uiTheme`을 쓴다(`th`) — 문서 테마를 바꿔도 패널이 제안하는
  // 색은 변하지 않는다. 예전엔 문서 테마(`controller.theme`)의 팔레트를 썼는데, 테마를
  // 바꾸는 순간 방금 적용한 색이 목록에서 사라져 되돌리기 어려웠다. 서식 팝업
  // (`TextToolbar`)과도 같은 규칙이라 두 진입점이 늘 같은 색을 제안한다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 여기서 고를 수 없다.)
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
      <div style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
        <div style={panelBodyStyle(isMobile)}>
          <PanelTitle theme={th} kicker="선택한 이미지" name={(f.caption || '').trim() || '이미지'} />
          {/* 이미지 제목(캡션) — 이미지 아래 한 줄로 그려진다(Float.caption).
              blur/Enter에 커밋(입력마다 커밋하면 타이핑마다 undo 단계가 쌓인다). */}
          <SectionLabel theme={th}>제목</SectionLabel>
          <input
            key={refId}
            type="text"
            defaultValue={f.caption || ''}
            placeholder="이미지 아래 표시할 제목"
            // 한 줄 말줄임으로 그려지는 자리라 길게 적어도 보이지 않는다 —
            // 입력 단계에서 20자로 끊는다(요청).
            maxLength={FLOAT_CAPTION_MAX}
            aria-label="이미지 제목"
            onBlur={(e) => controller.setFloatCaption(refId, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: 12,
              padding: '7px 9px',
              border: `1px solid ${th.border}`,
              borderRadius: 8,
              background: th.panel2,
              color: th.text,
              fontFamily: 'inherit',
              fontSize: 12.5,
              outline: 'none',
            }}
          />
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
    <div style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
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
          <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={f.bg} onPick={(hex) => controller.setFloatBg(hex)} onReset={() => controller.setFloatBg(null)} />
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="텍스트 스타일" open={openSec === 'ftext'} onToggle={() => toggle('ftext')}>
          <BoldSizeRow
            theme={th}
            bold={!!f.bold}
            size={f.tsize}
            onToggleBold={controller.toggleFloatBold}
            onSetSize={controller.setFloatTsize}
            // I·S는 노드 패널과 같은 whole-toggle(전체 텍스트에 rich 적용) — 서식
            // 파리티 완성. 활성 표시도 노드와 같은 첫 대상 기준.
            italic={floatFullyRich(f, 'i')}
            strike={floatFullyRich(f, 's')}
            onToggleItalic={() => controller.toggleFloatRichStyle('i')}
            onToggleStrike={() => controller.toggleFloatRichStyle('s')}
          />
          <SectionLabel theme={th}>글자 색상</SectionLabel>
          <SwatchRow
            theme={th}
            palette={[th.panel, th.text, ...th.palette]}
            current={f.textColor}
            onPick={(hex) => controller.setFloatTextColor(hex)}
            onReset={() => controller.setFloatTextColor(null)}
          />
        </PanelSection>
      </div>
    </div>
  );
}
