import { beforeEach, describe, expect, it } from 'vitest';
import { LocalShareStore } from './localShareStore';

beforeEach(() => localStorage.clear());

describe('LocalShareStore', () => {
  it('초대를 추가하고 문서별로 돌려준다', async () => {
    const store = new LocalShareStore();
    expect(await store.add('d1', 'a@example.com')).toEqual({});
    await store.add('d1', 'b@example.com');
    await store.add('d2', 'c@example.com');

    const d1 = await store.list('d1');
    expect(d1.map((s) => s.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(d1.every((s) => s.role === 'edit')).toBe(true); // 기본 권한
    expect((await store.list('d2')).map((s) => s.email)).toEqual(['c@example.com']);
  });

  it('이메일은 소문자·공백 정리해서 저장한다 (Supabase 트리거와 같은 규칙)', async () => {
    const store = new LocalShareStore();
    await store.add('d1', '  Mixed.Case@Example.COM  ');
    expect((await store.list('d1')).map((s) => s.email)).toEqual(['mixed.case@example.com']);
  });

  it('같은 이메일을 다시 초대하면 중복이 아니라 권한 갱신이다', async () => {
    const store = new LocalShareStore();
    await store.add('d1', 'a@example.com', 'edit');
    await store.add('d1', 'A@example.com', 'view');
    const d1 = await store.list('d1');
    expect(d1).toHaveLength(1);
    expect(d1[0]!.role).toBe('view');
  });

  it('빈 이메일은 거부한다', async () => {
    const store = new LocalShareStore();
    expect((await store.add('d1', '   ')).error).toBeTruthy();
    expect(await store.list('d1')).toEqual([]);
  });

  it('초대를 취소한다 (대소문자 무관)', async () => {
    const store = new LocalShareStore();
    await store.add('d1', 'a@example.com');
    await store.add('d1', 'b@example.com');
    await store.remove('d1', 'A@EXAMPLE.COM');
    expect((await store.list('d1')).map((s) => s.email)).toEqual(['b@example.com']);
  });

  it('없는 초대를 취소해도 조용히 넘어간다', async () => {
    const store = new LocalShareStore();
    expect(await store.remove('d1', 'nobody@example.com')).toEqual({});
  });

  it('이 모드에는 "남"이 없으므로 공유받은 문서는 항상 없다', async () => {
    const store = new LocalShareStore();
    await store.add('d1', 'a@example.com');
    expect(await store.listSharedWithMe()).toEqual([]);
  });

  it('저장소가 망가져 있어도 빈 목록으로 시작한다', async () => {
    localStorage.setItem('mf_doc_shares', '{ 이건 JSON이 아니다');
    expect(await new LocalShareStore().list('d1')).toEqual([]);
  });

  it('참가자: 소유자는 데모 세션의 나, 초대는 프로필명 캐시가 있으면 이름·가입으로 본다', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    localStorage.setItem('mf_profile_names', JSON.stringify({ 'me@example.com': '나야나', 'known@example.com': '아는 사람' }));
    const store = new LocalShareStore();
    await store.add('d1', 'known@example.com');
    await store.add('d1', 'stranger@example.com');

    const people = await store.listParticipants('d1');

    expect(people).toEqual([
      { kind: 'owner', email: 'me@example.com', displayName: '나야나', joined: true, role: 'edit', avatarUrl: null },
      { kind: 'invitee', email: 'known@example.com', displayName: '아는 사람', joined: true, role: 'edit', avatarUrl: null },
      { kind: 'invitee', email: 'stranger@example.com', displayName: null, joined: false, role: 'edit', avatarUrl: null },
    ]);
  });

  // 프로필 이미지(0031)의 데모 짝 — Supabase는 RPC 조인으로 오지만, 데모에는
  // "다른 사용자"가 없으므로 이 브라우저의 캐시에서 읽는다(프로필명과 같은 규칙).
  // 그래야 에디터(칸반 담당·댓글 얼굴)에서도 같은 길을 탄다.
  it('참가자: 프로필 이미지 캐시가 있으면 그 주소를 함께 싣는다', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    localStorage.setItem('mf_profile_avatars', JSON.stringify({ 'me@example.com': 'data:image/webp;base64,AA', 'known@example.com': 'https://cdn.example.com/k.webp' }));
    const store = new LocalShareStore();
    await store.add('d1', 'known@example.com');
    await store.add('d1', 'stranger@example.com');

    const people = await store.listParticipants('d1');

    expect(people?.map((p) => p.avatarUrl)).toEqual(['data:image/webp;base64,AA', 'https://cdn.example.com/k.webp', null]);
  });
});

describe('listSharedByMe — 카드 "공유 중" 표식의 원천', () => {
  beforeEach(() => localStorage.clear());

  it('초대 수와 링크 여부를 문서별로 묶는다', async () => {
    const store = new LocalShareStore();
    await store.add('d1', 'a@example.com', 'edit');
    await store.add('d1', 'b@example.com', 'view');
    await store.setLink('d2', 'view');
    const out = await store.listSharedByMe();
    expect(out.d1).toEqual({ invitees: 2, link: false });
    expect(out.d2).toEqual({ invitees: 0, link: true });
    expect(out.d3).toBeUndefined(); // 공유 없는 문서는 항목 자체가 없다
  });
});
