// Demo auth adapter — the `AuthProvider` port wrapped around exactly the
// behavior Login.dc.html's ported controller (`useLoginController`) already
// had: no network, an in-memory "session" that resolves instantly. Used
// whenever Supabase env vars aren't configured (`adapters/factory.ts`), so the
// app never breaks in a plain checkout / CI / local dev without secrets.
//
// Persists the (fake) session to localStorage under a namespaced key so a
// page reload doesn't silently log the demo user out — but note nothing in
// the app currently *enforces* auth when running in local mode (see
// `App.tsx`'s `RequireAuth`), so this is a convenience, not a gate.

import type { AuthChangeListener, AuthProvider, AuthResult, AuthSession } from '../ports';

const SESSION_KEY = 'mf_demo_session';

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed || !parsed.user || typeof parsed.user.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable (private mode, quota, ...) — non-fatal, matches the
     * rest of the app's storage try/catch convention */
  }
}

function demoUserId(email: string): string {
  let h = 0;
  const s = String(email || 'demo');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'local-' + h.toString(36);
}

function makeSession(email: string): AuthSession {
  return { user: { id: demoUserId(email), email: email || null } };
}

export class LocalAuth implements AuthProvider {
  private listeners = new Set<AuthChangeListener>();

  async getSession(): Promise<AuthSession | null> {
    return readSession();
  }

  // `password`/`provider`/`token`/`type` are unused: the demo adapter never
  // actually checks credentials — only the interface's shape matters here
  // (fewer params than the `AuthProvider` method signature is a valid
  // implementation in TS's structural typing, same as a shorter callback).
  async signInWithPassword(email: string): Promise<AuthResult> {
    const session = makeSession(email);
    writeSession(session);
    this.emit(session);
    return { session };
  }

  async signUp(email: string): Promise<AuthResult> {
    const session = makeSession(email);
    writeSession(session);
    this.emit(session);
    return { session };
  }

  async signInWithOAuth(): Promise<{ error?: string }> {
    const session = makeSession('demo-google@mindflow.local');
    writeSession(session);
    this.emit(session);
    return {};
  }

  async signOut(): Promise<void> {
    writeSession(null);
    this.emit(null);
  }

  onAuthChange(listener: AuthChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendPasswordReset(): Promise<{ error?: string }> {
    return {};
  }

  async verifyOtp(email: string): Promise<AuthResult> {
    const session = makeSession(email);
    writeSession(session);
    this.emit(session);
    return { session };
  }

  async updatePassword(): Promise<{ error?: string }> {
    return {};
  }

  // In demo mode "the account" is just this browser's MindFlow storage, so
  // deleting it means wiping every namespaced key (docs, workspace, recents,
  // active view, session) and emitting a signed-out change — mirroring what
  // the Supabase RPC does server-side (delete the user → cascade all data).
  async deleteAccount(): Promise<{ error?: string }> {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('mindflow_') || k.startsWith('mf_'))) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable (private mode, quota, ...) — non-fatal */
    }
    this.emit(null);
    return {};
  }

  private emit(session: AuthSession | null): void {
    this.listeners.forEach((l) => l(session));
  }
}
