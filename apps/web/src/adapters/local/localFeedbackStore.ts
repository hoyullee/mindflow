// 로컬/데모 모드의 `FeedbackStore` — 서버가 없으니 localStorage에 쌓는다.
// 실제로 운영자에게 전달되지는 않지만(모달이 데모 모드 안내를 띄운다) UI 흐름이
// 깨지지 않고, 개발 중에는 `mf_feedback` 키로 제출 내용을 확인할 수 있다.

import type { FeedbackEntry, FeedbackStore } from '../ports';

const KEY = 'mf_feedback';
const MAX_ENTRIES = 100;

export class LocalFeedbackStore implements FeedbackStore {
  async submit(entry: FeedbackEntry): Promise<{ error?: string }> {
    const message = entry.message.trim();
    if (!message) return { error: '내용을 입력해 주세요.' };
    try {
      const raw = localStorage.getItem(KEY);
      const list: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : [];
      list.push({ ...entry, message: message.slice(0, 4000), createdAt: new Date().toISOString() });
      localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
    } catch {
      // 손상된 저장소/쿼터 초과 — 피드백은 부가 기능이라 조용히 성공 처리하지
      // 않고 알린다(다시 시도할 수 있게).
      return { error: '저장에 실패했어요.' };
    }
    return {};
  }
}
