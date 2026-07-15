import type { CSSProperties } from 'react';
import type { Float } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';

interface FloatLayerProps {
  floats: Float[];
  theme: Theme;
}

/**
 * Free-floating memo cards — port of `Component#renderFloats`
 * (MindFlow.dc.html:1441-1510), minus selection/drag/resize/edit/delete
 * (Editor-b). The fold icon reflects `collapsed` but isn't clickable yet.
 */
export function FloatLayer({ floats, theme: th }: FloatLayerProps) {
  if (!floats.length) return null;
  return (
    <>
      {floats.map((f) => {
        const collapsed = !!f.collapsed;
        const fFpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
        const boxStyle: CSSProperties = {
          position: 'absolute',
          left: f.x,
          top: f.y,
          width: f.w,
          minHeight: f.h || 44,
          background: f.bg ? f.bg : th.appBg === '#191512' ? '#3a2f22' : '#fff6cf',
          color: f.textColor || th.text,
          border: `1px solid ${f.bg ? hexA('#000000', 0.14) : th.appBg === '#191512' ? '#5a4a2f' : '#f0e3a0'}`,
          borderRadius: 8,
          padding: '9px 11px 9px 32px',
          fontFamily: 'Pretendard, sans-serif',
          fontSize: fFpx,
          fontWeight: f.bold ? 700 : 400,
          lineHeight: 1.55,
          boxShadow: '0 3px 10px rgba(0,0,0,.10)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxSizing: 'border-box',
          zIndex: 10,
          userSelect: 'none',
        };
        if (collapsed) {
          boxStyle.minHeight = 38;
          boxStyle.whiteSpace = 'nowrap';
        }
        const shown = collapsed ? String(f.text || '').split('\n')[0] : f.text;
        return (
          <div key={f.id} style={boxStyle}>
            <div
              title={collapsed ? '펼치기' : '접기'}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 6,
                top: 6,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: th.accent,
                color: th.accentInk,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                userSelect: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                zIndex: 4,
              }}
            >
              {collapsed ? '＋' : '−'}
            </div>
            <div
              style={{
                pointerEvents: 'none',
                minHeight: 18,
                color: f.text ? 'inherit' : hexA(th.text, 0.4),
                overflow: collapsed ? 'hidden' : undefined,
                textOverflow: collapsed ? 'ellipsis' : undefined,
                whiteSpace: collapsed ? 'nowrap' : undefined,
              }}
            >
              {shown || '메모 입력…'}
            </div>
          </div>
        );
      })}
    </>
  );
}
