// 로그인 사용자의 **표시용 프로필명**을 해석하는 훅. 홈의 LNB 프로필 블록이 쓰는
// 규칙(`useHomeController`의 프로필 로드 효과)과 동일한 우선순위를 따른다:
//   ① 로컬 캐시(`readSavedProfileName` — 홈의 '프로필명 변경'이 즉시 쓰는 곳)
//   ② 공급자 이름(Google full_name 등, 세션의 `user.name`)
//   ③ 이메일 로컬 파트(hoyul.lee@… → "hoyul.lee")
// 그 뒤 백엔드(`AuthProvider.getProfileName` — Supabase `profiles.display_name`)와
// 한 번 대조한다: 다른 기기에서 바꾼 이름이 이 기기 캐시보다 이길 수 있게.
//
// 처음 쓰인 곳: 협업 커서 이름표. 예전엔 이메일 전체를 그대로 띄웠는데(제보),
// 사용자가 고른 이름이 있는데 이메일을 노출할 이유가 없다 — 프라이버시로도 표시로도.

import { useEffect, useState } from 'react';
import { useAuth } from './BackendContext';
import { readSavedProfileName, writeSavedProfileName } from '../features/home/storage';

export function useProfileName(email: string | null, providerName?: string | null): string | null {
  const auth = useAuth();
  const [name, setName] = useState<string | null>(() => (email ? readSavedProfileName(email) : null));

  useEffect(() => {
    if (!email) {
      setName(null);
      return;
    }
    setName(readSavedProfileName(email) || providerName || email.split('@')[0] || email);
    let cancelled = false;
    auth
      .getProfileName()
      .then((remote) => {
        if (cancelled || !remote || !remote.trim()) return;
        writeSavedProfileName(email, remote); // 캐시 갱신 — 다음 마운트는 ①에서 바로 맞는 값
        setName(remote);
      })
      .catch(() => {
        /* 오프라인/일시 오류 — 캐시된 이름 유지 */
      });
    return () => {
      cancelled = true;
    };
  }, [auth, email, providerName]);

  return name;
}
