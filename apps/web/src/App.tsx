import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './features/auth/Login';
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
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>(backend.mode === 'local' ? 'authed' : 'checking');

  useEffect(() => {
    if (backend.mode === 'local') return;
    let cancelled = false;
    backend.auth.getSession().then((session) => {
      if (!cancelled) setStatus(session ? 'authed' : 'anon');
    });
    const unsubscribe = backend.auth.onAuthChange((session) => {
      if (!cancelled) setStatus(session ? 'authed' : 'anon');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [backend]);

  if (status === 'checking') return null; // brief flash-free wait for the session check
  if (status === 'anon') return <Navigate to="/login" replace />;
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
