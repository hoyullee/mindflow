// Small React hook wrapping `AuthProvider#getSession`/`onAuthChange` — the
// same pattern `App.tsx`'s `RequireAuth` already uses, extracted so
// `usePresence` (`collab/usePresence.ts`) can pick up the real logged-in
// user's email for presence identity (falling back to a random guest
// identity in local/demo mode or before the session check resolves).

import { useEffect, useState } from 'react';
import { useAuth } from './BackendContext';
import type { AuthUser } from './ports';

export function useAuthUser(): AuthUser | null {
  const auth = useAuth();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    auth
      .getSession()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch(() => {
        /* not logged in / session check failed — stays null (guest identity) */
      });
    const unsubscribe = auth.onAuthChange((session) => {
      if (!cancelled) setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth]);

  return user;
}
