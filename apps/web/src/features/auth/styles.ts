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
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 8,
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

export const fieldLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  marginBottom: 7,
};
