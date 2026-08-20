import { describe, expect, it } from 'vitest';
import { localizeAuthError } from './useLoginController';

// 이 함수는 서버의 영문 오류를 한글로 옮긴다 — 매핑이 없으면 일반 안내로 덮어
// 원인을 감춘다(제보: 라이브에서 Google 연결을 누르면 "요청을 처리하지 못했어요"만
// 떴고, 실제 원인은 대시보드에서 Manual linking이 꺼져 있던 것이었다).
describe('localizeAuthError — 로그인 수단 연동(backend.md §16)', () => {
  it('연동 기능이 꺼져 있으면 그 사실을 말한다', () => {
    const msg = localizeAuthError('Manual linking is disabled');
    expect(msg).toContain('연동');
    expect(msg).not.toContain('요청을 처리하지 못했어요');
  });

  it('이미 다른 계정에 붙은 Google 신원은 그렇게 말한다', () => {
    expect(localizeAuthError('Identity is already linked to another user')).toContain('이미 다른 계정');
  });

  it('마지막 수단은 해제할 수 없다 — 비밀번호를 권하지 않는다(신원이 늘지 않는다)', () => {
    const msg = localizeAuthError('User must have at least 1 identity after unlinking');
    expect(msg).toContain('마지막 로그인 수단');
    // 서버는 신원(identity) 개수를 센다 — 비밀번호 설정은 이 거절을 풀지 못하므로
    // 그 조언을 여기 담으면 사용자를 헛수고하게 만든다(제보: 두 이유가 섞였다).
    expect(msg).not.toContain('비밀번호');
    expect(msg).toContain('다른 로그인 수단');
  });

  it('모르는 오류는 여전히 일반 안내로 덮는다(영문 노출 방지)', () => {
    expect(localizeAuthError('some unexpected server hiccup')).toBe('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });
});
