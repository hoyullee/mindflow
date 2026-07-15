import type { EditorController } from '../useEditorState';
import { NodePanel } from './panel/NodePanel';
import { LinePanel } from './panel/LinePanel';
import { FloatPanel } from './panel/FloatPanel';
import { ZonePanel } from './panel/ZonePanel';

interface PropertyPanelProps {
  controller: EditorController;
}

/**
 * Left-side property panel — dispatches on `controller.selection.kind` to the
 * node/line/float/zone variant, matching the original's four mutually
 * exclusive `sc-if` panel blocks (MindFlow.dc.html:136-401: `hasSelection` /
 * `zoneSelected` / `lineSelected` / `floatPanelSel`).
 */
export function PropertyPanel({ controller }: PropertyPanelProps) {
  const sel = controller.selection;
  if (!sel) return null;
  if (sel.kind === 'node') return <NodePanel controller={controller} nodeId={sel.id} />;
  if (sel.kind === 'line') return <LinePanel controller={controller} lineId={sel.id} />;
  if (sel.kind === 'float') return <FloatPanel controller={controller} floatId={sel.id} />;
  return <ZonePanel controller={controller} zoneId={sel.id} />;
}
