import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal } from '../../../components/Modal';
import { jiraReasonText, jiraSource, type JiraDateChoice, type JiraField, type JiraIssueTypeRef, type JiraProjectRef, type JiraSite } from './jiraApi';
import { applyJiraStatus, useJiraConn } from './jiraStore';
import { toolToast } from '../ui';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { MobileSheet } from '../../home/mobile/parts';

/**
 * Jira **프로젝트 고르기**(결정 2026-09-30: "프로젝트는 연결 시 선택").
 *
 * 연결에서 돌아오면 곧바로 뜨고(`/auth/jira` → `/home?jira=setup`), 나중에는 작업 현황의 빈
 * 화면·설정의 Jira 행에서 다시 연다. 사이트가 여럿이면 사이트부터 고른다(v1은 사이트 하나 —
 * 도구 스펙 §7). 어디서든 열 수 있게 여닫기는 이 모듈의 작은 스토어가 든다.
 */

let open = false;
let after: (() => void) | null = null;
/** 열 때 어디를 보여 줄지 — 작업 현황의 `날짜 기준` 단추는 날짜 칸으로 곧장 내려 준다. */
let focusDates = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openJiraSetup(onDone?: () => void, opts?: { focus?: 'dates' }): void {
  open = true;
  after = onDone ?? null;
  focusDates = opts?.focus === 'dates';
  emit();
}

function closeJiraSetup(): void {
  open = false;
  after = null;
  emit();
}

export function JiraSetupHost() {
  const isOpen = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
  // 폰은 **전체 화면 두 단계**(모바일 디자인 W7·W8) — 460px 판에 네 칸을 쌓으면 폰에서는 목록 칸이 손가락 두 줄만 남았다.
  const mobile = useIsMobile();
  return (
    <Modal
      open={isOpen}
      onClose={closeJiraSetup}
      label="Jira 설정"
      dim={mobile ? { zIndex: 150, alignItems: 'stretch', background: 'var(--mf-m-bg)' } : { zIndex: 90, background: 'rgba(58,52,46,.32)', backdropFilter: 'blur(5px)', padding: 16 }}
      card={
        mobile
          ? { position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)', color: 'var(--mf-m-ink)', overflow: 'hidden', outline: 'none' }
          : { width: 460, maxWidth: '100%', maxHeight: 'calc(var(--mf-app-h) - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--mf-card)', border: '1px solid var(--mf-border)', borderRadius: 24, boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)', overflow: 'hidden', animation: 'mf-fade .2s ease' }
      }
      {...(mobile ? { cardClass: 'mf-m-page' } : {})}
      cardAttrs={mobile ? { 'data-jira-setup': '', 'data-jira-setup-mobile': '' } : { 'data-jira-setup': '' }}
    >
      {isOpen && <SetupBody mobile={mobile} />}
    </Modal>
  );
}

function SetupBody({ mobile }: { mobile: boolean }) {
  const conn = useJiraConn();
  // 폰의 두 단계 — `날짜 기준 바꾸기`에서 열었으면(이미 프로젝트가 있다) 둘째 단계부터.
  const [step, setStep] = useState<1 | 2>(() => (focusDates && conn.projects.length ? 2 : 1));
  const [fieldSheet, setFieldSheet] = useState<'start' | 'end' | 'release' | null>(null);
  const needSite = conn.connected && !conn.site;
  const [sites, setSites] = useState<JiraSite[] | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<JiraProjectRef[] | null>(null);
  const [picked, setPicked] = useState<JiraProjectRef[]>(conn.projects);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 날짜 기준(0045) — 어느 필드로 막대를 그릴지. 사이트마다 필드가 달라 열 때 한 번 묻는다.
  const [fields, setFields] = useState<JiraField[] | null>(null);
  const [rule, setRule] = useState<JiraDateChoice>(() => ({
    start: conn.startField?.id ?? null,
    startName: conn.startField?.name,
    end: conn.endField?.id ?? 'duedate',
    endName: conn.endField?.name,
    fill: conn.fillDates !== false,
    release: conn.releaseField?.id ?? null,
    releaseName: conn.releaseField?.name,
  }));

  // 이슈 유형 — 고른 프로젝트들의 것. 이름으로 고르고(팀 관리 프로젝트는 같은 이름이 프로젝트마다 다른 id) 저장은 id로.
  const [types, setTypes] = useState<JiraIssueTypeRef[] | null>(null);
  const [typeNames, setTypeNames] = useState<string[]>(() => [...new Set((conn.issueTypes ?? []).map((t) => t.name))]);
  const pickedKeys = picked.map((p) => p.key).join(',');
  // 상태 — 고른 프로젝트(이슈 유형을 골랐으면 그 유형)의 티켓이 가질 수 있는 상태. 고른 유형이 바뀌면 다시 묻는다.
  const [statuses, setStatuses] = useState<JiraIssueTypeRef[] | null>(null);
  const [statusNames, setStatusNames] = useState<string[]>(() => [...new Set((conn.issueStatuses ?? []).map((t) => t.name))]);
  const typeIdsKey = (types ?? []).filter((t) => typeNames.includes(t.name)).map((t) => t.id).join(',');
  useEffect(() => {
    if (needSite || !conn.connected) return;
    if (!pickedKeys) {
      setStatuses([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void jiraSource()
        .statuses(pickedKeys.split(','), typeIdsKey ? typeIdsKey.split(',') : [])
        .then((r) => {
          if (alive) setStatuses(r.ok ? r.statuses : null);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pickedKeys, typeIdsKey, needSite, conn.connected]);
  useEffect(() => {
    if (needSite || !conn.connected) return;
    if (!pickedKeys) {
      setTypes([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void jiraSource()
        .issueTypes(pickedKeys.split(','))
        .then((r) => {
          if (alive) setTypes(r.ok ? r.types : null);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pickedKeys, needSite, conn.connected]);

  useEffect(() => {
    if (needSite || !conn.connected) return;
    let alive = true;
    void jiraSource()
      .fields()
      .then((r) => {
        if (!alive) return;
        // 못 받아도 고르기는 된다 — 기본 칸(기한·만든 날·해결된 날)과 지금 값은 늘 있다.
        setFields(r.ok ? r.fields : []);
        // 처음 고르는 사람에게는 찾아 둔 시작일 필드를 먼저 채워 둔다.
        if (r.ok && r.suggested && !conn.startField && !conn.projects.length) setRule((v) => (v.start ? v : { ...v, start: r.suggested!.id, startName: r.suggested!.name }));
        // 배포 예정일도 이름으로 한 번 짐작해 둔다(처음 고를 때만 — 고른 것을 덮지 않는다).
        const rel = r.ok && !conn.releaseField ? r.fields.find((f) => /배포|release/i.test(f.name)) : undefined;
        if (rel) setRule((v) => (v.release ? v : { ...v, release: rel.id, releaseName: rel.name }));
      });
    return () => {
      alive = false;
    };
  }, [needSite, conn.connected]);

  useEffect(() => {
    if (!needSite) return;
    let alive = true;
    void jiraSource()
      .sites()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setSites(r.sites);
        else setError(jiraReasonText(r.reason));
      });
    return () => {
      alive = false;
    };
  }, [needSite]);

  // 프로젝트 검색 — 치는 동안 0.25초 모았다가 묻는다(한 글자마다 서버를 부르지 않는다).
  useEffect(() => {
    if (needSite || !conn.connected) return;
    let alive = true;
    const t = setTimeout(() => {
      void jiraSource()
        .projects(query.trim())
        .then((r) => {
          if (!alive) return;
          if (r.ok) {
            setList(r.projects);
            setError('');
          } else setError(jiraReasonText(r.reason));
        });
    }, query ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, needSite, conn.connected]);

  const pickSite = async (s: JiraSite) => {
    const r = await jiraSource().selectSite(s.id);
    if (r.ok) applyJiraStatus(r);
    else setError(jiraReasonText(r.reason));
  };

  const toggle = (p: JiraProjectRef) => setPicked((cur) => (cur.some((x) => x.key === p.key) ? cur.filter((x) => x.key !== p.key) : [...cur, p]));

  const save = async () => {
    setSaving(true);
    // 못 받았으면(옛 함수·실패) 지금 저장된 유형을 그대로 둔다 — 고른 이름이 사라지지 않게.
    const chosen = types ? types.filter((t) => typeNames.includes(t.name)) : (conn.issueTypes ?? []);
    const chosenStatus = statuses ? statuses.filter((t) => statusNames.includes(t.name)) : (conn.issueStatuses ?? []);
    const r = await jiraSource().saveProjects(picked, rule, typeNames.length ? chosen : [], statusNames.length ? chosenStatus.map(({ id, name }) => ({ id, name })) : []);
    setSaving(false);
    if (!r.ok) {
      setError(jiraReasonText(r.reason));
      return;
    }
    applyJiraStatus(r);
    const done = after;
    closeJiraSetup();
    toolToast(picked.length ? `프로젝트 ${picked.length}개의 티켓을 불러와요` : '프로젝트를 모두 뺐어요');
    done?.();
  };

  const head = (title: string, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 22px 12px', borderBottom: '1px solid var(--mf-hairline)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--mf-faint)', marginTop: 3 }}>{sub}</div>
      </div>
      <button type="button" className="btn mf-settings-x" aria-label="닫기" onClick={closeJiraSetup} style={{ marginLeft: 'auto', width: 32, height: 32, flexShrink: 0, border: 0, borderRadius: 11, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  if (!conn.connected) {
    return (
      <>
        {head('Jira 프로젝트', '먼저 Jira를 연결해 주세요')}
        <div style={{ padding: '28px 22px', fontSize: 13, color: 'var(--mf-muted)' }}>연결이 끊겨 있어요. 왼쪽 도구 목록의 도구 관리에서 다시 연결할 수 있어요.</div>
      </>
    );
  }

  if (needSite) {
    return (
      <>
        {head('Jira 사이트 고르기', '작업 현황에 쓸 사이트 하나를 골라요')}
        <div style={{ padding: 10, overflowY: 'auto' }}>
          {!sites && !error && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--mf-muted)' }}>사이트를 불러오는 중…</div>}
          {sites?.map((s) => (
            <button key={s.id} type="button" className="btn mf-tool-row" data-jira-site={s.id} onClick={() => void pickSite(s)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', padding: '10px 12px', border: 0, borderRadius: 10, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--mf-text)' }}>{s.name || s.url}</span>
              <span style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>{s.url.replace(/^https?:\/\//, '')}</span>
            </button>
          ))}
          {sites && !sites.length && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--mf-muted)' }}>읽을 수 있는 Jira 사이트가 없어요</div>}
          {error && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--mf-danger)' }}>{error}</div>}
        </div>
      </>
    );
  }

  const shown = list ?? [];
  // 검색에 걸리지 않아도 **고른 것은 늘 위에** 남긴다 — 무엇을 골랐는지가 사라지지 않게.
  const rows = [...picked.filter((p) => !shown.some((x) => x.key === p.key)), ...shown];

  if (mobile) {
    const siteName = conn.site?.name || conn.site?.url.replace(/^https?:\/\//, '') || 'Jira';
    const opts = ruleOptions(fields, rule);
    const fieldRows = [
      { id: 'start' as const, label: '시작', value: opts.nameOf(opts.startOpts, rule.start ?? '') ?? '없음' },
      { id: 'end' as const, label: '끝', value: opts.nameOf(opts.endOpts, rule.end) ?? '기한' },
      { id: 'release' as const, label: '배포', value: opts.nameOf(opts.releaseOpts, rule.release ?? '') ?? '표시 안 함' },
    ];
    const sheetOpts = fieldSheet === 'start' ? opts.startOpts : fieldSheet === 'end' ? opts.endOpts : opts.releaseOpts;
    const sheetCur = fieldSheet === 'start' ? (rule.start ?? '') : fieldSheet === 'end' ? rule.end : (rule.release ?? '');
    const pickField = (id: string) => {
      const nm = opts.nameOf(sheetOpts, id);
      if (fieldSheet === 'start') setRule({ ...rule, start: id || null, startName: nm });
      else if (fieldSheet === 'end') setRule({ ...rule, end: id, endName: nm });
      else setRule({ ...rule, release: id || null, releaseName: nm });
      setFieldSheet(null);
    };
    const summary = picked.length ? `${picked.length}개 고름` : '하나 이상 골라 주세요';
    return (
      <>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', height: 52, padding: '0 8px', paddingTop: 'env(safe-area-inset-top)' }}>
          <button type="button" className="btn" data-jira-setup-back aria-label={step === 1 ? '닫기' : '프로젝트로 돌아가기'} onClick={step === 1 ? closeJiraSetup : () => setStep(1)} style={M_BACK}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {step === 1 ? '닫기' : '프로젝트'}
          </button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap' }}>{step === 1 ? '프로젝트 고르기' : '유형 · 날짜 기준'}</span>
          <span style={{ width: 84 }} />
        </div>
        {/* 단계 줄 — 1을 마치면 초록 ✓, 지금 단계는 짙은 알약. 지난 단계는 눌러 돌아간다. */}
        <div data-jira-steps style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 20px 12px' }}>
          {step === 1 ? (
            <StepPill n={1} name="프로젝트" on />
          ) : (
            <button type="button" className="btn" onClick={() => setStep(1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px 0 8px', borderRadius: 99, border: '1px solid color-mix(in srgb, var(--mf-success-ink) 24%, transparent)', background: 'var(--mf-success-soft)', color: 'var(--mf-success-ink)', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 5 5L20 7" />
              </svg>
              프로젝트 {picked.length}
            </button>
          )}
          <span style={{ flex: 1, height: 1.5, borderRadius: 99, background: step === 2 ? 'var(--mf-m-ink)' : 'var(--mf-m-btn-line)' }} />
          <StepPill n={2} name="유형 · 날짜" on={step === 2} />
        </div>

        {step === 1 ? (
          <>
            <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, margin: '0 16px', height: 42, padding: '0 14px', borderRadius: 14, border: '1px solid var(--mf-m-btn-line)', background: 'var(--mf-m-card)', boxSizing: 'border-box' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-m-faint)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input data-jira-project-search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="프로젝트 이름이나 키로 찾기" aria-label="프로젝트 찾기" enterKeyHint="search" style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 16 }} />
            </label>
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 20px 6px' }}>
              <span style={{ minWidth: 0, fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-m-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {siteName}의 프로젝트 <span style={{ fontFamily: M_MONO, fontWeight: 600 }}>{rows.length}</span>
              </span>
              {picked.length > 0 && (
                <button type="button" className="btn" data-jira-clear onClick={() => setPicked([])} style={{ flexShrink: 0, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--mf-m-faint)', cursor: 'pointer' }}>
                  선택 모두 해제
                </button>
              )}
            </div>
            <div className="mf-m-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 16px 110px' }}>
              {list === null && !error && <div style={{ padding: 14, fontSize: 13, color: 'var(--mf-m-mut)' }}>프로젝트를 불러오는 중…</div>}
              {rows.map((p) => {
                const on = picked.some((x) => x.key === p.key);
                const [bg, fg] = tileOf(p.key);
                return (
                  <button key={p.key} type="button" role="checkbox" aria-checked={on} className="btn" data-jira-project={p.key} onClick={() => toggle(p)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 60, padding: '0 4px', border: 0, borderBottom: '1px solid var(--mf-m-line)', background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                    <CheckBox on={on} />
                    <span aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: bg, color: fg, fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{p.key.slice(0, 1)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--mf-m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ flexShrink: 0, fontFamily: M_MONO, fontSize: 12, fontWeight: 600, color: 'var(--mf-m-faint)' }}>{p.key}</span>
                  </button>
                );
              })}
              {list !== null && !rows.length && <div style={{ padding: 14, fontSize: 13, color: 'var(--mf-m-mut)' }}>일치하는 프로젝트가 없어요</div>}
              {error && <div style={{ padding: 14, fontSize: 13, color: 'var(--mf-danger)' }}>{error}</div>}
            </div>
            <MobileFoot>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                {picked.length > 0 && (
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                    {picked.slice(0, 4).map((p, i) => {
                      const [bg, fg] = tileOf(p.key);
                      return <span key={p.key} aria-hidden="true" style={{ width: 24, height: 24, marginLeft: i ? -6 : 0, borderRadius: 7, border: '2px solid var(--mf-m-bg)', background: bg, color: fg, fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{p.key.slice(0, 1)}</span>;
                    })}
                  </span>
                )}
                <span style={{ fontSize: 13, color: 'var(--mf-m-mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
              </span>
              <button type="button" className="btn" data-jira-setup-next disabled={!picked.length} onClick={() => setStep(2)} style={{ ...M_PRIMARY, ...(picked.length ? {} : M_PRIMARY_OFF) }}>
                다음
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </MobileFoot>
          </>
        ) : (
          <>
            <div className="mf-m-scroll" data-jira-setup-body style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22, padding: '4px 16px 120px' }}>
              <MChips title="이슈 유형" attr="data-jira-issue-type" items={types} names={typeNames} onToggle={(n) => setTypeNames((cur) => toggleName(cur, n))} empty="고른 유형의 티켓만 가져와요 · 고르지 않으면 전부" />
              <MChips title="상태" attr="data-jira-status" items={statuses} names={statusNames} onToggle={(n) => setStatusNames((cur) => toggleName(cur, n))} empty="고른 상태의 티켓만 · 고르지 않으면 전부" />
              <div data-jira-date-rule style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <MSectionHead title="날짜 기준" sub={`시작~끝이 티켓 막대, 배포는 그 날짜에 표시${fields === null ? ' · 필드를 불러오는 중…' : ''}`} />
                <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 16, background: 'var(--mf-m-card)', border: '1px solid var(--mf-m-card-line)', overflow: 'hidden' }}>
                  {fieldRows.map((f, i) => (
                    <button key={f.id} type="button" className="btn" data-jira-rule-row={f.id} onClick={() => setFieldSheet(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 58, padding: '0 14px 0 16px', border: 0, borderTop: i ? '1px solid var(--mf-m-line)' : 0, background: fieldSheet === f.id ? 'var(--mf-m-bg)' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ width: 34, flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--mf-m-mut)' }}>{f.label}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--mf-m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.value}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-m-faint)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  ))}
                </div>
                <button type="button" className="btn" data-jira-rule-fill aria-pressed={rule.fill} onClick={() => setRule({ ...rule, fill: !rule.fill })} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', border: 0, borderRadius: 14, background: rule.fill ? 'var(--mf-m-card)' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                  <CheckBox on={rule.fill} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mf-m-ink)', wordBreak: 'keep-all' }}>날짜가 비면 만든 날 ~ 해결된 날로 그리기</span>
                    <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--mf-m-mut2)', wordBreak: 'keep-all' }}>아직 해결 안 된 티켓은 오늘까지. 끄면 날짜 없는 티켓은 달력에 안 보여요.</span>
                  </span>
                </button>
              </div>
              {error && <div style={{ fontSize: 13, color: 'var(--mf-danger)' }}>{error}</div>}
            </div>
            <MobileFoot>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--mf-m-mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                프로젝트 {picked.length}{typeNames.length ? ` · 유형 ${typeNames.length}` : ''}{statusNames.length ? ` · 상태 ${statusNames.length}` : ''}
              </span>
              <button type="button" className="btn" data-jira-setup-save disabled={saving || !picked.length} onClick={() => void save()} style={{ ...M_PRIMARY, ...(saving || !picked.length ? M_PRIMARY_OFF : {}) }}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </MobileFoot>
            <MobileSheet open={fieldSheet !== null} onClose={() => setFieldSheet(null)} label="날짜 필드" zIndex={170} attrs={{ 'data-jira-field-sheet': fieldSheet ?? '' }}>
              <div style={{ padding: '14px 20px 4px' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--mf-m-ink)' }}>{fieldSheet === 'start' ? '시작' : fieldSheet === 'end' ? '끝' : '배포'} 날짜 필드</div>
                <div style={{ marginTop: 3, fontSize: 12, color: 'var(--mf-m-mut2)' }}>{fieldSheet === 'release' ? '그 날짜에 배포 표시를 찍어요' : '고른 필드의 날짜로 티켓 막대를 그려요'}</div>
              </div>
              <div className="mf-m-scroll" style={{ overflowY: 'auto', minHeight: 0, padding: '6px 12px 4px' }}>
                {sheetOpts.map((o) => {
                  const on = o.id === sheetCur;
                  return (
                    <button key={o.id || 'none'} type="button" role="radio" aria-checked={on} className="btn mf-m-press" data-jira-rule-option={o.id} onClick={() => pickField(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 50, padding: '0 10px', border: 0, borderRadius: 12, background: on ? 'var(--mf-m-bg)' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: on ? 800 : 600, color: 'var(--mf-m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                      {on && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </MobileSheet>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {head('Jira 설정', `${conn.site?.name || conn.site?.url || 'Jira'} · 어떤 티켓을 어떤 날짜로 보여 줄지 정해요`)}
      {/* 네 칸(프로젝트·이슈 유형·상태·날짜 기준)이 한 화면에 다 안 들어가 가운데를 통째로 굴린다. */}
      <div className="lnb-scroll" data-jira-setup-body style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
      <div style={{ padding: '12px 22px 6px' }}>
        <SectionTitle n={1} title="프로젝트" hint={picked.length ? `${picked.length}개 고름` : '하나 이상 골라 주세요'} />
        <input
          data-jira-project-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="프로젝트 이름이나 키로 찾기"
          aria-label="프로젝트 찾기"
          style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', height: 34, padding: '0 14px', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
        />
      </div>
      <div className="lnb-scroll" style={{ minHeight: 80, maxHeight: 200, overflowY: 'auto', padding: '4px 12px' }}>
        {list === null && !error && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--mf-muted)' }}>프로젝트를 불러오는 중…</div>}
        {rows.map((p) => {
          const on = picked.some((x) => x.key === p.key);
          return (
            <label key={p.key} className="mf-tool-row" data-jira-project={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(p)} style={{ width: 16, height: 16, accentColor: '#E85E33', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, color: 'var(--mf-faint)', flexShrink: 0 }}>{p.key}</span>
            </label>
          );
        })}
        {list !== null && !rows.length && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--mf-muted)' }}>일치하는 프로젝트가 없어요</div>}
        {error && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--mf-danger)' }}>{error}</div>}
      </div>
      <NameChipSection n={2} title="이슈 유형" attr="data-jira-issue-type" items={types} names={typeNames} onToggle={(n) => setTypeNames((cur) => toggleName(cur, n))} hasProjects={!!picked.length} />
      <NameChipSection n={3} title="상태" attr="data-jira-status" items={statuses} names={statusNames} onToggle={(n) => setStatusNames((cur) => toggleName(cur, n))} hasProjects={!!picked.length} />
      <DateRuleSection fields={fields} rule={rule} onChange={setRule} focus={focusDates} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px 16px', borderTop: '1px solid var(--mf-hairline)' }}>
        <span style={{ fontSize: 12, color: 'var(--mf-muted)' }}>{picked.length ? `프로젝트 ${picked.length}개${typeNames.length ? ` · 유형 ${typeNames.length}` : ''}${statusNames.length ? ` · 상태 ${statusNames.length}` : ''}` : '프로젝트를 하나 이상 골라 주세요'}</span>
        <button
          type="button"
          className="btn"
          data-jira-setup-save
          disabled={saving || !picked.length}
          onClick={() => void save()}
          style={{ marginLeft: 'auto', height: 34, padding: '0 18px', border: 0, borderRadius: 999, background: '#3A352F', color: '#FFFDFB', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: saving || !picked.length ? 'default' : 'pointer', opacity: saving || !picked.length ? 0.45 : 1 }}
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </>
  );
}

const SELECT_STYLE = { flex: '1 1 0', minWidth: 0, height: 32, padding: '0 10px', border: '1px solid var(--mf-border)', borderRadius: 10, background: 'var(--mf-card)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5 } as const;

/**
 * **날짜 기준** — 막대의 시작·끝을 어느 필드에서 읽을지(제보 2026-10-01: 시작 날짜·기한을 안 쓰는
 * 프로젝트라 화면이 텅 비었다). 기본 칸 셋(기한·만든 날·해결된 날) + 사이트의 커스텀 날짜 필드.
 */
function DateRuleSection({ fields, rule, onChange, focus }: { fields: JiraField[] | null; rule: JiraDateChoice; onChange: (r: JiraDateChoice) => void; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    ref.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
  }, [focus]);
  const { startOpts, endOpts, releaseOpts, nameOf } = ruleOptions(fields, rule);
  return (
    <div ref={ref} data-jira-date-rule data-focus={focus ? '' : undefined} style={{ ...(focus ? { background: 'var(--mf-panel2)' } : {}),  padding: '10px 22px 12px', borderTop: '1px solid var(--mf-hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle n={4} title="날짜 기준" hint={`시작~끝이 티켓 막대, 배포는 그 날짜에 표시${fields === null ? ' · 필드를 불러오는 중…' : ''}`} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 11.5, color: 'var(--mf-muted)', width: 28, flexShrink: 0 }} htmlFor="jira-rule-start">시작</label>
        <select id="jira-rule-start" data-jira-rule-start value={rule.start ?? ''} onChange={(e) => onChange({ ...rule, start: e.target.value || null, startName: nameOf(startOpts, e.target.value) })} style={SELECT_STYLE}>
          {startOpts.map((o) => (
            <option key={o.id || 'none'} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 11.5, color: 'var(--mf-muted)', width: 28, flexShrink: 0 }} htmlFor="jira-rule-end">끝</label>
        <select id="jira-rule-end" data-jira-rule-end value={rule.end} onChange={(e) => onChange({ ...rule, end: e.target.value, endName: nameOf(endOpts, e.target.value) })} style={SELECT_STYLE}>
          {endOpts.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 11.5, color: 'var(--mf-muted)', width: 28, flexShrink: 0 }} htmlFor="jira-rule-release">배포</label>
        <select id="jira-rule-release" data-jira-rule-release value={rule.release ?? ''} onChange={(e) => onChange({ ...rule, release: e.target.value || null, releaseName: nameOf(releaseOpts, e.target.value) })} style={SELECT_STYLE}>
          {releaseOpts.map((o) => (
            <option key={o.id || 'none'} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mf-subtext)', cursor: 'pointer' }}>
        <input type="checkbox" data-jira-rule-fill checked={rule.fill} onChange={(e) => onChange({ ...rule, fill: e.target.checked })} style={{ width: 15, height: 15, accentColor: '#E85E33', flexShrink: 0 }} />
        두 날짜가 다 비면 만든 날 ~ 해결된 날(아직이면 오늘)로 그리기
      </label>
    </div>
  );
}

/** 날짜 칸 셋의 고를 거리 — 기본 칸 + 사이트의 커스텀 날짜 필드(데스크톱 `<select>`와 폰 시트가 같은 목록을 본다). */
function ruleOptions(fields: JiraField[] | null, rule: JiraDateChoice) {
  const custom = fields ?? [];
  // 지금 값이 목록에 없으면(필드를 못 받았거나 지워졌다) 그 값도 칸에 남긴다 — 고른 것이 사라지지 않게.
  const withCurrent = (id: string | null, name: string | undefined) => (id && id.startsWith('customfield_') && !custom.some((f) => f.id === id) ? [{ id, name: name ?? id }, ...custom] : custom);
  const startOpts = [{ id: '', name: '없음 · 끝 날짜 하루로' }, { id: 'created', name: '만든 날짜' }, ...withCurrent(rule.start, rule.startName)];
  const endOpts = [{ id: 'duedate', name: '기한' }, { id: 'resolutiondate', name: '해결된 날짜 (아직이면 오늘)' }, ...withCurrent(rule.end, rule.endName)];
  const releaseOpts = [{ id: '', name: '표시 안 함' }, { id: 'duedate', name: '기한' }, ...withCurrent(rule.release ?? null, rule.releaseName)];
  const nameOf = (opts: { id: string; name: string }[], id: string) => opts.find((o) => o.id === id)?.name;
  return { startOpts, endOpts, releaseOpts, nameOf };
}

const toggleName = (cur: string[], n: string) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]);

/* ── 폰 판(W7·W8)의 조각 ─────────────────────────────────────────────── */

const M_MONO = "'JetBrains Mono', ui-monospace, monospace";
const M_BACK = { display: 'inline-flex', alignItems: 'center', gap: 2, height: 40, padding: '0 8px', border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', width: 84 } as const;
const M_PRIMARY = { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, height: 48, padding: '0 22px', border: 0, borderRadius: 14, background: 'var(--mf-m-ink)', color: 'var(--mf-m-card)', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' } as const;
const M_PRIMARY_OFF = { background: 'var(--mf-m-soft)', color: 'var(--mf-m-faint)', cursor: 'default' } as const;
/** 프로젝트 타일 색 — 키로 고른다(목록 순서가 검색마다 바뀌어도 같은 프로젝트는 같은 색). */
const TILES: readonly (readonly [string, string])[] = [
  ['#FBEDE6', '#C0563A'],
  ['#E9F0FC', '#3E66B8'],
  ['#EBF5EE', '#2F7D57'],
  ['#F1ECFA', '#7650B8'],
  ['#FBF3E4', '#B0781E'],
  ['#E7F3F6', '#2A7C91'],
];
function tileOf(key: string): readonly [string, string] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILES[h % TILES.length]!;
}

function StepPill({ n, name, on }: { n: number; name: string; on: boolean }) {
  return (
    <span data-jira-step={n} aria-current={on ? 'step' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px 0 6px', borderRadius: 99, border: on ? 0 : '1px solid var(--mf-m-btn-line)', background: on ? 'var(--mf-m-ink)' : 'var(--mf-m-card)', color: on ? 'var(--mf-m-card)' : 'var(--mf-m-mut)', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 99, background: on ? 'var(--mf-m-card)' : 'var(--mf-m-soft)', color: on ? 'var(--mf-m-ink)' : 'var(--mf-m-mut)', fontFamily: M_MONO, fontSize: 9.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
      {name}
    </span>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, border: `1.5px solid ${on ? 'var(--mf-accent)' : 'var(--mf-m-faint2)'}`, background: on ? 'var(--mf-accent)' : 'var(--mf-m-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', transition: 'all .12s ease' }}>
      {on && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
      )}
    </span>
  );
}

/** 바닥에 붙는 다음/저장 줄 — 엄지가 닿는 자리(디자인 W7 "다음은 엄지 위치에 고정"). */
function MobileFoot({ children }: { children: ReactNode }) {
  return <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px max(18px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, transparent, var(--mf-m-bg) 30%)' }}>{children}</div>;
}

function MSectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px' }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-m-ink)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--mf-m-mut2)', wordBreak: 'keep-all' }}>{sub}</span>
    </span>
  );
}

/** 폰의 이름 칩 칸(이슈 유형 · 상태) — 데스크톱 `NameChipSection`과 같은 규칙(이름 하나가 칩 하나 · 비우면 전부). */
function MChips({ title, attr, items, names, onToggle, empty }: { title: string; attr: string; items: JiraIssueTypeRef[] | null; names: string[]; onToggle: (name: string) => void; empty: string }) {
  const all = items ? [...new Set(items.map((t) => t.name))] : [];
  const shown = [...all, ...names.filter((x) => !all.includes(x))];
  const sub = items === null ? '불러오지 못했어요 · 지금 설정을 그대로 둬요' : names.length ? `${names.length}개만 보여요` : empty;
  return (
    <div data-jira-chips={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <MSectionHead title={title} sub={sub} />
      {!!shown.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {shown.map((x) => {
            const on = names.includes(x);
            return (
              <button key={x} type="button" className="btn" {...{ [attr]: x }} aria-pressed={on} onClick={() => onToggle(x)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 99, border: `1px solid ${on ? 'var(--mf-m-ink)' : 'var(--mf-m-btn-line)'}`, background: on ? 'var(--mf-m-ink)' : 'var(--mf-m-card)', color: on ? 'var(--mf-m-card)' : 'var(--mf-m-ink2)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {on && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                )}
                {x}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 칸 제목 — 번호를 붙여 이 팝업이 무엇을 정하는지(프로젝트·유형·상태·날짜) 한눈에 보이게(요청 2026-10-01). */
function SectionTitle({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: 'var(--mf-text)' }}>
      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: '#3A352F', color: '#FFFDFB', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
      {title}
      <span style={{ fontWeight: 500, color: 'var(--mf-faint)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {hint}</span>
    </div>
  );
}

/**
 * 이름 칩으로 고르는 칸 — **이슈 유형**·**상태**. 고른 것만 부른다(비우면 전부 · 하위 작업·에픽은 늘 빠진다).
 * 팀 관리 프로젝트는 같은 이름이 프로젝트마다 다른 id라 이름 하나가 칩 하나다.
 */
function NameChipSection({ n, title, attr, items, names, onToggle, hasProjects }: { n: number; title: string; attr: string; items: JiraIssueTypeRef[] | null; names: string[]; onToggle: (name: string) => void; hasProjects: boolean }) {
  const all = items ? [...new Set(items.map((t) => t.name))] : [];
  // 저장돼 있던 이름이 지금 목록에 없어도(프로젝트를 뺐다) 칩은 남겨 두어 끌 수 있게 한다.
  const shown = [...all, ...names.filter((x) => !all.includes(x))];
  const hint = !hasProjects ? '프로젝트를 고르면 나와요' : items === null ? '불러오지 못했어요 · 지금 설정을 그대로 둬요' : names.length ? `${names.length}개만 보여요` : '고르지 않으면 전부 보여요';
  return (
    <div data-jira-chips={title} style={{ padding: '10px 22px 4px', borderTop: '1px solid var(--mf-hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle n={n} title={title} hint={hint} />
      {!!shown.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {shown.map((x) => {
            const on = names.includes(x);
            return (
              <button
                key={x}
                type="button"
                className="btn"
                {...{ [attr]: x }}
                aria-pressed={on}
                onClick={() => onToggle(x)}
                style={{ height: 28, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? '#3A352F' : 'var(--mf-border)'}`, background: on ? '#3A352F' : 'var(--mf-card)', color: on ? '#FFFDFB' : 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {x}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
