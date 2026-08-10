// 인라인 멘션 알림의 로컬 짝(0023) — 저장 시 **새로 생긴** 멘션에만 알림.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '@mindflow/mindmap-core';
import { LocalDocStore } from './localDocStore';

function docWithMention(email: string | null): Doc {
  return {
    v: 1,
    nodes: {
      root: {
        id: 'root', text: '@kim 확인', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0,
        rich: email ? [{ t: '@kim', b: false, c: null, m: email }, { t: ' 확인', b: false, c: null }] : null,
      },
    },
    floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral',
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
    // 같은 멘션 그대로 재저장 — 집합 차이가 없으니 알림도 없다(자동저장 스팸 방지).
    await store.save('d1', docWithMention('kim@x.io'));
    const again = (JSON.parse(localStorage.getItem('mf_notifications') || '[]') as { kind: string }[]).filter((n) => n.kind === 'doc_mention');
    expect(again).toHaveLength(1);
  });
});
