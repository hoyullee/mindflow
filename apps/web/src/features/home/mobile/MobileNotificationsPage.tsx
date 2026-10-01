// 모바일 「알림」 탭(모바일 홈 디자인 M4) — 데스크톱의 LNB 알림 행 + 떠 있는 창을 한 화면으로 편다.
//
// 데이터·규칙은 데스크톱과 **같다**(`NotificationsContext` 한 벌 · 문장과 묶음은 `NotificationBell`의
// 함수): 열었으면 본 것(전부 읽음 처리 — 0019 공유 배지와 같은 규칙), 방금 읽은 것은 이 화면에
// 있는 동안 점으로 남아 "새로 온 것"을 알린다. 항목별 읽음 API가 없어 디자인의 「하나씩 읽음」은
// 두지 않는다 — 우편함 규칙을 화면마다 다르게 만들면 배지 수가 기기마다 어긋난다.
//
// 새 버전은 데스크톱처럼 **맨 위 고정 한 줄**이다(사건이 아니라 상태 — 적용할 때까지 남는다).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../adapters/ports';
import { useNotifications } from '../components/NotificationsContext';
import { avatarLabel } from '../components/ProfileAvatar';
import { groupOf, hrefOf, isCalendarNotice, lineOf, seedColor } from '../components/NotificationBell';
import { formatLastEdited } from '../timeFormat';
import { MONO_FONT } from '../chrome';
import { focusCalendar } from '../calendarFocus';
import { useMergedUpdate } from '../../../pwa/updateControl';
import { updateNoticeOf } from '../../../platform/shellUpdate';
import { Glyph, M_ICON } from './parts';

type Filter = 'all' | 'mention' | 'share' | 'cal';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'mention', label: '멘션' },
  { key: 'share', label: '공유' },
  { key: 'cal', label: '일정' },
];

/** 거름의 갈래 — 댓글·답글은 "나를 부른 말"이라 멘션에 묶는다(따로 두면 탭이 다섯이 된다). */
function filterOf(n: AppNotification): Exclude<Filter, 'all'> {
  if (n.kind === 'share') return 'share';
  if (isCalendarNotice(n)) return 'cal';
  return 'mention';
}

/** 메타 줄의 종류 아이콘 — 무엇 때문에 온 알림인가(디자인의 `@`·공유·시계). */
function kindIcon(n: AppNotification): ReactNode {
  const f = filterOf(n);
  return f === 'share' ? M_ICON.share : f === 'cal' ? M_ICON.clock : M_ICON.at;
}

/** 첫 줄을 `굵은 이름 + 나머지`로 가른다 — 사람 중심 문장(디자인). 사람이 없는 알림은 그대로. */
function splitLine(n: AppNotification): { who: string; rest: string } {
  const line = lineOf(n);
  if (isCalendarNotice(n)) return { who: '', rest: line };
  const who = n.actorName || '누군가';
  return line.startsWith(who) ? { who, rest: line.slice(who.length) } : { who: '', rest: line };
}

export function MobileNotificationsPage({ onOpenVersion }: { onOpenVersion: () => void }) {
  const navigate = useNavigate();
  const { items, refresh, markAllRead } = useNotifications();
  const notice = updateNoticeOf(useMergedUpdate());
  const [filter, setFilter] = useState<Filter>('all');
  /** 이 화면에서 "안 읽음"이었던 것 — 읽음 처리한 뒤에도 점으로 남긴다. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const opened = useRef(false);
  /** 첫 조회가 끝났는가 — 그 전의 목록은 들어오기 전의 것이라 아래 "보는 동안" 규칙이 손대지 않는다. */
  const ready = useRef(false);

  // 들어오는 순간 다시 읽고 전부 읽음으로(데스크톱 창을 여는 것과 같은 일).
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void refresh().then((list) => {
      ready.current = true;
      const unread = list.filter((i) => !i.read).map((i) => i.id);
      if (unread.length) {
        setFresh((s) => new Set([...s, ...unread]));
        markAllRead();
      }
    });
  }, [refresh, markAllRead]);
  // 보고 있는 동안 새로 온 것도 같은 규칙 — 화면에 떠 있으면 본 것이다(탭 배지도 함께 지운다).
  useEffect(() => {
    if (!ready.current) return;
    const unread = items.filter((i) => !i.read).map((i) => i.id);
    if (!unread.length) return;
    setFresh((s) => new Set([...s, ...unread]));
    markAllRead();
  }, [items, markAllRead]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, mention: 0, share: 0, cal: 0 };
    items.forEach((n) => (c[filterOf(n)] += 1));
    return c;
  }, [items]);
  const shown = filter === 'all' ? items : items.filter((n) => filterOf(n) === filter);

  const go = (n: AppNotification) => {
    if (isCalendarNotice(n)) {
      const c = n.calendar;
      focusCalendar(c ? { date: c.date, eventId: c.eventId, source: c.source } : undefined);
      navigate('/home');
      return;
    }
    const href = hrefOf(n);
    if (href) navigate(href);
  };

  return (
    <div data-m-noti className="mf-m-page" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)' }}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', padding: '10px 20px 6px' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <span data-m-noti-eyebrow style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mf-m-faint)' }}>{fresh.size ? `안 읽음 ${fresh.size}` : '모두 읽었어요'}</span>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>알림</h1>
        </span>
        {fresh.size > 0 && (
          <button type="button" className="btn" data-m-noti-readall onClick={() => setFresh(new Set())} style={{ height: 32, padding: '0 2px', border: 0, background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            모두 읽음
          </button>
        )}
      </div>
      <div role="tablist" aria-label="알림 거르기" style={{ flex: '0 0 auto', display: 'flex', gap: 20, padding: '0 20px', borderBottom: '1px solid var(--mf-m-line)' }}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={on}
              data-m-noti-filter={f.key}
              className="btn"
              onClick={() => setFilter(f.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 40, padding: 0, marginBottom: -1, border: 0, borderBottom: `2px solid ${on ? 'var(--mf-accent)' : 'transparent'}`, background: 'transparent', color: on ? 'var(--mf-m-ink)' : 'var(--mf-m-tab)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: on ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {f.label}
              <span style={{ fontFamily: MONO_FONT, fontSize: 11, fontWeight: 600, color: 'var(--mf-m-faint)' }}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>
      <div className="mf-m-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
        {notice && filter === 'all' && (
          <button
            type="button"
            className="btn mf-m-press"
            data-notification-update={notice.blocked ? 'blocked' : 'ready'}
            onClick={onOpenVersion}
            style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 16px 0', padding: '12px 14px', border: 0, borderRadius: 14, background: notice.blocked ? 'var(--mf-danger-bg)' : 'var(--mf-accent-soft)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          >
            <span aria-hidden="true" style={{ width: 36, height: 36, flex: '0 0 auto', borderRadius: 11, background: notice.blocked ? 'var(--mf-danger)' : 'var(--mf-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Glyph d={notice.blocked ? M_ICON.alert : M_ICON.download} size={17} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-m-ink)' }}>{notice.title}</span>
              <span style={{ fontSize: 12, color: 'var(--mf-m-mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notice.sub}</span>
            </span>
          </button>
        )}
        {shown.map((n, i) => {
          const group = groupOf(n.createdAt);
          const head = i === 0 || groupOf(shown[i - 1]!.createdAt) !== group;
          const isFresh = fresh.has(n.id);
          const canGo = !!hrefOf(n) || isCalendarNotice(n);
          const { who, rest } = splitLine(n);
          const cal = isCalendarNotice(n);
          const name = n.actorName || '누군가';
          const quote = n.kind === 'share' ? n.docTitle || '이름 없는 문서' : n.preview || '';
          const where = cal ? '일정' : n.docTitle || '이름 없는 문서';
          return (
            <span key={n.id} style={{ display: 'contents' }}>
              {head && <span style={{ padding: '16px 20px 2px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>{group}</span>}
              <button
                type="button"
                className="btn mf-m-press"
                data-notification-item={n.kind}
                data-unread={isFresh ? '1' : undefined}
                onClick={() => go(n)}
                disabled={!canGo}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px 0', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: canGo ? 'pointer' : 'default', color: 'inherit' }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 36, height: 36, flex: '0 0 auto', marginTop: 2, borderRadius: 99, background: cal ? 'var(--mf-accent-soft)' : seedColor(name), color: cal ? 'var(--mf-accent)' : '#fff', fontSize: 12.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {cal ? <Glyph d={M_ICON.calendar} size={17} /> : avatarLabel(name)}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0, paddingBottom: 12, borderBottom: '1px solid var(--mf-m-line)' }}>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: isFresh ? 'var(--mf-m-ink)' : 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>
                    {who && <b style={{ fontWeight: 800, color: 'var(--mf-m-ink)' }}>{who}</b>}
                    {rest}
                  </span>
                  {quote && <span style={{ fontSize: 13, color: isFresh ? 'var(--mf-m-ink2)' : 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.kind === 'share' ? quote : `“${quote}”`}</span>}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11.5, color: 'var(--mf-m-faint)' }}>
                    <Glyph d={kindIcon(n)} size={11} width={2.2} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
                    <span style={{ flex: '0 0 auto' }}>· {formatLastEdited(n.createdAt) || '방금 전'}</span>
                  </span>
                </span>
                <span data-notification-fresh={isFresh ? '' : undefined} aria-hidden="true" style={{ width: 7, height: 7, marginTop: 8, flex: '0 0 auto', borderRadius: 99, background: isFresh ? 'var(--mf-accent)' : 'transparent', display: 'block' }} />
              </button>
            </span>
          );
        })}
        {!shown.length && !(notice && filter === 'all') && (
          <div data-notification-empty style={{ padding: '48px 28px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.65, color: 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>
            {filter === 'all' ? (
              <>
                새 알림이 없어요.
                <br />
                멘션·답글·댓글·공유 초대·일정 알림이 여기에 모여요.
              </>
            ) : (
              `${FILTERS.find((f) => f.key === filter)?.label} 알림이 없어요.`
            )}
          </div>
        )}
      </div>
    </div>
  );
}
