import { dayChips, DOW, dowOf, gridDays, holidayOf, visibleChips, type Dataset, type HolidayRules, type Ticket } from './model';
import { AvatarStack, MONO } from './wsUi';

/**
 * 달력 보기(스펙 §5) — 7×6 격자. 칸마다 그날 걸친 티켓을 **에픽별 칩**으로 묶고, 셋을 넘으면
 * 둘 + `+N개 프로젝트`. 칸을 누르면 오른쪽 패널의 날짜가 바뀐다.
 */
export function WsCalendar({ y, m, today, sel, onPick, tickets, data, rules, avail }: { y: number; m: number; today: string; sel: string; onPick: (d: string) => void; tickets: Ticket[]; data: Dataset; rules: HolidayRules; avail: { from: string; to: string } | null }) {
  const month = `${y}-${String(m).padStart(2, '0')}`;
  const cells = gridDays(y, m);
  return (
    <div data-ws-calendar style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', boxSizing: 'border-box', background: 'var(--mf-cal-frame)', borderTop: '1px solid var(--mf-ws-line)', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--mf-ws-card)' }}>
        {DOW.map((t, i) => (
          <div key={t} style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: i === 0 ? '#D0917F' : i === 6 ? '#7C9BD8' : 'var(--mf-ws-mut2)', borderRight: i < 6 ? '1px solid var(--mf-ws-line)' : 0 }}>
            {t}
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 auto', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(96px, 1fr))', borderTop: '1px solid var(--mf-ws-line)' }}>
        {cells.map((d, i) => {
          const w = dowOf(d);
          const inMonth = d.startsWith(month);
          const h = holidayOf(d, rules);
          const isToday = d === today;
          const isSel = d === sel;
          const off = !!h || w === 0;
          const inAvail = !!avail && inMonth && d >= avail.from && d <= avail.to && !h && (rules.weekend || (w !== 0 && w !== 6));
          const bg = !inMonth ? 'var(--mf-cal-out)' : inAvail ? 'var(--mf-ws-avail)' : off ? 'var(--mf-ws-sun)' : w === 6 ? 'var(--mf-ws-sat)' : 'var(--mf-ws-card)';
          const chips = inMonth ? dayChips(tickets, d, data) : [];
          const { shown, more } = visibleChips(chips);
          const busy = inMonth ? new Set(tickets.filter((t) => t.start <= d && d <= t.end).map((t) => t.person.id)).size : 0;
          const ring = isSel ? `inset 0 0 0 1.5px #E8A25F${isToday ? ', inset 0 0 0 4px var(--mf-ws-card)' : ''}` : inAvail ? 'inset 0 -2px 0 0 #8FB88F' : 'none';
          return (
            <div
              key={d}
              role={inMonth ? 'button' : undefined}
              tabIndex={inMonth ? 0 : -1}
              data-ws-day={d}
              aria-label={inMonth ? `${Number(d.slice(8))}일${h ? ` ${h.name}` : ''}${busy ? ` · ${busy}명` : ''}` : undefined}
              onClick={inMonth ? () => onPick(d) : undefined}
              onKeyDown={(e) => {
                if (inMonth && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onPick(d);
                }
              }}
              style={{ minWidth: 0, background: bg, boxShadow: ring, borderRight: i % 7 < 6 ? '1px solid var(--mf-ws-line)' : 0, borderBottom: '1px solid var(--mf-ws-line)', padding: '6px 6px 4px', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', cursor: inMonth ? 'pointer' : 'default', boxSizing: 'border-box' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ width: 19, height: 19, borderRadius: 6, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10.5, fontWeight: isToday ? 800 : 600, background: isToday ? '#E85E33' : 'transparent', color: isToday ? '#FFFFFF' : !inMonth ? 'var(--mf-cal-num-out)' : off ? 'var(--mf-cal-num-sun)' : w === 6 ? 'var(--mf-cal-num-sat)' : 'var(--mf-ws-mut)' }}>
                  {Number(d.slice(8))}
                </span>
                {inMonth && h && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, color: '#C4614C', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {h.company && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                        <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4" />
                      </svg>
                    )}
                    {h.name}
                  </span>
                )}
                {busy > 0 && <span style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: MONO, fontSize: 9.5, color: 'var(--mf-ws-faint)' }}>{busy}명</span>}
              </div>
              {shown.map((c) => (
                <div
                  key={c.epic.key}
                  data-ws-chip={c.epic.key}
                  title={c.tickets.map((t) => `${t.key} ${t.summary} · ${t.person.name}`).join('\n')}
                  style={{ height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 3px 0 5px', borderRadius: 5, background: c.epic.bg, borderLeft: `3px solid ${c.epic.c}`, minWidth: 0, boxSizing: 'border-box' }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#3A352F', minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.epic.name}</span>
                  <AvatarStack people={c.people} size={13} max={3} overlap={4} ring={c.epic.bg} />
                </div>
              ))}
              {more > 0 && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--mf-ws-mut)', paddingLeft: 2 }}>+{more}개 프로젝트</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
