import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCommentStore } from './localCommentStore';
import { LocalShareStore } from './localShareStore';
import { LocalNotificationStore } from './localNotificationStore';
import { readLocalNotifications } from './localNotifications';

// 알림 생성 — Supabase에서는 DB 트리거(0022)가 하는 일을, 데모에서는 "서버 역할"인
// 로컬 어댑터들이 같은 시점에 한다(멘션·공유 초대).

function session(email: string): void {
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email } }));
}

beforeEach(() => {
  localStorage.clear();
  session('me@example.com');
  localStorage.setItem('mindflow_doc_d1', JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '분기 계획', parent: null, children: [] } }, floats: [], lines: [], zones: [] }));
});
afterEach(() => localStorage.clear());

describe('로컬 알림 생성', () => {
  it('멘션이 든 댓글이 멘션된 사람의 우편함에 알림을 남긴다 (자기 자신 제외)', async () => {
    const comments = new LocalCommentStore();
    await comments.add('d1', 'n1', '@friend 확인 부탁', { mentions: [{ email: 'friend@example.com', name: 'friend' }, { email: 'me@example.com', name: 'me' }] });
    const rows = readLocalNotifications();
    expect(rows).toHaveLength(1); // 자기 멘션은 알리지 않는다
    expect(rows[0]).toMatchObject({ recipientEmail: 'friend@example.com', kind: 'mention', documentId: 'd1', nodeId: 'n1', preview: '@friend 확인 부탁', docTitle: '분기 계획' });
  });

  it('공유 초대는 처음에만 알린다 — 권한 변경(upsert)은 알리지 않는다', async () => {
    const shares = new LocalShareStore();
    await shares.add('d1', 'friend@example.com', 'edit');
    await shares.add('d1', 'friend@example.com', 'view'); // 권한 변경
    const rows = readLocalNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientEmail: 'friend@example.com', kind: 'share', documentId: 'd1', docTitle: '분기 계획' });
  });

  it('list는 내 우편함만 최신 순으로 주고, markAllRead는 내 것만 읽음 처리한다', async () => {
    const comments = new LocalCommentStore();
    await comments.add('d1', 'n1', '첫 멘션', { mentions: [{ email: 'friend@example.com', name: 'friend' }] });
    await comments.add('d1', 'n2', '둘째 멘션', { mentions: [{ email: 'friend@example.com', name: 'friend' }] });
    await comments.add('d1', 'n3', '남의 것', { mentions: [{ email: 'other@example.com', name: 'other' }] });

    session('friend@example.com'); // 받는 사람 시점으로 전환
    const store = new LocalNotificationStore();
    const list = await store.list();
    expect(list.map((n) => n.preview)).toEqual(['둘째 멘션', '첫 멘션']); // 최신 순, 남의 것 제외
    expect(list.every((n) => !n.read)).toBe(true);

    await store.markAllRead();
    expect((await store.list()).every((n) => n.read)).toBe(true);
    // 남의 우편함은 그대로 안 읽음.
    expect(readLocalNotifications().find((n) => n.recipientEmail === 'other@example.com')?.readAt).toBeNull();
  });
});
