// 설정 첫 화면의 **첨부 파일 저장 공간** 한 줄 — `34MB / 200MB` + 막대(0049).
//
// 한도는 플랜마다 다르다(서버 `plans` 표). 90%를 넘으면 막대가 경고색이 된다 — 다 차서 올리기가
// 막히기 전에 알 수 있게.

import type { FileQuota } from '../../../adapters/ports';
import { formatBytes } from '../../editor/noteFiles';

export function FileQuotaBar({ quota }: { quota: FileQuota }) {
  const ratio = quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 0;
  const warn = ratio >= 0.9;
  return (
    <div data-file-quota style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 2px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-text)' }}>첨부 파일 저장 공간</span>
        <span data-file-quota-text style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: warn ? '#c4614c' : 'var(--mf-subtext)', fontVariantNumeric: 'tabular-nums' }}>
          {formatBytes(quota.used)} / {formatBytes(quota.limit)}
        </span>
      </div>
      <div role="progressbar" aria-label="첨부 파일 저장 공간" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} style={{ height: 6, borderRadius: 99, background: 'var(--mf-border-soft)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(ratio > 0 ? 2 : 0, ratio * 100)}%`, height: '100%', borderRadius: 99, background: warn ? '#c4614c' : 'var(--mf-accent, #e85e33)' }} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>파일 하나는 {formatBytes(quota.fileLimit)}까지 · 이미지는 따로 셉니다</span>
    </div>
  );
}
