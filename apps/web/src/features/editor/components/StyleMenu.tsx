import type { CSSProperties } from 'react';
import { LAYOUT_MODES, EDGE_MODES } from '../tree';
import { THEME_KEYS, THEMES, hexA } from '../theme';
import { Segmented } from '../../../components/Segmented';
import type { EditorController } from '../useEditorState';

interface StyleMenuProps {
  controller: EditorController;
}

/**
 * Layout / connector-style / theme dropdown — port of the `.mf-style` popover
 * body (MindFlow.dc.html:71-90). All three controls are wired (they directly
 * affect rendering, per the M3-Editor-a task); positioning is anchored via
 * CSS (`position: absolute; top: 100%`) rather than the original's
 * runtime-measured `position: fixed` — a harmless layout-only simplification.
 */
export function StyleMenu({ controller }: StyleMenuProps) {
  const segStyle = (active: boolean): CSSProperties => ({
    height: 28,
    padding: '0 10px',
    border: 'none',
    borderRadius: 7,
    background: active ? controller.uiTheme.panel : 'transparent',
    color: active ? controller.uiTheme.accent : controller.uiTheme.subtext,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,.10)' : 'none',
  });

  // 면·그늘·위치는 `Menu`(Radix Content)가 그린다 — 여기서 또 그리면 패널이 겹친다.
  // 이 메뉴는 항목 목록이 아니라 **설정 패널**(세그먼트·스와치)이라 Radix 항목으로
  // 감싸지 않는다: 화살표 이동이 뜻을 갖지 않고 Tab으로 옮겨 다니는 게 맞다.
  // (성격상 Popover이므로 다음 단계에서 Popover로 옮기는 것이 정확하다.)
  return (
    <div className="mf-ed-stylemenu" style={{ width: '100%', boxSizing: 'border-box', padding: 9 }}>
      {/* 화이트보드에는 트리가 없다 — 레이아웃(트리 배치)과 연결선(트리 간선)
          구획은 누를 대상이 없으므로 감춘다("할 수 없는 것은 보이지 않는다"). */}
      {!controller.isBoard && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.uiTheme.subtext, marginBottom: 8 }}>레이아웃</div>
          {/* 하나만 고르는 묶음 — `Segmented`(Radix ToggleGroup)라 ←/→로 옮겨 다닌다. */}
          <Segmented
            value={controller.layoutMode}
            onChange={controller.setLayoutMode}
            label="레이아웃"
            track={{ display: 'flex', alignItems: 'center', gap: 0, padding: 3, background: controller.uiTheme.panel2, border: `1px solid ${controller.uiTheme.border}`, borderRadius: 10, marginBottom: 14 }}
            itemClass="mf-ed-btn"
            items={LAYOUT_MODES.map((m) => ({ value: m.k, label: m.label, style: segStyle }))}
          />

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.uiTheme.subtext, marginBottom: 8 }}>연결선</div>
          <Segmented
            value={controller.edgeStyle}
            onChange={controller.setEdgeStyle}
            label="연결선"
            track={{ display: 'flex', alignItems: 'center', gap: 0, padding: 3, background: controller.uiTheme.panel2, border: `1px solid ${controller.uiTheme.border}`, borderRadius: 10, marginBottom: 14 }}
            itemClass="mf-ed-btn"
            items={EDGE_MODES.map((m) => ({ value: m.k, label: m.label, style: segStyle }))}
          />
        </>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.uiTheme.subtext, marginBottom: 8 }}>테마</div>
      {/* 스와치는 **그 테마의 캔버스 면 + 강조색 점** — 강조색 원만 그리면
          화이트·모노·다크처럼 면이 정체인 테마가 서로 구별되지 않는다(홈 설정
          모달이 쓰는 것과 같은 문법). 개수가 늘어도 접히도록 wrap. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {THEME_KEYS.map((k) => {
          const t = THEMES[k];
          const active = controller.themeKey === k;
          return (
            <button
              key={k}
              type="button"
              data-theme-swatch={k}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              onClick={() => controller.setThemeKey(k)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: t.canvasBg,
                border: active ? `2px solid ${controller.uiTheme.accent}` : `1px solid ${t.border}`,
                boxShadow: active ? `0 0 0 2px ${hexA(controller.uiTheme.accent, 0.28)}` : '0 1px 3px rgba(0,0,0,.12)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accent, display: 'block' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
