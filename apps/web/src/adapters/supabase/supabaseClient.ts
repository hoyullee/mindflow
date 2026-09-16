// Thin wrapper around `@supabase/supabase-js`'s `createClient` — isolated so
// `adapters/factory.ts` and tests can construct/inject a client without every
// call site needing to know `createClient`'s options shape.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authSessionStorage } from '../../features/auth/rememberSession';
import { isAuthCourierPath } from '../../features/auth/desktopGoogle';

let cached: { url: string; key: string; detectSessionInUrl: boolean; client: SupabaseClient } | null = null;

/**
 * **이 주소에서 URL의 세션을 주워도 되는가.**
 *
 * 심부름꾼 페이지(`/auth/desktop`·`/auth/gcal`)에서는 **아니다**. 그 자리는 설치형
 * 앱이 받을 값을 브라우저가 대신 받아 넘겨 주는 곳인데, 그 브라우저는 사용자가
 * **다른 계정으로 쓰고 있을 수 있는 바로 그 브라우저**다. 여기서 URL을 주우면
 * auth-js가 그 세션을 저장소에 쓰고 다른 탭에까지 `SIGNED_IN`을 알려 **원래 계정을
 * 덮어쓴다** — 실제로 그 제보를 받았다(크롬 A + 앱 B → 크롬도 B).
 *
 * 왜 "먼저 낚아채기"로는 못 막는지는 `isAuthCourierPath`의 주석에 적어 두었다.
 */
function detectSessionInUrlFor(pathname: string | null): boolean {
  if (pathname === null) return true; // 브라우저가 아닌 곳(테스트·SSR) — 지금까지의 값
  return !isAuthCourierPath(pathname);
}

function currentPathname(): string | null {
  return typeof window === 'undefined' ? null : window.location.pathname;
}

/**
 * Returns a memoized `SupabaseClient` for the given URL/anon key (re-creating
 * it only if either changes — relevant mainly for tests/hot-reload, since in
 * production `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are fixed at build time).
 */
export function getSupabaseClient(url: string, anonKey: string): SupabaseClient {
  // 주소도 기억한다 — 심부름꾼 경로인지에 따라 옵션이 갈리므로, 주소가 바뀌었는데
  // 앞서 만든 클라이언트를 돌려주면 그 규칙이 조용히 무시된다(실제 페이지 로드에서는
  // 한 번뿐이지만, 이 기억이 틀리면 테스트가 진실을 말하지 못한다).
  const detect = detectSessionInUrlFor(currentPathname());
  if (cached && cached.url === url && cached.key === anonKey && cached.detectSessionInUrl === detect) return cached.client;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      // "이 브라우저에서 로그인 유지"를 끄면 세션이 탭 저장소로 간다(창을 닫으면
      // 사라짐). 켜져 있으면 지금까지처럼 localStorage — rememberSession.ts 참고.
      storage: authSessionStorage,
      autoRefreshToken: true,
      // 심부름꾼 페이지에서는 **끈다** — 위 `detectSessionInUrlFor` 참고(계정 뒤섞임).
      detectSessionInUrl: detect,
      // **명시해 둔다.** 이 값이 `implicit`이라는 사실에 기대는 경로가 있다 —
      // 설치형 앱의 Google 로그인 핸드오프는 콜백이 해시로 실어 주는 토큰을 낚아채
      // 앱에 넘긴다(features/auth/desktopGoogle.ts). auth-js의 **기본값**이 지금은
      // `implicit`이지만 언젠가 `pkce`로 뒤집히면 그 경로가 조용히 깨지므로(이미 한 번
      // 잘못 짚었다) 기본값에 기대지 않고 여기서 못박는다. 바꾸려면 그 파일과
      // 비밀번호 재설정 링크 흐름을 함께 손봐야 한다.
      flowType: 'implicit',
    },
  });
  cached = { url, key: anonKey, detectSessionInUrl: detect, client };
  return client;
}
