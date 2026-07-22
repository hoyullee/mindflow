import { BrandMark } from '../../components/BrandMark';

/** Left gradient brand panel — static content, no dynamic bindings in the original. */
export function BrandPanel() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 48,
        background: 'linear-gradient(160deg,#f0663f,#e0491f)',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, zIndex: 2 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: 'rgba(255,255,255,.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 20,
          }}
        >
          <BrandMark size={22} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.01em' }}>Geurio</div>
      </div>

      <div style={{ zIndex: 2 }}>
        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.3, letterSpacing: '-.02em', marginBottom: 16 }}>
          흩어진 생각 조각을,
          <br />
          하나의 그림으로.
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.7, opacity: 0.9, maxWidth: 380 }}>
          떠오르는 아이디어를 자유롭게 그리고 이어, 복잡한 생각을 한눈에 정리하세요.
        </div>
      </div>

      <div style={{ zIndex: 2, fontSize: 12.5, opacity: 0.75 }}>© 2026 Geurio</div>

      {/* decorative mini nodes */}
      <div style={{ position: 'absolute', right: -40, top: 90, width: 320, height: 320, opacity: 0.16, zIndex: 1 }}>
        <div style={{ position: 'absolute', left: 120, top: 140, width: 70, height: 34, borderRadius: 10, background: '#fff' }} />
        <div style={{ position: 'absolute', left: 20, top: 60, width: 56, height: 28, borderRadius: 9, border: '2px solid #fff' }} />
        <div style={{ position: 'absolute', left: 30, top: 220, width: 56, height: 28, borderRadius: 9, border: '2px solid #fff' }} />
        <div style={{ position: 'absolute', left: 230, top: 70, width: 56, height: 28, borderRadius: 9, border: '2px solid #fff' }} />
        <div style={{ position: 'absolute', left: 230, top: 220, width: 56, height: 28, borderRadius: 9, border: '2px solid #fff' }} />
      </div>
    </div>
  );
}
