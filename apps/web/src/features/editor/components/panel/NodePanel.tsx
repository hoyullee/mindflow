import { useState } from 'react';
import type { EditorController } from '../../useEditorState';
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
export function NodePanel({ controller, nodeIds, isMobile = false }: NodePanelProps) {
  const th = controller.theme;
  const ids = nodeIds.filter((id) => controller.doc.nodes[id]);
  const refId = ids[0];
  const n = refId ? controller.doc.nodes[refId] : undefined;
  const [openSec, setOpenSec] = useState<string | null>(null);
  if (!n || !refId) return null;
  const multi = ids.length > 1;
  const toggle = (k: string) => setOpenSec((cur) => (cur === k ? null : k));

  return (
    <div style={panelWrapStyle(th, isMobile)}>
      <div style={panelBodyStyle(isMobile)}>
        {multi ? (
          <>
            <SectionLabel theme={th}>다중 선택</SectionLabel>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>도형 {ids.length}개 선택됨</div>
          </>
        ) : (
          <PanelTitle theme={th} kicker="선택한 주제" name={n.text} />
        )}

        <PanelSection theme={th} title="도형 스타일" open={openSec === 'shape'} onToggle={() => toggle('shape')}>
          <SectionLabel theme={th}>모양</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
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
                    width: 34,
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
          <BoldSizeRow theme={th} bold={!!n.bold} size={n.tsize} onToggleBold={controller.toggleNodeBold} onSetSize={controller.setNodeTsize} />
          <SectionLabel theme={th}>글자 색상</SectionLabel>
          <SwatchRow theme={th} palette={[th.panel, th.text, ...th.palette]} current={n.textColor} onPick={(hex) => controller.setTextColor(hex)} onReset={() => controller.setTextColor(null)} />
        </PanelSection>

        <Divider theme={th} />
        <PanelSection theme={th} title="아이콘" open={openSec === 'icon'} onToggle={() => toggle('icon')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingBottom: 16 }}>
            <button
              type="button"
              className="mf-ed-btn"
              onClick={controller.clearEmoji}
              style={{ width: 30, height: 30, border: `1px solid ${th.border}`, borderRadius: 8, background: th.panel, cursor: 'pointer', fontSize: 12, color: th.subtext, fontFamily: 'inherit' }}
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
                style={{ width: 30, height: 30, border: `1px solid ${th.border}`, borderRadius: 8, background: th.panel, cursor: 'pointer', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}
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
