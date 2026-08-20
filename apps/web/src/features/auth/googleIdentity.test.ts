import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNoncePair, emailFromIdToken } from './googleIdentity';

describe('createNoncePair', () => {
  it('mints a raw nonce whose SHA-256 hex is the hashed twin (the GIS↔Supabase contract)', async () => {
    // Google embeds `hashedNonce` in the ID token's nonce claim; Supabase
    // re-hashes the raw `nonce` we hand to signInWithIdToken and compares.
    // If these two ever stop being sha256(raw)=hashed, every GIS login 401s.
    const pair = await createNoncePair();
    expect(pair).not.toBeNull();
    expect(pair!.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(pair!.hashedNonce).toBe(createHash('sha256').update(pair!.nonce).digest('hex'));
  });

  it('mints a fresh nonce per call (replay protection is per-attempt)', async () => {
    const [a, b] = [await createNoncePair(), await createNoncePair()];
    expect(a!.nonce).not.toBe(b!.nonce);
  });
});

// 이메일 가입 계정에 Google이 자동 연결되는 것을 막으려면 **교환 전에** 이메일을
// 알아야 한다 — 서명은 검증하지 않는다(하는 일이 '거절'뿐이라 안전, 함수 주석 참고).
describe('emailFromIdToken', () => {
  const tokenWith = (claims: Record<string, unknown>): string => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
  };

  it('페이로드의 email 클레임을 읽는다', () => {
    expect(emailFromIdToken(tokenWith({ email: 'a@google.com', sub: '1' }))).toBe('a@google.com');
  });

  it('비ASCII가 섞여도 깨지지 않는다(UTF-8 디코딩)', () => {
    expect(emailFromIdToken(tokenWith({ email: '호율@geurio.com' }))).toBe('호율@geurio.com');
  });

  it('email이 없거나 형식이 깨진 토큰은 null — 그러면 호출부는 막지 않고 그대로 교환한다', () => {
    expect(emailFromIdToken(tokenWith({ sub: '1' }))).toBeNull();
    expect(emailFromIdToken('not-a-jwt')).toBeNull();
    expect(emailFromIdToken('')).toBeNull();
    expect(emailFromIdToken('a.!!!not-base64!!!.c')).toBeNull();
  });
});
