import { useState, type CSSProperties, type ReactNode } from 'react';
import { hexA } from '../../theme';
import type { Theme } from '../../theme';

/**
 * A property group shown as a tile on the mobile sheet's root screen.
 * `detail` groups drill into a sub-screen showing only their controls;
 * `action` groups fire immediately (e.g. 이름 편집) and dismiss the sheet.
 */
export type MobileGroup =
  | { key: string; label: string; icon: ReactNode; kind?: 'detail'; content: ReactNode }
  | { key: string; label: string; icon: ReactNode; kind: 'action'; onSelect: () => void; danger?: boolean };

/**
 * Mobile property panel as a two-level DRILL-DOWN bottom sheet (replaces the old
 * accordion-in-a-scrolling-sheet). The root screen is a grid of large,
 * touch-friendly tiles — one per function group; tapping a tile swaps the sheet
 * body to show ONLY that group's controls (with a ‹ 뒤로 header), so a single
 * screen never stacks every section and the sheet never needs to scroll through
 * a long list. The sheet height is content-driven (capped), so short groups get
 * a short sheet. Desktop keeps the floating accordion side panel unchanged; this
 * is mobile-only (`isMobile` branch in each *Panel).
 */
export function MobilePanelSheet({ theme: th, kicker, name, groups, onClose }: { theme: Theme; kicker: string; name: string; groups: MobileGroup[]; onClose: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const active = groups.find((g) => g.key === openKey);
  // Only `detail` groups drill in; `action` groups fire and never become the open view.
  const detailGroup = active && active.kind !== 'action' ? active : null;
  const inDetail = !!detailGroup;

  const wrap: CSSProperties = {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: 'auto',
    maxHeight: '85dvh',
    border: `1px solid ${th.border}`,
    borderBottom: 'none',
    borderRadius: '18px 18px 0 0',
    boxShadow: '0 -8px 30px rgba(0,0,0,.16)',
    zIndex: 25,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: th.panel,
  };

  const headerBtn: CSSProperties = {
    minWidth: 60,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    padding: '0 10px',
    border: 'none',
    borderRadius: 9,
    background: 'transparent',
    color: th.subtext,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div style={wrap}>
      {/* grab handle */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: th.border }} />
      </div>

      {/* header: back (detail) / title / close */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 8px', borderBottom: `1px solid ${th.border}` }}>
        {inDetail ? (
          <button type="button" className="mf-ed-btn" style={headerBtn} onClick={() => setOpenKey(null)}>
            <span style={{ fontSize: 17, lineHeight: 1 }}>‹</span> 뒤로
          </button>
        ) : (
          <div style={{ width: 60 }} />
        )}
        <div style={{ flex: '1 1 auto', textAlign: 'center', minWidth: 0, padding: '0 4px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: th.subtext }}>{kicker}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailGroup ? detailGroup.label : name}</div>
        </div>
        <button type="button" className="mf-ed-btn" aria-label="속성 닫기" style={{ ...headerBtn, minWidth: 44, fontSize: 18 }} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* body */}
      <div style={{ overflowY: 'auto', minHeight: 0, padding: '14px 14px calc(16px + env(safe-area-inset-bottom, 0px))' }}>
        {detailGroup ? (
          detailGroup.content
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 }}>
            {groups.map((g) => {
              const danger = g.kind === 'action' && g.danger;
              return (
                <button
                  key={g.key}
                  type="button"
                  className="mf-ed-btn"
                  onClick={() => {
                    if (g.kind === 'action') {
                      g.onSelect();
                    } else {
                      setOpenKey(g.key);
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    minHeight: 76,
                    padding: '12px 8px',
                    border: `1px solid ${th.border}`,
                    borderRadius: 14,
                    background: th.panel2,
                    color: danger ? '#d64545' : th.text,
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: danger ? hexA('#d64545', 0.12) : hexA(th.accent, 0.12), color: danger ? '#d64545' : th.accent }}>
                    {g.icon}
                  </span>
                  {g.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
