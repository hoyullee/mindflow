import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFeedbackStore } from './localFeedbackStore';

// 로컬/데모 모드 피드백 — 서버가 없으니 localStorage(`mf_feedback`)에 쌓인다.
// 실제 전송은 아니지만(모달이 안내) UI 흐름이 깨지지 않는 것이 계약.

describe('LocalFeedbackStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('제출이 localStorage에 누적된다 (createdAt 포함)', async () => {
    const store = new LocalFeedbackStore();
    expect(await store.submit({ category: 'ux', message: '  불편해요  ', page: 'home' })).toEqual({});
    expect(await store.submit({ category: 'bug', message: '버그예요', page: 'editor', meta: { build: 'x' } })).toEqual({});
    const saved = JSON.parse(localStorage.getItem('mf_feedback')!) as Array<Record<string, unknown>>;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ category: 'ux', message: '불편해요', page: 'home' }); // trim
    expect(saved[1]).toMatchObject({ category: 'bug', page: 'editor', meta: { build: 'x' } });
    expect(typeof saved[0]!.createdAt).toBe('string');
  });

  it('빈 내용은 막는다', async () => {
    const store = new LocalFeedbackStore();
    const res = await store.submit({ category: 'other', message: '   ', page: 'home' });
    expect(res.error).toBeTruthy();
    expect(localStorage.getItem('mf_feedback')).toBeNull();
  });

  it('손상된 저장소여도 던지지 않고 오류를 돌려준다', async () => {
    localStorage.setItem('mf_feedback', '{broken');
    const store = new LocalFeedbackStore();
    const res = await store.submit({ category: 'idea', message: '아이디어', page: 'home' });
    expect(res.error).toBeTruthy();
  });
});
