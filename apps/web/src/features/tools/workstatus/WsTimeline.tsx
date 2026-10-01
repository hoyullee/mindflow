import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { DOW, dowOf, holidayOf, layLanes, overlaps, type Dataset, type Epic, type HolidayRules, type Person, type Ticket } from './model';
import { Avatar, MONO, Seg, StatusBadge } from './wsUi';

const LEFT = 172;
const COL = 30;

interface Props {
  days: string[];
  today: string;
  rules: HolidayRules;
  tickets: Ticket[];
  data: Dataset;
  people: Person[];
  epics: Epic[];
  worked: Map<string, number>;
  group: 'person' | 'epic';
  onGroup: (g: 'person' | 'epic') => void;
  epicOpen: Record<string, boolean>;
  onToggleEpic: (key: string) => void;
  onPickPerson: (id: string) => void;
  onPickEpic: (key: string) => void;
  onOpenIssue: (key: string) => void;
}

/**
 * 타임라인 보기(스펙 §6) — 한 달을 날짜 칸으로 깔고 티켓을 막대로. 겹치면 레인을 나눠
 * 26px씩 아래로, 달 경계 밖은 잘라서. 가로로 넘치면 스크롤하고 이름 칸은 왼쪽에 붙어 있는다.
 */
export function WsTimeline(p: Props) {
  const n = p.days.length;
  const first = p.days[0] ?? '';
  const last = p.days[n - 1] ?? '';
  const todayIdx = p.days.indexOf(p.today);
  // 넘치면 **오늘이 보이게** 연다 — 달 끝의 오늘이 스크롤 밖에 숨어 세로선을 못 찾았다(실측 1600px:
  // 28일까지만 보였다). 달이 바뀔 때만 옮긴다(보던 자리를 묶음 전환마다 빼앗지 않게).
  const scrollRef = useRef<HTMLDivElement>(null);
  const month = first.slice(0, 7);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIdx < 0 || el.scrollWidth <= el.clientWidth) return;
    const col = (el.scrollWidth - LEFT) / n;
    el.scrollLeft = Math.max(0, LEFT + col * (todayIdx + 1) - el.clientWidth + col * 2);
  }, [month, todayIdx, n]);
  const offs = p.days.map((d) => (!p.rules.weekend && (dowOf(d) === 0 || dowOf(d) === 6)) || !!holidayOf(d, p.rules));

  const ticketRow = (t: Ticket, ep: Epic, nested: boolean) => {
    const person = p.data.pById.get(t.person.id);
    const b = layLanes([t], p.days).bars[0];
    return (
      <Row key={t.key} h={44} offs={offs} left={
        <button type="button" className="btn" onClick={() => p.onOpenIssue(t.key)} style={{ ...leftBtn, paddingLeft: nested ? 22 : 12, position: 'relative' }}>
          {nested && <span aria-hidden="true" style={{ position: 'absolute', left: 14, top: 8, width: 8, height: 14, borderLeft: '1px solid var(--mf-ws-line)', borderBottom: '1px solid var(--mf-ws-line)', borderBottomLeftRadius: 4 }} />}
          <span style={{ minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              {!nested && <span style={{ width: 8, height: 8, borderRadius: 2, background: ep.c, flexShrink: 0 }} />}
              <span style={nameStyle(12, 700)}>{t.summary}</span>
              <StatusBadge status={t.status} height={15} />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              {person && <PersonChip person={person} />}
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mf-ws-mut2)' }}>{t.key}</span>
            </span>
          </span>
        </button>
      }>
        <ReleaseMark t={t} days={p.days} top={9} />
        {b && <BarEl n={n} s={b.s} e={b.e} top={9} c={ep.c} bg={ep.bg} code={t.key} text={t.summary} dim={t.status === 'todo'} title={barTitle(t, person?.name ?? '')} onClick={() => p.onOpenIssue(t.key)} />}
      </Row>
    );
  };

  const rows: ReactNode[] = [];
  if (p.group === 'person') {
    for (const person of p.people) {
      const mine = p.tickets.filter((t) => t.person.id === person.id);
      const { bars, lanes } = layLanes(mine, p.days);
      const h = 16 + Math.max(1, lanes) * 26;
      rows.push(
        <Row key={person.id} h={h} offs={offs} left={
          <button type="button" className="btn" onClick={() => p.onPickPerson(person.id)} style={leftBtn}>
            <Avatar ini={person.ini} c={person.c} size={26} />
            <span style={{ minWidth: 0 }}>
              <span style={nameStyle(13, 700)}>{person.name}</span>
              <span style={subStyle}>티켓 {mine.filter((t) => overlaps(t, first, last)).length} · 진행 {p.worked.get(person.id) ?? 0}일</span>
            </span>
          </button>
        }>
          {bars.map((b) => <ReleaseMark key={`r:${b.item.key}`} t={b.item} days={p.days} top={8 + b.lane * 26} />)}
          {bars.map((b) => {
            const ep = p.data.eByKey.get(b.item.epic);
            return <BarEl key={b.item.key} n={n} s={b.s} e={b.e} top={8 + b.lane * 26} c={ep?.c ?? '#B7ACA1'} bg={ep?.bg ?? '#F3EEE8'} code={b.item.key} text={b.item.summary} dim={b.item.status === 'todo'} title={barTitle(b.item, ep && !ep.solo ? ep.name : '')} onClick={() => p.onOpenIssue(b.item.key)} />;
          })}
        </Row>,
      );
    }
  } else {
    for (const ep of p.epics) {
      const ts = p.tickets.filter((t) => t.epic === ep.key && overlaps(t, first, last)).sort((a, b) => a.start.localeCompare(b.start));
      if (ep.solo) {
        // 에픽 없는 티켓 — 묶음이 곧 티켓이라 머리 줄 없이 티켓 한 줄(머리 + 같은 막대 한 줄이 겹쳐 보였다).
        for (const t of ts) rows.push(ticketRow(t, ep, false));
        continue;
      }
      const open = p.epicOpen[ep.key] !== false;
      const done = ts.filter((t) => t.status === 'done').length;
      const owners = [...new Set(ts.map((t) => t.person.id))].map((id) => p.data.pById.get(id)).filter((x): x is Person => !!x);
      const es = ep.start ?? ts[0]?.start ?? null;
      const ee = ep.end ?? ts.reduce<string | null>((a, t) => (!a || t.end > a ? t.end : a), null);
      const span = es && ee && es <= last && ee >= first ? layLanes([{ start: es, end: ee }], p.days).bars[0] : undefined;
      rows.push(
        <Row key={ep.key} h={48} offs={offs} leftBg="var(--mf-ws-sunk)" left={
          <div style={{ ...leftBtn, cursor: 'default' }}>
            <button type="button" className="btn" aria-label={open ? '접기' : '펼치기'} aria-expanded={open} onClick={() => p.onToggleEpic(ep.key)} style={{ width: 22, height: 22, flexShrink: 0, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--mf-ws-mut)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .14s ease' }}>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button type="button" className="btn" onClick={() => p.onPickEpic(ep.key)} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: ep.c, flexShrink: 0 }} />
                <span style={nameStyle(13, 800)}>{ep.name}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, minWidth: 0 }}>
                {owners[0] && <PersonChip person={owners[0]} />}
                <span style={{ ...subStyle, marginTop: 0 }}>티켓 {ts.length} · 완료 {done}</span>
              </span>
            </button>
          </div>
        }>
          {span && <BarEl n={n} s={span.s} e={span.e} top={12} c={ep.c} bg={ep.c} fill code={ep.key} text={ep.name} dim={false} title={`에픽 ${ep.key} ${ep.name}\n${es} ~ ${ee}`} onClick={() => p.onOpenIssue(ep.key)} />}
        </Row>,
      );
      if (!open) continue;
      for (const t of ts) rows.push(ticketRow(t, ep, true));
    }
  }

  return (
    <div ref={scrollRef} data-ws-timeline className="lnb-scroll" style={{ height: '100%', boxSizing: 'border-box', background: 'var(--mf-ws-card)', borderTop: '1px solid var(--mf-ws-line)', overflow: 'auto' }}>
      <div style={{ minWidth: LEFT + n * COL, position: 'relative' }}>
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3, background: 'var(--mf-ws-card)', borderBottom: '1px solid var(--mf-ws-line)' }}>
          <div style={{ width: LEFT, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: 'var(--mf-ws-card)', display: 'flex', alignItems: 'center', padding: '0 12px', boxSizing: 'border-box', borderRight: '1px solid var(--mf-ws-line)' }}>
            <Seg items={[['person', '담당자별'], ['epic', '프로젝트별']]} value={p.group} onChange={p.onGroup} height={22} font={11} pad={9} label="타임라인 묶음" />
          </div>
          <div style={{ flex: '1 1 auto', display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(${COL}px, 1fr))` }}>
            {p.days.map((d, i) => {
              const w = dowOf(d);
              const isT = d === p.today;
              const hol = !!holidayOf(d, p.rules);
              return (
                <div key={d} style={{ height: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: offs[i] ? 'var(--mf-ws-off-head)' : 'transparent', borderRight: '1px solid var(--mf-ws-line)' }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: isT ? 800 : 600, color: isT ? '#E85E33' : hol || w === 0 ? '#C4614C' : w === 6 ? '#5F81BF' : 'var(--mf-ws-ink2)' }}>{Number(d.slice(8))}</span>
                  <span style={{ fontSize: 8.5, color: isT ? '#E85E33' : 'var(--mf-ws-faint)' }}>{DOW[w]}</span>
                </div>
              );
            })}
          </div>
        </div>
        {rows.length ? rows : <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--mf-ws-faint)' }}>조건에 맞는 {p.group === 'person' ? '담당자' : '프로젝트'}가 없어요</div>}
        {todayIdx >= 0 && <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${LEFT}px + (100% - ${LEFT}px) * ${(todayIdx + 0.5) / n})`, width: 1.5, background: '#E85E33', pointerEvents: 'none', zIndex: 2 }} />}
      </div>
    </div>
  );
}

const leftBtn = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: '100%', padding: '0 10px 0 12px', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left' as const, cursor: 'pointer', minWidth: 0, boxSizing: 'border-box' as const };
const nameStyle = (size: number, weight: number) => ({ display: 'block', fontSize: size, fontWeight: weight, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 });
const subStyle = { display: 'block', fontSize: 10.5, color: 'var(--mf-ws-mut2)', marginTop: 1, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' };

function Row({ h, offs, left, leftBg, children }: { h: number; offs: boolean[]; left: ReactNode; leftBg?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', height: h, borderBottom: '1px solid var(--mf-ws-line)' }}>
      <div style={{ width: LEFT, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: leftBg ?? 'var(--mf-ws-card)', borderRight: '1px solid var(--mf-ws-line)' }}>{left}</div>
      <div style={{ flex: '1 1 auto', position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${offs.length}, 1fr)` }}>
          {offs.map((o, i) => (
            <span key={i} style={{ background: o ? 'var(--mf-ws-off)' : 'transparent', borderRight: '1px solid var(--mf-ws-line)', opacity: 0.9 }} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function BarEl({ n, s, e, top, c, bg, code, text, dim, title, onClick, fill }: { n: number; s: number; e: number; top: number; c: string; bg: string; code: string; text: string; dim: boolean; title: string; onClick: () => void; fill?: boolean }) {
  return (
    <button
      type="button"
      className="btn mf-ws-bar"
      data-ws-bar={code}
      title={title}
      onClick={onClick}
      style={{ position: 'absolute', top, left: `${(s / n) * 100}%`, width: `calc(${((e - s + 1) / n) * 100}% - 3px)`, height: 22, display: 'flex', alignItems: 'center', gap: 5, padding: '0 7px', border: 0, borderLeft: `3px solid ${c}`, borderRadius: '4px 7px 7px 4px', background: bg, opacity: dim ? 0.6 : 1, fontFamily: 'inherit', cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box', zIndex: 1 }}
    >
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: fill ? '#FFFDFB' : c, flexShrink: 0 }}>{code}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: fill ? '#FFFDFB' : '#3A352F', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{text}</span>
    </button>
  );
}

function PersonChip({ person }: { person: Person }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 6px 0 2px', borderRadius: 999, border: '1px solid var(--mf-ws-chip-line)', flexShrink: 0, boxSizing: 'border-box' }}>
      <Avatar ini={person.ini} c={person.c} size={11} font={6.5} />
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mf-ws-ink2)', whiteSpace: 'nowrap' }}>{person.name}</span>
    </span>
  );
}

function barTitle(t: Ticket, sub: string): string {
  const flags = `${t.startMissing ? ' · 시작일 없음' : ''}${t.endMissing ? ' · 기한 없음' : ''}${t.filled ? ' · 날짜 없음(만든 날~해결된 날)' : ''}`;
  return `${t.key} ${t.summary}\n${sub ? `${sub} · ` : ''}${t.start} ~ ${t.end}${flags}${t.release ? `\n배포 예정 ${t.release}` : ''}`;
}

/** 배포 예정일 마름모 — 그 달 안이면 막대 줄의 그 날짜 칸 가운데에(막대 위에 얹힌다). */
function ReleaseMark({ t, days, top }: { t: Ticket; days: string[]; top: number }) {
  const i = t.release ? days.indexOf(t.release) : -1;
  if (i < 0) return null;
  return (
    <span
      data-ws-release-mark={t.key}
      title={`배포 예정 · ${t.key} ${t.summary} · ${t.release}`}
      style={{ position: 'absolute', top: top + 4, left: `calc(${((i + 0.5) / days.length) * 100}% - 7px)`, width: 14, height: 14, transform: 'rotate(45deg)', borderRadius: 3, background: '#4F79C2', boxShadow: '0 0 0 2px var(--mf-ws-card)', zIndex: 2, pointerEvents: 'auto' }}
    />
  );
}
