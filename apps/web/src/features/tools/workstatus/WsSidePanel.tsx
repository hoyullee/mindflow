import { activeOn, DOW, dowOf, holidayOf, shortDate, type Dataset, type HolidayRules, type Stats, type Ticket } from './model';
import { Avatar, MONO, StatusBadge } from './wsUi';

/**
 * 오른쪽 패널(스펙 §8) — 고른 날의 진행 작업(에픽별) + 이달 진행 일수 순위(상위 6).
 */
export function WsSidePanel({ sel, today, month, rules, tickets, data, stats, bizN, onOpenIssue, onPickPerson }: { sel: string; today: string; month: number; rules: HolidayRules; tickets: Ticket[]; data: Dataset; stats: Stats; bizN: number; onOpenIssue: (key: string) => void; onPickPerson: (id: string) => void }) {
  const day = tickets.filter((t) => activeOn(t, sel));
  const groups = new Map<string, Ticket[]>();
  for (const t of day) groups.set(t.epic, [...(groups.get(t.epic) ?? []), t]);
  const h = holidayOf(sel, rules);
  const people = new Set(day.map((t) => t.person.id)).size;
  const rank = [...stats.rows].sort((a, b) => b.total - a.total || a.person.name.localeCompare(b.person.name, 'ko')).slice(0, 6);
  const sub = sel === today ? '오늘' : '';
  return (
    <div data-ws-panel>
      <div style={{ padding: '14px 15px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>
            {Number(sel.slice(5, 7))}월 {Number(sel.slice(8))}일 ({DOW[dowOf(sel)]})
          </span>
          <span style={{ fontSize: 12, color: 'var(--mf-ws-faint)' }}>{[sub, day.length ? `${people}명 · 티켓 ${day.length}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        {h && <div style={{ fontSize: 11.5, fontWeight: 700, color: '#C4614C', marginTop: 3 }}>{h.company ? '회사 휴일' : '공휴일'} · {h.name}</div>}
      </div>
      <div style={{ padding: '0 15px 8px' }}>
        {!day.length && <div style={{ padding: '10px 0 14px', fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>이 날 진행 중인 작업이 없어요</div>}
        {[...groups].map(([key, ts]) => {
          const e = data.eByKey.get(key);
          return (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: e?.c ?? '#B7ACA1', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e?.name ?? key}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', flexShrink: 0 }}>{key}</span>
              </div>
              {ts.map((t) => {
                const p = data.pById.get(t.person.id);
                return (
                  <button key={t.key} type="button" className="btn mf-tool-row" data-ws-panel-ticket={t.key} onClick={() => onOpenIssue(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 4px', border: 0, borderRadius: 9, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                    {p && <Avatar ini={p.ini} c={p.c} size={22} />}
                    <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</span>
                      <span style={{ display: 'block', fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-ws-mut2)' }}>
                        {t.key} · {shortDate(t.start)}–{shortDate(t.end)}
                        {t.startMissing ? ' · 시작일 없음' : t.endMissing ? ' · 기한 없음' : ''}
                      </span>
                    </span>
                    <StatusBadge status={t.status} height={18} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 15px 18px', borderTop: '1px solid var(--mf-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>{month}월 진행 일수</span>
          <span style={{ fontSize: 11, color: 'var(--mf-ws-faint)' }}>영업일 {bizN}일 기준</span>
        </div>
        {!rank.length && <div style={{ fontSize: 12, color: 'var(--mf-ws-faint)' }}>담당자가 없어요</div>}
        {rank.map((r) => (
          <button key={r.person.id} type="button" className="btn mf-tool-row" onClick={() => onPickPerson(r.person.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 4px', border: 0, borderRadius: 9, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
            <Avatar ini={r.person.ini} c={r.person.c} size={22} />
            <span style={{ minWidth: 0, flex: '1 1 auto' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person.name}</span>
                <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 12, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>{r.total}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-ws-faint)', minWidth: 28, textAlign: 'right' }}>{r.pct}%</span>
              </span>
              <span style={{ display: 'flex', height: 4, borderRadius: 99, background: 'var(--mf-ws-soft)', overflow: 'hidden', marginTop: 4 }}>
                {r.cells
                  .filter((c) => c.days > 0)
                  .map((c) => (
                    <span key={c.epic.key} style={{ width: `${bizN ? (c.days / bizN) * 100 : 0}%`, background: c.epic.c }} />
                  ))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
