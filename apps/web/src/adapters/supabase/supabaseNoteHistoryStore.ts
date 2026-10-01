// 공책 페이지별 기록 — `note_history` 테이블 위의 `NoteHistoryStore`
// (`supabase/migrations/0048_note_history.sql`).
//
// 권한·보관은 전부 서버가 정한다(RLS: 읽기=소유자·초대받은 사람, 쓰기=편집 권한 + 자기
// 이름으로만, 고치기=내 항목만, 지우기=없음 / 보관 트리거: 30일 밖은 하루 1개).
// 이 어댑터는 행 ↔ 항목 모양을 옮길 뿐이다.
//
// **`actor_id`를 보내지 않는다** — 칼럼 기본값(`auth.uid()`)이 찍고, insert 정책이
// 그 값을 요구한다. 클라이언트가 id를 실어 보내는 길을 아예 두지 않으면 위조할 길도 없다.
//
// **던진다**: 태그 판과 달리 기록은 호출자(기록 훅)가 잡아 "기록 실패"를 조용히
// 건너뛴다 — 여기서 삼키면 호출자가 실패와 빈 목록을 구분할 수 없다.
// (테이블 미적용 서버면 list가 던지고, 호출자는 기록 패널을 비운 채 둔다.)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoteHistoryDraft, NoteHistoryEntry, NoteHistoryKind, NoteHistoryStore } from '../ports';

const TABLE = 'note_history';
const COLS = 'id,document_id,page_id,at,actor_id,actor_name,actor_color,actor_avatar,kind,summary,diff,anchor,snapshot';
const DEFAULT_LIMIT = 100;

interface Row {
  id: string;
  document_id: string;
  page_id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_color: string | null;
  actor_avatar: string | null;
  kind: NoteHistoryKind;
  summary: string | null;
  diff: unknown;
  anchor: string | null;
  snapshot: unknown;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** `{before, after}` 모양만 통과 — 어긋난 jsonb로 비교 화면을 세우지 않는다. */
function diffOf(raw: unknown): NoteHistoryEntry['diff'] {
  const d = raw as { before?: unknown; after?: unknown } | null;
  if (d && typeof d === 'object' && typeof d.before === 'string' && typeof d.after === 'string') return { before: d.before, after: d.after };
  return null;
}

function toEntry(r: Row): NoteHistoryEntry {
  return {
    id: r.id,
    docId: r.document_id,
    pageId: r.page_id,
    at: Date.parse(r.at),
    // 탈퇴한 사람은 actor_id가 null — 이름·색 스냅샷으로 계속 읽힌다.
    actor: { id: r.actor_id ?? '', name: r.actor_name ?? '', color: r.actor_color ?? '', avatar: r.actor_avatar },
    kind: r.kind,
    summary: r.summary ?? '',
    diff: diffOf(r.diff),
    anchor: r.anchor,
    snapshot: r.snapshot,
  };
}

export class SupabaseNoteHistoryStore implements NoteHistoryStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(docId: string, pageId: string, opts: { before?: number; limit?: number } = {}): Promise<{ entries: NoteHistoryEntry[]; hasMore: boolean }> {
    const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
    let q = this.client.from(TABLE).select(COLS).eq('document_id', docId).eq('page_id', pageId);
    if (opts.before !== undefined) q = q.lt('at', iso(opts.before));
    // 한 건 더 읽어 "더 있는가"만 안다 — count 질의를 따로 하지 않는다.
    const { data, error } = await q.order('at', { ascending: false }).limit(limit + 1);
    if (error) throw new Error(`note_history list failed: ${error.message}`);
    const rows = (data as Row[] | null) ?? [];
    return { entries: rows.slice(0, limit).map(toEntry), hasMore: rows.length > limit };
  }

  async append(draft: NoteHistoryDraft): Promise<NoteHistoryEntry> {
    const row: Record<string, unknown> = {
      document_id: draft.docId,
      page_id: draft.pageId,
      actor_name: draft.actor.name,
      actor_color: draft.actor.color,
      actor_avatar: draft.actor.avatar ?? null,
      kind: draft.kind,
      summary: draft.summary,
      diff: draft.diff ?? null,
      anchor: draft.anchor ?? null,
      snapshot: draft.snapshot,
    };
    // 시각을 안 주면 칼럼 기본값(`now()`) — 서버 시계가 정한다.
    if (draft.at !== undefined) row['at'] = iso(draft.at);
    const { data, error } = await this.client.from(TABLE).insert(row).select(COLS).single();
    if (error) throw new Error(`note_history append failed: ${error.message}`);
    return toEntry(data as Row);
  }

  async update(id: string, patch: Parameters<NoteHistoryStore['update']>[1]): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.at !== undefined) row['at'] = iso(patch.at);
    if (patch.kind !== undefined) row['kind'] = patch.kind;
    if (patch.summary !== undefined) row['summary'] = patch.summary;
    if (patch.diff !== undefined) row['diff'] = patch.diff;
    if (patch.anchor !== undefined) row['anchor'] = patch.anchor;
    if (patch.snapshot !== undefined) row['snapshot'] = patch.snapshot;
    if (Object.keys(row).length === 0) return;
    // 남의 항목이면 RLS가 0행으로 돌려 오류 없이 지나간다 — 묶음 창은 내 항목만 고친다.
    const { error } = await this.client.from(TABLE).update(row).eq('id', id);
    if (error) throw new Error(`note_history update failed: ${error.message}`);
  }
}
