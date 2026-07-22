import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { Home } from './features/home/Home';
import { Editor } from './features/editor/Editor';
import { PrivacyPolicy } from './features/legal/PrivacyPolicy';
import { Terms } from './features/legal/Terms';
import { BackendProvider, useBackend } from './adapters/BackendContext';

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
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
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
