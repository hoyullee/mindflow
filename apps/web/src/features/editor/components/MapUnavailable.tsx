import { Link } from 'react-router-dom';
import { BrandMark } from '../../../components/BrandMark';

/**
 * 열 수 없는 맵 — **에디터 대신** 통째로 이 화면을 보여준다.
 *
 * 예전엔 캔버스 위에 안내만 띄웠다. 편집·저장은 막혀 있었지만 툴바·메뉴·내보내기가
 * 그대로 노출돼서, 초대받지 않은 계정이 URL을 열면 "권한은 없는데 화면은 다 보이는"
 * 상태가 됐다(제보). 볼 수 없는 문서에 대해 도구를 보여줄 이유가 없으므로 크롬 없는
 * 독립 화면으로 대체한다.
 *
 * 문구가 한 화면에 두 가지 원인을 함께 담는 이유: 클라이언트는 둘을 **구분할 수
 * 없다.** 권한이 없는 문서는 RLS가 행을 걸러내므로 "행이 없다"로 오고, 본문이 다른
 * 기기에만 있는 내 문서도 똑같이 "행이 없다"로 온다. 존재 여부를 알려 주지 않는 건
 * 보안상 옳기도 하다(공유받지 않은 사람에게 "그 문서는 있다"를 알리지 않는다).
 */
export function MapUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        padding: '32px 20px',
        background: '#fdf9f6',
        color: '#3d2f25',
        fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 30 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: '#e2603c' }}>
          <BrandMark size={19} />
        </span>
        <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em' }}>Geurio</span>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          border: '1px solid #ecdfd5',
          borderRadius: 18,
          boxShadow: '0 10px 34px rgba(90,60,40,.07)',
          padding: '30px 24px 26px',
        }}
      >
        <span
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 14, background: '#fdeee7', color: '#c2603f', marginBottom: 16 }}
        >
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="10.5" rx="2.4" />
            <path d="M8 10.5V7.2A4 4 0 0 1 15.5 5.4" />
            <line x1="12" y1="14.6" x2="12" y2="17" />
          </svg>
        </span>
        <h1 style={{ margin: 0, fontSize: 17.5, fontWeight: 800, letterSpacing: '-.01em' }}>이 맵을 열 수 없어요</h1>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.65, color: '#7c6d60' }}>
          링크가 잘못되었거나, 나에게 공유되지 않은 문서이거나, 아직 이 기기에 내려오지 않은 내 문서일 수 있어요.
        </p>

        <ul style={{ margin: '18px 0 0', padding: 0, listStyle: 'none', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {[
            '공유받은 문서라면 문서 소유자에게 초대를 다시 요청해 주세요.',
            '내 문서라면 그 맵을 만든 기기에서 Geurio를 한 번 열면 이 기기로 동기화됩니다.',
          ].map((t) => (
            <li key={t} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.6, color: '#8a7a6d' }}>
              <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 6, width: 4, height: 4, borderRadius: '50%', background: '#d9c6b8' }} />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <Link
            to="/home"
            style={{
              flex: '1 1 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              borderRadius: 11,
              background: '#e2603c',
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            내 맵으로 가기
          </Link>
          <button
            type="button"
            onClick={onRetry}
            style={{
              flex: '0 0 auto',
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 11,
              border: '1px solid #ecdfd5',
              background: '#fff',
              color: '#7c6d60',
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            다시 확인
          </button>
        </div>
      </div>
    </div>
  );
}
