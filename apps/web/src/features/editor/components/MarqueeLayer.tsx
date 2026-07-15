import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { MarqueeRect } from '../types';

interface MarqueeLayerProps {
  rect: MarqueeRect | null;
  theme: Theme;
}

/**
 * The in-progress rubber-band selection rectangle — port of `Component#renderCanvas`'s
 * `this._marquee` overlay (MindFlow.dc.html:1297-1301). Rendered in canvas
 * (untransformed) coordinates, inside the same pan/zoom transform group as the
 * nodes/floats/lines it's selecting.
 */
export function MarqueeLayer({ rect, theme }: MarqueeLayerProps) {
  if (!rect) return null;
  const x = Math.min(rect.x0, rect.x1);
  const y = Math.min(rect.y0, rect.y1);
  const w = Math.abs(rect.x1 - rect.x0);
  const h = Math.abs(rect.y1 - rect.y0);
  return (
    <div
      aria-hidden="true"
      data-testid="marquee"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        border: `1.5px solid ${theme.accent}`,
        background: hexA(theme.accent, 0.08),
        borderRadius: 3,
        pointerEvents: 'none',
        zIndex: 30,
        boxSizing: 'border-box',
      }}
    />
  );
}
