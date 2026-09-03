// 구글 OAuth의 **서버 쪽 절반** — Edge Function `google-oauth`를 부르는 자리.
//
// 브라우저가 하는 일은 인가 코드를 받아 넘기는 것까지이고, 코드 교환·refresh token
// 보관·조용한 갱신은 전부 서버가 한다(그 이유는 함수 머리 주석). 이 모듈은 그 함수를
// 부르는 얇은 껍데기이며, **함수를 쓸 수 없는 환경을 정상으로 다룬다**:
//
//  - 로컬·데모 모드(Supabase 미설정): 서버가 없다 → `unavailable`
//  - 함수·시크릿 미배포: 함수가 `not-configured`를 돌려준다 → `unavailable`
//
// 두 경우 모두 호출부는 **예전 흐름**(브라우저 토큰 + 한 시간 뒤 "다시 연결")으로
// 물러난다. 한 번 `unavailable`을 본 뒤에는 이 탭에서 다시 묻지 않는다 — 매 갱신마다
// 없는 함수를 부르면 왕복만 늘어난다.

import { getSupabaseClient } from '../../../adapters/supabase/supabaseClient';
import { isSupabaseConfigured, readViteEnv } from '../../../adapters/env';

/** 서버가 돌려준 액세스 토큰(한 시간짜리) — refresh token은 절대 오지 않는다. */
export interface ServerToken {
  accessToken: string;
  expiresIn: number;
  scope: string;
  email: string | null;
  /** 서버가 refresh token을 갖고 있는가 — 없으면 조용한 갱신을 기대할 수 없다. */
  persistent: boolean;
}

export type ServerResult =
  /** 이 환경에는 서버 흐름이 없다(로컬·데모·함수 미배포) — 호출부는 예전 흐름으로. */
  | { unavailable: true }
  | { token: ServerToken }
  /** 서버에 저장된 자격 증명이 없거나 폐기됐다 — 사용자가 다시 연결해야 한다. */
  | { needsConsent: true }
  | { error: string };

let known: 'unknown' | 'available' | 'unavailable' = 'unknown';

/** 테스트·계정 전환에서 이 탭의 판단을 되돌린다. */
export function resetGoogleOAuthServer(): void {
  known = 'unknown';
}

interface FnResponse {
  ok?: boolean;
  reason?: string;
  accessToken?: string;
  expiresIn?: number;
  scope?: string;
  email?: string | null;
  persistent?: boolean;
  detail?: string;
}

async function call(body: Record<string, unknown>): Promise<ServerResult> {
  if (known === 'unavailable') return { unavailable: true };
  const env = readViteEnv();
  if (!isSupabaseConfigured(env)) {
    known = 'unavailable';
    return { unavailable: true };
  }
  const client = getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
  let data: FnResponse | null = null;
  try {
    const res = await client.functions.invoke<FnResponse>('google-oauth', { body });
    // 함수가 배포되지 않았으면 호출 자체가 실패한다 — 그것도 "서버 흐름 없음"이다.
    if (res.error) {
      known = 'unavailable';
      return { unavailable: true };
    }
    data = res.data ?? null;
  } catch {
    known = 'unavailable';
    return { unavailable: true };
  }
  if (!data) return { error: '구글 연결을 확인하지 못했어요.' };
  if (data.ok && data.accessToken && data.expiresIn) {
    known = 'available';
    return {
      token: {
        accessToken: data.accessToken,
        expiresIn: data.expiresIn,
        scope: data.scope ?? '',
        email: data.email ?? null,
        persistent: data.persistent !== false,
      },
    };
  }
  if (data.reason === 'not-configured') {
    known = 'unavailable';
    return { unavailable: true };
  }
  // 서버는 살아 있는데 자격 증명이 없거나 폐기됐다 — 사용자의 동의가 다시 필요하다.
  known = 'available';
  if (data.reason === 'no-credentials' || data.reason === 'revoked') return { needsConsent: true };
  return { error: '구글 연결을 확인하지 못했어요.' };
}

/** 서버 흐름을 쓸 수 있다고 이미 확인했는가(팝업 방식을 고르는 데 쓴다). */
export function serverKnownUnavailable(): boolean {
  return known === 'unavailable';
}

export const exchangeGoogleCode = (code: string): Promise<ServerResult> => call({ action: 'exchange', code });
export const refreshGoogleAccess = (): Promise<ServerResult> => call({ action: 'refresh' });
export const disconnectGoogleServer = (): Promise<ServerResult> => call({ action: 'disconnect' });
