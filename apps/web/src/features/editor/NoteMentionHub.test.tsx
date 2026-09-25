// `NoteMentionHub`의 계약 — 그룹 구성·고르기 규칙·키보드·달력 모드(스펙 4-3~4-5).
// 통합 테스트가 아니라 컴포넌트만 직접 렌더한다(`Segmented.test.tsx`와 같은 결).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { NoteMentionHub } from './components/NoteMentionHub';
import type { HubAnchor, HubPage, HubPerson, HubPick } from './components/NoteMentionHub';

afterEach(cleanup);

const TODAY = '2026-08-25'; // 화요일 — `noteDateQuery.test.ts`와 같은 고정값.
const ANCHOR: HubAnchor = { gx: 40, gy: 100, up: false, listH: 240 };

const PEOPLE: HubPerson[] = [
  { email: 'seoyeon@example.com', name: '김서연' },
  { email: 'dana@example.com', name: 'dana' },
  { email: 'jun@example.com', name: '박준' },
  { email: 'mira@example.com', name: '이미라' },
];
const PAGES: HubPage[] = [
  { id: 'pg1', title: '회의록 8월' },
  { id: 'pg2', title: '아이디어 노트' },
];

function setup(overrides: Partial<ComponentProps<typeof NoteMentionHub>> = {}) {
  const onPick = vi.fn<(pick: HubPick) => void>();
  const onClose = vi.fn();
  const utils = render(<NoteMentionHub anchor={ANCHOR} query="" today={TODAY} people={PEOPLE} pages={PAGES} onPick={onPick} onClose={onClose} {...overrides} />);
  return { onPick, onClose, ...utils };
}

describe('열림/닫힘', () => {
  it('anchor가 null이면 아무것도 그리지 않는다', () => {
    const { container } = render(<NoteMentionHub anchor={null} query="" today={TODAY} people={PEOPLE} pages={PAGES} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(container.querySelector('[data-note-hub]')).toBeNull();
  });

  it('바깥을 누르면 onClose, 판 안을 누르면 닫히지 않는다', () => {
    const { onClose } = setup();
    fireEvent.pointerDown(screen.getByText('멘션'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc로 닫힌다', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('헤더 라벨', () => {
  it('검색어가 비면 멘션, 있으면 @검색어', () => {
    const { rerender } = setup();
    expect(screen.getByText('멘션')).toBeTruthy();
    rerender(<NoteMentionHub anchor={ANCHOR} query="서연" today={TODAY} people={PEOPLE} pages={PAGES} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('@서연')).toBeTruthy();
  });

  it('dateOnly면 검색어와 무관하게 날짜 넣기', () => {
    setup({ query: '서연', dateOnly: true });
    expect(screen.getByText('날짜 넣기')).toBeTruthy();
  });
});

describe('사람 그룹', () => {
  it('검색어가 비면 앞 3명만', () => {
    setup();
    const personButtons = document.querySelectorAll('[data-hub-kind="person"]');
    expect(personButtons.length).toBe(3);
    expect(within(personButtons[0] as HTMLElement).getByText('김서연')).toBeTruthy();
  });

  it('검색어가 있으면 이름 포함으로 좁혀진다', () => {
    setup({ query: '박' }); // 이름에 '박'이 든 사람은 박준 하나뿐(이메일에는 아무도 없다).
    const personButtons = document.querySelectorAll('[data-hub-kind="person"]');
    expect(personButtons.length).toBe(1);
    expect(within(personButtons[0] as HTMLElement).getByText('박준')).toBeTruthy();
  });

  it('이메일 포함으로도 찾고, 매칭이 넘치면 4명에서 자른다', () => {
    const five: HubPerson[] = [
      ...PEOPLE,
      { email: 'extra@example.com', name: '최지우' }, // 이름에는 없지만 이메일 도메인이 겹친다.
    ];
    setup({ query: 'example.com', people: five }); // 다섯 모두 이메일에 포함 — 4명으로 잘려야 한다.
    expect(document.querySelectorAll('[data-hub-kind="person"]').length).toBe(4);
  });

  it('사람을 고르면 onPick({kind:"person", ...})', () => {
    const { onPick } = setup();
    const first = document.querySelector('[data-hub-kind="person"]') as HTMLElement;
    fireEvent.click(first);
    expect(onPick).toHaveBeenCalledWith({ kind: 'person', email: 'seoyeon@example.com', name: '김서연' });
  });
});

describe('날짜 그룹', () => {
  it('빈 검색어면 오늘·내일 + 다른 날짜 고르기 행(숫자/날/달 없어 wantsCalendarRow=true)', () => {
    setup();
    const dateButtons = document.querySelectorAll('[data-hub-kind="date"]');
    expect(dateButtons.length).toBe(2);
    expect(document.querySelector('[data-hub-kind="calendar"]')).toBeTruthy();
  });

  it('이름만 친 경우(금요일)에는 다른 날짜 고르기 행이 없다', () => {
    setup({ query: '금요일' });
    expect(document.querySelector('[data-hub-kind="calendar"]')).toBeNull();
  });

  it('날짜를 고르면 onPick({kind:"date", iso, label})', () => {
    const { onPick } = setup();
    const today = document.querySelector('[data-hub-kind="date"]') as HTMLElement;
    fireEvent.click(today);
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-25', label: '오늘' });
  });
});

describe('페이지 그룹', () => {
  it('검색어가 없으면 페이지 그룹이 없다', () => {
    setup();
    expect(document.querySelector('[data-hub-kind="page"]')).toBeNull();
  });

  it('검색어가 제목에 포함되면 최대 3개', () => {
    setup({ query: '노트' });
    const pageButtons = document.querySelectorAll('[data-hub-kind="page"]');
    expect(pageButtons.length).toBe(1);
    expect(within(pageButtons[0] as HTMLElement).getByText('아이디어 노트')).toBeTruthy();
  });
});

describe('dateOnly', () => {
  it('사람·페이지 그룹을 숨기고 달력이 함께 보인다', () => {
    setup({ dateOnly: true });
    expect(document.querySelector('[data-hub-kind="person"]')).toBeNull();
    expect(document.querySelector('[data-hub-kind="page"]')).toBeNull();
    expect(document.querySelectorAll('[data-hub-kind="date"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-hub-day]').length).toBe(42);
  });

  it('뒤로 가기 버튼이 없다', () => {
    setup({ dateOnly: true });
    expect(screen.queryByText('‹ 사람·날짜 목록으로')).toBeNull();
  });
});

describe('결과 없음', () => {
  it("맞는 것이 없으면 안내 문구", () => {
    setup({ query: 'zzz공백없는검색어' });
    expect(screen.getByText("'zzz공백없는검색어'와 맞는 사람·날짜·페이지가 없어요")).toBeTruthy();
  });
});

describe('키보드 — 목록', () => {
  it('ArrowDown/ArrowUp으로 활성 행이 옮겨가고 Enter로 고른다', () => {
    const { onPick } = setup();
    // 순서: 사람(3) → 날짜(오늘·내일·달력행)
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // index 3 = 첫 날짜(오늘)
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-25', label: '오늘' });
  });

  it('IME 조합 중 Enter는 무시한다', () => {
    const { onPick } = setup();
    fireEvent.keyDown(document, { key: 'Enter', isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ArrowLeft는 목록을 접는다(onClose)', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('달력 모드', () => {
  it('다른 날짜 고르기…를 고르면 목록이 숨고 달력만 보이며 뒤로 가기 버튼이 뜬다', () => {
    setup();
    const calRow = document.querySelector('[data-hub-kind="calendar"]') as HTMLElement;
    fireEvent.click(calRow);
    expect(document.querySelector('[data-hub-kind="person"]')).toBeNull();
    expect(screen.getByText('‹ 사람·날짜 목록으로')).toBeTruthy();
    expect(screen.getByText('2026년 8월')).toBeTruthy();
    expect(screen.getByText('8월 25일 화')).toBeTruthy();
  });

  it('뒤로 가기를 누르면 목록으로 돌아온다', () => {
    setup();
    fireEvent.click(document.querySelector('[data-hub-kind="calendar"]') as HTMLElement);
    fireEvent.click(screen.getByText('‹ 사람·날짜 목록으로'));
    expect(document.querySelector('[data-hub-kind="person"]')).toBeTruthy();
  });

  it('←→ ±1일, ↑↓ ±7일이고 그 달을 넘지 않는다', () => {
    setup();
    fireEvent.click(document.querySelector('[data-hub-kind="calendar"]') as HTMLElement);
    // 8/25 화 기준 +7 → 9월로 넘어가려 하지만(9/1) 8월 안에서 멈춰야 한다 → 8/31.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByText('8월 31일 월')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // 다시 +7 — 이미 말일이라 그대로.
    expect(screen.getByText('8월 31일 월')).toBeTruthy();
  });

  it('달력에서 Enter로 포커스한 날짜를 고른다', () => {
    const { onPick } = setup();
    fireEvent.click(document.querySelector('[data-hub-kind="calendar"]') as HTMLElement);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-26', label: '8월 26일 수' });
  });

  it('달력 칸을 클릭하면 바로 고른다', () => {
    const { onPick } = setup();
    fireEvent.click(document.querySelector('[data-hub-kind="calendar"]') as HTMLElement);
    const day27 = document.querySelector('[data-hub-day="2026-08-27"]') as HTMLElement;
    fireEvent.click(day27);
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-27', label: '8월 27일 목' });
  });
});

describe('dateOnly의 Enter 우선순위', () => {
  it('달력을 움직이지 않았으면 Enter는 목록의 고른 항목을 쓴다', () => {
    const { onPick } = setup({ dateOnly: true });
    // 목록 첫 항목(오늘)로 이미 커서가 있다 — 화살표로 목록을 한 번 움직여 확인.
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-25', label: '오늘' });
  });

  it('달력을 한 번이라도 움직였으면 Enter는 달력의 포커스 날짜를 쓴다', () => {
    const { onPick } = setup({ dateOnly: true });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'date', iso: '2026-08-26', label: '8월 26일 수' });
  });
});
