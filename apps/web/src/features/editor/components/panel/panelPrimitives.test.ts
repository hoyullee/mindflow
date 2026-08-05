import { describe, expect, it } from 'vitest';
import { panelTitleLine } from './panelPrimitives';

// 속성 패널의 제목("선택한 주제" 아래 이름)은 대상을 가리키는 **이름**이다.
// 제목 줄은 nowrap이라 줄바꿈이 공백으로 접혀, 여러 줄 도형을 고르면 내용 전체가
// 한 줄로 나열됐다(제보). 첫 줄만 쓴다.
describe('panelTitleLine', () => {
  it('한 줄이면 그대로', () => {
    expect(panelTitleLine('리서치')).toBe('리서치');
  });

  it('여러 줄이면 첫 줄만', () => {
    expect(panelTitleLine('결정 사항\n- 일정 확정\n- 담당자 배정')).toBe('결정 사항');
  });

  it('첫 줄이 비어 있으면 다음 비지 않은 줄 (빈 제목보다 낫다)', () => {
    expect(panelTitleLine('\n\n앞이 빈 줄로 시작')).toBe('앞이 빈 줄로 시작');
    expect(panelTitleLine('   \n실제 제목')).toBe('실제 제목');
  });

  it('양끝 공백은 다듬고, 내용이 없으면 빈 문자열', () => {
    expect(panelTitleLine('  여백 있는 제목  \n둘째')).toBe('여백 있는 제목');
    expect(panelTitleLine('')).toBe('');
    expect(panelTitleLine('\n \n\t')).toBe('');
  });
});
