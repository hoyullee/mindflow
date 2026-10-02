// 공책 본문의 **화살표 자동 바꿈**(요청) — `->` → `→` · `<-` → `←` · `<->`(곧 `←>`) → `↔`.
//
// 친 직후에 캐럿 바로 앞 글자들만 본다(붙여넣은 글·이미 있던 글은 건드리지 않는다).
// 코드 블록·인라인 코드에서는 바꾸지 않는다 — `a->b`·`x <- y`는 코드의 글자다(호출부가 거른다).

const RULES: { from: string; to: string }[] = [
  // 긴 것부터 — `←` 뒤의 `>`는 양쪽 화살표다(`<-`가 먼저 `←`가 된 뒤에 `>`가 온다).
  { from: '←>', to: '↔' },
  { from: '->', to: '→' },
  { from: '<-', to: '←' },
];

/** 캐럿(`offset`) 바로 앞이 바꿀 짝이면 그 자리와 바꿀 글자 — 없으면 `null`. */
export function arrowAt(text: string, offset: number): { start: number; len: number; to: string } | null {
  for (const r of RULES) {
    const start = offset - r.from.length;
    if (start >= 0 && text.slice(start, offset) === r.from) return { start, len: r.from.length, to: r.to };
  }
  return null;
}
