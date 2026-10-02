import { useEffect, useState } from 'react';
import { Switch } from '../../../components/Switch';
import { jiraSource, type JiraPerson } from '../jira/jiraApi';
import { initialOf, PERSON_PALETTE, type HolidayRules, type Person } from './model';
import { Avatar, MONO } from './wsUi';
import type { Leave, LeaveInput } from '../jira/leavesStore';
import { LeaveButton, LeaveChip, LeaveForm, type LeaveDraft } from './WsLeave';

/** 담당자 팝오버의 휴가 몫(휴가 스펙 §3) — 없으면 휴가 단추를 그리지 않는다. */
export interface MembersLeave {
  leaves: Leave[];
  today: string;
  rules: HolidayRules;
  draft: LeaveDraft | null;
  onDraft: (d: LeaveDraft | null) => void;
  onSubmit: (v: LeaveInput, editId?: string) => Promise<boolean>;
  onDelete: (l: Leave) => void;
}

/**
 * 담당자 팝오버(스펙 §4.3-1) — 이 화면에서 볼 사람을 켜고 끈다(Jira 배정은 그대로). 바닥에서
 * Jira 사용자를 찾아 더하면 티켓이 없어도 목록과 일정 맞춰보기에 선다.
 */
export function WsMembers({ people, hidden, monthCount, onToggle, onAdd, onRemove, leave }: { people: Person[]; hidden: string[]; monthCount: Map<string, number>; onToggle: (id: string) => void; onAdd: (p: JiraPerson) => void; onRemove: (id: string) => void; leave?: MembersLeave }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<JiraPerson[] | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setFound(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void jiraSource()
        .users(s)
        .then((r) => {
          if (alive) setFound(r.ok ? r.users : []);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  const known = new Set(people.map((p) => p.id));
  const sug = (found ?? []).filter((u) => !known.has(u.id));
  return (
    <div data-ws-members>
      <div style={{ padding: '14px 16px 8px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mf-ws-ink)' }}>담당자</div>
        <div style={{ fontSize: 11.5, color: 'var(--mf-ws-mut2)', marginTop: 2 }}>끄면 이 화면에서만 숨겨져요 · Jira 배정은 그대로</div>
      </div>
      <div className="lnb-scroll" style={{ maxHeight: leave ? 'min(440px, 62vh)' : 300, overflowY: 'auto', padding: '0 8px 6px' }}>
        {people.map((p) => {
          const on = !hidden.includes(p.id);
          const cnt = monthCount.get(p.id) ?? 0;
          // 휴가 칩은 오늘 이후 것만(지난 휴가도 달력·집계에는 계속 반영된다 — 스펙 §10).
          const upcoming = leave ? leave.leaves.filter((l) => l.person === p.id && l.end >= leave.today) : [];
          const draft = leave?.draft?.person === p.id ? leave.draft : null;
          return (
            <div key={p.id}>
            <div data-ws-member={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 10, opacity: on ? 1 : 0.45 }}>
              <Avatar ini={p.ini} c={p.c} size={24} />
              <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mf-ws-mut2)' }}>{cnt ? `이번 달 티켓 ${cnt}` : '배정된 티켓 없음'}</span>
              </span>
              {p.extra && (
                <button type="button" className="btn" aria-label={`${p.name} 님을 목록에서 빼기`} onClick={() => onRemove(p.id)} style={{ width: 22, height: 22, flexShrink: 0, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--mf-ws-faint)', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
              {leave && <LeaveButton on={!!draft} label={`${p.name} 님 휴가 등록`} onClick={() => leave.onDraft(draft ? null : { person: p.id })} />}
              <Switch checked={on} onCheckedChange={() => onToggle(p.id)} label={`${p.name} 보기`} accent="#E85E33" track="#DDD3C8" knob="#FFFFFF" />
            </div>
            {leave && upcoming.length > 0 && (
              <div data-ws-leave-chips={p.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 6px 41px' }}>
                {upcoming.map((l) => (
                  <LeaveChip key={l.id} l={l} editing={draft?.editId === l.id} onEdit={() => leave.onDraft(draft?.editId === l.id ? null : { person: p.id, start: l.start, end: l.end, kind: l.kind, note: l.note, editId: l.id })} onDelete={() => leave.onDelete(l)} />
                ))}
              </div>
            )}
            {leave && draft && <LeaveForm key={`${draft.editId ?? ''}|${draft.start ?? ''}|${draft.end ?? ''}`} draft={draft} person={p} rules={leave.rules} onCancel={() => leave.onDraft(null)} onSubmit={leave.onSubmit} />}
            </div>
          );
        })}
        {!people.length && <div style={{ padding: 10, fontSize: 12, color: 'var(--mf-ws-faint)' }}>이번 달 티켓이 있는 담당자가 없어요</div>}
      </div>
      <div style={{ padding: '10px 12px 12px', background: 'var(--mf-ws-sunk)', borderTop: '1px solid var(--mf-hairline)', borderRadius: '0 0 14px 14px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 10px', borderRadius: 9, border: '1px solid var(--mf-ws-line2)', background: 'var(--mf-ws-card)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-ws-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="9" cy="8" r="4" />
            <path d="M2 21v-1a6 6 0 0 1 11-3.3M19 14v6M16 17h6" />
          </svg>
          <input data-ws-member-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jira 사용자 검색해 추가" aria-label="Jira 사용자 검색" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--mf-ws-ink)', fontFamily: 'inherit', fontSize: 12.5 }} />
        </label>
        {q.trim() && found !== null && (
          <div style={{ marginTop: 6 }}>
            {sug.map((u, i) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 6px' }}>
                <Avatar ini={initialOf(u.name)} c={PERSON_PALETTE[i % PERSON_PALETTE.length] as string} size={22} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{u.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-ws-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{u.id.length > 14 ? `${u.id.slice(0, 12)}…` : u.id}</span>
                <button
                  type="button"
                  className="btn"
                  data-ws-member-add={u.id}
                  onClick={() => {
                    onAdd(u);
                    setQ('');
                  }}
                  style={{ marginLeft: 'auto', border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, color: '#D8794F', cursor: 'pointer', flexShrink: 0 }}
                >
                  추가
                </button>
              </div>
            ))}
            {!sug.length && <div style={{ padding: '8px 6px', fontSize: 12, color: 'var(--mf-ws-faint)' }}>Jira에서 찾지 못했어요</div>}
          </div>
        )}
      </div>
    </div>
  );
}
