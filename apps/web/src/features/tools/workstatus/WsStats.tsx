import type { ReactNode } from 'react';
import { heatLevel, type Epic, type MonthBiz, type Stats } from './model';
import { Avatar, MONO } from './wsUi';

const HEAT = ['var(--mf-ws-card)', '#FBF3EA', '#F8E6D5', '#F4D6BF', '#EFC5A6'] as const;

/**
 * 집계 보기(스펙 §9) — 담당자 × 프로젝트(에픽) 진행 일수 표. 칸은 히트맵, 마지막 열은 합계와
 * 영업일 대비 비율, 바닥은 에픽별 인일 합.
 */
export function WsStats({ stats, epics, biz, month, filteredIds, onPickPerson, onOpenHoliday }: { stats: Stats; epics: Epic[]; biz: MonthBiz; month: number; filteredIds: string[]; onPickPerson: (id: string) => void; onOpenHoliday: () => void }) {
  const cols = `200px repeat(${epics.length}, minmax(120px, 1fr)) 150px`;
  const bizN = biz.biz.length;
  return (
    <div data-ws-stats style={{ padding: '20px 32px 32px', background: 'var(--mf-ws-card)', borderTop: '1px solid var(--mf-ws-line)', minHeight: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>담당자 × 프로젝트 진행 일수</div>
          <div style={{ fontSize: 12, color: 'var(--mf-ws-mut2)', marginTop: 3 }}>진행 중·완료 티켓이 걸친 영업일 기준 · 같은 날 여러 티켓은 1일로 셈</div>
        </div>
        <div data-ws-bizline style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>{month}월 영업일</span>
          <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>{bizN}</span>
          <span style={{ fontSize: 12.5, color: 'var(--mf-ws-mut)' }}>일 · {bizBreakdown(biz)}</span>
        </div>
      </div>
      <div className="lnb-scroll" style={{ border: '1px solid var(--mf-ws-line)', borderRadius: 12, overflowX: 'auto' }}>
        <div role="table" aria-label="담당자 × 프로젝트 진행 일수" style={{ minWidth: 200 + epics.length * 120 + 150 }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, background: 'var(--mf-ws-sunk)', position: 'sticky', top: 0, zIndex: 1 }}>
            <Head>담당자</Head>
            {epics.map((e) => (
              <Head key={e.key}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: e.c, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
              </Head>
            ))}
            <Head end>합계 / 영업일</Head>
          </div>
          {stats.rows.map((r) => {
            const hot = bizN ? r.total / bizN > 0.9 : false;
            return (
              <div key={r.person.id} role="row" data-ws-stat-row={r.person.id} onClick={() => onPickPerson(r.person.id)} className="mf-tool-row" style={{ display: 'grid', gridTemplateColumns: cols, height: 48, borderTop: '1px solid var(--mf-ws-line)', background: filteredIds.includes(r.person.id) ? '#FBF6F0' : undefined, cursor: 'pointer' }}>
                <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', minWidth: 0 }}>
                  <Avatar ini={r.person.ini} c={r.person.c} size={24} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person.name}</span>
                </div>
                {r.cells.map((c) => {
                  const lv = heatLevel(c.days);
                  return (
                    <div key={c.epic.key} role="cell" title={`${r.person.name} · ${c.epic.name} · ${c.days}일`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: HEAT[lv], fontFamily: MONO, fontSize: 13, fontWeight: c.days >= 9 ? 800 : 600, color: c.days ? '#3A352F' : 'var(--mf-ws-chip-line)', borderLeft: '1px solid var(--mf-ws-line)' }}>
                      {c.days || '·'}
                    </div>
                  );
                })}
                <div role="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 16px', borderLeft: '1px solid var(--mf-ws-line)' }}>
                  <span style={{ width: 56, height: 4, borderRadius: 99, background: 'var(--mf-ws-soft)', overflow: 'hidden', flexShrink: 0 }}>
                    <span style={{ display: 'block', height: '100%', width: `${Math.min(100, r.pct)}%`, background: hot ? '#C0563A' : '#E85E33' }} />
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: 'var(--mf-ws-ink)', minWidth: 20, textAlign: 'right' }}>{r.total}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', minWidth: 30, textAlign: 'right' }}>{r.pct}%</span>
                </div>
              </div>
            );
          })}
          {!stats.rows.length && <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)', borderTop: '1px solid var(--mf-ws-line)' }}>조건에 맞는 담당자가 없어요</div>}
          <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, height: 44, borderTop: '1px solid var(--mf-ws-line)', background: 'var(--mf-ws-sunk)' }}>
            <div role="cell" style={{ display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 12.5, fontWeight: 800, color: 'var(--mf-ws-ink2)' }}>프로젝트 합계 (인일)</div>
            {stats.foot.map((v, i) => (
              <div key={epics[i]?.key ?? i} role="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 13, fontWeight: 800, color: 'var(--mf-ws-ink)', borderLeft: '1px solid var(--mf-ws-line)' }}>
                {v}
              </div>
            ))}
            <div role="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 16px', fontFamily: MONO, fontSize: 13, fontWeight: 800, color: 'var(--mf-ws-ink)', borderLeft: '1px solid var(--mf-ws-line)' }}>
              {stats.grand}
            </div>
          </div>
        </div>
      </div>
      <p style={{ margin: '12px 2px 0', fontSize: 12, color: 'var(--mf-ws-mut2)', lineHeight: 1.6 }}>
        합계는 그 사람의 진행 중·완료 티켓이 걸친 영업일 수(같은 날은 한 번), 프로젝트 합계는 프로젝트별 값을 더한 인일이에요.
        {stats.grand !== stats.totalSum && ` 한 사람이 같은 날 두 프로젝트에 걸치면 두 곳에 모두 세므로, 인일 합계(${stats.grand})가 담당자 합계의 총합(${stats.totalSum})보다 클 수 있어요.`}{' '}
        <button type="button" className="btn" onClick={onOpenHoliday} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#C0563A', cursor: 'pointer', textDecoration: 'underline' }}>
          휴일 설정
        </button>
      </p>
    </div>
  );
}

/** `주말 8일, 공휴일 2일, 휴일 1일 제외` — 0인 것은 뺀다(스펙 §9). */
export function bizBreakdown(b: MonthBiz): string {
  const parts = [
    ['주말', b.weekend],
    ['공휴일', b.holiday],
    ['휴일', b.company],
  ]
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => `${k} ${v}일`);
  return parts.length ? `${parts.join(', ')} 제외` : '뺀 날 없음';
}

function Head({ children, end }: { children: ReactNode; end?: boolean }) {
  return (
    <div role="columnheader" style={{ display: 'flex', alignItems: 'center', justifyContent: end ? 'flex-end' : 'flex-start', gap: 6, height: 40, padding: '0 16px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-ws-mut)', borderLeft: '1px solid var(--mf-ws-line)', minWidth: 0 }}>
      {children}
    </div>
  );
}
