import type { EditorController } from '../useEditorState';
import { NodePanel } from './panel/NodePanel';
import { LinePanel } from './panel/LinePanel';
import { FloatPanel } from './panel/FloatPanel';
import { ZonePanel } from './panel/ZonePanel';
import { StrokePanel } from './panel/StrokePanel';
import { useIsMobile, useIsShortScreen } from '../../../hooks/useMediaQuery';

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
  const isMobile = useIsMobile();
  // 가로로 돌린 폰(낮은 화면)에서는 바텀시트 대신 오른쪽 사이드 시트로 — 55dvh를
  // 그대로 쓰면 캔버스가 거의 남지 않는다(`panelWrapStyle`).
  const short = useIsShortScreen();
  // On mobile the panel is a bottom sheet that used to pop open on every
  // selection (covering the canvas + panning the map). Now it only shows when
  // the user explicitly opens it via the mobile selection bar (`propsOpen`).
  if (isMobile && !controller.propsOpen) return null;
  const sel = controller.selection;
  if (sel?.kind === 'zone') return <ZonePanel controller={controller} zoneId={sel.id} isMobile={isMobile} short={short} />;
  // 그리기 획(화이트보드) — 마퀴에 담기지 않으므로 언제나 단일 선택이다.
  if (sel?.kind === 'stroke') return <StrokePanel controller={controller} strokeId={sel.id} isMobile={isMobile} short={short} />;

  const m = controller.multiGroups;
  const nodesOnly = m.nodes.length > 0 && !m.lines.length && !m.floats.length;
  const linesOnly = m.lines.length > 0 && !m.nodes.length && !m.floats.length;
  const floatsOnly = m.floats.length > 0 && !m.nodes.length && !m.lines.length;

  // The `key` remounts the panel when the selection set changes, resetting each
  // panel's accordion (PanelSection) back to all-collapsed — matching the dc
  // original's "reset panelSec on selection change" (MindFlow.dc.html:853-859).
  if (nodesOnly) return <NodePanel key={`nodes:${m.nodes.join(',')}`} controller={controller} nodeIds={m.nodes} isMobile={isMobile} short={short} />;
  if (linesOnly) return <LinePanel key={`lines:${m.lines.join(',')}`} controller={controller} lineIds={m.lines} isMobile={isMobile} short={short} />;
  if (floatsOnly) return <FloatPanel key={`floats:${m.floats.join(',')}`} controller={controller} floatIds={m.floats} isMobile={isMobile} short={short} />;
  return null;
}
