// 사용자 피드백 — `feedback` 테이블 위의 `FeedbackStore`
// (`supabase/migrations/0014_feedback.sql`).
//
// insert 전용 우편함: RLS가 "로그인 사용자, 자기 uid로만 insert"를 강제하고
// 조회 정책은 없다 — 운영자가 Supabase Studio에서 본다. 이메일은 작성 시점
// 스냅샷으로 함께 남긴다(탈퇴로 user_id가 null이 되어도 내용이 자산으로 남게).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackEntry, FeedbackStore } from '../ports';

export class SupabaseFeedbackStore implements FeedbackStore {
  constructor(private readonly client: SupabaseClient) {}

  async submit(entry: FeedbackEntry): Promise<{ error?: string }> {
    const message = entry.message.trim();
    if (!message) return { error: '내용을 입력해 주세요.' };
    const { data } = await this.client.auth.getUser();
    const user = data?.user;
    if (!user) return { error: '로그인이 필요해요.' };
    const { error } = await this.client.from('feedback').insert({
      user_id: user.id,
      email: user.email ?? null,
      category: entry.category,
      message: message.slice(0, 4000),
      page: entry.page,
      meta: entry.meta ?? null,
    });
    // 테이블 미적용 서버(마이그레이션 전 배포)·네트워크 오류 — 사용자에게는
    // 짧게, 원문은 콘솔로(재시도할 수 있게 모달은 열려 있는다).
    if (error) {
      console.warn('[feedback] submit failed:', error.message);
      return { error: '전송에 실패했어요. 잠시 후 다시 시도해 주세요.' };
    }
    return {};
  }
}
