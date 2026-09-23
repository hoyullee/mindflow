// 공책 태그 판 — `note_tags` 테이블 위의 `TagStore`
// (`supabase/migrations/0042_note_tags.sql`).
//
// 사용자당 한 행(`owner` PK, 기본값 `auth.uid()`)에 판 전체를 `data` JSONB로 담는다.
// RLS가 모든 행을 `owner = auth.uid()`로 좁히므로 이 어댑터는 owner로 거르지 않는다
// — 질의가 닿을 수 있는 행이 자기 것 하나뿐이다(`SupabaseSpaceStore`와 같은 모양).
//
// **던지지 않는다**: 태그 판은 부가 정보라, 서버가 없거나(마이그레이션 전 배포)
// 네트워크가 끊겨도 화면은 기기 캐시로 그대로 돌아가야 한다. 실패는 콘솔로만 남기고
// `load`는 `null`(= 서버에 판이 없다)로 돌아선다.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoteTagBoard, TagStore } from '../ports';

const TABLE = 'note_tags';

interface TagRow {
  data: Partial<NoteTagBoard> | null;
}

export class SupabaseTagStore implements TagStore {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<NoteTagBoard | null> {
    const { data, error } = await this.client.from(TABLE).select('data').maybeSingle();
    if (error) {
      console.warn('[note-tags] load failed:', error.message);
      return null;
    }
    const body = (data as TagRow | null)?.data;
    if (!body || typeof body !== 'object') return null;
    // 판이 빈 객체(`'{}'::jsonb` 기본값)일 수도 있다 — 모양을 맞춰 돌려준다.
    return {
      made: Array.isArray(body.made) ? body.made.filter((t): t is string => typeof t === 'string') : [],
      colors: body.colors && typeof body.colors === 'object' ? (body.colors as Record<string, string>) : {},
      hidden: Array.isArray(body.hidden) ? body.hidden.filter((t): t is string => typeof t === 'string') : [],
    };
  }

  async save(board: NoteTagBoard): Promise<void> {
    // `owner`를 보내지 않는다 — 칼럼 기본값(`auth.uid()`)이 insert 때 찍고,
    // 다음부터는 `onConflict: 'owner'`가 그 행을 갱신한다(0042 / workspaces와 동일).
    const { error } = await this.client
      .from(TABLE)
      .upsert({ data: { made: board.made, colors: board.colors, hidden: board.hidden }, updated_at: new Date().toISOString() }, { onConflict: 'owner' });
    if (error) console.warn('[note-tags] save failed:', error.message);
  }
}
