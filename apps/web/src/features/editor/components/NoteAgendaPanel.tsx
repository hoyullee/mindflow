// 공책의 우측 **「일정」 탭**(스펙 5절) — 미니 달력 + 고른 날의 일정 + 24시간 시간표.
//
// 내용은 **일정 화면 오른쪽 사이드바와 같은 부품**(`CalendarSide`)이다. 스펙이 그렇게
// 적었고, 실제로도 두 벌을 두면 한쪽에만 고침이 들어간다(홈의 `+`·시간표 겹침 배치가
// 그 부품 안에 있다).
//
// ## 스펙과 달리 간 한 군데 — 선택한 날짜
//
// 5절은 "일정 페이지와 **같은 상태를 공유**한다"고 적었지만, 그 값(`state.calDay`)은 홈
// 컨트롤러의 **메모리 상태**라 라우트가 다른 에디터에서는 닿지 않는다(저장소에도 없다).
// 옮기려면 홈의 상태 묶음을 걷어내야 해서, 여기서는 **이 기기의 마지막 선택을 기억**하는
// 것으로 근사한다 — 공책을 닫았다 열어도, 탭을 접었다 펴도 보던 날이 그대로다.
//
// ## 일정을 누르면
//
// 상세 팝업은 원천마다 다르고(그리오·구글) 저장·삭제·회의실까지 달고 있어 이 라우트에
// 그대로 세울 수 없다. 대신 **일정 화면을 그 일정에 맞춰 연다**(`focusCalendar`) — 알림
// 토스트가 쓰는 그 길이라 새로 만든 것이 없다.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarSide } from '../../home/calendar/CalendarSide';
import type { CalendarEntry } from '../../home/calendar/entries';
import { partsOf, todayISO } from '../../home/calendar/model';
import { focusCalendar } from '../../home/calendarFocus';
import { useNoteAgenda } from '../noteAgenda';
import type { EditorController } from '../useEditorState';

/** 이 기기가 보던 날 — 스펙의 "일정 페이지와 공유"에 가장 가까운 근사(머리말). */
const DAY_KEY = 'mf_note_agenda_day';

function readDay(): string {
  try {
    const v = localStorage.getItem(DAY_KEY) || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayISO();
  } catch {
    return todayISO();
  }
}

export function NoteAgendaPanel({ controller, onClose }: { controller: EditorController; onClose: () => void }) {
  const th = controller.uiTheme;
  const navigate = useNavigate();
  const today = todayISO();
  const [day, setDay] = useState(readDay);
  const at = partsOf(day) ?? partsOf(today)!;
  const [ym, setYm] = useState({ y: at.y, m: at.m });
  const agenda = useNoteAgenda(ym.y, ym.m);

  useEffect(() => {
    try {
      localStorage.setItem(DAY_KEY, day);
    } catch {
      /* 저장할 수 없는 환경 — 기억만 못 할 뿐 화면은 그대로다 */
    }
  }, [day]);

  const go = (focus?: { date: string; eventId?: string; source?: 'geurio' | 'google' }): void => {
    focusCalendar(focus);
    navigate('/home');
  };

  return (
    <aside
      data-note-agenda
      className="mf-note-agenda"
      aria-label="일정"
      style={{
        flex: '0 0 296px',
        minWidth: 0,
        /**
         * **가로 flex다.** 세로로 두면 `CalendarSide`의 `flex: 0 0 300px`가 폭이
         * 아니라 **높이**로 읽혀 판이 300px에서 잘린다(실브라우저에서 그 꼴을 봤다).
         * 폭은 이 aside가 잡고(296), 안쪽은 `editor.css`가 늘려 준다.
         */
        display: 'flex',
        borderLeft: `1px solid ${th.border}`,
        background: 'var(--mf-note-bar, var(--mf-panel2))',
        overflow: 'hidden',
      }}
    >
      <CalendarSide
        entries={agenda.entries}
        todayIso={today}
        y={ym.y}
        m={ym.m}
        surface={{ card: th.panel, text: th.text }}
        selectedDay={day}
        holidays={agenda.holidays}
        onPickDay={setDay}
        onPickEntry={(e: CalendarEntry) =>
          // 원천은 어느 칸이 채워져 있는가로 갈린다(`CalendarEntry` — 구글이면
          // `google`, 그리오 일정이면 `event`). `cardId`가 그 일정의 id다.
          go({ date: e.due, ...(e.google || e.event ? { eventId: e.cardId } : {}), ...(e.google ? { source: 'google' as const } : e.event ? { source: 'geurio' as const } : {}) })
        }
        onSetMonth={(y, m) => setYm({ y, m })}
        onNewEvent={(iso) => go({ date: iso })}
        onClose={onClose}
      />
    </aside>
  );
}
