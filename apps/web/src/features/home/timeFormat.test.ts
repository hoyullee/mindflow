import { describe, expect, it } from 'vitest';
import { formatFullDateTime, formatLastEdited } from './timeFormat';

// 기준 시각 고정: 2026-07-23 15:00 (로컬)
const NOW = new Date(2026, 6, 23, 15, 0, 0);
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

describe('formatLastEdited — 상대(7일 이내)/절대 혼합 표기', () => {
  it('1분 미만 → 방금 전 (정확히 1분부터는 1분 전)', () => {
    expect(formatLastEdited(new Date(2026, 6, 23, 14, 59, 30).toISOString(), NOW)).toBe('방금 전');
    expect(formatLastEdited(at(2026, 7, 23, 14, 59), NOW)).toBe('1분 전');
  });
  it('분/시간/일 단위 상대 표기', () => {
    expect(formatLastEdited(at(2026, 7, 23, 14, 35), NOW)).toBe('25분 전');
    expect(formatLastEdited(at(2026, 7, 23, 12, 0), NOW)).toBe('3시간 전');
    expect(formatLastEdited(at(2026, 7, 21, 15, 0), NOW)).toBe('2일 전');
  });
  it('7일 이상, 같은 해 → "M월 D일"', () => {
    expect(formatLastEdited(at(2026, 7, 10), NOW)).toBe('7월 10일');
  });
  it('다른 해 → "YYYY. M. D."', () => {
    expect(formatLastEdited(at(2025, 12, 30), NOW)).toBe('2025. 12. 30.');
  });
  it('값 없음/epoch(메타 없던 옛 문서)/깨진 값 → 빈 문자열 (줄 생략)', () => {
    expect(formatLastEdited(undefined, NOW)).toBe('');
    expect(formatLastEdited(new Date(0).toISOString(), NOW)).toBe('');
    expect(formatLastEdited('not-a-date', NOW)).toBe('');
  });
  it('미래 시각(기기 시계 왜곡)도 방금 전으로 관대하게', () => {
    expect(formatLastEdited(new Date(2026, 6, 23, 15, 5, 0).toISOString(), NOW)).toBe('방금 전');
  });
});

describe('formatFullDateTime — 툴팁용 전체 일시', () => {
  it('YYYY. M. D. HH:mm', () => {
    expect(formatFullDateTime(at(2026, 7, 23, 9, 5))).toBe('2026. 7. 23. 09:05');
  });
  it('값 없음 → 빈 문자열', () => {
    expect(formatFullDateTime(undefined)).toBe('');
  });
});
