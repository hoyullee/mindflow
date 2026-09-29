// **내 프로필 이미지의 단 하나의 원천**(제보: 홈에서 바꾼 사진이 에디터·공유 단추·공유
// 팝업에는 안 보이고 구글 기본 이미지가 뜬다).
//
// 무슨 일이 있었나: 사진을 읽는 길이 둘이었다.
// - 홈은 서버의 `profiles.avatar_url`(`AuthProvider.getProfileAvatar`)로 맞췄다.
// - 에디터·공유 단추·일정 댓글은 **세션의 `avatarUrl`**(로그인 토큰의 메타데이터)만 봤다.
// 그런데 그 메타데이터는 **구글로 다시 로그인할 때마다 구글 사진으로 덮인다**(Supabase가
// 신원 공급자의 값으로 `avatar_url`을 갱신한다). `updateAvatar`가 두 칸에 모두 적어도
// 다음 로그인에서 한 칸만 되돌아가므로, 홈은 맞고 에디터는 구글 사진인 모양이 된다.
//
// 그래서 정본은 **서버의 `profiles.avatar_url` 한 칸**이고, 모든 화면이 이 모듈을 거쳐
// 읽는다. 순서:
//   ① 서버가 이번 탭에서 알려 준 값(`null` = 지웠다 → 기본 얼굴) — 가장 믿을 만하다
//   ② 계정별 캐시(`mf_profile_avatars` — 마지막으로 확인·변경한 값, 첫 페인트용)
//   ③ 세션의 `avatarUrl` — 서버도 캐시도 모를 때만(첫 로그인 직후·로컬 모드)
// 서버 조회는 탭에 한 번이다(화면 여럿이 동시에 떠도 요청은 하나). 바꾸면
// `publishMyAvatar`가 캐시를 고치고 살아 있는 모든 구독자에게 밀어 준다 — 다른 탭은
// `storage` 이벤트로 같은 값을 받는다.

import { useEffect, useState } from 'react';
import { useAuth } from './BackendContext';
import { readSavedAvatar, writeSavedAvatar } from '../features/home/storage';
import type { AuthProvider } from './ports';

/** 서버가 **이번 탭에서** 확인해 준 값 — 키는 이메일(소문자). `null`은 「지웠다」. */
const known = new Map<string, string | null>();
const inflight = new Map<string, Promise<void>>();
const watchers = new Set<() => void>();

const keyOf = (email: string): string => email.trim().toLowerCase();

function notify(): void {
  for (const fn of watchers) fn();
}

/** 지금 보여 줄 내 사진 — 위의 ①②③ 순서. */
export function resolveMyAvatar(email: string | null | undefined, sessionUrl: string | null | undefined): string | null {
  if (!email) return sessionUrl || null;
  const k = keyOf(email);
  if (known.has(k)) return known.get(k) ?? null;
  return readSavedAvatar(email) || readSavedAvatar(k) || sessionUrl || null;
}

/** 서버가 확인해 준 값만 — 모르면 `undefined`(그때 화면은 제가 가진 값을 지킨다). */
export function knownMyAvatar(email: string): string | null | undefined {
  const k = keyOf(email);
  return known.has(k) ? (known.get(k) ?? null) : undefined;
}

/**
 * 사진이 바뀌었다(올림·지움·서버 조회 결과) — 캐시를 고치고 모든 화면에 알린다.
 * 캐시는 받은 그 이메일 표기로 적는다(홈이 쓰던 키와 같게).
 */
export function publishMyAvatar(email: string, url: string | null): void {
  known.set(keyOf(email), url);
  writeSavedAvatar(email, url);
  notify();
}

/** 서버에 한 번 묻는다(탭당 한 번 · 동시에 여럿이 불러도 요청은 하나). */
export function refreshMyAvatar(auth: AuthProvider, email: string): Promise<void> {
  const k = keyOf(email);
  const busy = inflight.get(k);
  if (busy) return busy;
  const p = auth
    .getProfileAvatar()
    .then((url) => {
      // `undefined` = 모른다(로컬 모드·조회 실패) — 캐시·세션 값을 그대로 둔다.
      if (url !== undefined) publishMyAvatar(email, url);
    })
    .catch(() => {
      /* 오프라인·일시 실패 — 가진 값을 그대로 쓴다 */
    });
  inflight.set(k, p);
  return p;
}

/** 값이 바뀌면 부른다 — 해제 함수를 돌려준다. */
export function subscribeMyAvatar(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** 다른 탭에서 바꾼 사진 — 그 탭이 적은 캐시를 이 탭의 「확인된 값」으로 받는다. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'mf_profile_avatars') return;
    for (const k of [...known.keys()]) known.set(k, readSavedAvatar(k));
    notify();
  });
}

/**
 * 내 사진 — 화면은 이것만 쓴다(`useProfileName`과 같은 모양). 이메일·세션 사진은 부르는 쪽이
 * 이미 가진 값(`useAuthUser`)을 넘긴다 — 세션을 여기서 한 번 더 읽지 않으려는 것.
 */
export function useMyAvatar(email: string | null | undefined, sessionUrl: string | null | undefined): string | null {
  const auth = useAuth();
  const [, bump] = useState(0);
  useEffect(() => subscribeMyAvatar(() => bump((n) => n + 1)), []);
  useEffect(() => {
    if (email) void refreshMyAvatar(auth, email);
  }, [auth, email]);
  return resolveMyAvatar(email, sessionUrl);
}

/** 테스트용 — 모듈 상태를 비운다. */
export function resetMyAvatarForTests(): void {
  known.clear();
  inflight.clear();
}
