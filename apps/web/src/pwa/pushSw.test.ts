// `public/push-sw.js`의 동작 — **서비스 워커 안에서 도는 코드**라 평범한 방법으로는
// 테스트할 수 없다(번들러를 지나지 않고, `self`가 `ServiceWorkerGlobalScope`다).
//
// 그래서 가짜 `self`/`clients`를 만들어 그 파일을 **그대로 실행한 뒤** 등록된
// 핸들러를 직접 부른다. 산출물에 복사되는 그 내용을 재는 것이므로, 사본을 만들어
// 테스트하는 것(내용이 갈릴 수 있다)보다 정직하다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/push-sw.js'), 'utf8');

interface Shown {
  title: string;
  options: Record<string, unknown>;
}
interface FakeClient {
  focused: boolean;
  navigatedTo: string | null;
  focus: () => Promise<FakeClient>;
  navigate?: (u: string) => Promise<FakeClient>;
}

function runSw(clientList: FakeClient[] = []) {
  const handlers: Record<string, ((e: unknown) => void) | undefined> = {};
  const shown: Shown[] = [];
  const opened: string[] = [];
  const waited: unknown[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  const clients = {
    matchAll: async () => clientList,
    openWindow: async (u: string) => {
      opened.push(u);
      return null;
    },
  };
  // `self`와 `clients`를 인자로 받는 함수로 감싸 그대로 실행한다.
  new Function('self', 'clients', SRC)(self, clients);
  return { handlers, shown, opened, waited };
}

function pushEvent(payload: unknown, waited: unknown[]) {
  return {
    data: payload === undefined ? null : { json: () => payload },
    waitUntil: (p: unknown) => waited.push(p),
  };
}

describe('push-sw.js', () => {
  it('페이로드대로 배너를 띄운다', () => {
    const sw = runSw();
    sw.handlers.push?.(pushEvent({ title: '앨리스님이 회원님을 불렀어요', body: '로드맵', url: '/editor?map=d1', tag: 'geurio-mention' }, sw.waited));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe('앨리스님이 회원님을 불렀어요');
    expect(sw.shown[0]!.options.body).toBe('로드맵');
    expect(sw.shown[0]!.options.tag).toBe('geurio-mention');
    expect((sw.shown[0]!.options.data as { url: string }).url).toBe('/editor?map=d1');
  });

  it('페이로드가 없거나 깨져도 **반드시** 띄운다', () => {
    // `userVisibleOnly: true`로 구독했으므로 아무것도 안 띄우면 브라우저가 경고를
    // 남기고, 되풀이되면 구독을 거둬 간다 — 그러면 푸시가 조용히 죽는다.
    const sw = runSw();
    sw.handlers.push?.(pushEvent(undefined, sw.waited));
    sw.handlers.push?.({
      data: {
        json: () => {
          throw new Error('not json');
        },
      },
      waitUntil: (p: unknown) => sw.waited.push(p),
    });
    expect(sw.shown).toHaveLength(2);
    expect(sw.shown[0]!.title).toBe('Geurio');
    expect(sw.shown[1]!.options.body).toBe('새 알림이 있어요');
  });

  it('이미 열린 창이 있으면 새 탭을 열지 않고 그 창을 옮긴다', async () => {
    // 누를 때마다 새 탭이 열리면 편집 중이던 문서가 뒤에 남아 같은 문서를 연 탭이
    // 둘이 된다 — 실시간 공동 편집에서 자기 자신과 겹친다.
    const client: FakeClient = {
      focused: false,
      navigatedTo: null,
      focus: async () => {
        client.focused = true;
        return client;
      },
      navigate: async (u: string) => {
        client.navigatedTo = u;
        return client;
      },
    };
    const sw = runSw([client]);
    const closed: number[] = [];
    const waits: unknown[] = [];
    sw.handlers.notificationclick?.({
      notification: { close: () => closed.push(1), data: { url: '/editor?map=d1' } },
      waitUntil: (p: unknown) => waits.push(p),
    });
    await waits[0];
    expect(closed).toHaveLength(1);
    expect(client.navigatedTo).toBe('/editor?map=d1');
    expect(client.focused).toBe(true);
    expect(sw.opened).toHaveLength(0);
  });

  it('열린 창이 없으면 새로 연다', async () => {
    const sw = runSw([]);
    const waits: unknown[] = [];
    sw.handlers.notificationclick?.({
      notification: { close: () => undefined, data: { url: '/home' } },
      waitUntil: (p: unknown) => waits.push(p),
    });
    await waits[0];
    expect(sw.opened).toEqual(['/home']);
  });
});
