// 구글 일정 상세 — **읽기 전용**(PR5).
//
// 우리 두 상세 팝업(칸반 카드·Geurio 일정)과 다른 것은 고칠 것이 하나도 없다는
// 점이다. 구글이 정본이라 여기서 고칠 수 있는 척하면 거짓말이 된다 — 대신
// **구글에서 열기**로 진짜 고칠 수 있는 자리로 보낸다.

import { Modal, MODAL_DIM } from '../../../components/Modal';
import { dateLabel, daysBetween, minutesOf, timeLabel } from './model';
import type { GoogleEvent } from './googleCalendar';

export function GoogleEventDetail({ event, isMobile, onClose }: { event: GoogleEvent; isMobile: boolean; onClose: () => void }) {
  const spanDays = daysBetween(event.startDate, event.endDate) + 1;
  const when = event.allDay
    ? spanDays > 1
      ? `${dateLabel(event.startDate)} – ${dateLabel(event.endDate)}`
      : dateLabel(event.startDate)
    : `${dateLabel(event.startDate)} · ${timeLabel(minutesOf(event.startTime) ?? 0)}${event.endTime ? ` – ${timeLabel(minutesOf(event.endTime) ?? 0)}` : ''}`;
  return (
    <Modal
      open
      onClose={onClose}
      label="Google 일정"
      dim={{ ...MODAL_DIM, backdropFilter: 'blur(3px)' }}
      cardAttrs={{ 'data-google-detail': '' }}
      card={{
        width: isMobile ? '100%' : 452,
        maxWidth: '100%',
        borderRadius: isMobile ? '20px 20px 0 0' : 22,
        background: 'var(--mf-card)',
        boxShadow: '0 30px 60px -30px rgba(46,42,38,.5)',
        padding: 22,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: event.color ?? 'var(--mf-accent)', marginTop: 7, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em', wordBreak: 'break-word' }}>{event.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 4 }}>{event.calendarName} · Google 캘린더</div>
          </div>
          <button type="button" className="mf-ctl" aria-label="닫기" onClick={onClose} style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <dl style={{ margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="언제">{when}</Row>
          {event.location && <Row label="어디">{event.location}</Row>}
          {event.description && (
            <Row label="메모">
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{event.description.slice(0, 600)}</span>
            </Row>
          )}
        </dl>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--mf-faint)' }}>Google 일정은 여기서 고칠 수 없어요</span>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              data-google-open
              className="mf-ctl"
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
              Google에서 열기
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <dt style={{ flex: '0 0 52px', fontSize: 12.5, fontWeight: 700, color: 'var(--mf-faint)', paddingTop: 1 }}>{label}</dt>
      <dd style={{ margin: 0, minWidth: 0, flex: 1, fontSize: 13.5, color: 'var(--mf-text)' }}>{children}</dd>
    </div>
  );
}
