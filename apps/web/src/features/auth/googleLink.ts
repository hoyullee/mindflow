// "이메일로 가입한 계정에 Google이 붙는 것"을 막는 규칙 한 곳.
//
// 배경(제보): ① A@…로 이메일 회원가입 → ② 같은 주소로 Google 로그인 하면, Supabase가
// **같은 이메일의 Google 신원을 그 계정에 자동 연결**한다(동일 이메일·인증된 계정의
// 기본 동작). 그러면 한 계정에 로그인 수단이 둘 붙는다 — 사용자가 만들지 않은 두
// 번째 출입구다. 이메일 가입 쪽은 이미 막고 있었으므로(0013 `email_signin_providers`)
// 이 규칙으로 **대칭**을 맞춘다: 각 수단은 상대 방법으로 만든 계정을 거절한다.
//
// 판정 근거는 세션의 `app_metadata`다(서버가 채우는 값): `provider`= 이번 로그인에
// 쓴 수단, `providers`= 이 계정에 연결된 수단 전부. 그래서 "비밀번호로 로그인한
// 사람"(provider='email')은 두 수단이 이미 연결돼 있어도 막히지 않는다.

export interface ProviderInfo {
  signInProvider?: string | null;
  linkedProviders?: string[];
}

/**
 * 이 로그인을 거절해야 하는가 — **Google로 들어왔는데 그 계정이 비밀번호(email)로도
 * 가입돼 있을 때**만 true.
 *
 * 모르는 값(provider 없음·providers 비어 있음)은 막지 않는다: 정보가 없다고 로그인을
 * 잠그는 쪽이 더 나쁘다(이 앱의 다른 게이트들과 같은 원칙).
 */
export function googleLinkRefused(info: ProviderInfo | null | undefined): boolean {
  if (!info) return false;
  if (info.signInProvider !== 'google') return false;
  const linked = info.linkedProviders ?? [];
  return linked.includes('email');
}

/** 거절 시 로그인 화면에 띄우는 안내 — 두 진입점(GIS·리다이렉트)이 같은 문구를 쓴다. */
export const GOOGLE_LINK_REFUSED_MESSAGE = '이 이메일은 비밀번호로 가입한 계정이에요. 위에서 비밀번호로 로그인해 주세요.';
