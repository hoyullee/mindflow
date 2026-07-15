import type { NodeMap } from '@mindflow/mindmap-core';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { colorOf, descendants } from '../tree';
import type { Theme } from '../theme';

interface OutlineRow {
  id: string;
  depth: number;
}

function outlineRows(nodes: NodeMap): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (id: string, depth: number): void => {
    const n = nodes[id];
    if (!n) return;
    rows.push({ id, depth });
    if (!n.collapsed) n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT_ID, 0);
  for (const id in nodes) {
    const n = nodes[id];
    if (n?.free && !n.parent) walk(id, 1);
  }
  return rows;
}

interface OutlineViewProps {
  nodes: NodeMap;
  theme: Theme;
}

/**
 * Read-only indented tree — port of `Component#renderOutline`
 * (MindFlow.dc.html:1982-2046), minus selection/edit/indent-outdent
 * (Editor-b). The expand/collapse chevron is drawn but not clickable yet.
 */
export function OutlineView({ nodes, theme: th }: OutlineViewProps) {
  const rows = outlineRows(nodes);
  const treeCount = rows.filter((r) => !nodes[r.id]?.free).length;
  let freeHeaderShown = false;

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '96px 36px 90px', fontFamily: 'Pretendard, sans-serif' }}>
      {rows.map(({ id, depth }) => {
        const n = nodes[id];
        if (!n) return null;
        const isRoot = id === ROOT_ID;
        const col = colorOf(id, nodes, th);
        const hasKids = n.children.length > 0;
        const showFreeHeader = !!n.free && !freeHeaderShown;
        if (showFreeHeader) freeHeaderShown = true;
        const showDivider = isRoot && treeCount > 0;

        return (
          <div key={id}>
            {showFreeHeader && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: th.subtext, margin: '26px 0 8px', paddingLeft: 4 }}>
                개별 주제
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: isRoot ? 44 : 36,
                margin: isRoot ? '0 0 10px' : '1px 0',
                padding: '4px 10px',
                paddingLeft: 10 + depth * 26,
                borderRadius: 9,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: th.subtext,
                  fontSize: 10,
                  userSelect: 'none',
                  visibility: hasKids ? 'visible' : 'hidden',
                }}
              >
                {n.collapsed ? '▸' : '▾'}
              </div>
              <div style={{ width: isRoot ? 12 : 9, height: isRoot ? 12 : 9, borderRadius: '50%', background: isRoot ? th.accent : col, flexShrink: 0, marginRight: 10 }} />
              {n.emoji && <span style={{ marginRight: 6, fontSize: isRoot ? 17 : 14 }}>{n.emoji}</span>}
              <div
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: n.textColor || th.text,
                  fontSize: isRoot ? 19 : depth === 1 ? 15 : 14,
                  fontWeight: n.bold ? 800 : isRoot ? 800 : depth === 1 ? 600 : 500,
                }}
              >
                {(n.text || '').replace(/\n/g, ' ') || ' '}
              </div>
              {n.note && n.note.trim() && (
                <span title={n.note} style={{ flexShrink: 0, marginLeft: 8, display: 'flex', color: th.accent }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </span>
              )}
              {hasKids && n.collapsed && (
                <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 11, color: th.subtext, background: th.panel2, border: `1px solid ${th.border}`, borderRadius: 999, padding: '1px 7px' }}>
                  {descendants(nodes, id).length}
                </span>
              )}
            </div>
            {showDivider && <div style={{ height: 1, background: th.border, margin: '0 0 12px' }} />}
          </div>
        );
      })}
      <div style={{ marginTop: 26, fontSize: 12, color: th.subtext, lineHeight: 1.7, paddingLeft: 4 }}>
        읽기 전용 미리보기 — 편집은 다음 단계에서 지원됩니다.
      </div>
    </div>
  );
}
