import type { CSSProperties } from 'react';

interface RemotePeerTagProps {
  color: string;
  name: string;
  style?: CSSProperties;
}

/** A tiny peer-colored name pill — marks which remote peer currently has a
 * node/float/line/zone selected. Purely decorative (`pointerEvents: 'none'`)
 * so it never intercepts this tab's own drag/click handling. */
export function RemotePeerTag({ color, name, style }: RemotePeerTagProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        background: color,
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.6,
        padding: '0 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        zIndex: 60,
        fontFamily: 'Pretendard, sans-serif',
        ...style,
      }}
    >
      {name}
    </div>
  );
}
