import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
import { BoldSizeRow, Divider, PanelSection, PanelTitle, RenameButton, SectionLabel, SegButton, SwatchRow, panelBodyStyle, panelWrapStyle } from './panelPrimitives';

interface LinePanelProps {
  controller: EditorController;
  /** One or more selected line ids — port of `lineTargets()` (MindFlow.dc.html:1558).
   * 선 종류/화살표/텍스트 스타일 bulk-apply to every target; 곡률 and 이름 편집 stay
   * single-reference-only (matching `singleLineSel`, MindFlow.dc.html:302, 342). */
  lineIds: string[];
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
  /** 가로로 돌린 폰(낮은 화면) — 바텀시트 대신 오른쪽 사이드 시트. */
  short?: boolean;
}

/**
 * Selected-line property panel — port of the `lineSelected` panel body
 * (MindFlow.dc.html:264-348): 선 종류(점선/실선) / 시작·끝 화살표 / 곡률①② /
 * 텍스트 스타일(B·크기·색) / 이름 편집. With 2+ ids (`multiLineSel`,
 * MindFlow.dc.html:269) the header switches to a "다중 선택" count and the
 * 곡률/이름 편집 sections (single-only) are hidden.
 */
export function LinePanel({ controller, lineIds, isMobile = false, short = false }: LinePanelProps) {
  const th = controller.uiTheme;
  // 스와치 팔레트도 **고정** `uiTheme`을 쓴다(`th`) — 문서 테마를 바꿔도 패널이 제안하는
  // 색은 변하지 않는다. 예전엔 문서 테마(`controller.theme`)의 팔레트를 썼는데, 테마를
  // 바꾸는 순간 방금 적용한 색이 목록에서 사라져 되돌리기 어려웠다. 서식 팝업
  // (`TextToolbar`)과도 같은 규칙이라 두 진입점이 늘 같은 색을 제안한다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 여기서 고를 수 없다.)
  const ids = lineIds.filter((id) => controller.doc.lines.some((x) => x.id === id));
  const refId = ids[0];
  const l = refId ? controller.doc.lines.find((x) => x.id === refId) : undefined;
  // 열릴 때마다 **첫 구획은 펼친 채** 시작한다(요청) — 패널은 선택이 바뀔 때
  // key로 리마운트되므로 이 초기값이 곧 "매번 열릴 때"다.
  const [openSec, setOpenSec] = useState<string | null>('lstyle');
  if (!l || !refId) return null;
  const multi = ids.length > 1;
  const name = l.label && l.label.trim() ? l.label : l.dashed === false ? '실선' : '점선';
  const toggle = (k: string) => setOpenSec((cur) => (cur === k ? null : k));

  return (
    <div data-props-panel style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>선 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 선" name={name} swatch={l.color || th.subtext} onClose={controller.clearSelection} />
        )}

        <PanelSection theme={th} title="선 스타일" open={openSec === 'lstyle'} onToggle={() => toggle('lstyle')}>
          {/* 라벨은 다른 패널과 같은 `SectionLabel`(11px 대문자 톤), 두 버튼은 2열
              그리드로 행 폭을 채워 아래 위 행의 열이 정렬되게 — 제보(배치가 중구난방)
              의 "라벨 스타일·버튼 폭 제각각" 부분 정리. */}
          <SectionLabel theme={th}>선 종류</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 16 }}>
            <SegButton label="점선" active={!!l.dashed} theme={th} onClick={() => controller.setLineDashed(true)} />
            <SegButton label="실선" active={!l.dashed} theme={th} onClick={() => controller.setLineDashed(false)} />
          </div>
          <SectionLabel theme={th}>시작점 화살표</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 16 }}>
            <SegButton label="화살표" active={l.startArrow} theme={th} onClick={() => controller.setLineArrow(1, true)} />
            <SegButton label="없음" active={!l.startArrow} theme={th} onClick={() => controller.setLineArrow(1, false)} />
          </div>
          <SectionLabel theme={th}>끝점 화살표</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 16 }}>
            <SegButton label="화살표" active={l.endArrow} theme={th} onClick={() => controller.setLineArrow(2, true)} />
            <SegButton label="없음" active={!l.endArrow} theme={th} onClick={() => controller.setLineArrow(2, false)} />
          </div>
        </PanelSection>

        {!multi && (
          <>
            <Divider theme={th} />
            <PanelSection theme={th} title="곡률" open={openSec === 'lcurve'} onToggle={() => toggle('lcurve')}>
              <SectionLabel theme={th}>
                <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>곡률 ①</span>
                  <span style={{ fontWeight: 500 }}>{Math.round(l.c1 != null ? l.c1 : l.curve || 0)}</span>
                </span>
              </SectionLabel>
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
              <SectionLabel theme={th}>
                <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>곡률 ②</span>
                  <span style={{ fontWeight: 500 }}>{Math.round(l.c2 != null ? l.c2 : l.curve || 0)}</span>
                </span>
              </SectionLabel>
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
            </PanelSection>
          </>
        )}

        <Divider theme={th} />
        <PanelSection theme={th} title="텍스트 스타일" open={openSec === 'ltext'} onToggle={() => toggle('ltext')}>
          <BoldSizeRow theme={th} bold={!!l.lbold} size={l.lsize} onToggleBold={controller.toggleLineBold} onSetSize={controller.setLineTsize} />
          <SwatchRow label="글자 색상"
            theme={th}
            palette={[th.panel, th.text, ...th.palette]}
            current={l.ltextColor}
            onPick={(hex) => controller.setLineTextColor(hex)}
            onReset={() => controller.setLineTextColor(null)}
          />
        </PanelSection>

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
