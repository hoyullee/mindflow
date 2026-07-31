// Real doc store — `DocStore` implemented against the `documents` Postgres
// table (`supabase/migrations/0001_init.sql`). RLS restricts every query to
// rows I may touch — 내 문서 **또는 나에게 공유된 문서**(0009) — so this adapter
// doesn't need to (and shouldn't) filter by owner itself: a stray missing
// `WHERE owner = ...` here is not a security hole, RLS is the actual
// enforcement boundary.
//
// 공유가 생긴 뒤로 `list()`는 남이 나에게 공유한 문서까지 돌려준다. 그래서 각 행의
// `owner`를 함께 읽어 `DocMeta.ownedByMe`를 채운다 — 홈이 남의 문서를 자기 스페이스
// 카드로 삼지 않기 위한 구분이다(워크스페이스 블롭은 per-user).
//
// Doc bodies are stored as-is in the `data` JSONB column, exactly as
// `serializeDoc` produces them — `load()` runs them back through `parseDoc`
// so a malformed/legacy row degrades to `null` rather than throwing.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Doc } from '@mindflow/mindmap-core';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import type { DocMeta, DocStore, LoadedDoc, SaveOptions, SaveResult } from '../ports';
import { readPreviewBody, writePreviewBody } from '../previewBodyCache';

const TABLE = 'documents';

interface DocumentRow {
  id: string;
  title: string | null;
  version: number;
  data: unknown;
  updated_at: string;
  is_favorite: boolean | null;
  deleted_at: string | null;
  owner?: string | null;
}

export class SupabaseDocStore implements DocStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<DocMeta[]> {
    // 내 uid는 세션에서 온다(supabase-js가 캐시한다). 못 알아내면 모두 내 것으로
    // 본다 — 공유 이전과 같은 동작이라 최악이라도 예전 상태로 퇴화할 뿐이다.
    const [{ data, error }, { data: userData }] = await Promise.all([
      this.client.from(TABLE).select('id,title,version,updated_at,is_favorite,deleted_at,owner').order('updated_at', { ascending: false }),
      this.client.auth.getUser(),
    ]);
    if (error) throw new Error(error.message);
    const myId = userData?.user?.id ?? null;
    return ((data ?? []) as DocumentRow[]).map((row) => ({
      id: row.id,
      title: row.title ?? '(제목 없음)',
      version: row.version,
      updatedAt: row.updated_at,
      isFavorite: Boolean(row.is_favorite),
      deletedAt: row.deleted_at,
      ownedByMe: !myId || !row.owner ? true : row.owner === myId,
    }));
  }

  async load(id: string): Promise<LoadedDoc | null> {
    const { data, error } = await this.client.from(TABLE).select('id,title,version,data').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as DocumentRow;
    const doc: Doc | null = parseDoc(row.data);
    if (!doc) return null;
    return { doc, version: row.version, title: row.title ?? '' };
  }

  async loadPreview(id: string, meta?: { version: number; updatedAt: string }): Promise<string | null> {
    // ① 같은 판(version + updatedAt)을 이미 받아 뒀으면 네트워크 생략.
    //    version은 낙관적 잠금이라 판이 다르면 반드시 키가 어긋난다 — 동시
    //    편집으로 남이 저장했어도 다음 list()가 새 version을 주므로 재다운로드.
    if (meta) {
      const hit = readPreviewBody(id, meta.version, meta.updatedAt);
      if (hit !== null) return hit;
    }
    // ② 이미지 데이터를 뗀 본문 RPC(0012). RLS invoker — 내 문서/공유받은
    //    문서만 보인다(documents SELECT 정책 그대로).
    let body: string | null = null;
    try {
      const { data, error } = await this.client.rpc('preview_doc', { doc_id: id });
      if (!error && data != null) {
        const doc = parseDoc(data);
        if (doc) body = JSON.stringify(serializeDoc(doc));
      } else if (error) {
        // RPC 미적용 서버(마이그레이션 전) 등 — 전문 로드로 폴백한다.
        console.warn('[geurio] preview_doc RPC 실패 — 전문 로드로 폴백:', error.message);
      }
    } catch {
      /* 네트워크 오류 등 — 아래 폴백 */
    }
    if (body === null) {
      const full = await this.load(id).catch(() => null);
      if (!full) return null;
      body = JSON.stringify(serializeDoc(full.doc));
    }
    if (meta) writePreviewBody(id, meta.version, meta.updatedAt, body);
    return body;
  }

  async save(id: string, doc: Doc, opts: SaveOptions = {}): Promise<SaveResult> {
    const payload = serializeDoc(doc);
    const nowIso = new Date().toISOString();

    if (opts.prevVersion === undefined) {
      const row = { id, title: opts.title ?? '', data: payload, version: 1, updated_at: nowIso };
      if (opts.createOnly) {
        // INSERT만 — 이미 있으면 PK 충돌로 실패한다(`SaveOptions.createOnly` 참고).
        // 덮어쓰기가 아니라 `conflict`로 돌려주므로 호출부가 다른 id로 재시도할 수 있다.
        const { data, error } = await this.client.from(TABLE).insert(row).select('version').single();
        if (!error) return { ok: true, version: (data as { version: number } | null)?.version ?? 1 };
        // 23505 = unique_violation. 코드가 없는 구현/프록시도 있으니 메시지도 함께 본다.
        const dup = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
        if (!dup) return { ok: false, reason: 'error', message: error.message };
        const { data: cur } = await this.client.from(TABLE).select('version').eq('id', id).maybeSingle();
        return { ok: false, reason: 'conflict', currentVersion: (cur as { version: number } | null)?.version ?? 1 };
      }
      // 버전을 모르는 첫 저장 — **INSERT**로 한다(예전엔 upsert였다).
      //
      // upsert(`ON CONFLICT DO UPDATE`)였을 때의 문제: 그 id의 행이 이미 있고 그게
      // **다른 계정 문서**라면 남의 행을 UPDATE하려 든다. RLS가 막아 주긴 하지만
      // (42501 `row-level security policy (USING expression)` — 자동저장이 재시도해
      // 로그를 가득 채웠다, 제보) 애초에 요청 자체가 틀렸다. 정책이 허용했다면
      // **남의 문서를 조용히 덮어썼을** 요청이다.
      //
      // INSERT면 id가 이미 있을 때 23505로 안전하게 실패한다. 이어서 그 행을 읽어
      // 보고 — 읽히면 내 문서(다른 탭이 방금 만든 것)이니 `conflict`로 버전을 알려
      // 재시도하게 하고, 안 읽히면 남의 문서이니 `idTaken`으로 알려 호출부가 새
      // id로 옮겨 저장하게 한다.
      const { data, error } = await this.client.from(TABLE).insert(row).select('version').single();
      if (!error) return { ok: true, version: (data as { version: number } | null)?.version ?? 1 };
      const taken = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
      if (!taken) return { ok: false, reason: 'error', message: error.message };
      const { data: cur } = await this.client.from(TABLE).select('version').eq('id', id).maybeSingle();
      const mine = (cur as { version: number } | null)?.version;
      if (typeof mine === 'number') return { ok: false, reason: 'conflict', currentVersion: mine };
      return { ok: false, reason: 'idTaken' };
    }

    const nextVersion = opts.prevVersion + 1;
    const update: Record<string, unknown> = { data: payload, version: nextVersion, updated_at: nowIso };
    if (opts.title !== undefined) update.title = opts.title;

    const { data, error } = await this.client.from(TABLE).update(update).eq('id', id).eq('version', opts.prevVersion).select('version').maybeSingle();
    if (error) return { ok: false, reason: 'error', message: error.message };
    if (!data) {
      // `UPDATE ... WHERE id = ? AND version = ?` matched no row: either the
      // doc doesn't exist, or someone else saved first — fetch the current
      // version so the caller can report *which* conflict this is.
      const { data: cur } = await this.client.from(TABLE).select('version').eq('id', id).maybeSingle();
      return { ok: false, reason: 'conflict', currentVersion: (cur as { version: number } | null)?.version ?? nextVersion };
    }
    return { ok: true, version: (data as { version: number }).version };
  }

  async remove(id: string): Promise<void> {
    await this.client.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }

  async restore(id: string): Promise<void> {
    await this.client.from(TABLE).update({ deleted_at: null }).eq('id', id);
  }

  async purge(id: string): Promise<void> {
    // Hard row delete — covered by the existing `documents_delete_own` RLS
    // policy (0001_init.sql), so no new migration is needed.
    await this.client.from(TABLE).delete().eq('id', id);
  }

  async rename(id: string, title: string): Promise<void> {
    await this.client.from(TABLE).update({ title }).eq('id', id);
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.client.from(TABLE).update({ is_favorite: favorite }).eq('id', id);
  }
}
