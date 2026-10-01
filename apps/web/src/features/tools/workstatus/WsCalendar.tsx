import { useEffect, useRef, useState } from 'react';
import { calCapacity, CAL_LANES, DOW, dowOf, gridDays, holidayOf, planWeek, releasesOn, type Dataset, type HolidayRules, type Ticket } from './model';
import { AvatarStack, MONO } from './wsUi';

/**
 * 달력 보기(스펙 §5) — 7×6 격자. 칸마다 그날 걸친 티켓을 **에픽별 칩**으로 묶고, 셋을 넘으면
 * 둘 + `+N개 프로젝트`. 칸을 누르면 오른쪽 패널의 날짜가 바뀐다.
 */
export function WsCalendar({ y, m, today, sel, onPick, tickets, data, rules, avail }: { y: number; m: number; today: string; sel: string; onPick: (d: string) => void; tickets: Ticket[]; data: Dataset; rules: HolidayRules; avail: { from: string; to: string } | null }) {
  const month = `${y}-${String(m).padStart(2, '0')}`;
  const cells = gridDays(y, m);
  // 칸 하나가 담는 줄 수는 **칸 높이를 재서** 정한다(일정 페이지와 같은 방식) — 창 크기·패널 접기에 따라 달라진다.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellH, setCellH] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => setCellH(el.clientHeight / 6);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 아직 못 쟀으면(첫 프레임·레이아웃 없는 환경) 스펙의 기본(셋/둘).
  const cap = cellH > 0 ? calCapacity(cellH) : CAL_LANES;
  // 주마다 줄을 배정한다 — 이어지는 같은 묶음이 칸마다 위아래로 흔들리지 않게(일정 페이지와 같은 규칙).
  const plans = Array.from({ length: cells.length / 7 }, (_, w) => {
    const week = cells.slice(w * 7, w * 7 + 7);
    return planWeek(tickets, week, week.map((d) => d.startsWith(month)), data, cap);
  });
  return (
    <div data-ws-calendar style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', boxSizing: 'border-box', background: 'var(--mf-cal-frame)', borderTop: '1px solid var(--mf-ws-line)', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--mf-ws-card)' }}>
        {DOW.map((t, i) => (
          <div key={t} style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: i === 0 ? '#D0917F' : i === 6 ? '#7C9BD8' : 'var(--mf-ws-mut2)', borderRight: i < 6 ? '1px solid var(--mf-ws-line)' : 0 }}>
            {t}
          </div>
        ))}
      </div>
      <div ref={gridRef} style={{ flex: '1 1 auto', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(96px, 1fr))', borderTop: '1px solid var(--mf-ws-line)' }}>
        {cells.map((d, i) => {
          const w = dowOf(d);
          const inMonth = d.startsWith(month);
          const h = holidayOf(d, rules);
          const isToday = d === today;
          const isSel = d === sel;
          const off = !!h || w === 0;
          const inAvail = !!avail && inMonth && d >= avail.from && d <= avail.to && !h && (rules.weekend || (w !== 0 && w !== 6));
          const bg = !inMonth ? 'var(--mf-cal-out)' : inAvail ? 'var(--mf-ws-avail)' : off ? 'var(--mf-ws-sun)' : w === 6 ? 'var(--mf-ws-sat)' : 'var(--mf-ws-card)';
          const plan = plans[Math.floor(i / 7)]!;
          const pieces = plan.rows[i % 7] ?? [];
          const more = plan.more[i % 7] ?? 0;
          const rel = inMonth ? releasesOn(tickets, d) : [];
          const busy = inMonth ? new Set(tickets.filter((t) => t.start <= d && d <= t.end).map((t) => t.person.id)).size : 0;
          // 고른 날의 테두리는 칸 **위에 얹는 층**으로 그린다 — 칸의 box-shadow로 두면 칸 여백까지 내민 띠 조각이
          // 그 위를 덮어 테두리가 띠 뒤로 숨었다(제보 2026-10-01).
          const ring = isSel ? 'inset 0 0 0 2px #E8A25F' : inAvail ? 'inset 0 -2px 0 0 #8FB88F' : 'none';
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
              style={{ position: 'relative', minWidth: 0, background: bg, borderRight: i % 7 < 6 ? '1px solid var(--mf-ws-line)' : 0, borderBottom: '1px solid var(--mf-ws-line)', padding: '6px 6px 4px', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', cursor: inMonth ? 'pointer' : 'default', boxSizing: 'border-box' }}
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
                {rel.length > 0 && (
                  // 배포 예정일 — 날짜 줄 안에(칩 줄 사이에 끼면 이어지는 띠의 줄이 그날만 한 칸 밀렸다 — 제보 2026-10-01).
                  <span data-ws-release={d} title={rel.map((t) => `배포 예정 · ${t.key} ${t.summary}`).join('\n')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 15, padding: '0 5px', borderRadius: 999, background: '#EAF1FB', color: '#3F67A8', fontSize: 9, fontWeight: 800, minWidth: 0, flexShrink: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                      <path d="M12 2 4 7v10l8 5 8-5V7z" />
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>배포{rel.length > 1 ? ` ${rel.length}` : ` ${rel[0]!.key}`}</span>
                  </span>
                )}
                {busy > 0 && <span style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: MONO, fontSize: 9.5, color: 'var(--mf-ws-faint)' }}>{busy}명</span>}
              </div>
              {pieces.map((pc, li) => {
                if (!pc) return <div key={`gap${li}`} aria-hidden="true" style={{ height: 18, flexShrink: 0 }} />;
                const c = pc.chip;
                // 띠 한 조각 — 이어지는 칸 쪽은 칸 안쪽 여백만큼 내밀어 옆 칸과 붙인다. 이름은 시작 칸(또는 주의 첫 칸)에만.
                return (
                  <div
                    key={c.epic.key}
                    data-ws-chip={c.epic.key}
                    data-ws-lane={li}
                    title={c.tickets.map((t) => `${t.key} ${t.summary} · ${t.person.name} · ${t.start} ~ ${t.end}`).join('\n')}
                    style={{ height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: pc.head ? '0 3px 0 5px' : '0 3px', marginLeft: pc.head ? 0 : -6, marginRight: pc.tail ? 0 : -6, borderRadius: `${pc.head ? 5 : 0}px ${pc.tail ? 5 : 0}px ${pc.tail ? 5 : 0}px ${pc.head ? 5 : 0}px`, background: c.epic.bg, borderLeft: pc.head ? `3px solid ${c.epic.c}` : 0, minWidth: 0, boxSizing: 'border-box' }}
                  >
                    {pc.head && (
                      <>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#3A352F', minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {/* 에픽 없는 티켓은 칩이 곧 티켓 — 키를 앞에 붙여 어느 티켓인지 알게 한다. */}
                          {c.epic.solo && <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: c.epic.c, marginRight: 4 }}>{c.epic.key}</span>}
                          {c.epic.name}
                        </span>
                        <AvatarStack people={c.people} size={13} max={3} overlap={4} ring={c.epic.bg} />
                      </>
                    )}
                  </div>
                );
              })}
              {more > 0 && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--mf-ws-mut)', paddingLeft: 2 }}>+{more}개</span>}
              {ring !== 'none' && <span aria-hidden="true" data-ws-day-ring style={{ position: 'absolute', inset: 0, boxShadow: ring, pointerEvents: 'none', zIndex: 2 }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
