import type { CSSProperties } from 'react';
import { AUTH } from './tokens';

/** 로그인 화면의 공용 스타일 — 디자인 원본의 인라인 값을 그대로 옮겼다. */

/** 제출 버튼. `ready`가 false면(필수 칸이 비어 있음) 옅은 코럴 + 그림자 없음.
 *
 * 비활성 조건을 "형식까지 올바른가"가 아니라 **"칸이 비어 있는가"**로 둔 이유:
 * 이유를 모르는 비활성 버튼을 만들지 않는다는 이 앱의 규칙 때문이다(설정의
 * 비밀번호 변경과 같은 판단). 짧은 비밀번호·불일치처럼 **말해 줄 수 있는**
 * 문제는 누른 뒤 문장으로 알린다. */
export function submitButtonStyle(busy: boolean, ready: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    width: '100%',
    height: 50,
    marginTop: 2,
    border: 0,
    borderRadius: 14,
    background: ready || busy ? AUTH.accent : AUTH.accentMute,
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 15.5,
    fontWeight: 700,
    letterSpacing: '-.015em',
    cursor: busy ? 'progress' : ready ? 'pointer' : 'not-allowed',
    boxShadow: ready && !busy ? '0 16px 30px -16px rgba(238,107,69,.72)' : 'none',
    transition: 'background .16s ease, transform .12s ease, box-shadow .16s ease',
  };
}

export function spinnerStyle(busy: boolean): CSSProperties {
  return {
    display: busy ? 'block' : 'none',
    width: 15,
    height: 15,
    border: '2px solid rgba(255,255,255,.35)',
    borderTopColor: '#fff',
    borderRadius: 99,
    animation: 'mf-spin .7s linear infinite',
  };
}

/** [라벨][입력]을 세로로 쌓는 필드 묶음. */
export const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7 };

export const fieldLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: '-.01em',
  color: AUTH.label,
};

export function textInputStyle(invalid = false): CSSProperties {
  return {
    height: 48,
    padding: '0 14px',
    borderRadius: 13,
    border: `1px solid ${invalid ? '#E9A08A' : AUTH.border}`,
    background: AUTH.field,
    outline: 'none',
    fontFamily: 'inherit',
    fontSize: 14.5,
    color: AUTH.ink,
    transition: 'border-color .16s ease, box-shadow .16s ease',
  };
}

/** 인증 코드 칸 — 등폭·자간 넓게·가운데. 코드는 읽어서 옮겨 적는 값이라
 * 글자 하나씩 눈에 걸리는 편이 낫다. */
export const codeInputStyle: CSSProperties = {
  height: 48,
  padding: '0 14px',
  borderRadius: 13,
  border: `1px solid ${AUTH.border}`,
  background: AUTH.field,
  outline: 'none',
  fontFamily: AUTH.mono,
  fontSize: 17,
  letterSpacing: '.3em',
  textAlign: 'center',
  color: AUTH.ink,
  transition: 'border-color .16s ease, box-shadow .16s ease',
};

export const errorMsgStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: AUTH.accentDeep,
  marginTop: -4,
};

export const noticeMsgStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 7,
  fontSize: 12,
  lineHeight: 1.55,
  color: AUTH.sub,
  marginTop: -4,
};

/** 이미 가입된 이메일로 가입을 시도했을 때의 안내 콜아웃 — 단순 에러 줄보다
 * 눈에 띄게 해 다음 행동(소셜 로그인 / 로그인 탭)을 바로 찾게 한다. */
export const calloutStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  background: AUTH.accentSoft,
  border: `1px solid ${AUTH.accentBorder}`,
  borderRadius: 12,
  padding: '11px 13px',
  fontSize: 12.5,
  lineHeight: 1.6,
  color: '#B4462A',
};

/** 데모 코드 힌트(로컬/데모 모드에서만) */
export const demoHintStyle: CSSProperties = {
  fontSize: 12,
  color: AUTH.faint2,
  background: AUTH.hover,
  border: `1px dashed ${AUTH.accentBorder}`,
  borderRadius: 11,
  padding: '10px 12px',
};

/** 단계 안내 아이콘 아래 붙는 설명문(비밀번호 찾기·인증 단계) */
export const introTextStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.7,
  color: AUTH.label,
};
