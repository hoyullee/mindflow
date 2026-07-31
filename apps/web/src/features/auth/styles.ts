import type { CSSProperties } from 'react';

/** Shared style builders mirroring the inline style objects in Login.dc.html's renderVals(). */

export function submitButtonStyle(busy: boolean): CSSProperties {
  return {
    width: '100%',
    height: 50,
    marginTop: 8,
    border: 'none',
    borderRadius: 12,
    background: '#f0663f',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    cursor: busy ? 'default' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    opacity: busy ? 0.85 : 1,
    boxShadow: '0 8px 22px rgba(240,102,63,.32)',
    transition: 'filter .12s, transform .06s',
  };
}

export function spinnerStyle(busy: boolean): CSSProperties {
  return {
    display: busy ? 'inline-block' : 'none',
    width: 16,
    height: 16,
    border: '2.5px solid rgba(255,255,255,.4)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'mf-spin .7s linear infinite',
  };
}

export function textInputStyle(marginBottom: number): CSSProperties {
  return {
    width: '100%',
    height: 48,
    border: '1px solid #ecdfd5',
    borderRadius: 11,
    background: '#faf3ee',
    fontFamily: 'inherit',
    fontSize: 14,
    padding: '0 14px',
    outline: 'none',
    marginBottom,
    transition: 'border-color .12s, background .12s',
  };
}

export function codeInputStyle(marginBottom: number): CSSProperties {
  return {
    width: '100%',
    height: 50,
    border: '1px solid #ecdfd5',
    borderRadius: 11,
    background: '#faf3ee',
    fontFamily: 'inherit',
    // 코드 입력 placeholder("인증 코드 입력")가 일반 본문 텍스트처럼 보이도록
    // 크게·굵게 두지 않는다(과거 22px/700/자간8 → 14px/400/자간2).
    fontSize: 14,
    fontWeight: 400,
    letterSpacing: 2,
    textAlign: 'center',
    padding: '0 14px',
    outline: 'none',
    marginBottom,
    transition: 'border-color .12s, background .12s',
  };
}

export const errorMsgStyle: CSSProperties = {
  fontSize: 12.5,
  color: '#d64545',
  marginBottom: 12,
  marginTop: 2,
};

export const noticeMsgStyle: CSSProperties = {
  fontSize: 12.5,
  color: '#2f9e63',
  background: '#e9f4ee',
  border: '1px solid #cbe5d6',
  borderRadius: 9,
  padding: '9px 12px',
  marginBottom: 12,
  marginTop: 2,
};

/** 이미 가입된 이메일로 가입을 시도했을 때의 안내 콜아웃 — 비밀번호 찾기의
 * 미가입 툴팁(`ForgotStep`)과 같은 톤(주황 계열)으로, 단순 에러 줄보다 눈에
 * 띄게 해 사용자가 다음 행동(소셜 로그인 / 로그인 탭)을 바로 찾게 한다. */
export const signupBlockedCalloutStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  background: '#fff3ec',
  border: '1px solid #f0c4ad',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 12.5,
  lineHeight: 1.55,
  color: '#b4462a',
  marginBottom: 12,
  marginTop: 2,
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  marginBottom: 7,
};
