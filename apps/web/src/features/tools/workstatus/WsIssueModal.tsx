import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdfView } from './AdfView';
import { Modal } from '../../../components/Modal';
import { jiraReasonText, jiraSource, type DetailField, type JiraIssueDetail } from '../jira/jiraApi';
import { EPIC_PALETTE, PERSON_PALETTE, type Dataset } from './model';
import { Avatar, MONO, STATUS } from './wsUi';

/**
 * 작업 현황 · **티켓 상세 팝업**(디자인 `Geurio Jira 티켓 상세 팝업`) — 달력 칩·타임라인 막대·패널 항목을
 * 누르면 연다. 보기 전용이다(상태 변경·댓글은 Jira에서). 에픽이면 하위 티켓 목록과 완료 진행률.
 *
 * - 머리: 유형 사각·키 · 상태 알약 · 유형 이름 · 상위 에픽 칩(누르면 그 에픽으로) · Jira에서 열기 · 닫기
 * - 본문 왼쪽: 제목 · 설명(전부) · 하위 티켓 · 최근 댓글 셋 / 오른쪽 320px: 담당자·보고자 · 기간(남은 날)
 *   · 우선순위 · 프로젝트 · 스프린트 · 「모든 필드」(접어 둔다 — 빈 필드는 개수만)
 * - 폰: 전체 화면, 오른쪽 열은 제목 아래로 내려온다.
 *
 * 상세는 저장하지 않는다 — 한 번 연 것은 1분 동안만 이 탭에 들고 있다(같은 티켓을 오가며 볼 때 다시 묻지 않게).
 */

const TTL = 60_000;
const cache = new Map<string, { at: number; d: JiraIssueDetail }>();

const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const ini = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** 날짜 `YYYY-MM-DD` → `MM.DD`. */
const md = (d: string | null) => (d ? d.slice(5).replace('-', '.') : '');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 기간 아래의 알약 — 시작 전 · N일 남음(3일 이하면 주황) · N일 지남 · 완료. */
export function dueLabel(start: string | null, end: string | null, done: boolean, today: string): { text: string; bg: string; fg: string } | null {
  if (done) return { text: '완료', bg: '#EBF5EE', fg: '#2F7D57' };
  if (!end) return null;
  if (start && today < start) return { text: `${daysBetween(today, start)}일 뒤 시작`, bg: '#F3EEE8', fg: '#8A8078' };
  const left = daysBetween(today, end);
  if (left < 0) return { text: `${-left}일 지남`, bg: '#FBEDE6', fg: '#C0563A' };
  if (left === 0) return { text: '오늘 마감', bg: '#FBF3E4', fg: '#B0781E' };
  return left <= 3 ? { text: `${left}일 남음`, bg: '#FBF3E4', fg: '#B0781E' } : { text: `${left}일 남음`, bg: '#EBF5EE', fg: '#2F7D57' };
}

/** 우선순위 아이콘 — Jira 기본 id(1 가장 높음 ~ 5 가장 낮음)로, 모르면 이름으로 짐작. */
function priorityIcon(p: { id: string; name: string }): { c: string; d: string } {
  const n = p.name.toLowerCase();
  const lv = /^[1-5]$/.test(p.id) ? Number(p.id) : /highest|blocker|critical|긴급|매우 높|p1/.test(n) ? 1 : /high|높|p2/.test(n) ? 2 : /lowest|매우 낮|p5/.test(n) ? 5 : /low|낮|p4/.test(n) ? 4 : 3;
  if (lv === 1) return { c: '#D8542A', d: 'M6 11l6-6 6 6M6 18l6-6 6 6' };
  if (lv === 2) return { c: '#E07B39', d: 'M6 15l6-6 6 6' };
  if (lv === 4) return { c: '#5B8DEF', d: 'M6 9l6 6 6-6' };
  if (lv === 5) return { c: '#3A9BB5', d: 'M6 6l6 6 6-6M6 13l6 6 6-6' };
  return { c: '#D8A24F', d: 'M5 12h14' };
}

export function WsIssueModal({ stack, onClose, onBack, onOpen, data, siteUrl, demo, today, isMobile }: { stack: string[]; onClose: () => void; onBack: () => void; onOpen: (key: string) => void; data: Dataset; siteUrl: string; demo: boolean; today: string; isMobile: boolean }) {
  const key = stack[stack.length - 1] ?? null;
  return (
    <Modal
      open={!!key}
      onClose={onClose}
      label={key ? `Jira ${key} 상세` : 'Jira 상세'}
      dim={isMobile ? { zIndex: 95, background: 'var(--mf-ws-card)' } : { zIndex: 95, background: 'rgba(58,52,46,.32)', backdropFilter: 'blur(5px)', padding: 16 }}
      card={
        isMobile
          ? { outline: 'none', width: '100%', height: 'var(--mf-app-h)', display: 'flex', flexDirection: 'column', background: 'var(--mf-ws-card)', overflow: 'hidden' }
          : // 크게 연다(요청 2026-10-02: 디자인의 860×680은 설명·필드가 많은 티켓에 좁았다) — 화면 폭의 92%(최대 1160) ×
            // 위아래 32px씩 남긴 높이(최대 960). 작은 창에서는 막의 여백 16px 안쪽까지.
            { outline: 'none', width: 'min(1160px, 92vw)', maxWidth: '100%', height: 'min(960px, calc(var(--mf-app-h) - 64px))', maxHeight: 'calc(var(--mf-app-h) - 32px)', display: 'flex', flexDirection: 'column', borderRadius: 24, background: 'var(--mf-ws-card)', border: '1px solid var(--mf-ws-line)', boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)', overflow: 'hidden', animation: 'mf-fade .2s ease' }
      }
      cardAttrs={{ 'data-ws-issue': key ?? '' }}
    >
      {key && <Body key={key} issueKey={key} canBack={stack.length > 1} onBack={onBack} onClose={onClose} onOpen={onOpen} data={data} siteUrl={siteUrl} demo={demo} today={today} isMobile={isMobile} />}
    </Modal>
  );
}

function Body({ issueKey, canBack, onBack, onClose, onOpen, data, siteUrl, demo, today, isMobile }: { issueKey: string; canBack: boolean; onBack: () => void; onClose: () => void; onOpen: (key: string) => void; data: Dataset; siteUrl: string; demo: boolean; today: string; isMobile: boolean }) {
  const hit = cache.get(issueKey);
  const [d, setD] = useState<JiraIssueDetail | null>(hit && Date.now() - hit.at < TTL ? hit.d : null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number>(hit?.at ?? Date.now());
  const [nonce, setNonce] = useState(0);
  // 「모든 필드」는 **펼쳐 둔다**(제보 2026-10-02: 채워진 필드까지 숨어 보였다 — 빈 필드는 처음부터 빠져 있다). 접으면 접힌다.
  const [allOpen, setAllOpen] = useState(true);

  useEffect(() => {
    const c = cache.get(issueKey);
    if (c && Date.now() - c.at < TTL && !nonce) return;
    let alive = true;
    setErr(null);
    void jiraSource()
      .issue(issueKey)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          const now = Date.now();
          cache.set(issueKey, { at: now, d: r.issue });
          setD(r.issue);
          setAt(now);
        } else setErr(jiraReasonText(r.reason));
      });
    return () => {
      alive = false;
    };
  }, [issueKey, nonce]);

  // 색 — 작업 현황이 칠한 색을 그대로(묶음 = 에픽 또는 티켓 자신). 모르면 키로 고른다.
  const groupKey = d?.type.epic ? issueKey : (d?.epic?.key ?? data.tickets.find((t) => t.key === issueKey)?.epic ?? issueKey);
  const ep = data.eByKey.get(groupKey);
  const pal = EPIC_PALETTE[hash(groupKey) % EPIC_PALETTE.length]!;
  const c = ep?.c ?? pal.c;
  const cbg = ep?.bg ?? pal.bg;
  const pColor = useCallback((id: string) => data.pById.get(id)?.c ?? PERSON_PALETTE[hash(id) % PERSON_PALETTE.length]!, [data]);
  const url = `${siteUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(issueKey)}`;
  const openJira = (e: { preventDefault: () => void }) => {
    if (!demo && siteUrl) return;
    e.preventDefault();
  };

  const st = d ? STATUS[d.status.cat] : null;
  const head = (
    <div data-ws-issue-head style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px 16px' : '16px 18px 14px 24px', borderBottom: '1px solid var(--mf-ws-line)', flexShrink: 0, minWidth: 0 }}>
      {canBack && (
        <button type="button" className="btn" aria-label="뒤로" onClick={onBack} style={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: c }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, background: c, color: '#fff', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{d ? (d.type.epic ? 'E' : ini(d.type.name)) : ''}</span>
        {issueKey}
      </span>
      {d && st && (
        <span data-ws-issue-status style={{ height: 20, padding: '0 8px', borderRadius: 99, background: st.bg, color: st.fg, fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.status.name}</span>
      )}
      {d && !isMobile && <span style={{ fontSize: 11.5, color: 'var(--mf-ws-faint)', whiteSpace: 'nowrap' }}>{d.type.name}</span>}
      {d?.epic && !isMobile && (
        <>
          <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--mf-ws-chip-line)', flexShrink: 0 }} />
          <EpicChip epic={d.epic} c={c} onOpen={onOpen} />
        </>
      )}
      <span style={{ flex: 1 }} />
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={openJira} data-ws-issue-jira style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', border: '1px solid var(--mf-ws-line2)', borderRadius: 99, background: 'var(--mf-ws-card)', fontSize: 12, fontWeight: 800, color: 'var(--mf-ws-mut)', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none' }}>
        {isMobile ? 'Jira' : 'Jira에서 열기'}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </a>
      <button type="button" className="btn" aria-label="닫기" onClick={onClose} style={{ ...iconBtn, background: '#FBF3EE' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );

  if (!d) {
    return (
      <>
        {head}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, color: 'var(--mf-ws-faint)', fontSize: 13 }}>
          {err ? (
            <>
              <span role="alert" style={{ color: '#C0563A', fontWeight: 700 }}>{err}</span>
              <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} style={{ border: 0, background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
                다시 시도
              </button>
            </>
          ) : (
            <span aria-busy="true">Jira에서 불러오는 중…</span>
          )}
        </div>
      </>
    );
  }

  const due = dueLabel(d.start, d.end, d.status.cat === 'done', today);
  const kids = d.children ?? [];
  const doneN = kids.filter((k) => k.status === 'done').length;
  const pct = kids.length ? Math.round((doneN / kids.length) * 100) : 0;

  const meta = (
    <div className="lnb-scroll" data-ws-issue-meta style={{ minHeight: 0, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '16px 20px' : '20px 20px 22px', borderLeft: isMobile ? 0 : '1px solid var(--mf-ws-line)', borderTop: isMobile ? '1px solid var(--mf-ws-line)' : 0, borderBottom: isMobile ? '1px solid var(--mf-ws-line)' : 0, background: 'var(--mf-ws-bg)', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <MetaRow label="담당자">{d.assignee ? <PersonLine id={d.assignee.id} name={d.assignee.name} color={pColor} /> : <Dim>없음</Dim>}</MetaRow>
      <MetaRow label="보고자">{d.reporter ? <PersonLine id={d.reporter.id} name={d.reporter.name} color={pColor} /> : <Dim>없음</Dim>}</MetaRow>
      <div style={{ height: 1, background: 'var(--mf-ws-line)' }} />
      <MetaRow label="기간">
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--mf-ws-ink)', whiteSpace: 'nowrap' }}>{d.start || d.end ? `${md(d.start ?? d.end)} – ${md(d.end ?? d.start)}` : '날짜 없음'}</span>
        {due && <span data-ws-issue-due style={{ alignSelf: 'flex-start', height: 20, padding: '0 8px', borderRadius: 99, background: due.bg, color: due.fg, fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{due.text}</span>}
      </MetaRow>
      {d.priority && (
        <MetaRow label="우선순위">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={priorityIcon(d.priority).c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={priorityIcon(d.priority).d} />
            </svg>
            {d.priority.name}
          </span>
        </MetaRow>
      )}
      <MetaRow label="프로젝트">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 5, background: cbg, color: c, fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{ini(d.project.key)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.project.name || d.project.key}</span>
        </span>
      </MetaRow>
      {d.sprint && <MetaRow label="스프린트"><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>{d.sprint}</span></MetaRow>}
      <div style={{ height: 1, background: 'var(--mf-ws-line)' }} />
      <button type="button" className="btn mf-tool-row" data-ws-issue-all aria-expanded={allOpen} onClick={() => setAllOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '-6px -8px', padding: '6px 8px', border: 0, borderRadius: 9, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#A89C90" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: allOpen ? 'rotate(90deg)' : 'none', transition: 'transform .14s ease' }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mf-ws-ink2)' }}>모든 필드</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)' }}>{d.fields.length}</span>
        <span style={{ flex: 1 }} />
        {d.hiddenEmpty > 0 && <span style={{ fontSize: 10.5, color: 'var(--mf-ws-faint)', whiteSpace: 'nowrap' }}>빈 필드 {d.hiddenEmpty}개 숨김</span>}
      </button>
      {allOpen && (
        <div data-ws-issue-fields style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {d.fields.map((f, i) => (
            <FieldRow key={`${f.label}:${i}`} f={f} color={pColor} />
          ))}
        </div>
      )}
    </div>
  );

  const main = (
    // 가로로는 굴리지 않는다 — 긴 주소·넓은 표가 본문을 옆으로 밀어 Shift+휠·드래그에 본문이 비껴 보였다(제보 2026-10-02).
    <div className="lnb-scroll" style={{ minHeight: 0, minWidth: 0, overflowX: 'hidden', overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '18px 20px 20px' : '22px 26px 26px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <span data-ws-issue-title style={{ fontSize: isMobile ? 20 : 21, fontWeight: 800, lineHeight: 1.35, letterSpacing: '-.03em', color: 'var(--mf-ws-ink)', wordBreak: 'keep-all' }}>{d.summary}</span>
      {isMobile && d.epic && <EpicChip epic={d.epic} c={c} onOpen={onOpen} />}
      {isMobile && meta}
      {/* 본문은 **늘 전부** 보인다(요청 2026-10-02 — `더 보기` 접기를 걷었다). */}
      <Section title="설명">
        {d.description || d.descriptionDoc ? (
          <div data-ws-issue-desc style={{ minWidth: 0 }}>
            {d.descriptionDoc ? (
              <AdfView doc={d.descriptionDoc} style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--mf-ws-ink2)' }} />
            ) : (
              <span style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--mf-ws-ink2)', whiteSpace: 'pre-line', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{d.description}</span>
            )}
          </div>
        ) : (
          <Dim>설명이 없어요</Dim>
        )}
      </Section>
      {d.children && (
        <Section
          title="하위 티켓"
          count={`${doneN}/${kids.length}`}
          extra={
            kids.length > 0 && (
              <>
                <span style={{ width: 120, flexShrink: 0, height: 5, borderRadius: 99, background: 'var(--mf-ws-soft)', overflow: 'hidden', display: 'block' }}>
                  <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: c, borderRadius: 99 }} />
                </span>
                <span style={{ fontSize: 11, color: 'var(--mf-ws-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>완료 {pct}%</span>
              </>
            )
          }
        >
          {kids.length ? (
            <div data-ws-issue-children style={{ display: 'flex', flexDirection: 'column', borderRadius: 14, border: '1px solid var(--mf-ws-line)', overflow: 'hidden' }}>
              {kids.map((k, i) => {
                const done = k.status === 'done';
                return (
                  <button key={k.key} type="button" className="btn mf-tool-row" data-ws-issue-child={k.key} onClick={() => onOpen(k.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 12px 0 14px', border: 0, borderTop: i ? '1px solid var(--mf-ws-line)' : 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                    <span aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 99, border: `1.5px solid ${k.status === 'todo' ? '#D9CFC3' : c}`, background: done ? c : k.status === 'doing' ? cbg : 'var(--mf-ws-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                      {done && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 13 4.5 4.5L19 7" />
                        </svg>
                      )}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', flexShrink: 0 }}>{k.key}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: done ? '#A29B90' : 'var(--mf-ws-ink)', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.summary}</span>
                    {(k.start || k.end) && !isMobile && <span style={{ fontFamily: MONO, fontSize: 11, color: '#A29B90', whiteSpace: 'nowrap' }}>{`${md(k.start ?? k.end)}–${md(k.end ?? k.start)}`}</span>}
                    {k.person && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                        <Avatar ini={ini(k.person.name)} c={pColor(k.person.id)} size={18} font={7.5} />
                        {!isMobile && <span style={{ fontSize: 12, color: 'var(--mf-ws-ink2)', whiteSpace: 'nowrap' }}>{k.person.name}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <Dim>하위 티켓이 없어요</Dim>
          )}
        </Section>
      )}
      <Section title="댓글" count={String(d.commentTotal)}>
        {d.comments.length ? (
          d.comments.map((cm, i) => (
            <div key={i} data-ws-issue-comment style={{ display: 'flex', gap: 10 }}>
              <Avatar ini={ini(cm.author.name)} c={pColor(cm.author.id)} size={26} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>{cm.author.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--mf-ws-faint)' }}>{ago(cm.created, at)}</span>
                </span>
                {cm.doc ? <AdfView doc={cm.doc} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--mf-ws-ink2)' }} /> : <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--mf-ws-ink2)', wordBreak: 'keep-all', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{cm.text}</span>}
              </span>
            </div>
          ))
        ) : (
          <Dim>댓글이 없어요</Dim>
        )}
        {d.commentTotal > d.comments.length && (
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={openJira} style={{ ...linkBtn, textDecoration: 'none' }}>
            댓글 {d.commentTotal}개 모두 보기 ↗
          </a>
        )}
      </Section>
    </div>
  );

  return (
    <>
      {head}
      {isMobile ? (
        <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{main}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          {main}
          {meta}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '10px 16px calc(env(safe-area-inset-bottom, 0px) + 10px)' : '10px 20px 12px 24px', borderTop: '1px solid var(--mf-ws-line)', background: 'var(--mf-ws-bg)', fontSize: 11.5, color: 'var(--mf-ws-mut)', flexShrink: 0 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#B0A69B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>보기 전용이에요. 상태 변경과 댓글은 Jira에서 해요.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" title="새로 불러오기" onClick={() => setNonce((n) => n + 1)} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: MONO, fontSize: 11, color: 'var(--mf-ws-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {syncedText(at)}
        </button>
      </div>
    </>
  );
}

/** 잠깐 전 표현 — `방금 동기화` · `N분 전 동기화`. */
function syncedText(at: number): string {
  const m = Math.floor((Date.now() - at) / 60_000);
  return m < 1 ? '방금 동기화' : `${m}분 전 동기화`;
}

/** 댓글 시각 `YYYY-MM-DD HH:mm` → `4시간 전`·`어제`·`N일 전`·날짜. */
export function ago(stampText: string, now: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(stampText);
  if (!m) return stampText;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const dd = Math.floor(h / 24);
  if (dd === 1) return '어제';
  if (dd < 7) return `${dd}일 전`;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

const iconBtn = { width: 32, height: 32, flexShrink: 0, border: 0, borderRadius: 11, background: 'transparent', color: '#8A8078', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 } as const;
const linkBtn = { alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, color: '#C0563A', cursor: 'pointer' } as const;

function EpicChip({ epic, c, onOpen }: { epic: { key: string; name: string }; c: string; onOpen: (key: string) => void }) {
  return (
    <button type="button" className="btn" data-ws-issue-epic={epic.key} onClick={() => onOpen(epic.key)} title={`에픽 ${epic.key} 보기`} style={{ alignSelf: 'flex-start', flex: '0 1 auto', minWidth: 0, maxWidth: 280, display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px 0 7px', border: '1px solid var(--mf-ws-line2)', borderRadius: 8, background: 'var(--mf-ws-card)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: 'var(--mf-ws-ink2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 2.5, background: c }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{epic.name}</span>
      <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-ws-faint)' }}>{epic.key}</span>
    </button>
  );
}

function Section({ title, count, extra, children }: { title: string; count?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 10 }}>
        <span style={{ width: 92, flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', color: 'var(--mf-ws-faint)' }}>{title}</span>
          {count && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-ink)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
        </span>
        {extra}
        <span style={{ flex: 1, height: 1, background: 'var(--mf-ws-line)', display: 'block' }} />
      </span>
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', color: 'var(--mf-ws-faint)' }}>{label}</span>
      {children}
    </div>
  );
}

const Dim = ({ children }: { children: ReactNode }) => <span style={{ fontSize: 12.5, color: 'var(--mf-ws-faint)' }}>{children}</span>;

function PersonLine({ id, name, color }: { id: string; name: string; color: (id: string) => string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Avatar ini={ini(name)} c={color(id)} size={26} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  );
}

function FieldRow({ f, color }: { f: DetailField; color: (id: string) => string }) {
  return (
    <div data-ws-issue-field={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#B0A69B' }}>{f.label}</span>
      {f.kind === 'text' && <span title={f.value} style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: 'var(--mf-ws-ink)', wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f.value}</span>}
      {f.kind === 'mono' && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--mf-ws-ink)' }}>{f.value}</span>}
      {f.kind === 'person' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Avatar ini={ini(f.value)} c={color(f.personId ?? f.value)} size={18} font={7.5} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-ws-ink)' }}>{f.value}</span>
        </span>
      )}
      {f.kind === 'tags' && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(f.tags ?? []).map((t, i) => (
            <span key={`${t}:${i}`} style={{ height: 19, padding: '0 7px', borderRadius: 99, background: 'var(--mf-ws-card)', border: '1px solid var(--mf-ws-line2)', fontSize: 11, fontWeight: 700, color: 'var(--mf-ws-ink2)', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{t}</span>
          ))}
        </span>
      )}
      {f.kind === 'link' && (
        <a href={f.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: '#C0563A', minWidth: 0, textDecoration: 'none' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.value}</span>
        </a>
      )}
    </div>
  );
}

/** 테스트용 — 상세 캐시를 비운다. */
export function resetIssueCache(): void {
  cache.clear();
}
