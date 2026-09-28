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
// ## 일정을 누르면 — **공책 안에서 연다**(제보)
//
// 예전에는 일정 화면으로 건너뛰었다(`focusCalendar` + `navigate`). 그때는 상세 팝업을
// 이 라우트에 세울 길이 없다고 적어 두었는데, 그 뒤 날짜 칩 팝오버를 위해 **그 길이
// 생겼다**(`NoteEventPopups` — 일정 화면의 부품을 그대로 띄운다). 이쪽만 옛 길에
// 남아 있어서, 글을 읽다 일정 하나를 확인하려 하면 문서를 떠났다.
//
// 어느 상세를 여는가는 칩 팝오버와 **같은 한 자리**가 정한다(`noteEventOpenOf`).

import { useEffect, useState } from 'react';
import { CalendarSide } from '../../home/calendar/CalendarSide';
import type { CalendarEntry } from '../../home/calendar/entries';
import { partsOf, todayISO } from '../../home/calendar/model';
import { useNoteAgenda } from '../noteAgenda';
import { noteEventOpenOf, type NoteEventOpen } from './NoteEventPopups';
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

export function NoteAgendaPanel({ controller, onClose, onOpenEvent }: { controller: EditorController; onClose: () => void; onOpenEvent: (open: NoteEventOpen) => void }) {
  const th = controller.uiTheme;
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
        // 그 일정이 걸린 **날**을 넘긴다 — 기간 일정은 고른 날이 기준이다(칩 팝오버와 같다).
        onPickEntry={(e: CalendarEntry) => onOpenEvent(noteEventOpenOf(e, e.due || day))}
        onSetMonth={(y, m) => setYm({ y, m })}
        onNewEvent={(iso) => onOpenEvent({ kind: 'new', at: iso })}
        onClose={onClose}
      />
    </aside>
  );
}
