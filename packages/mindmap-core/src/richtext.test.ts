import { describe, expect, it } from 'vitest';
import { applyAutoLinks, applyPartialStyle, charsToRuns, isStyledRuns, runsToChars, stripRichStyle, applyMarkdownLinks, richToMarkdown } from './richtext';
import type { RichRun } from './model';

describe('runsToChars / charsToRuns', () => {
  it('explodes a plain (no rich) source into one unstyled char per character', () => {
    const chars = runsToChars({ text: 'abc' });
    expect(chars).toEqual([
      { ch: 'a', b: false, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
      { ch: 'b', b: false, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
      { ch: 'c', b: false, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
    ]);
  });

  it('explodes existing rich runs, carrying each run\'s style onto its own characters', () => {
    const rich: RichRun[] = [
      { t: 'ab', b: true, c: null },
      { t: 'cd', b: false, c: '#ff0000' },
    ];
    const chars = runsToChars({ text: 'abcd', rich });
    expect(chars).toEqual([
      { ch: 'a', b: true, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
      { ch: 'b', b: true, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
      { ch: 'c', b: false, c: '#ff0000', i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
      { ch: 'd', b: false, c: '#ff0000', i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null },
    ]);
  });

  it('an empty `rich` array is treated as absent (falls back to plain text)', () => {
    const chars = runsToChars({ text: 'x', rich: [] });
    expect(chars).toEqual([{ ch: 'x', b: false, c: null, i: false, s: false, href: null, m: null, u: false, k: false, hl: null, dt: null, pg: null }]);
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

describe('applyAutoLinks — 타이핑한 URL을 커밋 시 링크로', () => {
  it('URL 구간에만 href를 건다', () => {
    const out = applyAutoLinks({ text: '문서 https://example.com/a 참고' })!;
    expect(out.rich).toEqual([
      { t: '문서 ', b: false, c: null },
      { t: 'https://example.com/a', b: false, c: null, href: 'https://example.com/a' },
      { t: ' 참고', b: false, c: null },
    ]);
  });

  it('링크가 없으면 null (호출부가 원본을 그대로 쓴다)', () => {
    expect(applyAutoLinks({ text: '그냥 텍스트' })).toBeNull();
  });

  it('손으로 건 링크는 덮지 않는다', () => {
    const manual = applyPartialStyle({ text: 'https://example.com/a' }, 0, 21, 'link', 'https://other.com/');
    const out = applyAutoLinks({ text: manual.text, rich: manual.rich });
    expect(out).toBeNull();
  });

  it('굵게 등 다른 서식은 보존한다', () => {
    const bold = applyPartialStyle({ text: '보기 https://a.com' }, 0, 2, 'b');
    const out = applyAutoLinks({ text: bold.text, rich: bold.rich })!;
    expect(out.rich?.[0]).toEqual({ t: '보기', b: true, c: null });
    expect(out.rich?.[out.rich.length - 1]?.href).toBe('https://a.com/');
  });
});

describe('applyMarkdownLinks — `[텍스트](주소)` 되읽기', () => {
  it('마커를 걷어내고 그 구간에만 링크를 건다', () => {
    const r = applyMarkdownLinks({ text: '자세한 건 [문서](https://ex.com/a)를 보세요' });
    expect(r).not.toBeNull();
    expect(r!.text).toBe('자세한 건 문서를 보세요');
    const linked = (r!.rich || []).filter((x) => x.href);
    expect(linked.map((x) => x.t)).toEqual(['문서']);
    expect(linked[0]!.href).toBe('https://ex.com/a');
  });

  it('한 줄에 여럿도 모두 건다', () => {
    const r = applyMarkdownLinks({ text: '[A](https://a.com) 그리고 [B](https://b.com)' });
    expect(r!.text).toBe('A 그리고 B');
    expect((r!.rich || []).filter((x) => x.href).map((x) => [x.t, x.href])).toEqual([
      ['A', 'https://a.com/'],
      ['B', 'https://b.com/'],
    ]);
  });

  it('허용 스킴 밖의 주소는 문법 그대로 두고, 뒤의 멀쩡한 링크는 계속 건다', () => {
    const r = applyMarkdownLinks({ text: '[나쁨](javascript:alert(1)) [좋음](https://ok.com)' });
    expect(r!.text).toContain('[나쁨](javascript:alert(1))');
    expect(r!.text).toContain('좋음');
    expect((r!.rich || []).filter((x) => x.href).map((x) => x.t)).toEqual(['좋음']);
  });

  it('링크가 없으면 null (건드리지 않는다)', () => {
    expect(applyMarkdownLinks({ text: '평범한 글자' })).toBeNull();
  });

  it('richToMarkdown과 왕복한다', () => {
    const src = { text: '문서 보기', rich: [{ t: '문서 보기', b: false, c: null, href: 'https://ex.com/' }] };
    const md = richToMarkdown(src);
    expect(md).toBe('[문서 보기](https://ex.com/)');
    const back = applyMarkdownLinks({ text: md });
    expect(back!.text).toBe('문서 보기');
    expect((back!.rich || [])[0]?.href).toBe('https://ex.com/');
  });
});

describe('richToMarkdown — 자동 링크는 부풀리지 않는다', () => {
  it('글자 자체가 주소면 맨 URL로 남는다(다시 편집할 때 원문이 그대로 보이게)', () => {
    // 픽스처를 손으로 적지 않고 **실제 자동 링크 결과**로 만든다 — href 정규화
    // (스킴 보정·끝 슬래시)가 바뀌어도 테스트가 현실과 어긋나지 않게.
    for (const raw of ['https://ex.com/a', 'www.ex.com', 'a@b.com']) {
      const linked = applyAutoLinks({ text: raw, rich: null });
      expect(linked).not.toBeNull();
      expect(richToMarkdown(linked!)).toBe(raw);
    }
  });

  it('글자와 주소가 다르면 `[텍스트](주소)` 그대로', () => {
    expect(richToMarkdown({ text: '문서', rich: [{ t: '문서', b: false, c: null, href: 'https://ex.com/a' }] })).toBe('[문서](https://ex.com/a)');
  });
});

describe('인라인 코드는 다른 글자 서식을 걷어낸다(요청)', () => {
  const src = { text: '코드', rich: [{ t: '코드', b: true, c: '#f00', i: true, s: true, u: true }] };

  it('켜면 굵게·기울임·취소선·밑줄이 사라진다 — 색은 남는다', () => {
    const out = applyPartialStyle(src, 0, 2, 'k');
    const r = out.rich![0]!;
    expect(r.k).toBe(true);
    expect(r.b).toBeFalsy();
    expect(r.i).toBeFalsy();
    expect(r.s).toBeFalsy();
    expect(r.u).toBeFalsy();
    // 색은 문법 강조처럼 쓰는 사람이 있어 건드리지 않는다.
    expect(r.c).toBe('#f00');
  });

  it('끌 때는 아무것도 건드리지 않는다', () => {
    const coded = applyPartialStyle(src, 0, 2, 'k');
    const off = applyPartialStyle({ text: coded.text, rich: coded.rich }, 0, 2, 'k');
    const r = off.rich?.[0];
    expect(r?.k).toBeFalsy();
    // 켤 때 이미 걷어냈으므로 되살아나지는 않는다 — 다만 끄기가 새로 지우지도 않는다.
    expect(r?.c).toBe('#f00');
  });
});

describe('공책의 인라인 칩 — 날짜(dt)와 페이지 링크(pg)', () => {
  it('**평문으로 접히지 않는다** — 칩만 걸린 런도 서식으로 센다', () => {
    // 이 판정이 빠지면 칩만 있는 런이 `rich: null`로 접혀 조용히 사라진다
    // (링크에서 실제로 겪은 사고 — `isStyledRuns` 머리말).
    expect(isStyledRuns([{ t: '8월 27일 목', b: false, c: null, dt: '2026-08-27' }])).toBe(true);
    expect(isStyledRuns([{ t: '2쪽', b: false, c: null, pg: 'doc1:p2' }])).toBe(true);
  });

  it('가리키는 날이 다르면 **한 런으로 합치지 않는다**', () => {
    const runs = charsToRuns([
      { ch: 'a', b: false, c: null, dt: '2026-08-27' },
      { ch: 'b', b: false, c: null, dt: '2026-08-28' },
    ]);
    expect(runs).toEqual([
      { t: 'a', b: false, c: null, dt: '2026-08-27' },
      { t: 'b', b: false, c: null, dt: '2026-08-28' },
    ]);
  });

  it('글자 단위로 펴고 다시 합쳐도 칩이 그대로다(왕복)', () => {
    const rich: RichRun[] = [
      { t: '회의는 ', b: false, c: null },
      { t: '8월 27일 목', b: false, c: null, dt: '2026-08-27' },
      { t: '입니다', b: false, c: null },
    ];
    const back = charsToRuns(runsToChars({ text: '회의는 8월 27일 목입니다', rich }));
    expect(back).toEqual(rich);
  });

  it('굵게를 걸어도 칩의 뜻은 남는다 — 서식과 뜻은 다른 칸이다', () => {
    const out = applyPartialStyle({ text: '8월 27일', rich: [{ t: '8월 27일', b: false, c: null, dt: '2026-08-27' }] }, 0, 6, 'b');
    expect(out.rich?.[0]).toMatchObject({ b: true, dt: '2026-08-27' });
  });

  it('**서식 지우기는 뜻만 걷고 글자는 남긴다** — 멘션과 같은 규칙', () => {
    const out = applyPartialStyle({ text: '8월 27일', rich: [{ t: '8월 27일', b: true, c: null, dt: '2026-08-27' }] }, 0, 6, 'clear');
    expect(out.text).toBe('8월 27일');
    expect(out.rich).toBeNull();
  });

  it('칩이 걸린 구간에는 **자동 링크가 덧걸리지 않는다**', () => {
    // `8.27`처럼 생긴 칩 글자가 주소로 읽히면 칩 하나에 두 뜻이 얹힌다.
    const src = { text: 'a geurio.com b', rich: [{ t: 'a geurio.com b', b: false, c: null, dt: '2026-08-27' }] };
    expect(applyAutoLinks(src)).toBeNull();
  });

  it('`stripRichStyle`로 칩만 걷을 수 있다', () => {
    expect(stripRichStyle([{ t: 'x', b: false, c: null, dt: '2026-08-27' }], 'dt')).toBeNull();
    expect(stripRichStyle([{ t: 'x', b: true, c: null, pg: 'd:p' }], 'pg')).toEqual([{ t: 'x', b: true, c: null }]);
  });
});
