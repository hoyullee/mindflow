import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNoncePair } from './googleIdentity';

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
