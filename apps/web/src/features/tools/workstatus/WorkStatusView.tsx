import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { JiraPerson } from '../jira/jiraApi';
import { beginJiraConnect, useJiraConn } from '../jira/jiraStore';
import { addLeave, deleteLeave, updateLeave, useJiraLeaves, type Leave, type LeaveInput } from '../jira/leavesStore';
import { leaveRange, type LeaveDraft } from './WsLeave';
import { openJiraSetup } from '../jira/JiraSetupModal';
import { WsIssueModal } from './WsIssueModal';
import { updateToolPrefs, useToolPrefs } from '../toolPrefsStore';
import type { WorkStatusPrefs } from '../toolPrefs';
import { TOOL_DEFS } from '../toolDefs';
import { ToolIcon, toolToast } from '../ui';
import {
  availability,
  bizDaysIn,
  buildDataset,
  computeStats,
  foldSolo,
  indexLeaves,
  leaveDaysIn,
  monthBiz,
  monthDays,
  overlaps,
  passes,
  suggest,
  workedDays,
  type Filter,
  type FilterType,
} from './model';
import { clearWorkStatusCache, localToday, useWorkStatusData, workStatusKey } from './useWorkStatusData';
import { FilterChips, type ChipItem } from './FilterChips';
import { WsCalendar } from './WsCalendar';
import { WsTimeline } from './WsTimeline';
import { WsStats } from './WsStats';
import { WsSidePanel } from './WsSidePanel';
import { quickRanges, WsAvail } from './WsAvail';
import { WsMembers } from './WsMembers';
import { WsHolidayModal } from './WsHolidayModal';
import { Avatar, AvatarStack, CalCheckIcon, MONO, popPanel, RoundButton, Seg, useDismiss } from './wsUi';
import { WsMobileCalendar, WsMobileStats } from './WsMobile';
import { MobileSheet } from '../../home/mobile/parts';

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

/**
 * 도구 · **작업 현황**(작업 현황 스펙) — Jira 에픽·티켓을 한 달 단위로 본다(달력·타임라인·집계).
 * 홈 본문을 꽉 채우고(LNB는 그대로 — 도구 스펙 §5), 안에서 스스로 스크롤한다.
 */
export function WorkStatusView({ isMobile, onOpenNav, onBack }: { isMobile: boolean; onOpenNav?: () => void; /** 폰의 `‹ 전체` — 전체 탭으로 돌아간다. */ onBack?: () => void }) {
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
  // 담당자 팝오버 안의 휴가 폼 — 한 번에 한 사람(휴가 스펙 §3.1). 팝오버가 닫히면 비운다.
  const [leaveDraft, setLeaveDraft] = useState<LeaveDraft | null>(null);

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
  const projKey = workStatusKey(conn);
  const ready = conn.connected && !!conn.site && conn.projects.length > 0;
  // `날짜 기준` 단추의 툴팁 — 지금 무엇으로 그리고 있는지 열지 않고도 보이게.
  const names = (xs: { name: string }[] | undefined) => [...new Set((xs ?? []).map((x) => x.name))].join(', ') || '전부';
  const dateRuleTitle = [
    `프로젝트 ${conn.projects.map((p) => p.name).join(', ') || '없음'}`,
    `이슈 유형 ${names(conn.issueTypes)}`,
    `상태 ${names(conn.issueStatuses)}`,
    `날짜 시작 ${conn.startField?.name ?? '없음'} · 끝 ${conn.endField?.name ?? '기한'} · 배포 ${conn.releaseField?.name ?? '표시 안 함'}`,
  ].join('\n');
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
  // 담당자 휴가 — 같은 Jira 사이트를 연결한 사람 모두가 보는 값(0050). 데모는 이 기기.
  const leaveSnap = useJiraLeaves(ready ? (conn.site?.id ?? null) : null);
  const data = useMemo(() => buildDataset(month.data?.epics ?? [], month.data?.tickets ?? [], work.extra), [month.data, work.extra]);
  const hidden = work.hidden;
  const peopleOn = data.people.filter((p) => !hidden.includes(p.id));
  const filters = vp.filters;
  const tickets = data.tickets.filter((t) => !hidden.includes(t.person.id) && passes(t, filters));
  const inMonth = tickets.filter((t) => overlaps(t, from, to));
  const visiblePeople = filters.length ? peopleOn.filter((p) => inMonth.some((t) => t.person.id === p.id)) : peopleOn;
  const visibleEpics = data.epics.filter((e) => inMonth.some((t) => t.epic === e.key));
  const biz = useMemo(() => monthBiz(y, m, rules), [y, m, rules]);
  // 집계는 에픽 없는 티켓을 한 열로 접는다(티켓마다 열이면 표가 티켓 수만큼 넓어진다).
  const folded = foldSolo(visibleEpics, tickets);
  // 휴가는 보이는 담당자 것만 그린다(끈 사람·필터 밖 사람의 휴가 줄은 칸만 차지한다). 계산은 사람별이라 전부 넘겨도 같다.
  const allLeaves = leaveSnap.leaves;
  const lv = useMemo(() => indexLeaves(allLeaves), [allLeaves]);
  const visibleIds = new Set(visiblePeople.map((p) => p.id));
  const shownLeaves = allLeaves.filter((l) => visibleIds.has(l.person));
  const stats = computeStats(visiblePeople, folded.epics, folded.tickets, biz.biz, lv);
  const worked = new Map(visiblePeople.map((p) => [p.id, workedDays(tickets, biz.biz, p.id, undefined, lv)]));
  const leaveDays = new Map(visiblePeople.map((p) => [p.id, leaveDaysIn(lv, p.id, biz.biz)]));
  const monthCount = new Map<string, number>();
  data.tickets.filter((t) => overlaps(t, from, to)).forEach((t) => monthCount.set(t.person.id, (monthCount.get(t.person.id) ?? 0) + 1));

  // 일정 맞춰보기 — 그 기간의 티켓(따로 받는다: 다음 달까지 걸칠 수 있다). 필터는 걸지 않는다 —
  // "누가 비었나"는 필터 밖의 사람에게도 묻는 질문이다. 끈 담당자만 뺀다.
  const availBiz = bizDaysIn(range.from, range.to, rules);
  const availRows = availability(
    peopleOn,
    (availData.data?.tickets ?? []).filter((t) => !hidden.includes(t.person.id)),
    availBiz,
    lv,
  );

  const addFilter = (type: FilterType, id: string) => {
    setVp((v) => (v.filters.some((f) => f.type === type && f.id === id) ? v : { ...v, filters: [...v.filters, { type, id }] }));
    setQ('');
    setSugOpen(false);
  };
  const removeFilter = (key: string) => setVp((v) => ({ ...v, filters: v.filters.filter((f) => `${f.type}:${f.id}` !== key) }));

  // 티켓 상세 팝업 — 새 창으로 Jira를 열던 것을 앱 안의 보기 전용 팝업으로(디자인 `Geurio Jira 티켓 상세 팝업`).
  // 에픽 칩·하위 티켓을 누르면 쌓이고 `‹`로 돌아온다. Jira 원문은 팝업의 `Jira에서 열기`.
  const [issueStack, setIssueStack] = useState<string[]>([]);
  const openIssue = (key: string) => setIssueStack((st) => (st[st.length - 1] === key ? st : [...st, key]));

  const issueModal = (
    <WsIssueModal stack={issueStack} onClose={() => setIssueStack([])} onBack={() => setIssueStack((st) => st.slice(0, -1))} onOpen={openIssue} data={data} siteUrl={conn.site?.url ?? ''} demo={conn.demo} today={today} isMobile={isMobile} />
  );
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
  useEffect(() => {
    if (!memberOpen) setLeaveDraft(null);
  }, [memberOpen]);
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
    <Empty title="볼 프로젝트를 골라 주세요" body="고른 프로젝트에서 담당자가 있는 티켓을 달력·타임라인·집계에 보여 줘요(에픽이 있으면 에픽별로)." action="프로젝트 고르기" onAction={() => openJiraSetup()} />
  ) : null;

  const personName = (id: string) => data.pById.get(id)?.name ?? allLeaves.find((l) => l.person === id)?.personName ?? '';
  const submitLeave = async (v: LeaveInput, editId?: string): Promise<boolean> => {
    const err = editId ? await updateLeave(editId, v) : await addLeave(v);
    if (err) {
      toolToast(err);
      return false;
    }
    setLeaveDraft(null);
    toolToast(`${v.personName} 님 휴가를 ${editId ? '고쳤어요' : '등록했어요'} · ${leaveRange(v)}`);
    return true;
  };
  const removeLeave = (l: Leave) => {
    void deleteLeave(l.id).then((r) => toolToast(r.error ?? `${personName(l.person) || l.personName} 님 휴가를 지웠어요`));
    if (leaveDraft?.editId === l.id) setLeaveDraft(null);
  };
  // 일정 맞춰보기의 `휴가` — 맞춰보기를 닫고 담당자 팝오버에서 그 기간을 채운 폼을 연다(휴가 스펙 §4).
  const leaveFromAvail = (id: string) => {
    setAvailOpen(false);
    setMemberOpen(true);
    setLeaveDraft({ person: id, start: range.from, end: range.to });
  };

  const membersPanel = (
    <WsMembers
      leave={{ leaves: allLeaves, today, rules, draft: leaveDraft, onDraft: setLeaveDraft, onSubmit: submitLeave, onDelete: removeLeave }}
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
  );
  const availPanel = (
    <WsAvail from={range.from} to={range.to} onRange={(f, t) => setRange({ name: '', from: f, to: t })} rows={availRows} bizN={availBiz.length} loading={availData.loading} data={data} onClose={() => setAvailOpen(false)} onPickPerson={(id) => addFilter('person', id)} onLeave={leaveFromAvail} />
  );
  const goThisMonth = () => {
    setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
    setSel(today);
  };
  const notices = (
    <>
      {month.error && (
        <div role="alert" data-ws-error style={{ display: 'flex', alignItems: 'center', gap: 10, margin: isMobile ? '0 20px 10px' : '10px 20px', padding: '10px 14px', borderRadius: 12, background: '#FBEDE6', color: '#C0563A', fontSize: 12.5, fontWeight: 700 }}>
          {month.error}
          <button type="button" className="btn" onClick={month.reload} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: '#C0563A', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
            다시 시도
          </button>
        </div>
      )}
      {month.data && !month.data.tickets.length && !month.error && (
        // 텅 빈 달 — 대개 날짜가 비어 있거나 다른 필드에 적혀 있다(제보 2026-10-01). 고칠 자리로 바로 보낸다.
        <div data-ws-nodata style={{ display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? '4px 10px' : 10, margin: isMobile ? '0 20px 10px' : '10px 20px 0', padding: '10px 14px', borderRadius: 12, background: 'var(--mf-ws-sunk)', color: 'var(--mf-ws-mut)', fontSize: 12.5, fontWeight: 600 }}>
          이 달에 그릴 티켓이 없어요 · 담당자가 있고 날짜가 이 달에 걸린 티켓만 보여요
          <button type="button" className="btn" onClick={() => openJiraSetup(undefined, { focus: 'dates' })} style={{ marginLeft: 'auto', flexShrink: 0, border: 0, background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
            날짜 기준 바꾸기
          </button>
        </div>
      )}
      {month.data?.truncated && <div style={{ margin: isMobile ? '0 20px 10px' : '8px 20px 0', fontSize: 12, color: 'var(--mf-ws-mut)' }}>티켓이 많아 앞의 1,000건만 불러왔어요 · 프로젝트를 줄여 보세요</div>}
    </>
  );
  const suggestList = (
    <>
      {sugGroups.map((g) => (
        <div key={g.name}>
          <div style={{ padding: '8px 8px 4px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-ws-faint)' }}>{g.name}</div>
          {g.items.map((it) => (
            <button key={it.key} type="button" className="btn mf-tool-row" onClick={it.pick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: isMobile ? 44 : 34, padding: '0 8px', border: 0, borderRadius: 9, background: it.on ? '#F7F0E8' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              {it.icon}
              <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 700, color: 'var(--mf-ws-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', flexShrink: 0 }}>{it.meta}</span>
            </button>
          ))}
        </div>
      ))}
      {!sugGroups.length && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>일치하는 항목이 없어요</div>}
    </>
  );

  if (isMobile) {
    /**
     * **폰 판**(모바일 디자인 A — W1~W5). 데스크톱 머리는 [도구 · 이름 / 월 / 요약] · 검색 · [담당자 · 보기 · 맞춰보기 · 설정 ·
     * 패널 · 휴일]을 한 줄에 세운다 — 390px에서는 단추가 세 줄로 접혀 달력이 화면 아래로 밀렸다. 폰은 넷으로 나눈다:
     * 맨 위 `‹ 전체`와 휴일, 월 제목과 보기 세그먼트, 검색 + 담당자 + 맞춰보기, 그리고 보기. 오른쪽 패널(고른 날의 작업)은
     * 달력 **아래 목록**이 되고, 담당자·맞춰보기는 바닥 시트로 연다. `Jira 설정`은 빈 달 안내와 전체 탭의 `도구 관리`가 맡는다.
     */
    const topBtn = { height: 40, minWidth: 40, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-ws-mut)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' } as const;
    return (
      <div data-work-status data-ws-mobile style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--mf-ws-bg)', color: 'var(--mf-ws-ink)' }}>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, height: 44, padding: '0 8px' }}>
          {onBack && (
            <button type="button" className="btn" data-ws-back onClick={onBack} style={{ ...topBtn, gap: 2, padding: '0 8px', fontSize: 15, fontWeight: 700 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
              전체
            </button>
          )}
          <span style={{ flex: 1 }} />
          {!isNow && (
            <button type="button" className="btn" data-ws-this-month onClick={goThisMonth} style={{ height: 30, padding: '0 12px', marginRight: 2, borderRadius: 999, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              이번 달
            </button>
          )}
          {ready && (
            <button type="button" className="btn" aria-label="새로 불러오기" onClick={month.reload} style={topBtn}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={month.loading ? 'mf-ws-spin' : undefined}>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
              </svg>
            </button>
          )}
          <button type="button" className="btn" data-ws-holiday-btn aria-label="휴일 · 영업일 설정" onClick={() => setHolidayOpen(true)} style={topBtn}>
            <CalCheckIcon size={20} />
          </button>
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '0 20px 10px' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--mf-ws-faint)', minWidth: 0 }}>
              <ToolIcon tool="jira" size={14} radius={4} font={8} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: -8 }}>
              <MonthArrow dir={-1} onClick={() => shift(-1)} />
              <h1 data-ws-month style={{ margin: 0, fontSize: 'clamp(20px, 6.2vw, 26px)', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--mf-ws-ink)', whiteSpace: 'nowrap' }}>
                {y}년 {m}월
              </h1>
              <MonthArrow dir={1} onClick={() => shift(1)} />
            </span>
          </span>
          <span style={{ flexShrink: 0, paddingBottom: 1 }}>
            <Seg items={[['cal', '달력'], ['tl', '타임라인'], ['stats', '집계']]} value={vp.view} onChange={(v) => setVp((x) => ({ ...x, view: v }))} height={28} font={12} pad={10} label="보기" />
          </span>
        </div>

        {!empty && (
          <>
            <div ref={searchRef} style={{ flex: '0 0 auto', position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 10px' }}>
              <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderRadius: 999, border: `1px solid ${sugOpen && q ? '#E8A25F' : 'var(--mf-ws-line2)'}`, background: 'var(--mf-ws-card)', boxSizing: 'border-box' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-ws-faint)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input data-ws-search value={q} onChange={(e) => { setQ(e.target.value); setSugOpen(true); }} onFocus={() => setSugOpen(!!q)} onKeyDown={onSearchKey} placeholder="담당자, 프로젝트, 티켓" aria-label="담당자, 프로젝트, 티켓 키로 걸러 보기" enterKeyHint="search" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 16 }} />
              </label>
              <button type="button" className="btn" data-ws-members-btn aria-label={`담당자 ${peopleOn.length}/${data.people.length}`} onClick={() => setMemberOpen(true)} style={{ flexShrink: 0, height: 38, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 9px 0 7px', borderRadius: 999, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', cursor: 'pointer' }}>
                <AvatarStack people={peopleOn} size={20} max={3} overlap={6} ring="var(--mf-ws-card)" />
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700 }}>{peopleOn.length}</span>
              </button>
              <button type="button" className="btn" data-ws-avail-btn aria-label="일정 맞춰보기" aria-expanded={availOpen} onClick={() => setAvailOpen(true)} style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 999, border: '1px solid color-mix(in srgb, var(--mf-success-ink) 24%, transparent)', background: 'var(--mf-success-soft)', color: 'var(--mf-success-ink)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalCheckIcon size={17} />
              </button>
              {sugOpen && !!q.trim() && (
                <div data-ws-suggest className="lnb-scroll" style={popPanel({ top: 44, left: 16, right: 16, maxHeight: 'min(360px, 50dvh)', overflowY: 'auto', padding: 6 })}>
                  {suggestList}
                </div>
              )}
            </div>
            {chips.length > 0 && (
              <div data-ws-mchips className="mf-m-scroll" style={{ flex: '0 0 auto', display: 'flex', gap: 6, overflowX: 'auto', padding: '0 20px 10px' }}>
                {chips.map((c) => (
                  <span key={c.key} data-ws-chip-filter={c.key} style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 4px 0 10px', borderRadius: 99, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-ink)', whiteSpace: 'nowrap' }}>
                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: c.round ? 99 : 2, background: c.c }} />
                    {c.name}
                    <button type="button" className="btn" aria-label={`${c.name} 필터 빼기`} onClick={() => removeFilter(c.key)} style={{ width: 22, height: 22, border: 0, borderRadius: 99, background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </span>
                ))}
                {chips.length > 1 && (
                  <button type="button" className="btn" data-ws-chips-clear onClick={() => setVp((v) => ({ ...v, filters: [] }))} style={{ flex: '0 0 auto', height: 28, padding: '0 10px', borderRadius: 99, border: 0, background: 'transparent', color: 'var(--mf-ws-mut)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    모두 지우기
                  </button>
                )}
              </div>
            )}
            {notices}
          </>
        )}

        <div className="mf-m-scroll" data-ws-body style={{ flex: '1 1 auto', minHeight: 0, overflowY: vp.view === 'tl' ? 'hidden' : 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {empty ??
            (!month.data && month.loading ? (
              <div aria-busy="true" style={{ padding: '60px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)' }}>
                Jira에서 불러오는 중…
              </div>
            ) : vp.view === 'cal' ? (
              <WsMobileCalendar y={y} m={m} today={today} sel={sel} onPick={setSel} onShift={shift} tickets={tickets} data={data} rules={rules} avail={availOpen ? range : null} onOpenIssue={openIssue} />
            ) : vp.view === 'tl' ? (
              <>
                {/* 묶음 고르기는 표 위로 — 폰의 이름 열(118px)에는 세그먼트가 들어가지 않는다(디자인 W2). */}
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 20px 10px' }}>
                  <Seg items={[['person', '담당자'], ['epic', '프로젝트']]} value={vp.tlGroup} onChange={(g) => setVp((v) => ({ ...v, tlGroup: g }))} height={24} font={11.5} pad={10} label="타임라인 묶음" />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--mf-ws-mut2)', whiteSpace: 'nowrap' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    옆으로 밀어 날짜 이동
                  </span>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                  <WsTimeline
                    compact
                    days={days}
                    today={today}
                    rules={rules}
                    tickets={tickets}
                    data={data}
                    people={visiblePeople}
                    epics={visibleEpics}
                    worked={worked}
                  leaves={shownLeaves}
                  leaveDays={leaveDays}
                    group={vp.tlGroup}
                    onGroup={(g) => setVp((v) => ({ ...v, tlGroup: g }))}
                    epicOpen={vp.epicOpen}
                    onToggleEpic={(key) => setVp((v) => ({ ...v, epicOpen: { ...v.epicOpen, [key]: v.epicOpen[key] === false } }))}
                    onPickPerson={(id) => addFilter('person', id)}
                    onPickEpic={(key) => addFilter('epic', key)}
                    onOpenIssue={openIssue}
                  />
                </div>
              </>
            ) : (
              <WsMobileStats stats={stats} biz={biz} month={m} onOpenHoliday={() => setHolidayOpen(true)} />
            ))}
        </div>

        <MobileSheet open={memberOpen} onClose={() => setMemberOpen(false)} label="담당자" attrs={{ 'data-ws-members-sheet': '' }}>
          <div className="mf-m-scroll" style={{ overflowY: 'auto', minHeight: 0, padding: '4px 4px 8px' }}>
            {membersPanel}
          </div>
        </MobileSheet>
        <MobileSheet open={availOpen} onClose={() => setAvailOpen(false)} label="일정 맞춰보기" attrs={{ 'data-ws-avail-sheet': '' }} maxHeight="calc(100% - 180px)">
          {availPanel}
        </MobileSheet>
        <WsHolidayModal open={holidayOpen} onClose={() => setHolidayOpen(false)} prefs={work} onChange={setWork} y={y} m={m} onToast={toolToast} />
      {issueModal}
      </div>
    );
  }

  const pad = isMobile ? '12px 14px 12px' : '16px 20px 14px 32px';
  return (
    <div data-work-status style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--mf-ws-bg)', color: 'var(--mf-ws-ink)' }}>
      {/* 헤더(스펙 §4) */}
      <div style={{ padding: pad, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, background: 'var(--mf-cal-head)', backgroundImage: 'radial-gradient(var(--mf-cal-head-dot) 1px, transparent 1px)', backgroundSize: '18px 18px', backgroundPosition: '-9px -9px', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-mut)' }}>
            {isMobile && onOpenNav && (
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
              <button type="button" className="btn" data-ws-this-month onClick={goThisMonth} style={{ height: 28, padding: '0 11px', marginLeft: 4, borderRadius: 999, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                이번 달
              </button>
            )}
          </div>
          <div data-ws-summary style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 7px', paddingLeft: 32, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--mf-ws-mut)' }}>
            <span>{siteHost}</span>
            {[
              // 에픽 없는 티켓은 자기 자신이 묶음이라 세지 않는다(세면 티켓 수와 같아진다).
              ...(visibleEpics.some((e) => !e.solo) ? [['에픽', visibleEpics.filter((e) => !e.solo).length]] : []),
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
              {suggestList}
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
                {membersPanel}
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
                {availPanel}
              </div>
            )}
          </div>
          {ready && (
            // `Jira 설정` — 프로젝트·이슈 유형·상태·날짜 기준을 한 팝업에서 정한다. 처음 이름(`날짜 기준`)은 팝업에
            // 무엇이 있는지 말하지 못했다(요청 2026-10-01). 지금 설정은 툴팁으로.
            <button type="button" className="btn" data-ws-date-rule-btn aria-label="Jira 설정 — 프로젝트 · 이슈 유형 · 상태 · 날짜 기준" title={dateRuleTitle} onClick={() => openJiraSetup()} style={{ height: 32, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px 0 10px', borderRadius: 999, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)', color: 'var(--mf-ws-ink2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
                <circle cx="16" cy="6" r="2" />
                <circle cx="10" cy="12" r="2" />
                <circle cx="18" cy="18" r="2" />
              </svg>
              Jira 설정
            </button>
          )}
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
              {notices}
              {!month.data && month.loading ? (
                <div aria-busy="true" style={{ padding: '60px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)' }}>
                  Jira에서 불러오는 중…
                </div>
              ) : vp.view === 'cal' ? (
                <WsCalendar y={y} m={m} today={today} sel={sel} onPick={(d) => { setSel(d); if (!docked && vp.panelOpen !== true) setVp((v) => ({ ...v, panelOpen: true })); }} tickets={tickets} data={data} rules={rules} avail={availOpen ? range : null} onOpenIssue={openIssue} leaves={shownLeaves} />
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
                  leaves={shownLeaves}
                  leaveDays={leaveDays}
                  group={vp.tlGroup}
                  onGroup={(g) => setVp((v) => ({ ...v, tlGroup: g }))}
                  epicOpen={vp.epicOpen}
                  onToggleEpic={(key) => setVp((v) => ({ ...v, epicOpen: { ...v.epicOpen, [key]: v.epicOpen[key] === false } }))}
                  onPickPerson={(id) => addFilter('person', id)}
                  onPickEpic={(key) => addFilter('epic', key)}
                  onOpenIssue={openIssue}
                />
              ) : (
                <WsStats stats={stats} epics={folded.epics} biz={biz} month={m} filteredIds={filters.filter((f) => f.type === 'person').map((f) => f.id)} onPickPerson={(id) => addFilter('person', id)} onOpenHoliday={() => setHolidayOpen(true)} />
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
              <WsSidePanel sel={sel} today={today} month={m} rules={rules} tickets={tickets} data={data} stats={stats} bizN={biz.biz.length} onOpenIssue={openIssue} onPickPerson={(id) => addFilter('person', id)} leaves={shownLeaves} />
            </aside>
          </>
        )}
      </div>

      <WsHolidayModal open={holidayOpen} onClose={() => setHolidayOpen(false)} prefs={work} onChange={setWork} y={y} m={m} onToast={toolToast} />
      {issueModal}
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
