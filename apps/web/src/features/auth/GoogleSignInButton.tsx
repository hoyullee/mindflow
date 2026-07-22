import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackend } from '../../adapters/BackendContext';
import { createNoncePair, loadGoogleIdApi, readGoogleClientId } from './googleIdentity';

interface Props {
  /** Fired with the Google ID token (and the raw nonce it was minted with)
   * when the user completes the GIS popup — caller exchanges it via
   * `auth.signInWithIdToken`. */
  onCredential: (token: string, nonce?: string) => void;
  /** Rendered instead of (or until) the GIS button: local/demo mode, missing
   * client ID, script blocked/offline, or still loading. This is the app's
   * original custom button wired to the redirect flow, so Google login never
   * breaks — it just falls back to showing the supabase.co consent domain. */
  fallback: ReactNode;
  /** Test seam — defaults to the Vite env (`VITE_GOOGLE_CLIENT_ID`). */
  clientId?: string | null;
}

/**
 * The official "Google 계정으로 계속하기" button, rendered by Google Identity
 * Services on OUR origin. Compared to the redirect flow this keeps the whole
 * OAuth exchange on geurio.com, so the consent screen stops naming the
 * supabase.co callback domain (and, once brand verification passes, shows
 * "Geurio" instead). GIS only issues credentials through its own rendered
 * button — a custom button can't trigger the popup — hence the swap-in-place
 * with `fallback` rather than restyling ours.
 */
export function GoogleSignInButton({ onCredential, fallback, clientId }: Props) {
  const { mode } = useBackend();
  const resolvedClientId = clientId !== undefined ? clientId : readGoogleClientId();
  // Local/demo mode has no real Google app to talk to; without a client ID
  // GIS can't initialize. Both cases: the redirect-flow fallback IS the button.
  const enabled = mode === 'supabase' && !!resolvedClientId;

  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // The GIS callback fires long after mount — always route it to the latest
  // onCredential (busy-state checks live in the controller, not here).
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const api = await loadGoogleIdApi();
      const host = containerRef.current;
      if (cancelled || !api || !host) return;
      const noncePair = await createNoncePair();
      if (cancelled) return;
      try {
        api.initialize({
          client_id: resolvedClientId!,
          ...(noncePair ? { nonce: noncePair.hashedNonce } : {}),
          callback: (res) => {
            if (res?.credential) onCredentialRef.current(res.credential, noncePair?.nonce);
          },
        });
        api.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          // GIS caps width at 400; the login form column is ≤360. Measure the
          // (still zero-height, but laid-out) container so narrow mobile
          // viewports get a button that fits.
          width: Math.max(200, Math.min(400, host.clientWidth || 360)),
          locale: 'ko',
        });
        if (!cancelled) setReady(true);
      } catch {
        // Leave `ready` false — the fallback button stays.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, resolvedClientId]);

  if (!enabled) return <>{fallback}</>;
  return (
    <>
      <div
        ref={containerRef}
        data-testid="gis-button-host"
        // Kept in the layout (width measurable) but invisible until GIS has
        // actually rendered its iframe into it — so a blocked script never
        // leaves a dead empty slot above the fallback.
        style={ready ? { display: 'flex', justifyContent: 'center' } : { height: 0, overflow: 'hidden' }}
      />
      {!ready && fallback}
    </>
  );
}
