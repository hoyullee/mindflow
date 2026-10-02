// 첨부 파일 한도(0049) — 설정의 플랜 알약과 사용량 막대가 읽는다.
//
// 서버(`my_file_quota`)가 모르면 — 아직 마이그레이션 전이거나 오프라인이면 — `null`이고, 화면은
// 예전처럼 `무료 플랜` 알약만 그린다(막대는 숨긴다). **열려 있을 때만**(`enabled`) 읽는다 — 설정 모달·
// 메뉴는 홈에 늘 붙어 있어서, 그렇지 않으면 홈을 켤 때마다 묻는다. 열 때마다 다시 읽는다(올린 직후의
// 숫자를 보여 주려고 캐시하지 않는다 — 설정을 여는 일은 드물다).

import { useEffect, useState } from 'react';
import { useFileStore } from '../../adapters/BackendContext';
import type { FileQuota } from '../../adapters/ports';

export function useFileQuota(enabled: boolean): FileQuota | null {
  const store = useFileStore();
  const [quota, setQuota] = useState<FileQuota | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    store
      .quota()
      .then((q) => {
        if (alive) setQuota(q);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, store]);
  return quota;
}

/** 알약 글자 — `무료 플랜`. 서버를 아직 모르면 무료(지금 모든 계정이 그렇다). */
export function planLabel(q: FileQuota | null): string {
  return `${q?.planName || '무료'} 플랜`;
}
