// 문서 공유 — `document_shares` 테이블 위의 `ShareStore`
// (`supabase/migrations/0009_document_shares.sql`).
//
// 접근 제어는 전부 **RLS**가 한다: 소유자만 초대를 만들고 전체 목록을 보며,
// 초대받은 사람은 자기 행만 읽고 자기 자신만 뺄 수 있다(공유 나가기). 그래서 이
// 어댑터는 필터를 직접 걸지 않는다 — 쿼리가 닿을 수 있는 행 자체가 이미 제한된다.
//
// 초대 대상은 사용자 id가 아니라 **이메일**이다: 클라이언트는 `auth.users`를 읽을 수
// 없어 이메일 → uuid 변환을 할 수 없고, 이 방식이면 아직 가입하지 않은 사람도
// 초대할 수 있다(그 이메일로 가입하는 순간 권한이 생긴다). 0009 주석 참고.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentShare, ShareParticipant, ShareRole, ShareStore, SharedWithMe } from '../ports';

const TABLE = 'document_shares';

interface ShareRow {
  document_id: string;
  invitee_email: string;
  role: string;
  created_at: string;
}

function toRole(raw: string): ShareRole {
  return raw === 'view' ? 'view' : 'edit';
}

export class SupabaseShareStore implements ShareStore {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * 링크 공유 상태(0017의 `documents.link_role`). 읽기는 문서를 볼 수 있는 사람이면
   * 되지만, 쓰기는 RLS가 소유자만 허용한다.
   */
  async getLink(documentId: string): Promise<ShareRole | null> {
    const { data, error } = await this.client.from('documents').select('link_role').eq('id', documentId).maybeSingle();
    // 컬럼이 없는 서버(마이그레이션 전)나 일시 오류 → 꺼짐으로 본다. 켜져 있는데
    // 꺼진 것으로 보이는 쪽이 안전하다(UI가 실수로 "공유 중"이라 말하지 않는다).
    if (error) return null;
    const raw = (data as { link_role?: string | null } | null)?.link_role;
    return raw === 'view' ? 'view' : null;
  }

  async setLink(documentId: string, role: ShareRole | null): Promise<{ error?: string }> {
    // 'edit' 링크는 0017의 check 제약이 막는다 — 열려면 의도적인 마이그레이션이 필요하다.
    const next = role === 'view' ? 'view' : null;
    const { error } = await this.client.from('documents').update({ link_role: next }).eq('id', documentId);
    if (error) return { error: error.message };
    return {};
  }

  async list(documentId: string): Promise<DocumentShare[]> {
    const { data, error } = await this.client.from(TABLE).select('document_id,invitee_email,role,created_at').eq('document_id', documentId).order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ShareRow[]).map((r) => ({ documentId: r.document_id, email: r.invitee_email, role: toRole(r.role), createdAt: r.created_at }));
  }

  async add(documentId: string, email: string, role: ShareRole = 'edit'): Promise<{ error?: string }> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return { error: '이메일을 입력해 주세요.' };
    // `invited_by`는 컬럼 기본값(auth.uid())이 채운다 — 정책이 `auth.uid() = invited_by`를
    // 요구하므로 클라이언트가 보내지 않는 편이 안전하다(0001의 documents.owner와 같은 패턴).
    // 이미 있는 초대면 권한만 갱신한다(PK = document_id + invitee_email).
    const { error } = await this.client.from(TABLE).upsert({ document_id: documentId, invitee_email: normalized, role }, { onConflict: 'document_id,invitee_email' });
    if (error) return { error: error.message };
    return {};
  }

  async remove(documentId: string, email: string): Promise<{ error?: string }> {
    const { error } = await this.client.from(TABLE).delete().eq('document_id', documentId).eq('invitee_email', email.trim().toLowerCase());
    if (error) return { error: error.message };
    return {};
  }

  async listParticipants(documentId: string): Promise<ShareParticipant[] | null> {
    // 0011의 SECURITY DEFINER RPC — 클라이언트가 못 읽는 auth.users/profiles 조인을
    // 서버가 대신 한다. 문서에 접근할 수 있는 사람 전원이 같은 명단을 본다. RPC가
    // 아직 적용되지 않은 서버(마이그레이션 전 배포)나 일시 오류에서는 null — 공유
    // 팝업은 이메일만 보여주는 기존 렌더로 폴백하고, 공유 자체는 계속 동작한다.
    try {
      const { data, error } = await this.client.rpc('share_participants', { doc_id: documentId });
      if (error) return null;
      return ((data ?? []) as { kind: string; email: string; display_name: string | null; joined: boolean; role?: string | null }[]).map((r) => ({
        kind: r.kind === 'owner' ? 'owner' : 'invitee',
        email: r.email,
        displayName: r.display_name && r.display_name.trim() ? r.display_name : null,
        joined: !!r.joined,
        role: toRole(r.role ?? 'edit'),
      }));
    } catch {
      return null;
    }
  }

  async listSharedWithMe(): Promise<SharedWithMe[]> {
    // RLS가 "내 이메일로 온 초대"만 보이게 하므로 필터가 필요 없다. 다만 소유자로서
    // 내가 만든 초대도 보이므로(정책이 OR), 내 문서에 걸린 초대는 걸러낸다 —
    // 이건 "남이 나에게 공유한 것" 목록이다. `documents.owner`를 클라이언트에서 알 수
    // 없으니 조인 대신 내 이메일과의 일치로 판단한다.
    const { data: userData } = await this.client.auth.getUser();
    const myEmail = (userData?.user?.email ?? '').trim().toLowerCase();
    if (!myEmail) return [];
    const { data, error } = await this.client.from(TABLE).select('document_id,role').eq('invitee_email', myEmail);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { document_id: string; role: string }[]).map((r) => ({ documentId: r.document_id, role: toRole(r.role) }));
  }
}
