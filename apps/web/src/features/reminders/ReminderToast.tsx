// 일정 알림 토스트 — **표현만** 담당한다(순수 props라 테스트에서 그대로 렌더된다).
//
// 자리·모양은 새 버전 토스트와 **같은 껍데기**(`toastShellStyle`)를 쓴다: 한 앱에서
// 화면 아래 알림이 종류마다 다른 자리에 다른 모양으로 뜨면 그게 곧 어긋남이다.

import { minutesOf, timeLabel } from '../home/calendar/model';
import { toastShellStyle } from '../../pwa/toastShell';
import { reminderLead, type ReminderItem } from './reminders';

export function ReminderToast({ item, rest, onOpen, onDismiss }: { item: ReminderItem; rest: number; onOpen: () => void; onDismiss: () => void }) {
  const mins = minutesOf(item.startTime);
  const when = mins === null ? item.startTime : timeLabel(mins);

  return (
    <div
      data-reminder-toast
      // polite: 편집 중 포커스를 훔치지 않고 스크린리더에 알린다(새 버전 토스트와 같은 규칙).
      role="status"
      aria-live="polite"
      style={{ ...toastShellStyle, gap: 12, padding: '11px 11px 11px 15px', maxWidth: 'min(420px, calc(100vw - 24px))' }}
    >
      <span aria-hidden style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.12)' }}>
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span data-reminder-title style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.72)', whiteSpace: 'nowrap' }}>
          {when} · {reminderLead(item.minutes)}
          {rest > 0 && ` · ${rest}건 더`}
        </span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        style={{ flexShrink: 0, marginLeft: 'auto', height: 32, padding: '0 12px', border: 'none', borderRadius: 9, background: 'rgba(255,255,255,.14)', color: '#fff', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        일정 보기
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="알림 닫기"
        title="닫기"
        style={{ flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 9, background: 'transparent', color: 'rgba(255,255,255,.72)', cursor: 'pointer' }}
      >
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
