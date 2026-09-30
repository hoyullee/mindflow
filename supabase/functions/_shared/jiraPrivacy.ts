// Atlassian **개인정보 보고**(Personal Data Reporting API)의 순수한 부분 — 무엇을 보고하고, 답을 어떻게
// 반영하나. Deno·네트워크 의존이 없어서 웹 쪽 vitest가 검사한다(`jiraPrivacy.test.ts`).
//
// 우리가 저장하는 Atlassian 사용자 정보는 `user_tool_prefs.data.work`의 두 칸뿐이다:
//   - `extra`  — 작업 현황에서 **직접 더한 담당자** `{ id, name, at? }`(accountId · 표시 이름 · 받은 시각)
//   - `hidden` — 이 화면에서 **끈 담당자**의 accountId
// 티켓 내용·담당자 이름은 저장하지 않는다(조회할 때마다 받는다). 연결을 해제한 사람의 설정에도
// 이 두 칸이 남는다(재연결 때 되살리려고 — 결정 2026-09-30) — 그래서 보고는 **모든 행**을 본다.

/** 한 번에 보고할 수 있는 계정 수(Atlassian 상한). */
export const REPORT_BATCH = 90;

export interface PrefsRow {
  owner: string;
  data: unknown;
  updated_at: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const iso = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

/**
 * 보고할 계정 — accountId → 그 사람의 정보를 **마지막으로 받은 시각**(`updatedAt`).
 * 같은 사람이 여러 행에 있으면 **가장 오래된** 시각을 보낸다(가장 낡은 사본이 갱신 대상인가가 질문이다).
 * `hidden`처럼 시각이 없는 id는 그 행의 `updated_at`으로 둔다.
 */
export function collectAccounts(rows: PrefsRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const put = (id: unknown, at: string | null) => {
    if (typeof id !== 'string' || !id || id.length > 128) return;
    const t = at ?? new Date(0).toISOString();
    const prev = out.get(id);
    if (!prev || t < prev) out.set(id, t);
  };
  for (const r of rows) {
    const work = obj(obj(r.data)?.work);
    if (!work) continue;
    const rowAt = iso(r.updated_at);
    if (Array.isArray(work.extra)) for (const p of work.extra) put(obj(p)?.id, iso(obj(p)?.at) ?? rowAt);
    if (Array.isArray(work.hidden)) for (const id of work.hidden) put(id, rowAt);
  }
  return out;
}

export function chunks<T>(list: T[], size = REPORT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 보고 요청 본문. */
export function reportBody(batch: [string, string][]): { accounts: { accountId: string; updatedAt: string }[] } {
  return { accounts: batch.map(([accountId, updatedAt]) => ({ accountId, updatedAt })) };
}

/** 200 응답 → 지울 계정 / 새로 받을 계정. 모르는 status는 무시한다. */
export function parseReport(body: unknown): { closed: string[]; updated: string[] } {
  const closed: string[] = [];
  const updated: string[] = [];
  const list = obj(body)?.accounts;
  if (Array.isArray(list)) {
    for (const a of list) {
      const o = obj(a);
      const id = o?.accountId;
      if (typeof id !== 'string') continue;
      if (o?.status === 'closed') closed.push(id);
      else if (o?.status === 'updated') updated.push(id);
    }
  }
  return { closed, updated };
}

/**
 * 한 행의 설정에 보고 결과를 반영한다 — 바뀐 것이 없으면 `null`(쓰지 않는다).
 * - `closed`: `extra`·`hidden` 둘 다에서 **지운다**(Atlassian 계정이 닫혔다 — 그 사람의 흔적을 남기지 않는다).
 * - `updated`: 새 이름을 받았으면 이름과 `at`을 고친다. 못 받았으면 그대로 둔다(다음 회차에 다시 온다).
 */
export function applyReport(data: unknown, closed: Set<string>, renamed: Map<string, string>, now: string): Obj | null {
  const root = obj(data);
  const work = obj(root?.work);
  if (!root || !work) return null;
  let changed = false;
  const extra = Array.isArray(work.extra)
    ? work.extra.flatMap((p) => {
        const o = obj(p);
        const id = o?.id;
        if (!o || typeof id !== 'string') return [p];
        if (closed.has(id)) {
          changed = true;
          return [];
        }
        const name = renamed.get(id);
        if (name !== undefined) {
          changed = true;
          return [{ ...o, name, at: now }];
        }
        return [p];
      })
    : work.extra;
  const hidden = Array.isArray(work.hidden)
    ? work.hidden.filter((id) => {
        const drop = typeof id === 'string' && closed.has(id);
        if (drop) changed = true;
        return !drop;
      })
    : work.hidden;
  if (!changed) return null;
  return { ...root, work: { ...work, extra, hidden } };
}
