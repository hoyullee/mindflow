// 인라인 멘션 알림의 로컬 짝(0026) — 저장 시 **새로 생긴** (이메일, 객체) 쌍에만 알림.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '@mindflow/mindmap-core';
import { LocalDocStore } from './localDocStore';

function docWithMention(email: string | null, floatMention?: string): Doc {
  return {
    v: 1,
    nodes: {
      root: {
        id: 'root', text: '@kim 확인', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0,
        rich: email ? [{ t: '@kim', b: false, c: null, m: email }, { t: ' 확인', b: false, c: null }] : null,
      },
    },
    floats: floatMention
      ? [{ id: 'f1', text: '@kim 메모', x: 10, y: 10, w: 120, rich: [{ t: '@kim', b: false, c: null, m: floatMention }, { t: ' 메모', b: false, c: null }] }]
      : [],
    lines: [], zones: [], layoutMode: 'right', themeKey: 'coral',
  } as unknown as Doc;
}

describe('LocalDocStore 인라인 멘션 알림', () => {
  beforeEach(() => localStorage.clear());

  it('새 멘션이 생긴 저장에만 알림을 만들고, 같은 멘션의 재저장은 조용하다', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    const store = new LocalDocStore();
    await store.save('d1', docWithMention(null));
    expect(localStorage.getItem('mf_notifications') ?? '[]').not.toContain('doc_mention');
    await store.save('d1', docWithMention('kim@x.io'));
    const list = JSON.parse(localStorage.getItem('mf_notifications') || '[]') as { kind: string; recipientEmail: string; documentId: string }[];
    const mine = list.filter((n) => n.kind === 'doc_mention');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.recipientEmail).toBe('kim@x.io');
    expect(mine[0]!.documentId).toBe('d1');
    // 같은 멘션 그대로 재저장 — 쌍 차이가 없으니 알림도 없다(자동저장 스팸 방지).
    await store.save('d1', docWithMention('kim@x.io'));
    const again = (JSON.parse(localStorage.getItem('mf_notifications') || '[]') as { kind: string }[]).filter((n) => n.kind === 'doc_mention');
    expect(again).toHaveLength(1);
  });

  it('같은 사람이라도 **새 객체**(메모)에 멘션하면 다시 알린다 — (이메일, 객체) 쌍 비교(제보)', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    const store = new LocalDocStore();
    await store.save('d1', docWithMention('kim@x.io'));
    // 기존 노드 멘션은 그대로 두고 메모에 같은 사람을 새로 멘션 — 예전(이메일 집합)
    // 규칙이라면 집합이 {kim}으로 동일해 조용했다.
    await store.save('d1', docWithMention('kim@x.io', 'kim@x.io'));
    const list = (JSON.parse(localStorage.getItem('mf_notifications') || '[]') as { kind: string; recipientEmail: string }[]).filter((n) => n.kind === 'doc_mention');
    expect(list).toHaveLength(2);
    expect(list.every((n) => n.recipientEmail === 'kim@x.io')).toBe(true);
  });
});
