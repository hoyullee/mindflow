// React wiring for the backend ports. `BackendContext` is created with a
// real default value (`createBackend()` computed once at module load) rather
// than `null`/undefined, so `useAuth()`/`useDocStore()` work even in tests
// that render a feature component (`<Login />`, `<Home />`, `<Editor />`)
// directly without wrapping it in `<BackendProvider>` — they transparently
// get the Local adapter, matching this app's pre-M4 demo behavior exactly.
//
// `App.tsx` wraps the whole tree in `<BackendProvider>` explicitly anyway
// (clearer intent, and the one place a test COULD override the backend via
// the `backend` prop if a future test needs a mock Supabase-mode backend).

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Backend } from './ports';
import { createBackend } from './factory';

const defaultBackend = createBackend();

const BackendContext = createContext<Backend>(defaultBackend);

export function BackendProvider({ backend, children }: { backend?: Backend; children: ReactNode }) {
  const value = useMemo(() => backend ?? defaultBackend, [backend]);
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  return useContext(BackendContext);
}

export function useAuth() {
  return useBackend().auth;
}

export function useDocStore() {
  return useBackend().docStore;
}
