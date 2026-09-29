// 내 프로필 이미지의 단 하나의 원천(`myAvatar`) — 제보: 홈에서 바꾼 사진이 에디터·공유
// 단추·공유 팝업에는 안 보이고 구글 기본 이미지가 뜬다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knownMyAvatar, publishMyAvatar, refreshMyAvatar, resetMyAvatarForTests, resolveMyAvatar, subscribeMyAvatar } from './myAvatar';
import { writeSavedAvatar } from '../features/home/storage';
import type { AuthProvider } from './ports';

const GOOGLE = 'https://lh3.googleusercontent.com/a/google-photo';
const MINE = 'https://x.supabase.co/storage/v1/object/public/avatars/u/1.webp';

const authWith = (remote: string | null | undefined): AuthProvider => ({ getProfileAvatar: vi.fn(async () => remote) }) as unknown as AuthProvider;

describe('myAvatar — 내 사진의 한 원천', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMyAvatarForTests();
  });
  afterEach(() => resetMyAvatarForTests());

  it('세션 사진(구글)보다 **캐시(마지막으로 바꾼 사진)**가 먼저다 — 에디터가 구글 사진을 띄우던 자리', () => {
    writeSavedAvatar('me@x.com', MINE);
    expect(resolveMyAvatar('me@x.com', GOOGLE)).toBe(MINE);
  });

  it('서버도 캐시도 모를 때만 세션 사진을 쓴다', () => {
    expect(resolveMyAvatar('me@x.com', GOOGLE)).toBe(GOOGLE);
    expect(resolveMyAvatar(null, GOOGLE)).toBe(GOOGLE);
  });

  it('서버가 확인해 준 값이 가장 먼저다 — `null`(지웠다)이면 구글 사진으로 물러서지 않는다', async () => {
    writeSavedAvatar('me@x.com', MINE);
    await refreshMyAvatar(authWith(null), 'me@x.com');
    expect(knownMyAvatar('me@x.com')).toBeNull();
    expect(resolveMyAvatar('me@x.com', GOOGLE)).toBeNull();
  });

  it('서버가 모르면(`undefined` — 로컬 모드·실패) 가진 값을 지킨다', async () => {
    writeSavedAvatar('me@x.com', MINE);
    await refreshMyAvatar(authWith(undefined), 'me@x.com');
    expect(knownMyAvatar('me@x.com')).toBeUndefined();
    expect(resolveMyAvatar('me@x.com', GOOGLE)).toBe(MINE);
  });

  it('화면이 여럿이어도 서버 조회는 탭에 한 번이다', async () => {
    const auth = authWith(MINE);
    await Promise.all([refreshMyAvatar(auth, 'me@x.com'), refreshMyAvatar(auth, 'me@x.com'), refreshMyAvatar(auth, 'ME@x.com')]);
    await refreshMyAvatar(auth, 'me@x.com');
    expect(auth.getProfileAvatar).toHaveBeenCalledTimes(1);
  });

  it('바꾸면 **떠 있는 모든 화면**이 받고, 다음 방문의 첫 페인트도 그 값이다', () => {
    const seen: (string | null)[] = [];
    const off = subscribeMyAvatar(() => seen.push(resolveMyAvatar('me@x.com', GOOGLE)));
    publishMyAvatar('me@x.com', MINE);
    publishMyAvatar('me@x.com', null);
    off();
    publishMyAvatar('me@x.com', MINE);
    expect(seen).toEqual([MINE, null]);
    resetMyAvatarForTests(); // 새 탭 — 캐시만 남는다
    expect(resolveMyAvatar('me@x.com', GOOGLE)).toBe(MINE);
  });
});
