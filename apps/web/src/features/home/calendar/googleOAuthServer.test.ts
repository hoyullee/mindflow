/**
 * 서버가 연동을 거절했을 때 **사유를 드러낸다**.
 *
 * 제보 ③: 앱에서 구글 캘린더를 연동하면 `구글 연결을 확인하지 못했어요.`만 뜨고
 * 이어지지 않았다. 그 문장은 우리 폴백이고, 정작 서버가 돌려준 `reason`·`detail`은
 * 버려지고 있었다 — 원인이 무엇이든 사용자와 우리가 보는 것이 같았다.
 *
 * 그래서 자주 나는 두 사유는 **무엇을 해야 하는지까지** 말하고, 나머지는 구글의
 * 원문을 그대로 싣는다(400은 "우리 요청이 틀렸다"는 뜻이라 "잠시 후 다시"가
 * 거짓말이 된다 — 같은 판단을 일정 쓰기에서도 한 적이 있다).
 */

import { describe, expect, it } from 'vitest';
import { serverFailureMessage } from './googleOAuthServer';

describe('serverFailureMessage', () => {
  it('redirect_uri_mismatch는 **함수 재배포**가 답임을 말한다', () => {
    // 이 사유는 코드를 받을 때 쓴 리디렉션 URI와 교환할 때 보낸 것이 다를 때만 난다.
    // 실제로 그런 상태가 하나 있다: 마이그레이션은 자동 배포되지만 **Edge Function은
    // 손으로 배포**하므로, 앱이 `/auth/gcal`로 코드를 받는데 서버가 옛 판이라
    // `postmessage`로 교환하는 창이 생긴다.
    const msg = serverFailureMessage('exchange-failed', 'Bad Request: redirect_uri_mismatch');
    expect(msg).toContain('redirect_uri_mismatch');
    expect(msg).toContain('google-oauth');
  });

  it('invalid_grant은 코드가 만료된 것 — 다시 연결하면 된다', () => {
    expect(serverFailureMessage('exchange-failed', 'invalid_grant')).toContain('다시 연결');
  });

  it('그 밖의 거절은 구글의 원문을 그대로 싣는다', () => {
    expect(serverFailureMessage('exchange-failed', 'unsupported_grant_type')).toBe('구글이 연동을 거절했어요: unsupported_grant_type');
    // 사유만 있고 원문이 없으면 그 사실만 말한다(지어내지 않는다).
    expect(serverFailureMessage('exchange-failed')).toBe('구글이 연동을 거절했어요.');
  });

  it('모르는 사유는 예전 문장으로 물러난다', () => {
    expect(serverFailureMessage()).toBe('구글 연결을 확인하지 못했어요.');
    expect(serverFailureMessage('refresh-failed')).toBe('구글 연결을 확인하지 못했어요.');
  });
});
