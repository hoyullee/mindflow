import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { hadSession, loginUrlWithNext, noteSessionExpired, rememberSignedIn } from './features/auth/sessionNotice';
import { Home } from './features/home/Home';
import { Editor } from './features/editor/Editor';
import { PrivacyPolicy } from './features/legal/PrivacyPolicy';
import { Terms } from './features/legal/Terms';
import { Landing } from './features/landing/Landing';
import { BackendProvider, useBackend } from './adapters/BackendContext';
import { UpdatePrompt } from './pwa/UpdatePrompt';

// M3: Login.dc.html, Home.dc.html, and MindFlow.dc.html are ported to React.
// M4: `/home` and `/editor` are gated behind `RequireAuth` — but ONLY when a
// real backend (Supabase) is configured. In local/demo mode (no env vars,
// the default for a plain checkout/CI) the guard is a no-op, so the app
// behaves exactly as before M4.
function RequireAuth({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const location = useLocation();
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>(backend.mode === 'local' ? 'authed' : 'checking');

  useEffect(() => {
    if (backend.mode === 'local') return;
    let cancelled = false;
    const apply = (session: unknown): void => {
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
  return <>{children}</>;
}

export function App() {
  return (
    <BackendProvider>
      {/* 새 배포 적용을 담당. 라우터 밖에 두어도 되는 이유: 화면별 정책을 경로로
          판단하지 않고 각 화면이 `useUpdateGuard`로 자기 위험도를 신고한다
          (같은 화면도 상태에 따라 다르다 — 빈 로그인 폼 vs 인증 코드 입력 중).
          안전한 화면은 조용히 갈아끼우고, 위험할 때만 토스트가 뜬다. */}
      <UpdatePrompt />
      <BrowserRouter>
        <Routes>
          {/* Public landing — Google brand verification requires the homepage
              to describe the app and show its name (a bare redirect to /login
              was rejected for exactly that). */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          {/* Public legal docs — must stay OUTSIDE RequireAuth (Google's brand
              verification reviewers and pre-signup users open them logged out). */}
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
