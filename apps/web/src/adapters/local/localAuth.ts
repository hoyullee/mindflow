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

import type { AuthChangeListener, AuthProvider, AuthResult, AuthSession, SigninMethods, SignOutScope } from '../ports';

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

// 데모 모드의 "로그인 수단" — 설정 → 로그인 수단을 실제로 눌러 볼 수 있게 이
// 브라우저에 상태를 남긴다(서버가 없으므로 이게 정본이다). 기본값은 이메일 가입
// 계정(비밀번호 있음)이고, 데모 Google 로그인으로 들어오면 Google 전용이 된다.
const METHODS_KEY = 'mf_demo_signin';

/** 데모 모드의 본인 확인 코드 — 보낼 메일이 없으니 고정값이다(모달이 알려 준다). */
export const DEMO_SETUP_CODE = '000000';

function readMethods(): SigninMethods {
  try {
    const raw = localStorage.getItem(METHODS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { hasPassword?: boolean; providers?: unknown };
      return { hasPassword: !!v.hasPassword, providers: Array.isArray(v.providers) ? v.providers.map(String) : [] };
    }
  } catch {
    /* storage unavailable / 깨진 값 — 기본값으로 */
  }
  return { hasPassword: true, providers: ['email'] };
}

function writeMethods(m: SigninMethods): void {
  try {
    localStorage.setItem(METHODS_KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable — 데모라 무시 */
  }
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

  async resendSignup(): Promise<{ error?: string }> {
    // No server in demo mode — the controller regenerates its demo code instead.
    return {};
  }

  async signInWithOAuth(): Promise<{ error?: string }> {
    const session = makeSession('demo-google@mindflow.local');
    // 데모에서도 "Google로 가입한 계정"이 되어야 설정 화면의 비밀번호 설정 흐름을
    // 눌러 볼 수 있다(실제 판정은 Supabase가 서버에서 한다).
    writeMethods({ hasPassword: false, providers: ['google'] });
    writeSession(session);
    this.emit(session);
    return {};
  }

  // Demo twin of the GIS token exchange — same fake Google session as
  // `signInWithOAuth`. Unreachable from the UI (the GIS button only renders in
  // Supabase mode) but required for port completeness.
  async signInWithIdToken(): Promise<AuthResult> {
    const session = makeSession('demo-google@mindflow.local');
    writeSession(session);
    this.emit(session);
    return { session };
  }

  // 데모 세션은 이 기기에 하나뿐이라 범위(local/global/others)와 무관하게 그
  // 하나를 지운다 — 포트 계약을 맞추기 위한 인자다(backend.md §15).
  async signOut(_scope?: SignOutScope): Promise<void> {
    void _scope;
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

  // No user directory in demo mode — return `null` ("unknown") so the reset
  // flow proceeds exactly as before (the simulated code step still opens).
  async isEmailRegistered(): Promise<boolean | null> {
    return null;
  }

  /** 로컬/데모 모드엔 계정 저장소가 없다 — 확인 불가(`null`). */
  async emailSignInProviders(): Promise<string[] | null> {
    return null;
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

  // 데모 계정에는 비밀번호 자체가 없다(`signInWithPassword`가 무엇이든 받아 준다) —
  // 확인할 것이 없으므로 성공으로 넘긴다. 데모에서 설정 흐름을 눌러 볼 수 있게 하는
  // 게 목적이고, 실제 검증은 Supabase 어댑터가 한다.
  async changePassword(): Promise<{ error?: string; wrongCurrent?: boolean }> {
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

  // No server in demo mode — the display name is persisted per-browser by the
  // home feature's localStorage cache, so these are no-ops.
  async getProfileName(): Promise<string | null> {
    return null;
  }

  async setProfileName(): Promise<{ error?: string }> {
    return {};
  }

  /**
   * 프로필 이미지(데모) — 파일을 올릴 곳이 없으므로 **데이터 URL을 세션에** 담는다
   * (Supabase 짝과 같은 칸: `user.avatarUrl`). 로컬 모드에서도 설정 화면과 에디터
   * 아바타가 실제로 바뀌는 것을 확인할 수 있다.
   */
  async updateAvatar(blob: Blob | null): Promise<{ url?: string | null; error?: string }> {
    const session = readSession();
    if (!session) return { error: 'not authenticated' };
    let url: string | null = null;
    if (blob) {
      url = await new Promise<string | null>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
      if (!url) return { error: '이미지를 읽지 못했어요.' };
    }
    writeSession({ ...session, user: { ...session.user, avatarUrl: url } });
    this.emit(readSession());
    return { url };
  }
  // ── 로그인 수단(데모) ──────────────────────────────────────────────────
  // Supabase 어댑터와 같은 규칙으로 움직이되 저장소는 이 브라우저다.
  async signinMethods(): Promise<SigninMethods | null> {
    return readMethods();
  }

  // 서버가 없어 메일을 보낼 수 없다 — 데모에서는 코드가 늘 `000000`이다(모달이
  // 데모 모드임을 밝히고 그 코드를 알려 준다).
  async sendPasswordSetupCode(): Promise<{ error?: string }> {
    return {};
  }

  // `newPassword`는 쓰지 않는다 — 데모 계정에는 비밀번호 자체가 없고
  // (`signInWithPassword`가 무엇이든 받아 준다) "걸렸다"는 사실만 기억한다.
  async setPasswordWithCode(code: string, newPassword?: string): Promise<{ error?: string; wrongCode?: boolean }> {
    void newPassword;
    if (code.trim() !== DEMO_SETUP_CODE) return { wrongCode: true, error: 'invalid nonce' };
    // 비밀번호만 걸고 **신원 목록은 건드리지 않는다** — 실제 Supabase도 그렇다
    // (`updateUser({ password })`는 identities에 'email'을 만들지 않는다). 신원은
    // `registerEmailIdentity`가 따로 등록한다.
    writeMethods({ ...readMethods(), hasPassword: true });
    return {};
  }

  // 데모 짝 — 비밀번호가 있으면 이메일 수단을 목록에 더한다(Supabase의 신원 등록).
  async registerEmailIdentity(): Promise<boolean> {
    const m = readMethods();
    if (!m.hasPassword || m.providers.includes('email')) return false;
    writeMethods({ ...m, providers: [...m.providers, 'email'] });
    return true;
  }

  async linkGoogle(): Promise<{ error?: string }> {
    const m = readMethods();
    if (!m.providers.includes('google')) writeMethods({ ...m, providers: [...m.providers, 'google'] });
    return {};
  }

  async unlinkGoogle(): Promise<{ error?: string }> {
    const m = readMethods();
    writeMethods({ ...m, providers: m.providers.filter((p) => p !== 'google') });
    return {};
  }


  private emit(session: AuthSession | null): void {
    this.listeners.forEach((l) => l(session));
  }
}
