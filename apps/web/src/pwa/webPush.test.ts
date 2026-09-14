// 웹 푸시 구독 모듈(0040) — **실제 발송은 이 환경에서 확인할 수 없다.**
//
// 헤드리스 크로뮴은 `Notification.permission`이 늘 `denied`라(probe-pitfalls E2)
// `pushManager.subscribe()`가 `AbortError: permission denied`로 끝난다 — 실측했다.
// 그래서 여기서는 **브라우저가 내주는 값을 우리가 어떻게 다루는가**만 못박는다:
// 키 변환, 권한 갈래, 이미 있는 구독의 재사용, 해제 시 엔드포인트 반환.
// 진짜 배달(푸시 서비스 → SW → 배너)은 사용자의 실기기에서 확인해야 한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }));
vi.stubEnv('VITE_VAPID_PUBLIC_KEY', H.key);

const { currentPushSubscription, pushAvailable, subscribePush, unsubscribePush } = await import('./webPush');

/** 브라우저가 내주는 키는 ArrayBuffer다 — 우리 쪽은 base64로 바꿔 서버에 싣는다. */
function keyBuf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

interface FakeSub {
  endpoint: string;
  getKey: (n: string) => ArrayBuffer | null;
  unsubscribe: () => Promise<boolean>;
}

function install(opts: { permission?: NotificationPermission; existing?: FakeSub | null; onSubscribe?: (o: unknown) => FakeSub }) {
  const state = { subscribeCalls: 0, requested: 0, lastOptions: null as unknown, unsubscribed: 0 };
  const existing = opts.existing ?? null;
  const made: FakeSub = {
    endpoint: 'https://push.example/new',
    getKey: (n) => (n === 'p256dh' ? keyBuf([1, 2, 3]) : keyBuf([4, 5])),
    unsubscribe: async () => {
      state.unsubscribed += 1;
      return true;
    },
  };
  const reg = {
    pushManager: {
      getSubscription: async () => existing,
      subscribe: async (o: unknown) => {
        state.subscribeCalls += 1;
        state.lastOptions = o;
        return opts.onSubscribe ? opts.onSubscribe(o) : made;
      },
    },
  };
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(reg) }, userAgent: 'test' });
  vi.stubGlobal('window', { PushManager: function () {} });
  vi.stubGlobal('Notification', {
    permission: opts.permission ?? 'granted',
    requestPermission: async () => {
      state.requested += 1;
      return opts.permission ?? 'granted';
    },
  });
  return state;
}

describe('웹 푸시 구독', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('푸시 API가 없으면 쓸 수 없는 것으로 본다(설정에서 행이 사라진다)', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    expect(pushAvailable()).toBe(false);
  });

  it('구독하면 키를 base64로 바꿔 돌려주고, 서버 키는 **바이트 배열**로 넘긴다', async () => {
    const state = install({ permission: 'granted' });
    const sub = await subscribePush();
    expect(sub).toEqual({ endpoint: 'https://push.example/new', p256dh: btoa('\x01\x02\x03'), auth: btoa('\x04\x05') });
    // 문자열 그대로 넘기면 사파리가 거부한다 — 바이트여야 한다.
    const opts = state.lastOptions as { applicationServerKey: unknown; userVisibleOnly: boolean };
    expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
    // 조용한 푸시를 허용하는 브라우저는 없다 — 어기면 구독이 거둬진다.
    expect(opts.userVisibleOnly).toBe(true);
  });

  it('권한을 거절하면 구독하지 않는다(스위치가 켜지면 거짓말이 된다)', async () => {
    const state = install({ permission: 'default' });
    // requestPermission이 'default'를 돌려준다 = 사용자가 닫았다.
    expect(await subscribePush()).toBeNull();
    expect(state.subscribeCalls).toBe(0);
  });

  it('브라우저가 막아 뒀으면 묻지도 않는다', async () => {
    const state = install({ permission: 'denied' });
    expect(await subscribePush()).toBeNull();
    expect(state.requested).toBe(0);
    expect(state.subscribeCalls).toBe(0);
  });

  it('이미 구독돼 있으면 그것을 쓴다(행이 불어나지 않는다)', async () => {
    const existing: FakeSub = {
      endpoint: 'https://push.example/old',
      getKey: (n) => (n === 'p256dh' ? keyBuf([9]) : keyBuf([8])),
      unsubscribe: async () => true,
    };
    const state = install({ permission: 'granted', existing });
    const sub = await subscribePush();
    expect(sub?.endpoint).toBe('https://push.example/old');
    expect(state.subscribeCalls).toBe(0);
  });

  it('해제하면 **거둔 엔드포인트**를 돌려준다(서버에서 지울 행을 그것으로 찾는다)', async () => {
    const existing: FakeSub = {
      endpoint: 'https://push.example/old',
      getKey: () => keyBuf([1]),
      unsubscribe: async () => true,
    };
    install({ permission: 'granted', existing });
    expect(await unsubscribePush()).toBe('https://push.example/old');
  });

  it('구독이 없으면 해제는 아무것도 하지 않는다', async () => {
    install({ permission: 'granted', existing: null });
    expect(await unsubscribePush()).toBeNull();
    expect(await currentPushSubscription()).toBeNull();
  });
});

describe('셸에서는 쓸 수 없는 것으로 본다', () => {
  afterEach(() => vi.unstubAllGlobals());

  // API가 **있으면서도** 구독이 실패하는 두 환경이다(푸시 서비스에 연결돼 있지
  // 않다). 걸러 내지 않으면 설정에 눌러도 아무 일이 없는 스위치가 선다.
  it('설치형 셸(Electron)에서는 false', () => {
    vi.stubGlobal('navigator', { serviceWorker: {}, userAgent: 'test' });
    vi.stubGlobal('window', { PushManager: function () {}, geurio: { desktop: true, titleBarHeight: 40 } });
    vi.stubGlobal('Notification', { permission: 'granted' });
    expect(pushAvailable()).toBe(false);
  });
});
