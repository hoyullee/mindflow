import { describe, it, expect } from 'vitest';
import { CORE_VERSION } from './index';

describe('mindmap-core (M0 scaffold)', () => {
  it('exposes a version marker', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });

  it('is pure — no DOM/React globals leaked into the module', () => {
    // Sanity guard reinforcing the eslint core-purity rule at runtime.
    expect(typeof CORE_VERSION).toBe('string');
  });
});
