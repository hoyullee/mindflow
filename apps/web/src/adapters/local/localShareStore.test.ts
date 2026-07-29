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
});
