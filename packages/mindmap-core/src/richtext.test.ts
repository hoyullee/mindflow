import { describe, expect, it } from 'vitest';
import { applyPartialStyle, charsToRuns, isStyledRuns, runsToChars, stripRichStyle } from './richtext';
import type { RichRun } from './model';

describe('runsToChars / charsToRuns', () => {
  it('explodes a plain (no rich) source into one unstyled char per character', () => {
    const chars = runsToChars({ text: 'abc' });
    expect(chars).toEqual([
      { ch: 'a', b: false, c: null, i: false, s: false, href: null },
      { ch: 'b', b: false, c: null, i: false, s: false, href: null },
      { ch: 'c', b: false, c: null, i: false, s: false, href: null },
    ]);
  });

  it('explodes existing rich runs, carrying each run\'s style onto its own characters', () => {
    const rich: RichRun[] = [
      { t: 'ab', b: true, c: null },
      { t: 'cd', b: false, c: '#ff0000' },
    ];
    const chars = runsToChars({ text: 'abcd', rich });
    expect(chars).toEqual([
      { ch: 'a', b: true, c: null, i: false, s: false, href: null },
      { ch: 'b', b: true, c: null, i: false, s: false, href: null },
      { ch: 'c', b: false, c: '#ff0000', i: false, s: false, href: null },
      { ch: 'd', b: false, c: '#ff0000', i: false, s: false, href: null },
    ]);
  });

  it('an empty `rich` array is treated as absent (falls back to plain text)', () => {
    const chars = runsToChars({ text: 'x', rich: [] });
    expect(chars).toEqual([{ ch: 'x', b: false, c: null, i: false, s: false, href: null }]);
  });

  it('re-merges adjacent same-style characters back into runs', () => {
    const runs = charsToRuns([
      { ch: 'a', b: true, c: null },
      { ch: 'b', b: true, c: null },
      { ch: 'c', b: false, c: null },
    ]);
    expect(runs).toEqual([
      { t: 'ab', b: true, c: null },
      { t: 'c', b: false, c: null },
    ]);
  });

  it('does NOT merge characters whose color differs even when bold matches', () => {
    const runs = charsToRuns([
      { ch: 'a', b: false, c: '#111111' },
      { ch: 'b', b: false, c: '#222222' },
    ]);
    expect(runs).toEqual([
      { t: 'a', b: false, c: '#111111' },
      { t: 'b', b: false, c: '#222222' },
    ]);
  });
});

describe('applyPartialStyle', () => {
  it('bolds a plain-text partial selection, producing 3 runs (before/selected/after)', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 6, 11, 'b');
    expect(out.text).toBe('hello world');
    expect(out.rich).toEqual([
      { t: 'hello ', b: false, c: null },
      { t: 'world', b: true, c: null },
    ]);
  });

  it('bolding the WHOLE text collapses to a single bold run', () => {
    const out = applyPartialStyle({ text: 'hi' }, 0, 2, 'b');
    expect(out.rich).toEqual([{ t: 'hi', b: true, c: null }]);
  });

  it('re-bolding an already-fully-bold selection toggles it back OFF (un-bolds), matching `!seg.every(b)`', () => {
    const bolded = applyPartialStyle({ text: 'hello world' }, 6, 11, 'b');
    const unbolded = applyPartialStyle({ text: bolded.text, rich: bolded.rich }, 6, 11, 'b');
    // back to plain — no styled runs left at all
    expect(unbolded.rich).toBeNull();
  });

  it('a MIXED bold/non-bold selection first turns fully bold (not toggled off)', () => {
    // "AB" bold, "CD" not — selecting all 4 chars and toggling bold should make
    // everything bold (mixed selections always turn ON first), not turn AB off.
    const rich: RichRun[] = [
      { t: 'AB', b: true, c: null },
      { t: 'CD', b: false, c: null },
    ];
    const out = applyPartialStyle({ text: 'ABCD', rich }, 0, 4, 'b');
    expect(out.rich).toEqual([{ t: 'ABCD', b: true, c: null }]);
  });

  it('applies a color to a partial selection', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 0, 5, 'c', '#3f8fd0');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: '#3f8fd0' },
      { t: ' world', b: false, c: null },
    ]);
  });

  it('clear removes bold+color from the selected range only', () => {
    const rich: RichRun[] = [{ t: 'hello world', b: true, c: '#3f8fd0' }];
    const out = applyPartialStyle({ text: 'hello world', rich }, 0, 5, 'clear');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: null },
      { t: ' world', b: true, c: '#3f8fd0' },
    ]);
  });

  it('clearing every styled character drops back to plain (rich: null)', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    const out = applyPartialStyle({ text: 'hi', rich }, 0, 2, 'clear');
    expect(out.rich).toBeNull();
    expect(out.text).toBe('hi');
  });

  it('a collapsed selection (s0 === s1) is a no-op', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    const out = applyPartialStyle({ text: 'hi', rich }, 1, 1, 'b');
    expect(out).toEqual({ text: 'hi', rich });
  });

  it('a reversed range (s1 < s0) is normalized before applying', () => {
    const out = applyPartialStyle({ text: 'hello world' }, 5, 0, 'c', '#000000');
    expect(out.rich).toEqual([
      { t: 'hello', b: false, c: '#000000' },
      { t: ' world', b: false, c: null },
    ]);
  });

  it('clamps an out-of-range end offset to the text length', () => {
    const out = applyPartialStyle({ text: 'hi' }, 0, 999, 'b');
    expect(out.rich).toEqual([{ t: 'hi', b: true, c: null }]);
  });

  it('an empty `rich` array on the source normalizes to null when the result is unstyled', () => {
    // clear on a plain source with rich: [] (edge case) should still just no-op cleanly
    const out = applyPartialStyle({ text: 'hi', rich: [] }, 0, 0, 'clear');
    expect(out).toEqual({ text: 'hi', rich: null });
  });
});

describe('stripRichStyle', () => {
  it('removes bold from every run, dropping to null if nothing else is styled', () => {
    const rich: RichRun[] = [{ t: 'hi', b: true, c: null }];
    expect(stripRichStyle(rich, 'b')).toBeNull();
  });

  it('removes bold from every run (even non-bold ones), keeping color-only runs styled', () => {
    const rich: RichRun[] = [
      { t: 'a', b: true, c: '#111111' },
      { t: 'b', b: false, c: null },
    ];
    expect(stripRichStyle(rich, 'b')).toEqual([{ t: 'a', c: '#111111' }, { t: 'b', c: null }]);
  });

  it('is a no-op on a null/undefined rich', () => {
    expect(stripRichStyle(null, 'b')).toBeNull();
    expect(stripRichStyle(undefined, 'c')).toBeNull();
  });
});

// ── 마크다운 서식 확장(post-dc): 기울임(i)·취소선(s) + 단축 문법 ────────────

import { applyMarkdownShortcuts } from './richtext';

describe('applyPartialStyle — 기울임/취소선 토글', () => {
  it('기울임을 켜고(혼합→전체), 전부 기울임이면 끈다 (굵게와 같은 규칙)', () => {
    const on = applyPartialStyle({ text: 'abcd' }, 0, 2, 'i');
    expect(on.rich).toEqual([
      { t: 'ab', b: false, c: null, i: true },
      { t: 'cd', b: false, c: null },
    ]);
    const off = applyPartialStyle({ text: on.text, rich: on.rich }, 0, 2, 'i');
    expect(off.rich).toBeNull(); // 전부 해제 → plain
  });

  it('취소선은 굵게·색과 독립적으로 겹친다', () => {
    const bold = applyPartialStyle({ text: 'abcd' }, 0, 4, 'b');
    const both = applyPartialStyle({ text: bold.text, rich: bold.rich }, 1, 3, 's');
    expect(both.rich).toEqual([
      { t: 'a', b: true, c: null },
      { t: 'bc', b: true, c: null, s: true },
      { t: 'd', b: true, c: null },
    ]);
  });

  it("'clear'는 기울임·취소선까지 벗긴다", () => {
    const styled = applyPartialStyle(applyPartialStyle({ text: 'ab' }, 0, 2, 'i'), 0, 2, 's');
    const cleared = applyPartialStyle({ text: styled.text, rich: styled.rich }, 0, 2, 'clear');
    expect(cleared.rich).toBeNull();
  });

  it('stripRichStyle이 i/s 키도 벗긴다', () => {
    const rich: RichRun[] = [{ t: 'ab', b: false, c: null, i: true }];
    expect(stripRichStyle(rich, 'i')).toBeNull();
    const both: RichRun[] = [{ t: 'ab', b: true, c: null, s: true }];
    expect(stripRichStyle(both, 's')).toEqual([{ t: 'ab', b: true, c: null }]);
  });
});

describe('applyMarkdownShortcuts', () => {
  it('**굵게** / *기울임* / ~~취소선~~ 마커를 제거하고 서식으로 바꾼다', () => {
    const out = applyMarkdownShortcuts({ text: '이건 **굵게** 그리고 *기울임* 또 ~~취소~~' });
    expect(out).not.toBeNull();
    expect(out!.text).toBe('이건 굵게 그리고 기울임 또 취소');
    expect(out!.rich).toEqual([
      { t: '이건 ', b: false, c: null },
      { t: '굵게', b: true, c: null },
      { t: ' 그리고 ', b: false, c: null },
      { t: '기울임', b: false, c: null, i: true },
      { t: ' 또 ', b: false, c: null },
      { t: '취소', b: false, c: null, s: true },
    ]);
  });

  it('__굵게__ / _기울임_ 변형도 지원한다', () => {
    const out = applyMarkdownShortcuts({ text: '__강조__ _살짝_' });
    expect(out!.text).toBe('강조 살짝');
    expect(out!.rich).toEqual([
      { t: '강조', b: true, c: null },
      { t: ' ', b: false, c: null },
      { t: '살짝', b: false, c: null, i: true },
    ]);
  });

  it('단어 내부 밑줄(snake_case)은 건드리지 않는다 — 뒤의 유효한 매치는 여전히 잡는다', () => {
    const out = applyMarkdownShortcuts({ text: 'my_var_name 그리고 _진짜_' });
    expect(out!.text).toBe('my_var_name 그리고 진짜');
    expect(out!.rich).toEqual([
      { t: 'my_var_name 그리고 ', b: false, c: null },
      { t: '진짜', b: false, c: null, i: true },
    ]);
  });

  it('짝이 없는 마커·마크다운 없음 → null (원본 그대로 커밋)', () => {
    expect(applyMarkdownShortcuts({ text: '2*3=6 그리고 a**b' })).toBeNull();
    expect(applyMarkdownShortcuts({ text: '평범한 텍스트' })).toBeNull();
  });

  it('기존 부분 색상 위에 겹쳐도 색이 보존된다', () => {
    const colored = applyPartialStyle({ text: '**빨강** 텍스트' }, 2, 4, 'c', '#d92626');
    const out = applyMarkdownShortcuts({ text: colored.text, rich: colored.rich });
    expect(out!.text).toBe('빨강 텍스트');
    expect(out!.rich).toEqual([{ t: '빨강', b: true, c: '#d92626' }, { t: ' 텍스트', b: false, c: null }]);
  });

  it('마커가 줄을 걸치면 발동하지 않는다', () => {
    expect(applyMarkdownShortcuts({ text: '*줄\n걸침*' })).toBeNull();
  });
});

describe('applyPartialStyle — 하이퍼링크', () => {
  it('선택 범위에만 href를 건다', () => {
    const out = applyPartialStyle({ text: '문서 보기' }, 0, 2, 'link', 'https://example.com/');
    expect(out.rich).toEqual([
      { t: '문서', b: false, c: null, href: 'https://example.com/' },
      { t: ' 보기', b: false, c: null },
    ]);
  });

  it('링크만 걸린 런도 rich로 남는다 (평문으로 접히면 링크가 사라진다)', () => {
    const out = applyPartialStyle({ text: 'abc' }, 0, 3, 'link', 'https://a.com/');
    expect(out.rich).not.toBeNull();
    expect(isStyledRuns(out.rich)).toBe(true);
  });

  it('null을 주면 링크를 뗀다', () => {
    const linked = applyPartialStyle({ text: 'abc' }, 0, 3, 'link', 'https://a.com/');
    const off = applyPartialStyle({ text: linked.text, rich: linked.rich }, 0, 3, 'link', null);
    expect(off.rich).toBeNull(); // 다른 서식이 없으면 평문으로
  });

  it('지우기는 링크도 함께 뗀다', () => {
    const linked = applyPartialStyle({ text: 'abc' }, 0, 3, 'link', 'https://a.com/');
    const cleared = applyPartialStyle({ text: linked.text, rich: linked.rich }, 0, 3, 'clear');
    expect(cleared.rich).toBeNull();
  });

  it('굵게와 링크는 같은 글자에 공존한다', () => {
    const linked = applyPartialStyle({ text: 'abc' }, 0, 3, 'link', 'https://a.com/');
    const bolded = applyPartialStyle({ text: linked.text, rich: linked.rich }, 0, 3, 'b');
    expect(bolded.rich).toEqual([{ t: 'abc', b: true, c: null, href: 'https://a.com/' }]);
  });

  it('href가 다르면 런이 합쳐지지 않는다', () => {
    const a = applyPartialStyle({ text: 'ab' }, 0, 1, 'link', 'https://a.com/');
    const b = applyPartialStyle({ text: a.text, rich: a.rich }, 1, 2, 'link', 'https://b.com/');
    expect(b.rich).toHaveLength(2);
  });
});
