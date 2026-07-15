// A peer's presence identity (name + color) when nobody's actually logged in
// (local/demo mode, or Supabase mode before the session check resolves) —
// "형용사 + 동물" per CLAUDE.md's task brief, e.g. "차분한 수달". Deterministic
// given a seed (so re-renders/reconnects of the SAME client don't reroll a
// new identity out from under the user mid-session — `usePresence.ts` seeds
// this with the Yjs `Awareness#clientID`, which is stable for the lifetime of
// one tab's connection), but otherwise looks random across tabs/clients.

const ADJECTIVES = ['차분한', '용감한', '반짝이는', '느긋한', '기민한', '포근한', '엉뚱한', '똑똑한', '든든한', '활발한', '조용한', '유쾌한'];
const ANIMALS = ['수달', '여우', '펭귄', '다람쥐', '고래', '토끼', '부엉이', '너구리', '고양이', '판다', '앵무새', '고슴도치'];

// A small, readable-on-both-light-and-dark palette — avoids near-white/near-black
// picks that would vanish against the editor's own light/dark themes.
const COLORS = ['#e0663f', '#3fae9e', '#3f8fd0', '#8a6bd1', '#e0b23c', '#4caf6e', '#e05f8f', '#5f9ea0', '#c0532e', '#6a5acd'];

/** A small, fast (non-cryptographic) string hash — good enough to pick a
 * stable index into a fixed-size palette/word list from an arbitrary seed
 * (a `clientID` number, or an email string). */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForSeed(seed: string): string {
  return COLORS[hashSeed(seed) % COLORS.length]!;
}

/** Random-looking (but seed-stable) "adjective + animal" display name, e.g. "차분한 수달". */
export function nameForSeed(seed: string): string {
  const h = hashSeed(seed);
  const adjective = ADJECTIVES[h % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length]!;
  return `${adjective} ${animal}`;
}
