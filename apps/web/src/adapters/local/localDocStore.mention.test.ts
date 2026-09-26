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

/** 공책 한 권 — 블록이 글을 드는 **세 자리**(runs · items[].runs · rows[][])를 담는다. */
function noteWith(blocks: unknown[], pageId = 'p1'): Doc {
  return {
    v: 1, kind: 'note', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral',
    pages: [{ id: pageId, title: '장', blocks }],
  } as unknown as Doc;
}
const mention = (email: string) => [{ t: '@kim', b: false, c: null, m: email }];

describe('공책 **본문**의 멘션도 알림을 만든다(0043)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
  });

  it('문단에 부른 사람에게 알림이 간다 — 예전에는 공책 본문을 한 글자도 보지 않았다', async () => {
    const store = new LocalDocStore();
    await store.save('n1', noteWith([{ id: 'b1', kind: 'p', runs: [] }]));
    expect(localStorage.getItem('mf_notifications') ?? '[]').not.toContain('doc_mention');
    await store.save('n1', noteWith([{ id: 'b1', kind: 'p', runs: mention('kim@x.io') }]));
    expect(localStorage.getItem('mf_notifications') ?? '[]').toContain('doc_mention');
  });

  it('**목록 항목**과 **표의 칸**도 훑는다 — 코어가 글을 펴는 자리와 같다', async () => {
    const store = new LocalDocStore();
    await store.save('n2', noteWith([{ id: 'b1', kind: 'ul', items: [{ id: 'i1', runs: [] }] }]));
    const quiet = localStorage.getItem('mf_notifications') ?? '[]';
    await store.save('n2', noteWith([{ id: 'b1', kind: 'ul', items: [{ id: 'i1', runs: mention('lee@x.io') }] }]));
    expect(localStorage.getItem('mf_notifications')).not.toBe(quiet);

    localStorage.removeItem('mf_notifications');
    await store.save('n3', noteWith([{ id: 't1', kind: 'table', rows: [[[{ t: '칸', b: false, c: null }]]] }]));
    await store.save('n3', noteWith([{ id: 't1', kind: 'table', rows: [[[{ t: '칸', b: false, c: null }], mention('park@x.io')]] }]));
    expect(localStorage.getItem('mf_notifications') ?? '[]').toContain('doc_mention');
  });

  it('**다른 블록**에 다시 부르면 새 쌍이라 또 울린다 — 같은 블록 안 재멘션은 조용하다', async () => {
    const store = new LocalDocStore();
    await store.save('n4', noteWith([{ id: 'b1', kind: 'p', runs: mention('kim@x.io') }, { id: 'b2', kind: 'p', runs: [] }]));
    // 첫 알림을 읽은 것으로 치우고(로컬은 미확인 중복 억제가 없지만 개수로 센다) 개수를 잰다.
    const one = JSON.parse(localStorage.getItem('mf_notifications') ?? '[]').length as number;
    // 같은 블록에 한 번 더 — 쌍이 그대로라 늘지 않는다.
    await store.save('n4', noteWith([{ id: 'b1', kind: 'p', runs: [...mention('kim@x.io'), { t: ' 덧말', b: false, c: null }] }, { id: 'b2', kind: 'p', runs: [] }]));
    expect((JSON.parse(localStorage.getItem('mf_notifications') ?? '[]') as unknown[]).length).toBe(one);
    // 다른 블록에 부르면 새 쌍이다.
    await store.save('n4', noteWith([{ id: 'b1', kind: 'p', runs: mention('kim@x.io') }, { id: 'b2', kind: 'p', runs: mention('kim@x.io') }]));
    expect((JSON.parse(localStorage.getItem('mf_notifications') ?? '[]') as unknown[]).length).toBeGreaterThan(one);
  });

  it('망가진 본문에도 터지지 않는다 — `pages`가 배열이 아니거나 `runs`가 평문일 때', async () => {
    const store = new LocalDocStore();
    const broken = { v: 1, kind: 'note', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', pages: 'nope' } as unknown as Doc;
    await expect(store.save('n5', broken)).resolves.toBeDefined();
    const odd = noteWith([{ id: 'b1', kind: 'p', runs: null }, { id: 'b2' }, { id: 'b3', kind: 'table', rows: [null, 'x'] }]);
    await expect(store.save('n6', odd)).resolves.toBeDefined();
  });
});
