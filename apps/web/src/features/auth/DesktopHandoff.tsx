import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBackend } from '../../adapters/BackendContext';
import { AUTH } from './tokens';
import { BrandMark } from '../../components/BrandMark';
import { buildAuthDeepLink } from './desktopGoogle';
import './login.css';

/**
 * `/auth/desktop` — 설치형 데스크톱 앱의 Google 로그인이 **브라우저에서** 끝나는
 * 자리(공개 라우트).
 *
 * 여기 오는 사람은 앱에서 버튼을 누른 그 사용자이고, Supabase가 방금 이 창에
 * 세션을 세워 뒀다(`detectSessionInUrl`). 이 페이지가 하는 일은 셋뿐이다:
 *   1. 세션의 갱신 토큰을 `geurio://auth?refresh_token=…`로 앱에 넘긴다.
 *   2. **이 창의 사본은 지운다** — 같은 세션이 브라우저와 앱 두 곳에 남지 않게.
 *      (앱이 그 토큰을 쓰는 순간 Supabase가 토큰을 회전시키므로, 주소에 실려
 *      지나간 값도 그 자리에서 무효가 된다.)
 *   3. 사용자에게 앱으로 돌아가라고 말한다.
 *
 * 브라우저에서 이 주소를 직접 열면(앱 없이) 넘길 세션이 없으므로 로그인 화면으로
 * 안내한다 — 앱을 열지 않은 사람에게 딥링크를 쏘지 않는다.
 */
export function DesktopHandoff() {
  const { auth } = useBackend();
  const [status, setStatus] = useState<'waiting' | 'done' | 'empty'>('waiting');
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let handed = false;
    const cleanups: Array<() => void> = [];

    const hand = async () => {
      if (handed) return;
      const token = await auth.sessionRefreshToken();
      if (!alive || handed || !token) return;
      handed = true;
      const deepLink = buildAuthDeepLink(token);
      setLink(deepLink);
      // 사본을 먼저 지운다 — 넘기는 중에 무슨 일이 있어도 세션이 두 곳에 남지
      // 않는다. `'local'`은 이 브라우저의 저장소만 비우는 것이라 앱이 이어받을
      // 그 토큰은 그대로 유효하다.
      try {
        await auth.signOut('local');
      } catch {
        // 지우지 못했더라도 핸드오프는 계속한다 — 그게 사용자가 기다리는 일이다.
      }
      if (!alive) return;
      setStatus('done');
      // OS가 앱을 깨운다. 이 창은 그대로 남으므로(커스텀 스킴 이동은 페이지를
      // 떠나지 않는다) 아래 안내가 계속 보인다.
      window.location.href = deepLink;
    };

    void (async () => {
      const session = await auth.getSession();
      if (!alive) return;
      if (session) {
        void hand();
        return;
      }
      // 아직 세션이 서지 않았을 수 있다(주소의 토큰을 Supabase가 읽는 중) —
      // 인증 변화를 기다린다. 그래도 오지 않으면 안내로 바꾼다.
      const timer = setTimeout(() => {
        if (alive && !handed) setStatus('empty');
      }, 6000);
      const off = auth.onAuthChange((next) => {
        if (next) {
          clearTimeout(timer);
          void hand();
        }
      });
      cleanups.push(() => {
        clearTimeout(timer);
        off();
      });
    })();

    return () => {
      alive = false;
      cleanups.forEach((fn) => fn());
    };
  }, [auth]);

  return (
    <div className="lg-root" data-desktop-handoff>
      <div className="lg-dots" aria-hidden="true" />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
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
            <BrandMark size={30} />
          </div>
          {status === 'empty' ? (
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
                {status === 'done' ? 'Geurio 앱으로 돌아가세요' : '로그인을 확인하고 있어요'}
              </h1>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: AUTH.ink2, margin: '0 0 18px' }}>
                {status === 'done' ? (
                  <>
                    앱에서 로그인이 이어졌어요.
                    <br />
                    이 창은 닫아도 됩니다.
                  </>
                ) : (
                  '잠시만 기다려 주세요.'
                )}
              </p>
              {/* 자동 이동이 막혔을 때의 손잡이 — 사용자가 직접 앱을 깨울 수 있다. */}
              {link && (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
