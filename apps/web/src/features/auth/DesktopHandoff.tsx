import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AUTH } from './tokens';
import { BrandMark } from '../../components/BrandMark';
import { buildAuthDeepLink, desktopAuthToken } from './desktopGoogle';
import './login.css';

/**
 * `/auth/desktop` — 설치형 데스크톱 앱의 Google 로그인이 **브라우저에서** 끝나는
 * 자리(공개 라우트).
 *
 * 하는 일은 하나뿐이다: Supabase 콜백이 **해시**에 실어 준 갱신 토큰을
 * `geurio://auth?refresh_token=…`로 앱에 넘긴다(엔트리가 클라이언트보다 먼저
 * 낚아채 둔다 — main.tsx).
 *
 * **세션을 세우지 않는다.** 해시를 먼저 치웠으므로 `detectSessionInUrl`이 읽을 것이
 * 없다 — 그래서 이 페이지는 Supabase를 쓰지 않고, 넘길 사본도 지울 사본도 없다.
 * 이 사람이 웹에서 따로 로그인해 둔 세션도 **건드리지 않는다**(첫 판은 그것을
 * `signOut('local')`으로 끊었는데, 그게 앱이 이어받을 토큰까지 무효로 만들었다 —
 * desktopGoogle.ts의 "두 번 틀린 것").
 *
 * 넘길 것이 없으면(앱 없이 이 주소를 직접 열었다) 딥링크를 쏘지 않고 로그인 화면으로
 * 안내한다.
 */
export function DesktopHandoff() {
  // 값은 엔트리(main.tsx)가 클라이언트보다 먼저 낚아채 둔다 — 여기서는 읽기만.
  const token = useMemo(() => desktopAuthToken(), []);
  const link = token ? buildAuthDeepLink(token) : null;

  useEffect(() => {
    if (!link) return;
    // OS가 앱을 깨운다. 이 창은 그대로 남으므로(커스텀 스킴 이동은 페이지를
    // 떠나지 않는다) 아래 안내가 계속 보인다.
    window.location.href = link;
  }, [link]);

  return (
    <div className="lg-root" data-desktop-handoff>
      <div className="lg-dots" aria-hidden="true" />
      <div
        style={{
          position: 'relative',
          minHeight: 'var(--mf-app-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            width: 380,
            maxWidth: '100%',
            background: AUTH.field,
            border: `1px solid ${AUTH.border}`,
            borderRadius: 20,
            boxShadow: '0 18px 40px -30px rgba(46,42,38,.5)',
            padding: '30px 26px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              margin: '0 auto 16px',
              borderRadius: 12,
              background: AUTH.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BrandMark size={46} />
          </div>
          {!link ? (
            <>
              <h1 style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px', color: AUTH.ink }}>
                로그인 정보를 받지 못했어요
              </h1>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: AUTH.ink2, margin: '0 0 18px' }}>
                데스크톱 앱에서 <strong style={{ fontWeight: 700 }}>Google 계정으로 계속하기</strong>를 다시 눌러 주세요.
              </p>
              <Link
                to="/login"
                style={{ fontSize: 13, fontWeight: 700, color: AUTH.accentDeep, textDecoration: 'none' }}
              >
                브라우저에서 로그인하기
              </Link>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px', color: AUTH.ink }}>
                Geurio 앱으로 돌아가세요
              </h1>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: AUTH.ink2, margin: '0 0 18px' }}>
                앱에서 로그인이 이어졌어요.
                <br />
                이 창은 닫아도 됩니다.
              </p>
              {/* 자동 이동이 막혔을 때의 손잡이 — 사용자가 직접 앱을 깨울 수 있다. */}
              <a
                href={link}
                className="mf-ctl-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 40,
                  padding: '0 18px',
                  borderRadius: 12,
                  background: `linear-gradient(180deg, ${AUTH.accent}, ${AUTH.accentDeep})`,
                  color: '#fff',
                  fontSize: 13.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                앱으로 돌아가기
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
