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
import type { Backend, NoteHistoryStore } from './ports';
import { createBackend } from './factory';
import { LocalNoteHistoryStore } from './local/localNoteHistoryStore';

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

export function useSpaceStore() {
  return useBackend().spaceStore;
}

export function useShareStore() {
  return useBackend().shareStore;
}

export function useFeedbackStore() {
  return useBackend().feedbackStore;
}

export function useTagStore() {
  return useBackend().tagStore;
}

export function useImageStore() {
  return useBackend().imageStore;
}

export function useCommentStore() {
  return useBackend().commentStore;
}

export function useNotificationStore() {
  return useBackend().notificationStore;
}

export function useEventStore() {
  return useBackend().eventStore;
}

// 공책 기록(0048)은 `Backend`의 **선택 필드**다 — 테스트가 손으로 짓는 Backend 리터럴과
// 옛 조립처럼 비어 있으면 이 기기의 로컬 판으로 물러난다(기록 패널이 죽지 않게).
// 매 렌더마다 새로 짓지 않도록 모듈 하나를 공유한다.
let fallbackNoteHistory: NoteHistoryStore | null = null;

export function useNoteHistoryStore(): NoteHistoryStore {
  const backend = useBackend();
  return backend.noteHistory ?? (fallbackNoteHistory ??= new LocalNoteHistoryStore());
}
