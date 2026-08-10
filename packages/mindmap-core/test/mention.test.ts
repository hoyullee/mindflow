// 인라인 멘션(RichRun.m) — 삽입·병합 경계·직렬화 통과.
import { describe, expect, it } from 'vitest';
import { insertMention, mentionEmails, runsToChars, charsToRuns, isStyledRuns, applyPartialStyle } from '../src/richtext';

describe('insertMention', () => {
  it('@토큰을 "@이름 "으로 갈아 끼우고 멘션 런을 심는다 (뒤 공백은 평문)', () => {
    const out = insertMention({ text: '검토 @fr 부탁', rich: null }, 3, 6, 'friend', 'friend@example.com');
    expect(out.text).toBe('검토 @friend  부탁');
    expect(out.rich).toEqual([
      { t: '검토 ', b: false, c: null },
      { t: '@friend', b: false, c: null, m: 'friend@example.com' },
      { t: '  부탁', b: false, c: null },
    ]);
    expect(out.caret).toBe(3 + '@friend'.length + 1);
  });

  it('기존 서식을 보존한다 — 굵은 글자 뒤에 삽입해도 굵기가 유지된다', () => {
    const out = insertMention({ text: '굵게 @x', rich: [{ t: '굵게', b: true, c: null }, { t: ' @x', b: false, c: null }] }, 3, 5, 'kim', 'kim@x.io');
    expect(out.rich?.[0]).toEqual({ t: '굵게', b: true, c: null });
    expect(out.rich?.find((r) => r.m)).toEqual({ t: '@kim', b: false, c: null, m: 'kim@x.io' });
  });

  it('mentionEmails가 중복 없이 소문자로 모은다', () => {
    const out = insertMention({ text: '@a @b', rich: [{ t: '@a', b: false, c: null, m: 'A@x.io' }, { t: ' @b', b: false, c: null }] }, 3, 5, 'b', 'b@x.io');
    expect(mentionEmails(out.rich).sort()).toEqual(['a@x.io', 'b@x.io']);
  });

  it('멘션 런은 스타일드로 판정되고(clear가 떼면 평문으로), 이웃 평문과 합쳐지지 않는다', () => {
    const rich = [{ t: '@kim', b: false, c: null, m: 'kim@x.io' }, { t: ' 확인', b: false, c: null }];
    expect(isStyledRuns(rich)).toBe(true);
    const chars = runsToChars({ text: '@kim 확인', rich });
    expect(charsToRuns(chars)).toEqual(rich);
    const cleared = applyPartialStyle({ text: '@kim 확인', rich }, 0, 4, 'clear');
    expect(cleared.rich).toBeNull();
  });
});
