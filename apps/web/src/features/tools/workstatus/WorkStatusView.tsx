import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { JiraPerson } from '../jira/jiraApi';
import { beginJiraConnect, useJiraConn } from '../jira/jiraStore';
import { openJiraSetup } from '../jira/JiraSetupModal';
import { updateToolPrefs, useToolPrefs } from '../toolPrefsStore';
import type { WorkStatusPrefs } from '../toolPrefs';
import { TOOL_DEFS } from '../toolDefs';
import { ToolIcon, toolToast } from '../ui';
import {
  availability,
  bizDaysIn,
  buildDataset,
  computeStats,
  monthBiz,
  monthDays,
  overlaps,
  passes,
  suggest,
  workedDays,
  type Filter,
  type FilterType,
} from './model';
import { clearWorkStatusCache, useWorkStatusData } from './useWorkStatusData';
import { FilterChips, type ChipItem } from './FilterChips';
import { WsCalendar } from './WsCalendar';
import { WsTimeline } from './WsTimeline';
import { WsStats } from './WsStats';
import { WsSidePanel } from './WsSidePanel';
import { quickRanges, WsAvail } from './WsAvail';
import { WsMembers } from './WsMembers';
import { WsHolidayModal } from './WsHolidayModal';
import { Avatar, AvatarStack, CalCheckIcon, MONO, popPanel, RoundButton, Seg, useDismiss } from './wsUi';

type View = 'cal' | 'tl' | 'stats';
interface ViewPrefs {
  view: View;
  tlGroup: 'person' | 'epic';
  epicOpen: Record<string, boolean>;
  /** `undefined`면 폭에 따라 자동(스펙 §3). */
  panelOpen?: boolean;
  filters: Filter[];
}

/** 보기 설정은 **이 기기**의 것이다 — 담당자·휴일(계정의 것)과 달리 자주 바뀌고, 기기마다 폭이 달라서. */
const VIEW_KEY = 'mf_ws_view';
const DOCK_MIN = 1200;

function loadView(): ViewPrefs {
  const d: ViewPrefs = { view: 'cal', tlGroup: 'person', epicOpen: {}, filters: [] };
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<ViewPrefs> | null;
    if (!v) return d;
    return {
      view: v.view === 'tl' || v.view === 'stats' ? v.view : 'cal',
      tlGroup: v.tlGroup === 'epic' ? 'epic' : 'person',
      epicOpen: v.epicOpen && typeof v.epicOpen === 'object' ? v.epicOpen : {},
      ...(typeof v.panelOpen === 'boolean' ? { panelOpen: v.panelOpen } : {}),
      filters: Array.isArray(v.filters) ? v.filters.filter((f): f is Filter => !!f && (f.type === 'person' || f.type === 'epic' || f.type === 'ticket') && typeof f.id === 'string') : [],
    };
  } catch {
    return d;
  }
}

const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * 도구 · **작업 현황**(작업 현황 스펙) — Jira 에픽·티켓을 한 달 단위로 본다(달력·타임라인·집계).
 * 홈 본문을 꽉 채우고(LNB는 그대로 — 도구 스펙 §5), 안에서 스스로 스크롤한다.
 */
export function WorkStatusView({ isMobile, onOpenNav }: { isMobile: boolean; onOpenNav: () => void }) {
  const today = useMemo(localToday, []);
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [sel, setSel] = useState(today);
  const [vp, setVp] = useState<ViewPrefs>(loadView);
  const [q, setQ] = useState('');
  const [sugOpen, setSugOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const [range, setRange] = useState(() => quickRanges(today)[0]!);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [rowW, setRowW] = useState(1400);

  const conn = useJiraConn();
  const { prefs } = useToolPrefs();
  const work = prefs.work;
  const label = prefs.jira.label ?? (TOOL_DEFS.jira.screen as string);
  const setWork = useCallback((fn: (w: WorkStatusPrefs) => WorkStatusPrefs) => updateToolPrefs((p) => ({ ...p, work: fn(p.work) })), []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(vp));
    } catch {
      /* 이 기기의 편의일 뿐 */
    }
  }, [vp]);

  const { y, m } = ym;
  const days = useMemo(() => monthDays(y, m), [y, m]);
  const from = days[0] as string;
  const to = days[days.length - 1] as string;
  // 프로젝트와 **날짜 규칙**이 질문이다 — 어느 쪽이 바뀌어도 새로 묻는다.
  const projKey = `${conn.projects.map((p) => p.key).join(',')}|${conn.startField?.id ?? ''}|${conn.endField?.id ?? ''}|${conn.fillDates === false ? 0 : 1}`;
  const ready = conn.connected && !!conn.site && conn.projects.length > 0;
  const month = useWorkStatusData(from, to, projKey, ready);
  const availData = useWorkStatusData(range.from, range.to, projKey, ready && availOpen);

  // 프로젝트를 다시 고르면 옛 캐시는 다른 질문의 답이다.
  const lastProj = useRef(projKey);
  useEffect(() => {
    if (lastProj.current !== projKey) {
      clearWorkStatusCache();
      lastProj.current = projKey;
    }
  }, [projKey]);

  // 본문 행의 폭 — 1200px 이상이면 패널을 옆에 붙이고, 아니면 오버레이(스펙 §3).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => {
      const w = Math.round(es[0]?.contentRect.width ?? 0);
      if (w) setRowW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  const rules = work;
  const data = useMemo(() => buildDataset(month.data?.epics ?? [], month.data?.tickets ?? [], work.extra), [month.data, work.extra]);
  const hidden = work.hidden;
  const peopleOn = data.people.filter((p) => !hidden.includes(p.id));
  const filters = vp.filters;
  const tickets = data.tickets.filter((t) => !hidden.includes(t.person.id) && passes(t, filters));
  const inMonth = tickets.filter((t) => overlaps(t, from, to));
  const visiblePeople = filters.length ? peopleOn.filter((p) => inMonth.some((t) => t.person.id === p.id)) : peopleOn;
  const visibleEpics = data.epics.filter((e) => inMonth.some((t) => t.epic === e.key));
  const biz = useMemo(() => monthBiz(y, m, rules), [y, m, rules]);
  const stats = computeStats(visiblePeople, visibleEpics, tickets, biz.biz);
  const worked = new Map(visiblePeople.map((p) => [p.id, workedDays(tickets, biz.biz, p.id)]));
  const monthCount = new Map<string, number>();
  data.tickets.filter((t) => overlaps(t, from, to)).forEach((t) => monthCount.set(t.person.id, (monthCount.get(t.person.id) ?? 0) + 1));

  // 일정 맞춰보기 — 그 기간의 티켓(따로 받는다: 다음 달까지 걸칠 수 있다). 필터는 걸지 않는다 —
  // "누가 비었나"는 필터 밖의 사람에게도 묻는 질문이다. 끈 담당자만 뺀다.
  const availBiz = bizDaysIn(range.from, range.to, rules);
  const availRows = availability(
    peopleOn,
    (availData.data?.tickets ?? []).filter((t) => !hidden.includes(t.person.id)),
    availBiz,
  );

  const addFilter = (type: FilterType, id: string) => {
    setVp((v) => (v.filters.some((f) => f.type === type && f.id === id) ? v : { ...v, filters: [...v.filters, { type, id }] }));
    setQ('');
    setSugOpen(false);
  };
  const removeFilter = (key: string) => setVp((v) => ({ ...v, filters: v.filters.filter((f) => `${f.type}:${f.id}` !== key) }));

  const openIssue = (key: string) => {
    if (conn.demo || !conn.site?.url) {
      toolToast(`${key} · Jira에서 열기`);
      return;
    }
    window.open(`${conn.site.url.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`, '_blank', 'noopener');
  };

  const docked = rowW >= DOCK_MIN && !isMobile;
  const panelShow = vp.panelOpen === undefined ? docked : vp.panelOpen;

  const sugg = suggest(q, data, peopleOn);
  const sugGroups: { name: string; items: { key: string; name: string; meta: string; icon: ReactNode; on: boolean; pick: () => void }[] }[] = [
    {
      name: '담당자',
      items: sugg.people.map((p) => ({ key: `person:${p.id}`, name: p.name, meta: `티켓 ${monthCount.get(p.id) ?? 0}`, icon: <Avatar ini={p.ini} c={p.c} size={20} />, on: filters.some((f) => f.type === 'person' && f.id === p.id), pick: () => addFilter('person', p.id) })),
    },
    {
      name: '프로젝트 (에픽)',
      items: sugg.epics.map((e) => ({ key: `epic:${e.key}`, name: e.name, meta: e.key, icon: <span style={{ width: 20, height: 20, borderRadius: 6, background: e.c, color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{e.key[0]}</span>, on: filters.some((f) => f.type === 'epic' && f.id === e.key), pick: () => addFilter('epic', e.key) })),
    },
    {
      name: '티켓',
      items: sugg.tickets.map((t) => ({ key: `ticket:${t.key}`, name: t.summary, meta: t.key, icon: <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--mf-ws-soft)', color: 'var(--mf-ws-mut)', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>#</span>, on: filters.some((f) => f.type === 'ticket' && f.id === t.key), pick: () => addFilter('ticket', t.key) })),
    },
  ].filter((g) => g.items.length);

  const chips: ChipItem[] = filters.map((f) => {
    if (f.type === 'person') {
      const p = data.pById.get(f.id);
      return { key: `person:${f.id}`, name: p?.name ?? f.id, c: p?.c ?? '#B7ACA1', round: true };
    }
    if (f.type === 'epic') {
      const e = data.eByKey.get(f.id);
      return { key: `epic:${f.id}`, name: e?.name ?? f.id, c: e?.c ?? '#B7ACA1', round: false };
    }
    return { key: `ticket:${f.id}`, name: f.id, c: '#B7ACA1', round: false };
  });

  const searchRef = useRef<HTMLDivElement>(null);
  const memberRef = useRef<HTMLDivElement>(null);
  const availRef = useRef<HTMLDivElement>(null);
  useDismiss(searchRef, sugOpen, useCallback(() => setSugOpen(false), []));
  useDismiss(memberRef, memberOpen, useCallback(() => setMemberOpen(false), []));
  useDismiss(availRef, availOpen, useCallback(() => setAvailOpen(false), []));

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setSugOpen(false);
    if (e.key === 'Enter') sugGroups[0]?.items[0]?.pick();
  };

  const isNow = y === Number(today.slice(0, 4)) && m === Number(today.slice(5, 7));
  const shift = (n: number) =>
    setYm(({ y: yy, m: mm }) => {
      const idx = yy * 12 + (mm - 1) + n;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });
  const siteHost = conn.site?.url.replace(/^https?:\/\//, '').replace(/\/$/, '') || (conn.demo ? '데모 사이트' : '');

  // ── 빈 상태 ─────────────────────────────────────────────────
  const empty = !conn.connected ? (
    <Empty title="Jira 연결이 끊겼어요" body="다시 연결하면 에픽과 티켓 일정을 이 화면에 모아요." action="Jira 연결" onAction={() => void beginJiraConnect().then((err) => err && toolToast(err))} />
  ) : !conn.site || !conn.projects.length ? (
    <Empty title="볼 프로젝트를 골라 주세요" body="고른 프로젝트의 티켓을 에픽(없으면 프로젝트)별로 달력·타임라인·집계에 보여 줘요." action="프로젝트 고르기" onAction={() => openJiraSetup()} />
  ) : null;

  const pad = isMobile ? '12px 14px 12px' : '16px 20px 14px 32px';
  return (
    <div data-work-status style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--mf-ws-bg)', color: 'var(--mf-ws-ink)' }}>
      {/* 헤더(스펙 §4) */}
      <div style={{ padding: pad, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, background: 'var(--mf-cal-head)', backgroundImage: 'radial-gradient(var(--mf-cal-head-dot) 1px, transparent 1px)', backgroundSize: '18px 18px', backgroundPosition: '-9px -9px', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>
            {isMobile && (
              <button type="button" aria-label="메뉴 열기" onClick={onOpenNav} className="btn mf-ws-arrow" style={{ width: 30, height: 30, marginLeft: -6, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-ws-mut)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            )}
            도구
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--mf-ws-chip-line)' }} />
            <ToolIcon tool="jira" size={14} radius={4} font={8} />
            <span style={{ fontWeight: 800, color: 'var(--mf-ws-ink)' }}>{label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <MonthArrow dir={-1} onClick={() => shift(-1)} />
            <h1 data-ws-month style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.04em', color: 'var(--mf-ws-ink)', whiteSpace: 'nowrap' }}>
              {y}년 {m}월
            </h1>
            <MonthArrow dir={1} onClick={() => shift(1)} />
            {!isNow && (
              <button type="button" className="btn" data-ws-this-month onClick={() => { setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }); setSel(today); }} style={{ height: 28, padding: '0 11px', marginLeft: 4, borderRadius: 999, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                이번 달
              </button>
            )}
          </div>
          <div data-ws-summary style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 7px', paddingLeft: 32, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--mf-ws-mut)' }}>
            <span>{siteHost}</span>
            {[
              ['프로젝트', visibleEpics.length],
              ['티켓', inMonth.length],
              ['담당자', visiblePeople.length],
              ['영업일', biz.biz.length],
            ].map(([k, v]) => (
              <span key={k as string} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--mf-ws-chip-line)' }} />
                {k}
                <b style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: k === '영업일' ? '#D8794F' : 'var(--mf-ws-ink2)' }}>{v}</b>
              </span>
            ))}
            {ready && (
              <button type="button" className="btn" aria-label="새로 불러오기" title={month.loading ? '불러오는 중' : '새로 불러오기'} onClick={month.reload} style={{ width: 22, height: 22, border: 0, borderRadius: 7, background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={month.loading ? 'mf-ws-spin' : undefined}>
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 검색 + 필터(§4.2) */}
        <div ref={searchRef} style={{ flex: '1 1 220px', minWidth: 220, maxWidth: 460, position: 'relative', alignSelf: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 14px', borderRadius: 999, border: `1px solid ${sugOpen && q ? '#E8A25F' : 'var(--mf-ws-line2)'}`, background: 'var(--mf-ws-card)', boxSizing: 'border-box' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-ws-faint)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input data-ws-search value={q} onChange={(e) => { setQ(e.target.value); setSugOpen(true); }} onFocus={() => setSugOpen(!!q)} onKeyDown={onSearchKey} placeholder="담당자, 프로젝트, 티켓 키" aria-label="담당자, 프로젝트, 티켓 키로 걸러 보기" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 13 }} />
          </label>
          {sugOpen && !!q.trim() && (
            <div data-ws-suggest className="lnb-scroll" style={popPanel({ top: 40, left: 0, width: 320, maxWidth: 'calc(100vw - 24px)', maxHeight: 320, overflowY: 'auto', padding: 6 })}>
              {sugGroups.map((g) => (
                <div key={g.name}>
                  <div style={{ padding: '8px 8px 4px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-ws-faint)' }}>{g.name}</div>
                  {g.items.map((it) => (
                    <button key={it.key} type="button" className="btn mf-tool-row" onClick={it.pick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34, padding: '0 8px', border: 0, borderRadius: 9, background: it.on ? '#F7F0E8' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      {it.icon}
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', flexShrink: 0 }}>{it.meta}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!sugGroups.length && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>일치하는 항목이 없어요</div>}
            </div>
          )}
          <FilterChips chips={chips} onRemove={removeFilter} onClear={() => setVp((v) => ({ ...v, filters: [] }))} />
        </div>

        {/* 오른쪽 묶음(§4.3) */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginLeft: 'auto', alignSelf: 'center' }}>
          <div ref={memberRef} style={{ position: 'relative' }}>
            <button type="button" className="btn" data-ws-members-btn aria-expanded={memberOpen} onClick={() => setMemberOpen((v) => !v)} style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px 0 6px', borderRadius: 999, border: `1px solid ${memberOpen ? '#E7C7B4' : 'var(--mf-ws-line2)'}`, background: memberOpen ? '#FBF3EE' : 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', cursor: 'pointer' }}>
              <AvatarStack people={peopleOn} size={20} max={4} overlap={5} ring="var(--mf-ws-card)" />
              <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700 }}>
                {peopleOn.length}/{data.people.length}
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {memberOpen && (
              <div style={popPanel({ top: 38, right: 0, width: 300, maxWidth: 'calc(100vw - 24px)' })}>
                <WsMembers
                  people={data.people}
                  hidden={hidden}
                  monthCount={monthCount}
                  onToggle={(id) => {
                    const off = !hidden.includes(id);
                    setWork((w) => ({ ...w, hidden: off ? [...w.hidden, id] : w.hidden.filter((x) => x !== id) }));
                    // 끄면 그 사람 필터도 함께 뺀다(스펙 §4.3).
                    if (off) setVp((v) => ({ ...v, filters: v.filters.filter((f) => !(f.type === 'person' && f.id === id)) }));
                  }}
                  onAdd={(u: JiraPerson) => {
                    setWork((w) => ({ ...w, extra: [...w.extra.filter((x) => x.id !== u.id), { id: u.id, name: u.name, at: new Date().toISOString() }], hidden: w.hidden.filter((x) => x !== u.id) }));
                    toolToast(`${u.name} 님을 추가했어요`);
                  }}
                  onRemove={(id) => {
                    const p = data.pById.get(id);
                    setWork((w) => ({ ...w, extra: w.extra.filter((x) => x.id !== id), hidden: w.hidden.filter((x) => x !== id) }));
                    setVp((v) => ({ ...v, filters: v.filters.filter((f) => !(f.type === 'person' && f.id === id)) }));
                    toolToast(`${p?.name ?? ''} 님을 목록에서 뺐어요`);
                  }}
                />
              </div>
            )}
          </div>
          <Seg items={[['cal', '달력'], ['tl', '타임라인'], ['stats', '집계']]} value={vp.view} onChange={(v) => setVp((x) => ({ ...x, view: v }))} height={28} font={12.5} pad={13} label="보기" />
          <div ref={availRef} style={{ position: 'relative' }}>
            <button type="button" className="btn" data-ws-avail-btn aria-expanded={availOpen} onClick={() => setAvailOpen((v) => !v)} style={{ height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRadius: 999, border: `1px solid ${availOpen ? '#CFE3D3' : 'var(--mf-ws-line2)'}`, background: availOpen ? '#EBF5EE' : 'var(--mf-ws-card)', color: availOpen ? '#2F7D57' : 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <CalCheckIcon />
              일정 맞춰보기
            </button>
            {availOpen && (
              <div style={popPanel({ top: 38, right: 0, width: 380, maxWidth: 'calc(100vw - 24px)', borderRadius: 16 })}>
                <WsAvail from={range.from} to={range.to} onRange={(f, t) => setRange({ name: '', from: f, to: t })} rows={availRows} bizN={availBiz.length} loading={availData.loading} data={data} onClose={() => setAvailOpen(false)} onPickPerson={(id) => addFilter('person', id)} />
              </div>
            )}
          </div>
          <RoundButton on={panelShow} label="오른쪽 패널" onClick={() => setVp((v) => ({ ...v, panelOpen: !panelShow }))} attrs={{ 'data-ws-panel-btn': '' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M15 4v16" />
            </svg>
          </RoundButton>
          <RoundButton on={false} label="휴일 · 영업일 설정" onClick={() => setHolidayOpen(true)} attrs={{ 'data-ws-holiday-btn': '' }}>
            <CalCheckIcon />
          </RoundButton>
        </div>
      </div>

      {/* 본문 행 — 보기 + 오른쪽 패널(§3) */}
      <div ref={rowRef} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', position: 'relative' }}>
        <div className="lnb-scroll" data-ws-body style={{ flex: '1 1 auto', minWidth: 0, overflowY: vp.view === 'tl' ? 'hidden' : 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}>
          {empty ?? (
            <>
              {month.error && (
                <div role="alert" data-ws-error style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 20px', padding: '10px 14px', borderRadius: 12, background: '#FBEDE6', color: '#C0563A', fontSize: 12.5, fontWeight: 700 }}>
                  {month.error}
                  <button type="button" className="btn" onClick={month.reload} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: '#C0563A', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
                    다시 시도
                  </button>
                </div>
              )}
              {month.data && !month.data.tickets.length && !month.error && (
                // 텅 빈 달 — 대개 날짜가 비어 있거나 다른 필드에 적혀 있다(제보 2026-10-01). 고칠 자리로 바로 보낸다.
                <div data-ws-nodata style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 20px 0', padding: '10px 14px', borderRadius: 12, background: 'var(--mf-ws-sunk)', color: 'var(--mf-ws-mut)', fontSize: 12.5, fontWeight: 600 }}>
                  이 달에 그릴 티켓이 없어요 · 담당자가 있고 날짜가 이 달에 걸린 티켓만 보여요
                  <button type="button" className="btn" onClick={() => openJiraSetup()} style={{ marginLeft: 'auto', flexShrink: 0, border: 0, background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
                    날짜 기준 바꾸기
                  </button>
                </div>
              )}
              {month.data?.truncated && <div style={{ margin: '8px 20px 0', fontSize: 12, color: 'var(--mf-ws-mut)' }}>티켓이 많아 앞의 1,000건만 불러왔어요 · 프로젝트를 줄여 보세요</div>}
              {!month.data && month.loading ? (
                <div aria-busy="true" style={{ padding: '60px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)' }}>
                  Jira에서 불러오는 중…
                </div>
              ) : vp.view === 'cal' ? (
                <WsCalendar y={y} m={m} today={today} sel={sel} onPick={(d) => { setSel(d); if (!docked && vp.panelOpen !== true) setVp((v) => ({ ...v, panelOpen: true })); }} tickets={tickets} data={data} rules={rules} avail={availOpen ? range : null} />
              ) : vp.view === 'tl' ? (
                <WsTimeline
                  days={days}
                  today={today}
                  rules={rules}
                  tickets={tickets}
                  data={data}
                  people={visiblePeople}
                  epics={visibleEpics}
                  worked={worked}
                  group={vp.tlGroup}
                  onGroup={(g) => setVp((v) => ({ ...v, tlGroup: g }))}
                  epicOpen={vp.epicOpen}
                  onToggleEpic={(key) => setVp((v) => ({ ...v, epicOpen: { ...v.epicOpen, [key]: v.epicOpen[key] === false } }))}
                  onPickPerson={(id) => addFilter('person', id)}
                  onPickEpic={(key) => addFilter('epic', key)}
                  onOpenIssue={openIssue}
                />
              ) : (
                <WsStats stats={stats} epics={visibleEpics} biz={biz} month={m} filteredIds={filters.filter((f) => f.type === 'person').map((f) => f.id)} onPickPerson={(id) => addFilter('person', id)} onOpenHoliday={() => setHolidayOpen(true)} />
              )}
            </>
          )}
        </div>
        {panelShow && !empty && (
          <>
            {!docked && <div aria-hidden="true" onClick={() => setVp((v) => ({ ...v, panelOpen: false }))} style={{ position: 'absolute', inset: 0, background: 'rgba(46,42,38,.18)', zIndex: 4 }} />}
            <aside
              className="lnb-scroll"
              aria-label="날짜별 작업"
              style={{ ...(docked ? { position: 'relative', flex: '0 0 300px', width: 300 } : { position: 'absolute', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '88%', zIndex: 5, boxShadow: '-22px 0 44px -24px rgba(46,42,38,.5)' }), background: 'var(--mf-ws-card)', borderLeft: '1px solid var(--mf-ws-line)', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}
            >
              <WsSidePanel sel={sel} today={today} month={m} rules={rules} tickets={tickets} data={data} stats={stats} bizN={biz.biz.length} onOpenIssue={openIssue} onPickPerson={(id) => addFilter('person', id)} />
            </aside>
          </>
        )}
      </div>

      <WsHolidayModal open={holidayOpen} onClose={() => setHolidayOpen(false)} prefs={work} onChange={setWork} y={y} m={m} onToast={toolToast} />
    </div>
  );
}

function MonthArrow({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button type="button" className="btn mf-ws-arrow" aria-label={dir < 0 ? '이전 달' : '다음 달'} onClick={onClick} style={{ width: 30, height: 30, flexShrink: 0, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir < 0 ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
      </svg>
    </button>
  );
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div data-ws-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '80px 24px', textAlign: 'center' }}>
      <ToolIcon tool="jira" size={40} radius={12} font={18} />
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--mf-ws-ink)', marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--mf-ws-mut)', maxWidth: 360 }}>{body}</div>
      <button type="button" className="btn mf-tool-connect" data-ws-empty-action onClick={onAction} style={{ marginTop: 10, height: 36, padding: '0 18px', border: 0, borderRadius: 999, fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
        {action}
      </button>
    </div>
  );
}
