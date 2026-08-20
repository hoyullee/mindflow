// Google Identity Services (GIS) plumbing for the client-side Google sign-in
// button. Why this exists: the redirect OAuth flow (`auth.signInWithOAuth`)
// bounces through the Supabase project's callback URL, so Google's consent
// screen tells the user they're being sent to `<ref>.supabase.co` — a domain
// we don't own and can never brand-verify. With GIS the official button runs
// on OUR origin and hands us a Google ID token directly, which we exchange via
// `auth.signInWithIdToken` — supabase.co never appears to the user.
//
// Everything here is defensive: the GIS script lives on accounts.google.com,
// so an ad-blocker, offline PWA session, or restricted network must degrade to
// the redirect flow (the caller keeps its old button as a fallback), never to
// a broken login page.

/** The subset of `window.google.accounts.id` this app touches. */
export interface GsiIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    /** SHA-256 hex of the raw nonce we'll later hand to Supabase. */
    nonce?: string;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      logo_alignment?: 'left' | 'center';
      width?: number;
      locale?: string;
    },
  ): void;
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 8000;

/** Vite-injected Google OAuth client ID (`VITE_GOOGLE_CLIENT_ID`), or `null`
 * when unset — same defensive read pattern as `adapters/env.ts`. */
export function readGoogleClientId(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    const v = env.VITE_GOOGLE_CLIENT_ID;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function currentGsiApi(): GsiIdApi | null {
  const w = window as unknown as { google?: { accounts?: { id?: GsiIdApi } } };
  return w.google?.accounts?.id ?? null;
}

let gisLoadPromise: Promise<GsiIdApi | null> | null = null;

/**
 * Resolves the GIS `accounts.id` API, injecting the script tag on first call
 * (memoized — repeated mounts share one load). Resolves `null` on load
 * failure or timeout so callers can fall back; NEVER rejects.
 */
export function loadGoogleIdApi(): Promise<GsiIdApi | null> {
  const existing = currentGsiApi();
  if (existing) return Promise.resolve(existing);
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<GsiIdApi | null>((resolve) => {
    let settled = false;
    const settle = (api: GsiIdApi | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A failed load shouldn't poison future attempts (e.g. the user comes
      // back online and re-navigates to /login without a full reload).
      if (!api) gisLoadPromise = null;
      resolve(api);
    };
    const timer = setTimeout(() => settle(currentGsiApi()), LOAD_TIMEOUT_MS);
    try {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => settle(currentGsiApi());
      script.onerror = () => settle(null);
      document.head.appendChild(script);
    } catch {
      settle(null);
    }
  });
  return gisLoadPromise;
}

/**
 * Replay-protection nonce pair: GIS gets the SHA-256 (hex) baked into the ID
 * token's `nonce` claim; Supabase gets the RAW value and re-hashes it to
 * verify. Returns `null` when WebCrypto is unavailable (non-secure context) —
 * callers then simply run the exchange without a nonce.
 */
export async function createNoncePair(): Promise<{ nonce: string; hashedNonce: string } | null> {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
    const hashedNonce = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return { nonce, hashedNonce };
  } catch {
    return null;
  }
}
