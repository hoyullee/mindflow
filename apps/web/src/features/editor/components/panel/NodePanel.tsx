import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
import { nodeFullyRich } from '../../mutations';
import {
  AlphaSlider,
  BoldSizeRow,
  Divider,
  EMOJIS,
  PanelSection,
  PanelTitle,
  RenameButton,
  SectionLabel,
  SHAPES,
  ShapeGlyph,
  SwatchRow,
  panelBodyStyle,
  panelWrapStyle,
} from './panelPrimitives';

interface NodePanelProps {
  controller: EditorController;
  /** One or more selected node ids (a plain single-select is `[nodeId]`, a
   * marquee multi-selection is every targeted node) — port of `nodeTargets()`
   * (MindFlow.dc.html:1557). All style setters below already bulk-apply to
   * every target (see `useEditorState`'s `nodeTargetIds`), so this panel
   * doesn't need to loop itself. */
  nodeIds: string[];
  /** M6: renders as a bottom sheet instead of a floating side panel. */
  isMobile?: boolean;
  /** 가로로 돌린 폰(낮은 화면) — 바텀시트 대신 오른쪽 사이드 시트. */
  short?: boolean;
}

/**
 * Selected-node property panel — port of the `hasSelection` panel body
 * (MindFlow.dc.html:136-245): 모양(shape) / 가지 색상 / 배경색+투명도 /
 * 선 색상+투명도 / 텍스트 스타일(B·크기·색) / 아이콘 / 메모 / 이름 편집.
 * Sections are collapsible (`PanelSection`), collapsed by default and one open
 * at a time — the dc original's `panelSec` accordion (도형 스타일 / 텍스트
 * 스타일 / 아이콘). With 2+ ids (`multiNodeSel`, MindFlow.dc.html:2967) the header switches to
 * a "다중 선택" count and 메모/이름 편집 (single-only, MindFlow.dc.html:141,
 * 236) are hidden — everything else applies to every target at once, exactly
 * like the original's own `nodeTargets()`-driven setters.
 */
export function NodePanel({ controller, nodeIds, isMobile = false, short = false }: NodePanelProps) {
  const th = controller.uiTheme;
  // 스와치 팔레트도 **고정** `uiTheme`을 쓴다(`th`) — 문서 테마를 바꿔도 패널이 제안하는
  // 색은 변하지 않는다. 예전엔 문서 테마(`controller.theme`)의 팔레트를 썼는데, 테마를
  // 바꾸는 순간 방금 적용한 색이 목록에서 사라져 되돌리기 어려웠다. 서식 팝업
  // (`TextToolbar`)과도 같은 규칙이라 두 진입점이 늘 같은 색을 제안한다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 여기서 고를 수 없다.)
  const ids = nodeIds.filter((id) => controller.doc.nodes[id]);
  const refId = ids[0];
  const n = refId ? controller.doc.nodes[refId] : undefined;
  const [openSec, setOpenSec] = useState<string | null>(null);
  if (!n || !refId) return null;
  const multi = ids.length > 1;
  const toggle = (k: string) => setOpenSec((cur) => (cur === k ? null : k));

  return (
    <div style={panelWrapStyle(th, isMobile, !!controller.saveConflict, short)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>주제 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 주제" name={n.text} />
        )}

        <PanelSection theme={th} title="주제 스타일" open={openSec === 'shape'} onToggle={() => toggle('shape')}>
          <SectionLabel theme={th}>모양</SectionLabel>
          {/* 8종을 4열 그리드(2행)로 — flex-wrap 시절엔 6+2로 감겨 줄이 들쭉날쭉했다
              (제보: 배치가 중구난방). 버튼은 셀 폭을 채워 열이 수직으로 정렬된다. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 16 }}>
            {SHAPES.map((s) => {
              const active = (n.shape || 'round') === s.k;
              return (
                <button
                  key={s.k}
                  type="button"
                  className="mf-ed-btn"
                  title={s.label}
                  onClick={() => controller.setShape(s.k)}
                  aria-pressed={active}
                  style={{
                    width: '100%',
                    height: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${active ? th.accent : th.border}`,
                    borderRadius: 8,
                    background: active ? `${th.accent}1a` : th.panel,
                    cursor: 'pointer',
                    color: active ? th.accent : th.subtext,
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  <ShapeGlyph kind={s.k} />
                </button>
              );
            })}
          </div>

          <SectionLabel theme={th}>가지 색상</SectionLabel>
          <SwatchRow theme={th} palette={th.palette} current={n.color} onPick={(hex) => controller.setColor(hex)} />

          <SectionLabel theme={th}>배경색</SectionLabel>
          <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={n.fill} onPick={(hex) => controller.setFill(hex)} onReset={() => controller.setFill(null)} />
          <AlphaSlider theme={th} value={n.fillA == null ? 1 : n.fillA} onChange={(a) => controller.setFillAlpha(a)} />

          <SectionLabel theme={th}>선 색상</SectionLabel>
          <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={n.stroke} onPick={(hex) => controller.setStroke(hex)} onReset={() => controller.setStroke(null)} />
          <AlphaSlider theme={th} value={n.strokeA == null ? 1 : n.strokeA} onChange={(a) => controller.setStrokeAlpha(a)} />
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="텍스트 스타일" open={openSec === 'text'} onToggle={() => toggle('text')}>
          <BoldSizeRow
            theme={th}
            bold={!!n.bold}
            size={n.tsize}
            onToggleBold={controller.toggleNodeBold}
            onSetSize={controller.setNodeTsize}
            // I·S 활성 표시는 굵게와 같은 규칙으로 REF(첫 대상) 노드 기준 — 다중 선택의
            // 토글 방향 판정(`toggleNodesRichStyle`의 first)과 일치해 버튼 상태와 실제
            // 동작이 어긋나지 않는다.
            italic={nodeFullyRich(n, 'i')}
            strike={nodeFullyRich(n, 's')}
            onToggleItalic={() => controller.toggleNodeRichStyle('i')}
            onToggleStrike={() => controller.toggleNodeRichStyle('s')}
          />
          <SectionLabel theme={th}>글자 색상</SectionLabel>
          <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={n.textColor} onPick={(hex) => controller.setTextColor(hex)} onReset={() => controller.setTextColor(null)} />
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="아이콘" open={openSec === 'icon'} onToggle={() => toggle('icon')}>
          {/* ✕ + 이모지 20종 = 21개 — 7열 그리드로 정확히 3행. flex-wrap 시절의
              어중간한 마지막 줄(6+6+6+3)을 없앤다. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, paddingBottom: 16 }}>
            <button
              type="button"
              className="mf-ed-btn"
              title="아이콘 없음"
              onClick={controller.clearEmoji}
              aria-pressed={!n.emoji}
              style={{ width: '100%', height: 28, border: `1px solid ${!n.emoji ? th.accent : th.border}`, borderRadius: 8, background: !n.emoji ? `${th.accent}1a` : th.panel, cursor: 'pointer', fontSize: 12, color: !n.emoji ? th.accent : th.subtext, fontFamily: 'inherit', padding: 0 }}
            >
              ✕
            </button>
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className="mf-ed-btn"
                onClick={() => controller.setEmoji(e)}
                aria-pressed={n.emoji === e}
                style={{ width: '100%', height: 28, border: `1px solid ${n.emoji === e ? th.accent : th.border}`, borderRadius: 8, background: n.emoji === e ? `${th.accent}1a` : th.panel, cursor: 'pointer', fontSize: 15, lineHeight: 1, fontFamily: 'inherit', padding: 0 }}
              >
                {e}
              </button>
            ))}
          </div>
        </PanelSection>

        {!multi && (
          <>
            <Divider theme={th} />
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: th.subtext, margin: '12px 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
              메모 <span style={{ fontSize: 12 }}>📝</span>
            </div>
            <textarea
              value={n.note || ''}
              onChange={(e) => controller.setNote(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="이 주제에 대한 메모를 남겨보세요…"
              style={{
                width: '100%',
                minHeight: 78,
                resize: 'vertical',
                border: `1px solid ${th.border}`,
                borderRadius: 9,
                background: th.panel2,
                color: th.text,
                fontFamily: 'inherit',
                fontSize: 12.5,
                lineHeight: 1.55,
                padding: '9px 10px',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 16,
              }}
            />

            <RenameButton theme={th} onClick={() => controller.startEditNode(refId)} />
          </>
        )}
      </div>
    </div>
  );
}
