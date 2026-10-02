// Jira 티켓 **상세**의 순수한 부분 — 이슈 한 건(`GET /rest/api/3/issue/{key}?expand=names,schema`)을
// 팝업이 그리는 모양으로 줄인다. 네트워크·Deno 의존이 없어서 웹 vitest가 그대로 검사한다
// (`apps/web/src/features/tools/jira/jiraDetail.test.ts`).
//
// ── 무엇을 싣지 않나 ──────────────────────────────────────────────────
// 사람은 **이름과 accountId만**(이메일·아바타 주소는 버린다 — 화면은 이니셜 원을 그린다).
// 상세는 **저장하지 않는다**(열 때마다 묻는다 — 개인정보 보고 대상이 늘지 않는다).

// `jira.ts`의 작은 조각을 여기에도 둔다 — Deno는 `.ts` 확장자를 요구하고 웹 타입 검사는 막아서,
// `_shared` 끼리는 서로 import하지 않는다(`jiraPrivacy.ts`와 같은 이유). 모양은 `jira.ts`와 같다.
export type TicketStatus = 'todo' | 'doing' | 'done';
export interface JiraPerson {
  id: string;
  name: string;
}
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const isIssueKey = (v: unknown): v is string => typeof v === 'string' && ISSUE_KEY_RE.test(v);
function statusOf(categoryKey: unknown): TicketStatus {
  if (categoryKey === 'done') return 'done';
  if (categoryKey === 'indeterminate') return 'doing';
  return 'todo';
}

export type FieldKind = 'text' | 'mono' | 'person' | 'tags' | 'link';

export interface DetailField {
  label: string;
  kind: FieldKind;
  /** text·mono·link의 글, person의 이름. */
  value: string;
  tags?: string[];
  href?: string;
  personId?: string;
}

export interface DetailComment {
  author: JiraPerson;
  created: string;
  text: string;
  /** 원본 서식 그대로 그릴 문서(줄인 ADF) — 없으면 `text`. */
  doc?: AdfNode | null;
}

/**
 * 화면이 그릴 **줄인 ADF** — 노드 종류·글·서식(marks)·필요한 속성만 남긴다(`pruneAdf`).
 * 원본 서식(목록 단계·번호·굵게·링크·표…)을 살리려고 줄글 대신 구조를 보낸다(제보 2026-10-02:
 * 번호 매기기·글머리 기호가 사라졌다).
 */
export interface AdfNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, string | number> }[];
  attrs?: Record<string, string | number | boolean>;
  content?: AdfNode[];
}

export interface DetailChild {
  key: string;
  summary: string;
  status: TicketStatus;
  person: JiraPerson | null;
  start: string | null;
  end: string | null;
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  type: { name: string; epic: boolean };
  status: { name: string; cat: TicketStatus };
  /** 상위 에픽(있으면). */
  epic: { key: string; name: string } | null;
  assignee: JiraPerson | null;
  reporter: JiraPerson | null;
  start: string | null;
  end: string | null;
  priority: { id: string; name: string } | null;
  project: { key: string; name: string };
  sprint: string | null;
  /** 설명 — ADF를 줄글로(목록은 `- `, 표는 ` | `). 검색·대체 표시용. */
  description: string;
  /** 설명의 원본 서식(줄인 ADF) — 화면은 이것을 그린다. */
  descriptionDoc?: AdfNode | null;
  commentTotal: number;
  /** 최근 댓글 몇 개 — 오래된 것부터. */
  comments: DetailComment[];
  /** 「모든 필드」 — 값이 있는 것만, 위에서 이미 보인 것은 뺀다. */
  fields: DetailField[];
  /** 값이 비어 숨긴 필드 수. */
  hiddenEmpty: number;
  /** 에픽이면 하위 티켓. */
  children: DetailChild[] | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/** `2026-09-16T14:57:53.804+0900` → `2026-09-16 14:57`(사이트 시간대 그대로). 날짜만이면 날짜만. */
export function stamp(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(s);
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]!) : null;
}

export function personOf(v: unknown): JiraPerson | null {
  const u = obj(v);
  const id = str(u?.accountId);
  return u && id ? { id, name: str(u.displayName) ?? '이름 없음' } : null;
}

const MAX_TEXT = 6000;

/**
 * Atlassian Document Format → 줄글. 블록은 줄바꿈, 목록은 `- `/`1. `, 표는 칸을 ` | `로,
 * 멘션·이모지는 글자로, 링크 카드는 주소로, 첨부(미디어)는 `[첨부]`. 모르는 노드는 자식만 훑는다.
 */
export function adfToText(doc: unknown): string {
  if (typeof doc === 'string') return doc.slice(0, MAX_TEXT);
  const pad = (n: number) => '  '.repeat(n);
  /** 줄 안의 글(인라인). */
  const inline = (n: unknown): string => {
    const o = obj(n);
    if (!o) return '';
    const attrs = obj(o.attrs);
    const kids = Array.isArray(o.content) ? o.content : [];
    switch (o.type) {
      case 'text':
        return str(o.text) ?? '';
      case 'hardBreak':
        return '\n';
      case 'mention':
        return str(attrs?.text) ?? '@';
      case 'emoji':
        return str(attrs?.text) ?? str(attrs?.shortName) ?? '';
      case 'inlineCard':
        return str(attrs?.url) ?? '';
      case 'status':
        return str(attrs?.text) ?? '';
      case 'date': {
        const ts = Number(attrs?.timestamp);
        return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
      }
      default:
        return kids.map(inline).join('');
    }
  };
  /** 블록 → 줄들. */
  const block = (n: unknown, depth: number): string => {
    const o = obj(n);
    if (!o) return '';
    const kids = Array.isArray(o.content) ? o.content : [];
    const attrs = obj(o.attrs);
    switch (o.type) {
      case 'paragraph':
      case 'heading':
        return `${pad(depth)}${kids.map(inline).join('')}\n`;
      case 'codeBlock':
        return `${kids.map(inline).join('')}\n`;
      case 'bulletList':
      case 'orderedList':
        return kids.map((li, i) => listItem(li, depth, o.type === 'bulletList' ? '- ' : `${i + 1}. `)).join('');
      case 'table':
        return kids
          .map((row) => {
            const cells = Array.isArray(obj(row)?.content) ? (obj(row)!.content as unknown[]) : [];
            return `${cells.map((c) => (Array.isArray(obj(c)?.content) ? (obj(c)!.content as unknown[]) : []).map((x) => block(x, 0)).join(' ').replace(/\s*\n\s*/g, ' ').trim()).join(' | ')}\n`;
          })
          .join('');
      case 'rule':
        return '---\n';
      case 'mediaSingle':
      case 'mediaGroup':
      case 'media':
        return `${pad(depth)}[첨부]\n`;
      case 'blockCard':
      case 'embedCard':
        return `${pad(depth)}${str(attrs?.url) ?? ''}\n`;
      default:
        // doc · blockquote · panel · expand … — 자식 블록을 그대로.
        return kids.map((k) => block(k, depth)).join('');
    }
  };
  const listItem = (n: unknown, depth: number, marker: string): string => {
    const kids = Array.isArray(obj(n)?.content) ? (obj(n)!.content as unknown[]) : [];
    let first = true;
    return kids
      .map((k) => {
        const t = obj(k)?.type;
        if (t === 'bulletList' || t === 'orderedList') return block(k, depth + 1);
        const line = block(k, 0).replace(/\n$/, '');
        const s = `${pad(depth)}${first ? marker : '  '}${line}\n`;
        first = false;
        return s;
      })
      .join('');
  };
  return block(doc, 0).replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

/** 위 칸(머리·담당자·기간·우선순위·프로젝트·스프린트)이 이미 보이거나 화면에 뜻이 없는 필드. */
const SKIP = new Set([
  'summary', 'description', 'status', 'issuetype', 'project', 'assignee', 'reporter', 'priority', 'parent',
  'comment', 'worklog', 'attachment', 'issuelinks', 'subtasks', 'watches', 'votes', 'progress', 'aggregateprogress',
  'timetracking', 'workratio', 'lastViewed', 'statuscategorychangedate', 'statusCategory', 'thumbnail', 'security',
  'creator', 'resolution', 'aggregatetimespent', 'aggregatetimeestimate', 'aggregatetimeoriginalestimate', 'timeestimate',
  'timeoriginalestimate', 'timespent', 'issuerestriction', 'created', 'updated', 'resolutiondate',
]);
/** 커스텀 필드 중 사람이 읽을 값이 아닌 것(순위·개발 정보·체크리스트 내부값 등). */
const SKIP_CUSTOM = /gh-lexo-rank|gh-sprint|gh-epic|devsummary|jpo-custom-field-parent|vulnerability|servicedesk-.*-sla|atlassian-team|flagged/i;

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

const nameish = (v: unknown): string | null => {
  const o = obj(v);
  if (!o) return typeof v === 'number' ? String(v) : str(v);
  return str(o.value) ?? str(o.name) ?? str(o.displayName) ?? str(o.title) ?? str(o.key);
};

/** 필드 하나 → 「모든 필드」 줄. 그릴 모양이 없으면 null. */
export function fieldOf(id: string, label: string, schema: Obj | null, v: unknown): DetailField | null {
  const t = str(schema?.type);
  const items = str(schema?.items);
  if (t === 'user') {
    const p = personOf(v);
    return p ? { label, kind: 'person', value: p.name, personId: p.id } : null;
  }
  if (t === 'array' || Array.isArray(v)) {
    const arr = Array.isArray(v) ? v : [];
    if (items === 'user') {
      const names = arr.map(personOf).filter((p): p is JiraPerson => !!p).map((p) => p.name);
      return names.length ? { label, kind: 'tags', value: '', tags: names.slice(0, 20) } : null;
    }
    const tags = arr.map(nameish).filter((x): x is string => !!x).map((x) => x.slice(0, 60));
    return tags.length ? { label, kind: 'tags', value: '', tags: tags.slice(0, 20) } : null;
  }
  if (t === 'date' || t === 'datetime') {
    const s = stamp(v);
    return s ? { label, kind: 'mono', value: s } : null;
  }
  if (t === 'number' || typeof v === 'number') return { label, kind: 'mono', value: String(v) };
  if (t === 'string' || typeof v === 'string') {
    const s = typeof v === 'string' ? v : adfToText(v);
    if (!s.trim()) return null;
    if (/^https?:\/\/\S+$/.test(s.trim())) {
      const href = s.trim();
      let host = href;
      try {
        const u = new URL(href);
        host = `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 1 ? ` · ${u.pathname.split('/').filter(Boolean).slice(-1)[0]}` : ''}`;
      } catch {
        /* 그대로 */
      }
      return { label, kind: 'link', value: host, href };
    }
    return { label, kind: 'text', value: s.slice(0, 600) };
  }
  // 옵션 하나(select)·계층 옵션 등 — 이름이 있으면 글로.
  const n = nameish(v);
  if (n) {
    const child = nameish(obj(v)?.child);
    return { label, kind: 'text', value: child ? `${n} › ${child}` : n };
  }
  // 문서(ADF)로 오는 긴 글 필드.
  if (obj(v)?.type === 'doc') {
    const s = adfToText(v);
    return s ? { label, kind: 'text', value: s.slice(0, 600) } : null;
  }
  return null;
}

/** 스프린트 필드(값은 `[{ name, state }]`) → 진행 중인 것, 없으면 마지막. 여럿이면 "외 N". */
function sprintOf(fields: Obj, names: Obj, schema: Obj): string | null {
  for (const id of Object.keys(fields)) {
    const sc = obj(schema[id]);
    if (!/gh-sprint/.test(str(sc?.custom) ?? '') && !/^sprint$|스프린트/i.test(str(names[id]) ?? '')) continue;
    const arr = Array.isArray(fields[id]) ? (fields[id] as unknown[]) : [];
    const list = arr.map(obj).filter((x): x is Obj => !!x && !!str(x.name));
    if (!list.length) continue;
    const pick = list.find((x) => x.state === 'active') ?? list[list.length - 1]!;
    return list.length > 1 && pick.state !== 'active' ? `${str(pick.name)} 외 ${list.length - 1}` : str(pick.name);
  }
  return null;
}

/**
 * 이슈 응답 → 상세. `dateFields`는 기간으로 보일 필드(작업 현황의 날짜 기준 — 「모든 필드」에서는 뺀다).
 * 댓글·하위 티켓은 따로 묻는다(`withComments`·`withChildren`).
 */
export function normalizeDetail(issue: unknown, dateFields: { start: string | null; end: string }): JiraIssueDetail | null {
  const it = obj(issue);
  const key = str(it?.key);
  const f = obj(it?.fields);
  if (!it || !isIssueKey(key) || !f) return null;
  const names = obj(it.names) ?? {};
  const schema = obj(it.schema) ?? {};
  const itype = obj(f.issuetype);
  const st = obj(f.status);
  const parent = obj(f.parent);
  const ptype = obj(obj(parent?.fields)?.issuetype);
  const parentIsEpic = !!parent && (typeof ptype?.hierarchyLevel === 'number' ? ptype.hierarchyLevel === 1 : true);
  const pr = obj(f.priority);
  const proj = obj(f.project);
  const start = dateFields.start ? day(f[dateFields.start]) : null;
  const end = day(f[dateFields.end]);
  const used = new Set([dateFields.start, dateFields.end].filter(Boolean) as string[]);

  const out: DetailField[] = [];
  let hidden = 0;
  for (const id of Object.keys(f)) {
    if (SKIP.has(id) || used.has(id)) continue;
    const sc = obj(schema[id]);
    if (SKIP_CUSTOM.test(str(sc?.custom) ?? '')) continue;
    const label = str(names[id]) ?? id;
    const v = f[id];
    if (isEmpty(v)) {
      hidden += 1;
      continue;
    }
    const row = fieldOf(id, label, sc, v);
    if (row) out.push(row);
    else hidden += 1;
  }
  // 시스템 필드는 늘 같은 자리(뒤쪽) — 사이트마다 순서가 달라 앞에 오면 찾기 어렵다.
  const created = stamp(f.created);
  const updated = stamp(f.updated);
  if (created) out.push({ label: str(names.created) ?? '만든 날', kind: 'mono', value: created });
  if (updated) out.push({ label: str(names.updated) ?? '업데이트', kind: 'mono', value: updated });

  return {
    key: key!,
    summary: str(f.summary) ?? key!,
    type: { name: str(itype?.name) ?? '이슈', epic: typeof itype?.hierarchyLevel === 'number' && itype.hierarchyLevel >= 1 },
    status: { name: str(st?.name) ?? '알 수 없음', cat: statusOf(obj(st?.statusCategory)?.key) },
    epic: parent && parentIsEpic && str(parent.key) ? { key: str(parent.key)!, name: str(obj(parent.fields)?.summary) ?? str(parent.key)! } : null,
    assignee: personOf(f.assignee),
    reporter: personOf(f.reporter),
    start,
    end,
    priority: pr && str(pr.name) ? { id: str(pr.id) ?? '', name: str(pr.name)! } : null,
    project: { key: str(proj?.key) ?? key!.split('-')[0]!, name: str(proj?.name) ?? str(proj?.key) ?? '' },
    sprint: sprintOf(f, names, schema),
    description: f.description ? adfToText(f.description) : '',
    descriptionDoc: pruneAdf(f.description),
    commentTotal: 0,
    comments: [],
    fields: out,
    hiddenEmpty: hidden,
    children: null,
  };
}

/** 댓글 응답(`/issue/{key}/comment?orderBy=-created`) → 최근 것 몇 개를 오래된 것부터. */
export function normalizeComments(body: unknown, max = 3): { total: number; comments: DetailComment[] } {
  const b = obj(body);
  const list = Array.isArray(b?.comments) ? b!.comments : [];
  const total = typeof b?.total === 'number' ? b.total : list.length;
  const comments = list
    .slice(0, max)
    .map((c) => {
      const o = obj(c);
      const author = personOf(o?.author) ?? { id: '', name: '알 수 없음' };
      return { author, created: stamp(o?.created) ?? '', text: adfToText(o?.body).slice(0, 1200), doc: pruneAdf(o?.body, 400) };
    })
    .reverse();
  return { total, comments };
}

/** 하위 티켓 검색 결과 → 줄. */
export function normalizeChildren(issues: unknown, dateFields: { start: string | null; end: string }): DetailChild[] {
  if (!Array.isArray(issues)) return [];
  const out: DetailChild[] = [];
  for (const raw of issues) {
    const it = obj(raw);
    const key = str(it?.key);
    const f = obj(it?.fields);
    if (!it || !key || !f) continue;
    out.push({
      key,
      summary: str(f.summary) ?? key,
      status: statusOf(obj(obj(f.status)?.statusCategory)?.key),
      person: personOf(f.assignee),
      start: dateFields.start ? day(f[dateFields.start]) : null,
      end: day(f[dateFields.end]),
    });
  }
  return out;
}

/** 남길 속성 — 목록 시작 번호·제목 단계·링크·멘션 글·패널 종류·할 일 상태·표 칸 너비 등. */
const KEEP_ATTRS = new Set(['title', 'level', 'order', 'url', 'text', 'shortName', 'language', 'timestamp', 'panelType', 'state', 'colspan', 'rowspan', 'color', 'localId']);
const KEEP_MARK_ATTRS = new Set(['href', 'color']);

/**
 * ADF를 화면이 그릴 만큼만 줄인다 — 노드 수 상한(`maxNodes`), 글은 그대로, 서식은 종류 + `href`·`color`만,
 * 속성은 위 목록만(미디어 id·사용자 id 같은 것은 버린다). 문서가 아니면 null.
 */
export function pruneAdf(doc: unknown, maxNodes = 3000): AdfNode | null {
  const root = obj(doc);
  if (!root || root.type !== 'doc') return null;
  let left = maxNodes;
  const walk = (n: unknown): AdfNode | null => {
    const o = obj(n);
    const type = str(o?.type);
    if (!o || !type || left <= 0) return null;
    left -= 1;
    const out: AdfNode = { type };
    if (typeof o.text === 'string') out.text = o.text.slice(0, 4000);
    if (Array.isArray(o.marks)) {
      const marks = o.marks
        .map((m) => {
          const mo = obj(m);
          const mt = str(mo?.type);
          if (!mo || !mt) return null;
          const ma = obj(mo.attrs);
          const attrs: Record<string, string | number> = {};
          for (const k of Object.keys(ma ?? {})) if (KEEP_MARK_ATTRS.has(k) && (typeof ma![k] === 'string' || typeof ma![k] === 'number')) attrs[k] = ma![k] as string | number;
          return Object.keys(attrs).length ? { type: mt, attrs } : { type: mt };
        })
        .filter((m): m is NonNullable<typeof m> => !!m);
      if (marks.length) out.marks = marks;
    }
    const a = obj(o.attrs);
    if (a) {
      const attrs: Record<string, string | number | boolean> = {};
      for (const k of Object.keys(a)) {
        const v = a[k];
        if (KEEP_ATTRS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) attrs[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
      if (Object.keys(attrs).length) out.attrs = attrs;
    }
    if (Array.isArray(o.content)) {
      const kids = o.content.map(walk).filter((k): k is AdfNode => !!k);
      if (kids.length) out.content = kids;
    }
    return out;
  };
  const r = walk(root);
  return r && r.content?.length ? r : null;
}
