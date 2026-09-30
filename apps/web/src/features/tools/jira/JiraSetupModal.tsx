import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal } from '../../../components/Modal';
import { jiraReasonText, jiraSource, type JiraProjectRef, type JiraSite } from './jiraApi';
import { applyJiraStatus, useJiraConn } from './jiraStore';
import { toolToast } from '../ui';

/**
 * Jira **프로젝트 고르기**(결정 2026-09-30: "프로젝트는 연결 시 선택").
 *
 * 연결에서 돌아오면 곧바로 뜨고(`/auth/jira` → `/home?jira=setup`), 나중에는 작업 현황의 빈
 * 화면·설정의 Jira 행에서 다시 연다. 사이트가 여럿이면 사이트부터 고른다(v1은 사이트 하나 —
 * 도구 스펙 §7). 어디서든 열 수 있게 여닫기는 이 모듈의 작은 스토어가 든다.
 */

let open = false;
let after: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openJiraSetup(onDone?: () => void): void {
  open = true;
  after = onDone ?? null;
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
  return (
    <Modal
      open={isOpen}
      onClose={closeJiraSetup}
      label="Jira 프로젝트 고르기"
      dim={{ zIndex: 90, background: 'rgba(58,52,46,.32)', backdropFilter: 'blur(5px)', padding: 16 }}
      card={{ width: 460, maxWidth: '100%', maxHeight: 'calc(var(--mf-app-h) - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--mf-card)', border: '1px solid var(--mf-border)', borderRadius: 24, boxShadow: '0 44px 90px -40px rgba(46,42,38,.6)', overflow: 'hidden', animation: 'mf-fade .2s ease' }}
      cardAttrs={{ 'data-jira-setup': '' }}
    >
      {isOpen && <SetupBody />}
    </Modal>
  );
}

function SetupBody() {
  const conn = useJiraConn();
  const needSite = conn.connected && !conn.site;
  const [sites, setSites] = useState<JiraSite[] | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<JiraProjectRef[] | null>(null);
  const [picked, setPicked] = useState<JiraProjectRef[]>(conn.projects);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    const r = await jiraSource().saveProjects(picked);
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
  return (
    <>
      {head('Jira 프로젝트 고르기', `${conn.site?.name || conn.site?.url || 'Jira'} · 고른 프로젝트의 에픽과 티켓을 작업 현황에 모아요`)}
      <div style={{ padding: '12px 22px 6px' }}>
        <input
          data-jira-project-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="프로젝트 이름이나 키로 찾기"
          aria-label="프로젝트 찾기"
          style={{ width: '100%', boxSizing: 'border-box', height: 34, padding: '0 14px', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
        />
      </div>
      <div className="lnb-scroll" style={{ flex: '1 1 auto', minHeight: 120, maxHeight: 360, overflowY: 'auto', padding: '4px 12px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px 16px', borderTop: '1px solid var(--mf-hairline)' }}>
        <span style={{ fontSize: 12, color: 'var(--mf-muted)' }}>{picked.length ? `${picked.length}개 고름` : '하나 이상 골라 주세요'}</span>
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
