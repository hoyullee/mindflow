import { useRef, useState } from 'react';
import { activeOn, DOW, dowOf, gridDays, holidayOf, planWeek, releasesOn, shortDate, type CalCapacity, type Dataset, type Epic, type HolidayRules, type MonthBiz, type Stats, type Ticket } from './model';
import { bizBreakdown } from './WsStats';
import { Avatar, MONO, StatusBadge } from './wsUi';

// 작업 현황의 **폰 판**(모바일 디자인 A — W1 달력 · W3 집계). 데스크톱의 7×6 칩 격자와 담당자 × 프로젝트 표는
// 390px에서 글자가 칸을 못 넘는다. 같은 데이터(`planWeek` · `computeStats`)를 손가락 판으로 다시 그린다.

/** 한 칸이 담는 줄 — 칩이 아니라 **2px 선**이라 셋까지(디자인 W1 "레인 최대 3개"), 넘친 것은 아래 목록이 다 보여 준다. */
const LANES: CalCapacity = { rows: 3, withMore: 3 };
const SWIPE_MIN = 56;

/**
 * W1 — 달력 + **고른 날의 목록**. 데스크톱의 오른쪽 패널(고른 날의 진행 작업)을 달력 아래로 내렸다.
 *
 * 칸은 날짜 동그라미 하나와 그 아래 선 셋이다: 이어지는 같은 묶음(에픽 — 없으면 티켓 자신)은 이웃 칸과 **붙은 선**,
 * 주가 바뀌면 끊긴다(줄 배정은 데스크톱과 같은 `planWeek` — 칸마다 위아래로 흔들리지 않는다). 옆으로 밀면 달이 바뀐다.
 */
export function WsMobileCalendar({ y, m, today, sel, onPick, onShift, tickets, data, rules, avail, onOpenIssue }: { y: number; m: number; today: string; sel: string; onPick: (d: string) => void; onShift: (n: number) => void; tickets: Ticket[]; data: Dataset; rules: HolidayRules; avail: { from: string; to: string } | null; onOpenIssue: (key: string) => void }) {
  const month = `${y}-${String(m).padStart(2, '0')}`;
  const all = gridDays(y, m);
  // 마지막 주가 통째로 다음 달이면 그리지 않는다(다섯 줄인 달이 여섯 줄 높이를 먹지 않게).
  const cells = all.slice(35).some((d) => d.startsWith(month)) ? all : all.slice(0, 35);
  const plans = Array.from({ length: cells.length / 7 }, (_, w) => {
    const week = cells.slice(w * 7, w * 7 + 7);
    return planWeek(tickets, week, week.map((d) => d.startsWith(month)), data, LANES);
  });
  const touch = useRef<{ x: number; y: number } | null>(null);
  return (
    <div data-ws-mcal>
      <div
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) onShift(dx < 0 ? 1 : -1);
        }}
        style={{ borderTop: '1px solid var(--mf-ws-line)', touchAction: 'pan-y' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', padding: '6px 12px 2px' }}>
          {DOW.map((t, i) => (
            <span key={t} style={{ textAlign: 'center', padding: '4px 0', fontSize: 11, fontWeight: 800, color: i === 0 ? '#D0917F' : i === 6 ? '#7C9BD8' : 'var(--mf-ws-mut2)' }}>
              {t}
            </span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', padding: '0 12px 8px' }}>
          {cells.map((d, i) => {
            const w = dowOf(d);
            const inMonth = d.startsWith(month);
            const h = inMonth ? holidayOf(d, rules) : null;
            const isToday = d === today;
            const isSel = d === sel && inMonth;
            const inAvail = !!avail && inMonth && d >= avail.from && d <= avail.to && !h && (rules.weekend || (w !== 0 && w !== 6));
            const red = w === 0 || !!h;
            const pieces = plans[Math.floor(i / 7)]!.rows[i % 7] ?? [];
            return (
              <button
                key={d}
                type="button"
                className="btn"
                data-ws-day={d}
                disabled={!inMonth}
                aria-pressed={inMonth ? isSel : undefined}
                aria-label={inMonth ? `${Number(d.slice(8))}일${h ? ` ${h.name}` : ''}` : undefined}
                onClick={() => onPick(d)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: 50, padding: '4px 0 0', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: inMonth ? 'pointer' : 'default', opacity: inMonth ? 1 : 0.35, minWidth: 0 }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 99,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: MONO,
                    fontSize: 13.5,
                    fontWeight: isToday || isSel ? 700 : 500,
                    background: isToday ? '#E85E33' : inAvail ? 'var(--mf-ws-avail)' : 'transparent',
                    boxShadow: isSel && !isToday ? 'inset 0 0 0 1.5px #E85E33' : 'none',
                    color: isToday ? '#FFFFFF' : inAvail ? '#2F7D57' : red ? '#C4614C' : w === 6 ? '#5F81BF' : 'var(--mf-ws-ink)',
                  }}
                >
                  {Number(d.slice(8))}
                </span>
                <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', height: 10 }}>
                  {pieces.map((pc, li) =>
                    pc ? (
                      <span
                        key={pc.chip.epic.key}
                        data-ws-lane={li}
                        data-ws-lane-epic={pc.chip.epic.key}
                        style={{ display: 'block', height: 2, flex: '0 0 auto', marginLeft: pc.head ? 9 : 0, marginRight: pc.tail ? 9 : 0, borderRadius: `${pc.head ? 99 : 0}px ${pc.tail ? 99 : 0}px ${pc.tail ? 99 : 0}px ${pc.head ? 99 : 0}px`, background: pc.chip.epic.c }}
                      />
                    ) : (
                      <span key={`gap${li}`} style={{ display: 'block', height: 2, flex: '0 0 auto' }} />
                    ),
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <WsMobileDay sel={sel} today={today} rules={rules} tickets={tickets} data={data} onOpenIssue={onOpenIssue} />
    </div>
  );
}

/** 고른 날의 진행 작업 — 묶음(에픽)마다 머리 한 줄, 그 아래 티켓. 에픽 없는 티켓은 머리 없이 한 줄(데스크톱 패널과 같은 규칙). */
function WsMobileDay({ sel, today, rules, tickets, data, onOpenIssue }: { sel: string; today: string; rules: HolidayRules; tickets: Ticket[]; data: Dataset; onOpenIssue: (key: string) => void }) {
  const day = tickets.filter((t) => activeOn(t, sel));
  const groups = new Map<string, Ticket[]>();
  for (const t of day) groups.set(t.epic, [...(groups.get(t.epic) ?? []), t]);
  const h = holidayOf(sel, rules);
  const rel = releasesOn(tickets, sel);
  const people = new Set(day.map((t) => t.person.id)).size;
  return (
    <section data-ws-mday={sel} aria-label="고른 날의 작업" style={{ borderTop: '1px solid var(--mf-ws-line)', background: 'var(--mf-ws-card)', padding: '0 20px 20px', minHeight: 160 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '16px 0 4px' }}>
        <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, letterSpacing: '-.03em', color: 'var(--mf-ws-ink)' }}>{Number(sel.slice(8))}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>
          {DOW[dowOf(sel)]}요일{sel === today ? ' · 오늘' : ''}
        </span>
        {h && <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 700, color: '#C4614C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>}
        <span style={{ flex: 1 }} />
        {day.length > 0 && <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--mf-ws-faint)' }}>{people}명 · 티켓 {day.length}</span>}
      </div>
      {rel.length > 0 && (
        <div data-ws-mday-release style={{ marginTop: 10, padding: '8px 12px', borderRadius: 12, background: '#EAF1FB' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#3F67A8', marginBottom: 2 }}>이 날 배포 예정 {rel.length}건</div>
          {rel.map((t) => (
            <button key={t.key} type="button" className="btn" onClick={() => onOpenIssue(t.key)} style={{ display: 'block', width: '100%', padding: '5px 0', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: '#3F67A8', marginRight: 6 }}>{t.key}</span>
              {t.summary}
            </button>
          ))}
        </div>
      )}
      {!day.length && <div style={{ padding: '18px 0 6px', fontSize: 13, color: 'var(--mf-ws-faint)' }}>이 날 진행 중인 작업이 없어요</div>}
      {[...groups].map(([key, ts]) => {
        const e = data.eByKey.get(key);
        return (
          <div key={key} data-ws-mday-group={key}>
            {!e?.solo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0 4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: e?.c ?? '#B7ACA1' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e?.name ?? key}</span>
                <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)' }}>{key}</span>
              </div>
            )}
            {ts.map((t) => {
              const p = data.pById.get(t.person.id);
              return (
                <button key={t.key} type="button" className="btn" data-ws-mday-ticket={t.key} onClick={() => onOpenIssue(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', minHeight: 56, padding: 0, border: 0, borderBottom: '1px solid var(--mf-ws-line)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                  {p ? <Avatar ini={p.ini} c={p.c} size={24} /> : <span style={{ width: 24, flexShrink: 0 }} />}
                  <span aria-hidden="true" style={{ width: 3, height: 22, flexShrink: 0, borderRadius: 99, background: e?.c ?? '#B7ACA1' }} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</span>
                    <span style={{ fontSize: 12, color: 'var(--mf-ws-mut2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: MONO }}>{t.key}</span> · {shortDate(t.start)}–{shortDate(t.end)}
                      {t.filled ? ' · 날짜 없음' : t.startMissing ? ' · 시작일 없음' : t.endMissing ? ' · 기한 없음' : ''}
                    </span>
                  </span>
                  <StatusBadge status={t.status} height={19} />
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

/**
 * W3 — 집계는 **표 대신 담당자 카드**다. 담당자 × 프로젝트 표는 프로젝트가 셋만 넘어도 폰 폭을 넘는다.
 * 줄마다 그 사람의 진행 일수와 영업일 대비 비율, 막대는 프로젝트 색으로 나눠 칠하고, 누르면 프로젝트별 일수가 펼쳐진다.
 * 같은 날의 여러 티켓은 1일(`workedDays`) — 그래서 프로젝트별 합이 사람의 합과 다를 수 있다는 말을 바닥에 남긴다.
 */
export function WsMobileStats({ stats, biz, month, onOpenHoliday }: { stats: Stats; biz: MonthBiz; month: number; onOpenHoliday: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const bizN = biz.biz.length;
  const rows = [...stats.rows].sort((a, b) => b.total - a.total || a.person.name.localeCompare(b.person.name, 'ko'));
  const segs = (cells: { epic: Epic; days: number }[]) => cells.filter((c) => c.days > 0);
  return (
    <div data-ws-mstats style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 20px 30px' }}>
      <button type="button" className="btn" data-ws-mbiz onClick={onOpenHoliday} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>{month}월 영업일</span>
          <span style={{ fontSize: 11.5, color: 'var(--mf-ws-faint)' }}>{bizBreakdown(biz)}</span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, letterSpacing: '-.04em', color: '#D8794F' }}>
          {bizN}
          <span style={{ fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--mf-ws-mut)', marginLeft: 3 }}>일</span>
        </span>
      </button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '4px 4px 0' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>담당자별 진행 일수</span>
        <span style={{ fontSize: 11.5, color: 'var(--mf-ws-faint)' }}>진행 중·완료 티켓이 걸친 영업일</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', overflow: 'hidden' }}>
        {!rows.length && <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)' }}>조건에 맞는 담당자가 없어요</div>}
        {rows.map((r, i) => {
          const on = open === r.person.id;
          const hot = bizN ? r.total / bizN > 0.9 : false;
          const parts = segs(r.cells);
          return (
            <button key={r.person.id} type="button" className="btn" data-ws-mstat={r.person.id} aria-expanded={on} onClick={() => setOpen(on ? null : r.person.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', border: 0, borderTop: i ? '1px solid var(--mf-ws-line)' : 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <Avatar ini={r.person.ini} c={r.person.c} size={26} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: hot ? '#C0563A' : r.total ? 'var(--mf-ws-ink)' : 'var(--mf-ws-faint)' }}>
                  {r.total}
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mf-ws-mut)', marginLeft: 2 }}>일</span>
                </span>
                <span style={{ width: 34, textAlign: 'right', fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)' }}>{r.pct}%</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-ws-faint)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: on ? 'rotate(90deg)' : 'none', transition: 'transform .14s ease' }}>
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
              <span aria-hidden="true" style={{ display: 'flex', width: '100%', height: 5, borderRadius: 99, background: 'var(--mf-ws-soft)', overflow: 'hidden' }}>
                {parts.map((c) => (
                  <span key={c.epic.key} style={{ display: 'block', width: `${bizN ? (c.days / bizN) * 100 : 0}%`, background: c.epic.c }} />
                ))}
              </span>
              {on && (
                <span data-ws-mstat-epics style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', padding: '2px 0 0 36px', boxSizing: 'border-box' }}>
                  {!parts.length && <span style={{ fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>이 달에 걸친 티켓이 없어요</span>}
                  {parts.map((c) => (
                    <span key={c.epic.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: c.epic.c }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--mf-ws-ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.epic.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--mf-ws-ink2)' }}>{c.days}일</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p style={{ margin: 0, padding: '0 4px', fontSize: 11.5, lineHeight: 1.55, color: 'var(--mf-ws-mut2)', wordBreak: 'keep-all' }}>
        같은 날 여러 티켓은 1일로 셈. 프로젝트별 합은 사람×일이라 담당자 합과 다를 수 있어요.
      </p>
    </div>
  );
}
