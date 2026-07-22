/**
 * The Geurio brand glyph — a monoline spiral converging on a dot ("생각이
 * 중심으로 모인다", with an abstract nod to the G of Geurio/그리오). Glyph
 * only, no background: call sites keep their own coral/translucent boxes.
 *
 * Geometry is shared VERBATIM with `apps/web/scripts/generate-icons.mjs`
 * (source of truth for the PWA/favicon/native icon pipeline) — if the path
 * changes here, regenerate the icons from an updated script and vice versa.
 */
export function BrandMark({ size = 16, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path
        d="M 50 22 A 28 28 0 1 0 78 50 A 20 20 0 0 0 58 32 A 13 13 0 0 0 45 45"
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="47" cy="52" r="6.5" fill={color} />
    </svg>
  );
}
