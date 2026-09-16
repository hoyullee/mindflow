// **심부름꾼 페이지에서는 URL의 세션을 줍지 않는다** — 계정 뒤섞임을 막는 자리.
//
// 제보: 크롬에 A로 로그인해 둔 채 설치형 앱에서 B로 로그인했더니 **크롬도 B**가 됐다.
// 앱의 Google 로그인은 시스템 브라우저를 거치고, 그 브라우저가 사용자가 A로 쓰던 바로
// 그 브라우저이기 때문이다. 콜백 주소(`/auth/desktop#…`)를 클라이언트가 주우면
// auth-js가 그 세션을 저장소에 쓰고 다른 탭에까지 알린다 — A가 덮인다.
//
// 한동안은 "낚아채기가 클라이언트보다 먼저 돈다"로 막고 있다고 믿었지만 그 순서는
// 성립하지 않았다(ESM 임포트가 본문보다 먼저 평가된다 + auth-js가 생성자 스택에서
// URL을 **동기로** 읽어 둔다). 그래서 근거를 순서가 아니라 **성질**로 옮겼고,
// 이 테스트가 그 성질을 지킨다.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ opts: [] as { auth: { detectSessionInUrl: boolean } }[] }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { auth: { detectSessionInUrl: boolean } }) => {
    H.opts.push(opts);
    return { __client: H.opts.length } as unknown;
  },
}));

import { getSupabaseClient } from './supabaseClient';
import { DESKTOP_HANDOFF_PATH } from '../../features/auth/desktopGoogle';
import { GCAL_HANDOFF_PATH } from '../../features/home/calendar/desktopGoogleCalendar';

/**
 * 그 주소에서 만들어진 클라이언트가 URL을 주워도 되는가.
 *
 * 키를 매번 다르게 준다 — `getSupabaseClient`는 만든 것을 **기억**하므로(프로덕션에서는
 * 페이지당 한 번뿐이라 맞는 동작이다) 같은 키로 부르면 새로 만들지 않아 옵션을 볼 수 없다.
 */
let keySeq = 0;
function detectOf(path: string): boolean {
  window.history.replaceState({}, '', path);
  getSupabaseClient('https://ref.supabase.co', `anon-${(keySeq += 1)}`);
  return H.opts[H.opts.length - 1]!.auth.detectSessionInUrl;
}

describe('세션을 URL에서 줍는 자리', () => {
  beforeEach(() => {
    H.opts = [];
    window.history.replaceState({}, '', '/');
  });

  it('**로그인 핸드오프에서는 줍지 않는다**(제보: 크롬 A + 앱 B → 크롬도 B)', () => {
    expect(detectOf(DESKTOP_HANDOFF_PATH)).toBe(false);
  });

  it('해시에 토큰이 실려 와도 마찬가지다 — 주소 모양이 아니라 **경로**로 판단한다', () => {
    expect(detectOf(`${DESKTOP_HANDOFF_PATH}#access_token=at&refresh_token=rt`)).toBe(false);
  });

  it('캘린더 연동 핸드오프에서도 줍지 않는다(같은 성질의 자리)', () => {
    expect(detectOf(`${GCAL_HANDOFF_PATH}?code=c&state=s`)).toBe(false);
  });

  it('평범한 화면에서는 지금까지처럼 줍는다 — 웹 로그인이 이 길로 세션을 세운다', () => {
    expect(detectOf('/login')).toBe(true);
    expect(detectOf('/home')).toBe(true);
    expect(detectOf('/')).toBe(true);
  });

  it('같은 주소에서 다시 부르면 **같은 클라이언트**다(만들 때마다 세션이 흔들리지 않게)', () => {
    window.history.replaceState({}, '', '/home');
    const a = getSupabaseClient('https://ref.supabase.co', 'memo-key');
    const b = getSupabaseClient('https://ref.supabase.co', 'memo-key');
    expect(b).toBe(a);
    expect(H.opts).toHaveLength(1);
  });

  it('경로가 심부름꾼으로 바뀌면 **다시 만든다** — 기억이 규칙을 덮어쓰지 않게', () => {
    window.history.replaceState({}, '', '/home');
    const web = getSupabaseClient('https://ref.supabase.co', 'switch-key');
    window.history.replaceState({}, '', DESKTOP_HANDOFF_PATH);
    const courier = getSupabaseClient('https://ref.supabase.co', 'switch-key');
    expect(courier).not.toBe(web);
    expect(H.opts.map((o) => o.auth.detectSessionInUrl)).toEqual([true, false]);
  });
});
