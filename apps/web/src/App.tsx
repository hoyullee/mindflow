import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { DesktopHandoff } from './features/auth/DesktopHandoff';
import { hadSession, loginUrlWithNext, noteSessionExpired, rememberSignedIn } from './features/auth/sessionNotice';
import type { AuthSession } from './adapters/ports';
import { Home } from './features/home/Home';
import { Editor } from './features/editor/Editor';
import { PrivacyPolicy } from './features/legal/PrivacyPolicy';
import { Terms } from './features/legal/Terms';
import { Landing } from './features/landing/Landing';
import { BackendProvider, useBackend } from './adapters/BackendContext';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { DesktopTitleBar } from './platform/DesktopTitleBar';
import { isDesktopShell } from './platform/desktopBridge';
import { ReminderHost } from './features/reminders/ReminderHost';

// M3: Login.dc.html, Home.dc.html, and MindFlow.dc.html are ported to React.
// M4: `/home` and `/editor` are gated behind `RequireAuth` — but ONLY when a
// real backend (Supabase) is configured. In local/demo mode (no env vars,
// the default for a plain checkout/CI) the guard is a no-op, so the app
// behaves exactly as before M4.
/** 인증 문지기 — 테스트에서 직접 렌더할 수 있게 export한다(supabase 모드에서만
 * 도는 경로가 있고, `App`은 자기 `BackendProvider`를 들고 있어 주입이 안 된다). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const location = useLocation();
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>(backend.mode === 'local' ? 'authed' : 'checking');

  useEffect(() => {
    if (backend.mode === 'local') return;
    let cancelled = false;
    const apply = (session: AuthSession | null): void => {
      if (cancelled) return;
      if (session) {
        // 이 기기에서 로그인한 적이 있다고 기억한다 — 나중에 세션이 사라졌을 때
        // "처음부터 로그아웃"과 "만료"를 가르는 근거다(sessionNotice).
        rememberSignedIn();
        setStatus('authed');
      } else {
        // 세션이 없다: 이 기기에서 로그인한 적이 있으면 **만료**로 보고 안내를
        // 남긴다(직접 로그아웃한 경우엔 그 마커가 이미 지워져 있다).
        if (hadSession()) noteSessionExpired();
        setStatus('anon');
      }
    };
    backend.auth.getSession().then(apply);
    const unsubscribe = backend.auth.onAuthChange(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [backend]);

  if (status === 'checking') return null; // brief flash-free wait for the session check
  // 돌아갈 자리를 `next`로 들고 간다 — 편집 중이던 맵 주소를 사용자가 다시 찾지 않게.
  if (status === 'anon') return <Navigate to={loginUrlWithNext(location.pathname, location.search)} replace />;
  // 일정 알림은 **로그인한 화면이면 어디서든** 와야 한다(마인드맵을 편집하는 중에도
  // 10:20이 되면 뜬다) — 그래서 화면마다 붙이지 않고 문지기 안에 한 번 둔다. 랜딩·
  // 로그인·약관은 문지기 밖이라 일정을 조회하지도 않는다.
  return (
    <>
      <ReminderHost />
      {children}
    </>
  );
}

export function App() {
  return (
    <BackendProvider>
      {/* 새 배포 적용을 담당. 라우터 밖에 두어도 되는 이유: 화면별 정책을 경로로
          판단하지 않고 각 화면이 `useUpdateGuard`로 자기 위험도를 신고한다
          (같은 화면도 상태에 따라 다르다 — 빈 로그인 폼 vs 인증 코드 입력 중).
          안전한 화면은 조용히 갈아끼우고, 위험할 때만 토스트가 뜬다. */}
      <UpdatePrompt />
      {/* 설치형 앱의 타이틀 바 — 셸이 프레임을 숨긴 플랫폼에서만 그려진다(그 밖에서는
          `null`). 라우터 밖에 두는 이유는 어느 화면에서도 같은 바여야 하기 때문이고,
          자리는 CSS 변수(`--mf-titlebar`)가 화면 루트들에게 알린다. */}
      <DesktopTitleBar />
      <BrowserRouter>
        <Routes>
          {/* Public landing — Google brand verification requires the homepage
              to describe the app and show its name (a bare redirect to /login
              was rejected for exactly that).

              설치형 데스크톱 앱에서는 **랜딩을 열지 않는다**: 그 화면은 "이 앱이
              무엇인가"를 설명해 설치를 권하는 마케팅 페이지이고, 앱을 이미 설치한
              사람에게는 갈 곳이 아니다. 게다가 프로덕션의 `/`는 SPA가 아니라 정적
              쌍둥이(`public/landing.html`)라, 앱 창이 그리로 가면 React 앱과 함께
              데스크톱 타이틀 바 배치(`--mf-titlebar`)까지 통째로 사라진다(제보:
              "화면이 틀어진다"). 셸도 같은 판단을 한 겹 더 한다(`shell.ts`의
              `isLandingPath`) — 이쪽은 앱 안에서의 이동(react-router)을 막는다. */}
          <Route path="/" element={isDesktopShell() ? <Navigate to="/home" replace /> : <Landing />} />
          <Route path="/login" element={<Login />} />
          {/* Public legal docs — must stay OUTSIDE RequireAuth (Google's brand
              verification reviewers and pre-signup users open them logged out). */}
          {/* 설치형 데스크톱 앱의 Google 로그인이 **브라우저에서** 끝나는 자리 —
              문지기 밖이어야 한다(앱이 아직 로그인 전이고, 이 창은 세션을 앱에
              넘기고 스스로 지운다). features/auth/desktopGoogle.ts 참고. */}
          <Route path="/auth/desktop" element={<DesktopHandoff />} />
          {/* 설치형 앱의 Google 캘린더 연동이 브라우저에서 끝나는 자리 —
              구글 콘솔의 **승인된 리디렉션 URI**가 이 주소다(backend.md §19). */}
          <Route path="/auth/gcal" element={<DesktopHandoff kind="gcal" />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route
            path="/home"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/editor"
            element={
              <RequireAuth>
                <Editor />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </BackendProvider>
  );
}
