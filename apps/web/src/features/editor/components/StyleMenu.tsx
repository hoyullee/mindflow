import type { CSSProperties } from 'react';
import { LAYOUT_MODES, EDGE_MODES } from '../tree';
import { THEME_KEYS, THEMES } from '../theme';
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
    background: active ? controller.theme.panel : 'transparent',
    color: active ? controller.theme.accent : controller.theme.subtext,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,.10)' : 'none',
  });

  return (
    <div
      className="mf-ed-stylemenu"
      style={{
        // Positioning/stacking is handled by the `AnchoredMenu` portal wrapper.
        width: '100%',
        boxSizing: 'border-box',
        background: controller.theme.panel,
        border: `1px solid ${controller.theme.border}`,
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,.16)',
        padding: 14,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.theme.subtext, marginBottom: 8 }}>레이아웃</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: 3, background: controller.theme.panel2, border: `1px solid ${controller.theme.border}`, borderRadius: 10, marginBottom: 14 }}>
        {LAYOUT_MODES.map((m) => (
          <button key={m.k} type="button" className="mf-ed-btn" onClick={() => controller.setLayoutMode(m.k)} style={segStyle(controller.layoutMode === m.k)} aria-pressed={controller.layoutMode === m.k}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.theme.subtext, marginBottom: 8 }}>연결선</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: 3, background: controller.theme.panel2, border: `1px solid ${controller.theme.border}`, borderRadius: 10, marginBottom: 14 }}>
        {EDGE_MODES.map((m) => (
          <button key={m.k} type="button" className="mf-ed-btn" onClick={() => controller.setEdgeStyle(m.k)} style={segStyle(controller.edgeStyle === m.k)} aria-pressed={controller.edgeStyle === m.k}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: controller.theme.subtext, marginBottom: 8 }}>테마</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {THEME_KEYS.map((k) => {
          const t = THEMES[k];
          const active = controller.themeKey === k;
          return (
            <button
              key={k}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              onClick={() => controller.setThemeKey(k)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: t.accent,
                border: active ? `2px solid ${controller.theme.text}` : `2px solid ${controller.theme.panel}`,
                boxShadow: active ? `0 0 0 2px ${controller.theme.accent}` : '0 1px 3px rgba(0,0,0,.15)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
