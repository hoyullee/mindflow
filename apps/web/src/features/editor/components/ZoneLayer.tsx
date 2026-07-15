import type { Zone } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';

interface ZoneLayerProps {
  zones: Zone[];
  theme: Theme;
}

/**
 * Background grouping rectangles — port of `Component#renderZones`
 * (MindFlow.dc.html:2323-2367), minus selection/drag/resize/edit/delete
 * (Editor-b).
 */
export function ZoneLayer({ zones, theme: th }: ZoneLayerProps) {
  if (!zones.length) return null;
  return (
    <>
      {zones.map((z) => {
        const col = z.color || th.accent;
        return (
          <div
            key={z.id}
            style={{
              position: 'absolute',
              left: z.x,
              top: z.y,
              width: z.w,
              height: z.h,
              background: hexA(col, 0.07),
              border: `2px dashed ${hexA(col, 0.55)}`,
              borderRadius: 16,
              boxSizing: 'border-box',
              zIndex: 8,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 10,
                top: -14,
                height: 27,
                display: 'flex',
                alignItems: 'center',
                padding: '0 13px',
                borderRadius: 999,
                background: col,
                color: z.color ? '#fff' : th.accentInk,
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: 'Pretendard, sans-serif',
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                maxWidth: 'calc(100% - 20px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                zIndex: 3,
              }}
            >
              {z.label || '영역'}
            </div>
          </div>
        );
      })}
    </>
  );
}
