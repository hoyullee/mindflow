// 커서 이름표가 쓰는 프로필명 해석 — 홈 프로필 블록과 같은 우선순위인지.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BackendProvider } from './BackendContext';
import type { Backend } from './ports';
import { useProfileName } from './useProfileName';
import { writeSavedProfileName } from '../features/home/storage';

function wrapperWith(getProfileName: () => Promise<string | null>) {
  const backend = { auth: { getProfileName }, mode: 'local' } as unknown as Backend;
  return ({ children }: { children: ReactNode }) => <BackendProvider backend={backend}>{children}</BackendProvider>;
}

afterEach(() => {
  localStorage.clear();
});

describe('useProfileName', () => {
  it('로컬 캐시(홈의 프로필명 변경) → 공급자 이름 → 이메일 로컬 파트 순서로 해석한다', async () => {
    writeSavedProfileName('a@x.com', '내가 고른 이름');
    const { result } = renderHook(() => useProfileName('a@x.com', 'Google Name'), { wrapper: wrapperWith(async () => null) });
    await waitFor(() => expect(result.current).toBe('내가 고른 이름'));

    const { result: r2 } = renderHook(() => useProfileName('b@x.com', 'Google Name'), { wrapper: wrapperWith(async () => null) });
    await waitFor(() => expect(r2.current).toBe('Google Name'));

    const { result: r3 } = renderHook(() => useProfileName('c.lee@x.com', null), { wrapper: wrapperWith(async () => null) });
    await waitFor(() => expect(r3.current).toBe('c.lee'));
  });

  it('백엔드의 display_name이 오면 그것이 이긴다 (다른 기기에서 바꾼 이름)', async () => {
    writeSavedProfileName('a@x.com', '옛 캐시');
    const { result } = renderHook(() => useProfileName('a@x.com', null), { wrapper: wrapperWith(async () => '서버 이름') });
    await waitFor(() => expect(result.current).toBe('서버 이름'));
  });

  it('이메일이 없으면(게스트) null — usePresence가 게스트 이름으로 폴백한다', async () => {
    const getProfileName = vi.fn(async () => 'should-not-matter');
    const { result } = renderHook(() => useProfileName(null), { wrapper: wrapperWith(getProfileName) });
    await waitFor(() => expect(result.current).toBeNull());
    expect(getProfileName).not.toHaveBeenCalled();
  });
});
