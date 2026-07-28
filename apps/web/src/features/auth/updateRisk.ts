import type { UpdateRisk } from '../../pwa/updateGate';
import type { LoginState } from './types';

/**
 * 로그인 화면에서 새 버전을 조용히 적용해도 되는지 — `useUpdateGuard`에 넘길 위험도.
 *
 * 손대지 않은 빈 로그인 폼은 리로드해도 잃을 게 없으니 `safe`. 반대로 **한 글자라도
 * 입력했거나** 폼을 넘어간 단계는 전부 `block`이다. 특히 인증 코드 단계는 리로드하면
 * 코드가 사라져 메일을 다시 받아야 한다 — 문서 저장 같은 걸로는 복구되지 않는,
 * 자동 적용이 실제로 사용자를 다치게 하는 자리다.
 */
export function loginUpdateRisk(state: LoginState): UpdateRisk {
  // 인증 코드·새 비밀번호·비밀번호 찾기 이메일 — 전부 폼 밖의 입력 단계.
  if (state.step !== 'form') return 'block';
  // 요청이 날아가 있는 중(가입/로그인 확인)에 리로드하면 결과를 놓친다.
  if (state.busy) return 'block';
  // 타이핑해 둔 자격증명이 있으면 날리지 않는다.
  if (state.email || state.password || state.password2) return 'block';
  return 'safe';
}
