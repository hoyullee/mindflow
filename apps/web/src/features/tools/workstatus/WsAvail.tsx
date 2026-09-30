import { DateButton } from '../../home/calendar/DatePop';
import { addDays, AVAIL_LABEL, dowOf, type AvailRow, type Dataset } from './model';
import { Avatar, MONO } from './wsUi';

const LEVEL = [
  { bg: '#EBF5EE', fg: '#2F7D57', bar: '#69B08A' },
  { bg: '#FBF3E4', fg: '#B0781E', bar: '#E0B45C' },
  { bg: '#FBEDE6', fg: '#C0563A', bar: '#E8845C' },
  { bg: '#F3EEE8', fg: '#8A8078', bar: '#CFC4B8' },
] as const;

/** 빠른 선택 — 다음 주(월~금) · 2주 · 다음 달 전체(스펙 §7). */
export function quickRanges(today: string): { name: string; from: string; to: string }[] {
  const w = dowOf(today);
  const nextMon = addDays(today, ((8 - w) % 7) || 7);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const mm = String(nm).padStart(2, '0');
  return [
    { name: '다음 주', from: nextMon, to: addDays(nextMon, 4) },
    { name: '2주', from: nextMon, to: addDays(nextMon, 11) },
    { name: `${nm}월 전체`, from: `${ny}-${mm}-01`, to: `${ny}-${mm}-${String(last).padStart(2, '0')}` },
  ];
}

/**
 * 일정 맞춰보기(스펙 §7) — 기간을 넣으면 그 안의 영업일에 누가 비어 있는지. 행을 누르면 그
 * 담당자 필터. 열려 있는 동안 달력에 기간이 초록으로 칠해진다(부모가 한다).
 */
export function WsAvail({ from, to, onRange, rows, bizN, loading, data, onClose, onPickPerson }: { from: string; to: string; onRange: (from: string, to: string) => void; rows: AvailRow[]; bizN: number; loading: boolean; data: Dataset; onClose: () => void; onPickPerson: (id: string) => void }) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const free = rows.filter((r) => r.level === 0).length;
  return (
    <div data-ws-avail style={{ display: 'flex', flexDirection: 'column', maxHeight: 'min(72vh, 640px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 16px 10px', background: 'var(--mf-ws-avail)', borderBottom: '1px solid var(--mf-hairline)', borderRadius: '16px 16px 0 0' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>일정 맞춰보기</div>
          <div data-ws-avail-sum style={{ fontSize: 11.5, color: 'var(--mf-ws-mut)', marginTop: 2 }}>
            영업일 {bizN}일 · 전부 가능 {free}명{loading ? ' · 불러오는 중…' : ''}
          </div>
        </div>
        <button type="button" className="btn" aria-label="닫기" onClick={onClose} style={{ marginLeft: 'auto', width: 24, height: 24, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--mf-ws-mut)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div style={{ padding: '10px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DateButton label="시작 날짜" value={from} clearable={false} height={32} attrs={{ 'data-ws-avail-from': '' }} onPick={(iso) => iso && onRange(iso, iso > to ? iso : to)} />
          <span style={{ color: 'var(--mf-ws-faint)' }}>~</span>
          <DateButton label="끝 날짜" value={to} min={from} clearable={false} height={32} attrs={{ 'data-ws-avail-to': '' }} onPick={(iso) => iso && onRange(from, iso)} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {quickRanges(todayIso).map((q) => {
            const on = q.from === from && q.to === to;
            return (
              <button key={q.name} type="button" className="btn mf-ws-quick" data-on={on ? '1' : '0'} onClick={() => onRange(q.from, q.to)} style={{ height: 24, padding: '0 10px', borderRadius: 999, border: `1px solid ${on ? '#CFE3D3' : 'var(--mf-ws-line2)'}`, background: on ? '#F1F7F2' : 'var(--mf-ws-card)', color: on ? '#2F7D57' : 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                {q.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="lnb-scroll" style={{ overflowY: 'auto', padding: '2px 8px 10px' }}>
        {!rows.length && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>담당자가 없어요</div>}
        {rows.map((r) => {
          const L = LEVEL[r.level];
          return (
            <button key={r.person.id} type="button" className="btn mf-ws-avail-row" data-ws-avail-row={r.person.id} onClick={() => onPickPerson(r.person.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px', border: 0, borderRadius: 11, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <Avatar ini={r.person.ini} c={r.person.c} size={22} />
              <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person.name}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11.5, color: 'var(--mf-ws-ink2)' }}>
                    {r.free}/{r.total}
                  </span>
                  <span style={{ height: 18, padding: '0 7px', borderRadius: 999, background: L.bg, color: L.fg, fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{AVAIL_LABEL[r.level]}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ flex: '1 1 auto', height: 4, borderRadius: 99, background: 'var(--mf-ws-soft)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${Math.round(r.ratio * 100)}%`, background: L.bar }} />
                  </span>
                  {r.conflicts.slice(0, 3).map((t) => (
                    <span key={t.key} title={`${t.summary} · ${t.start} ~ ${t.end}`} style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: data.eByKey.get(t.epic)?.c ?? 'var(--mf-ws-mut)', flexShrink: 0 }}>
                      {t.key}
                    </span>
                  ))}
                  {r.conflicts.length > 3 && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--mf-ws-faint)' }}>+{r.conflicts.length - 3}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
