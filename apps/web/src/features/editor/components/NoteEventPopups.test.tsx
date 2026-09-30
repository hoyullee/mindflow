// 공책 안의 일정 팝업 — **받아 오는 동안의 판**(요청: 일정 칩·일정 블록의 일정을 누르면 팝업이
// 뜨기까지 틈이 있다 — 그 사이에 로딩 애니메이션을).
//
// 틈은 조회 자체다(팝업이 열릴 때 비로소 그 달의 일정을 받는다) — 그래서 조회를 가짜로 바꿔
// 끼워 "아직 오는 중"과 "다 왔는데 없다"를 따로 세운다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NoteEventPopups } from './NoteEventPopups';
import { THEMES } from '../theme';

const agenda = { loading: true, events: { events: [] as unknown[], loading: true }, google: { events: [] as unknown[], writableCalendars: [] as unknown[], eventColors: {}, calendarDefaults: {} } };
vi.mock('../noteAgenda', () => ({ useNoteAgenda: () => agenda }));

afterEach(cleanup);

describe('NoteEventPopups — 받아 오는 동안의 스피너', () => {
  it('그리오 일정 — 목록이 오는 중이면 **스피너 카드**가 선다(예전에는 아무것도 그리지 않았다)', () => {
    agenda.loading = true;
    const onClose = vi.fn();
    render(<NoteEventPopups open={{ kind: 'geurio', id: 'e1', at: '2026-10-01' }} isMobile={false} theme={THEMES.coral} onClose={onClose} />);
    const card = document.querySelector('[data-note-event-loading]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('일정을 불러오는 중');
    // 도는 것이 보여야 한다 — 스피너는 회전 애니메이션을 단다.
    expect((card.querySelector('[aria-hidden="true"]') as HTMLElement).style.animation).toContain('mf-spin');
    // 기다리다 그만둘 수 있다 — Esc는 여는 것 자체를 거둔다.
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('구글 일정도 같다 — 그 달의 구글 일정이 아직이면 스피너', () => {
    agenda.loading = true;
    render(<NoteEventPopups open={{ kind: 'google', id: 'g1', at: '2026-10-01' }} isMobile={false} theme={THEMES.coral} onClose={() => {}} />);
    expect(document.querySelector('[data-note-event-loading]')).toBeTruthy();
  });

  it('다 받았는데 그 일정이 없으면(지워졌다) 스피너도 상세도 없다 — 없는 것을 세우지 않는다', () => {
    agenda.loading = false;
    render(<NoteEventPopups open={{ kind: 'geurio', id: 'gone', at: '2026-10-01' }} isMobile={false} theme={THEMES.coral} onClose={() => {}} />);
    expect(document.querySelector('[data-note-event-loading]')).toBeNull();
    expect(document.querySelector('[data-event-detail]')).toBeNull();
  });
});
