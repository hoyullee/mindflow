import type { EditorController } from '../useEditorState';
import { NodePanel } from './panel/NodePanel';
import { LinePanel } from './panel/LinePanel';
import { FloatPanel } from './panel/FloatPanel';
import { ZonePanel } from './panel/ZonePanel';

interface PropertyPanelProps {
  controller: EditorController;
}

/**
 * Left-side property panel — dispatches to the node/line/float/zone variant.
 * Port of the original's mutually-exclusive `sc-if` panel blocks
 * (MindFlow.dc.html:136-401: `hasSelection` / `zoneSelected` / `lineSelected` /
 * `floatPanelSel`), generalized from a single `selection` to
 * `controller.multiGroups` so a marquee multi-selection renders the SAME
 * panel (with a "다중 선택" header + bulk setters) instead of nothing — but
 * only when the marquee caught just one kind of thing (nodes-only /
 * lines-only / floats-only), exactly like the original's own
 * `nodesOnly`/`linesOnly`/`floatsOnly` derivation (MindFlow.dc.html:2964-2965,
 * 2984): a mixed marquee selection shows no property panel.
 */
export function PropertyPanel({ controller }: PropertyPanelProps) {
  const sel = controller.selection;
  if (sel?.kind === 'zone') return <ZonePanel controller={controller} zoneId={sel.id} />;

  const m = controller.multiGroups;
  const nodesOnly = m.nodes.length > 0 && !m.lines.length && !m.floats.length;
  const linesOnly = m.lines.length > 0 && !m.nodes.length && !m.floats.length;
  const floatsOnly = m.floats.length > 0 && !m.nodes.length && !m.lines.length;

  if (nodesOnly) return <NodePanel controller={controller} nodeIds={m.nodes} />;
  if (linesOnly) return <LinePanel controller={controller} lineIds={m.lines} />;
  if (floatsOnly) return <FloatPanel controller={controller} floatIds={m.floats} />;
  return null;
}
