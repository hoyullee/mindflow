import { describe, expect, it } from 'vitest';
import { MENTION_TONES, dateChipLabel, mentionInitial, mentionName, mentionTone } from './mentionChip';

describe('인라인 칩의 표시 규칙', () => {
  it('같은 이메일이면 **언제나 같은 색**이다 — 대소문자·공백은 무시한다', () => {
    const a = mentionTone('Seoyeon@Example.com');
    expect(mentionTone(' seoyeon@example.com ')).toBe(a);
    expect(MENTION_TONES).toContain(a);
  });

  it('서로 다른 사람은 색이 갈린다(여덟 벌 안에서)', () => {
    const tones = new Set(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'].map(mentionTone));
    expect(tones.size).toBeGreaterThan(1);
  });

  it('머리글자는 **한 글자**다 — 홈 아바타가 두 글자를 줘도 칩은 첫 글자만 쓴다', () => {
    expect(mentionInitial('@김서연')).toBe('서');
    expect(mentionInitial('이호율')).toBe('호');
    expect(mentionInitial('dana')).toBe('D');
  });

  it('빈 값에도 글자가 하나는 나온다 — 빈 원이 그려지지 않게', () => {
    expect(mentionInitial('')).toBe('M');
  });

  it('칩에 보일 이름은 `@`를 뗀 것이다', () => {
    expect(mentionName('@김서연')).toBe('김서연');
    expect(mentionName('김서연')).toBe('김서연');
  });
});

describe('날짜 칩의 글자', () => {
  it('`{M}월 {D}일 {요일}` — 한 달 뒤에 읽어도 같은 날을 가리킨다', () => {
    expect(dateChipLabel('2026-08-27')).toBe('8월 27일 목');
    expect(dateChipLabel('2026-01-01')).toBe('1월 1일 목');
  });
  it('망가진 값은 그대로 돌려준다 — 칩이 빈칸으로 보이지 않게', () => {
    expect(dateChipLabel('nope')).toBe('nope');
  });
});
