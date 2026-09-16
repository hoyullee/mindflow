// 설치형 앱의 **멘션 배너**(창을 닫아 둬도 뜬다 — 요청).
//
// 이 기능의 위험은 "안 뜬다"보다 **"너무 뜬다"**다: 알림 목록은 여러 계기로 다시
// 읽히고(실시간 신호·주기 확인·탭 복귀) 앱은 껐다 켜진다. 그래서 아래 테스트의
// 절반이 **되풀이·소음을 막는 규칙**이다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const H = vi.hoisted(() => ({
  shown: [] as { title: string; body: string; tag: string }[],
  desktop: true,
}));

vi.mock('./desktopBridge', async (orig) => ({
  ...(await orig<typeof import('./desktopBridge')>()),
  isDesktopShell: () => H.desktop,
}));

vi.mock('../features/reminders/reminderPrefs', async (orig) => ({
  ...(await orig<typeof import('../features/reminders/reminderPrefs')>()),
  showOsNotification: async (o: { title: string; body: string; tag: string }) => {
    H.shown.push(o);
    return true;
  },
}));

import { DesktopMentionNotifier, mentionBanner } from './DesktopMentionNotifier';
import { NotificationsProvider } from '../features/home/components/NotificationsContext';
import { BackendProvider } from '../adapters/BackendContext';
import { DEFAULT_NOTIFICATION_PREFS, type AppNotification, type Backend, type NotificationPrefs, type NotificationStore } from '../adapters/ports';
import { LocalAuth } from '../adapters/local/localAuth';
import { LocalSpaceStore } from '../adapters/local/localSpaceStore';
import { LocalShareStore } from '../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../adapters/local/localFeedbackStore';
import { LocalImageStore } from '../adapters/local/localImageStore';
import { LocalCommentStore } from '../adapters/local/localCommentStore';
import { LocalEventStore } from '../adapters/local/localEventStore';
import { LocalDocStore } from '../adapters/local/localDocStore';
import { resetMentionAnnounced } from './desktopMentionNotice';

function note(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'mention',
    documentId: 'd1',
    nodeId: null,
    actorName: '앨리스',
    preview: '여기 좀 봐 주세요',
    docTitle: '로드맵',
    createdAt: new Date().toISOString(),
    read: false,
    ...over,
  };
}

/** 목록을 마음대로 갈아 끼울 수 있는 저장소 — `subscribe`로 갱신을 밀어 넣는다. */
function makeStore(initial: AppNotification[], prefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS) {
  let list = initial;
  let notify: (() => void) | null = null;
  const store: NotificationStore = {
    list: async () => list,
    markAllRead: async () => ({}),
    subscribe: (fn) => {
      notify = fn;
      return () => {
        notify = null;
      };
    },
    loadPrefs: async () => prefs,
    savePrefs: async () => ({}),
    savePushSubscription: async () => ({}),
    removePushSubscription: async () => ({}),
  };
  return {
    store,
    push(next: AppNotification[]) {
      list = next;
      notify?.();
    },
  };
}

function renderWith(store: NotificationStore) {
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: store,
    eventStore: new LocalEventStore(),
    mode: 'local',
  };
  return render(
    <MemoryRouter>
      <BackendProvider backend={backend}>
        <NotificationsProvider>
          <DesktopMentionNotifier />
        </NotificationsProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function setFocus(on: boolean): void {
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => on });
}

/**
 * **창을 닫아 둔 설치형 앱이 실제로 답하는 값**으로 맞춘다 — `visible`인데 포커스는
 * 없다. 셸이 `backgroundThrottling: false`로 창을 만들어 Page Visibility API가 꺼져
 * 있기 때문이다(`isUserWatching()` 주석). 처음 판의 테스트는 여기서 `hidden`을
 * 심었고 jsdom이 그대로 답해 줘 **전부 통과했지만 실기기에서는 한 번도 뜨지
 * 않았다**(제보). 기본 상태를 실기기 쪽에 맞춰 두면 그 거짓 통과가 되풀이되지 않는다.
 */
function setClosedToTray(): void {
  setVisibility('visible');
  setFocus(false);
}

describe('설치형 앱의 멘션 배너', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMentionAnnounced();
    H.shown = [];
    H.desktop = true;
    setClosedToTray();
  });
  afterEach(() => {
    cleanup();
    setVisibility('visible');
    setFocus(true);
  });

  it('창을 닫아 둔 채로 새 멘션이 오면 배너가 뜬다(셸은 `visible`이라고 답한다)', async () => {
    const { store, push } = makeStore([]);
    renderWith(store);
    // 첫 목록이 기준선으로 자리잡을 때까지 기다린다.
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await waitFor(() => expect(H.shown).toHaveLength(1));
    expect(H.shown[0]!.title).toContain('앨리스');
    expect(H.shown[0]!.body).toBe('로드맵');
    expect(H.shown[0]!.tag).toBe('geurio-mention');
  });

  it('**앱을 켤 때 밀린 멘션이 우르르 뜨지 않는다**(첫 목록은 기준선)', async () => {
    // 이미 안 읽은 멘션 셋을 들고 시작 — 실행할 때마다 배너 셋이 뜨면 못 쓴다.
    const { store } = makeStore([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })]);
    renderWith(store);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0);
  });

  it('같은 멘션은 목록이 다시 읽혀도 두 번 뜨지 않는다', async () => {
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await waitFor(() => expect(H.shown).toHaveLength(1));
    // 같은 내용으로 다시 통지(실시간 신호가 겹쳐 오는 흔한 경우)
    push([note({ id: 'a' })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(1);
  });

  it('**보고 있을 때는 뜨지 않고**, 그 멘션이 나중에 뒤늦게 튀어나오지도 않는다', async () => {
    setVisibility('visible');
    setFocus(true); // 보이는 것만으로는 부족하다 — 포커스까지 있어야 "보고 있다"
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0); // 배지가 이미 말한다

    // 이제 창을 닫아 둬도 그 멘션은 "본 것"이라 다시 뜨지 않는다.
    setClosedToTray();
    push([note({ id: 'a' }), note({ id: 'b' })]);
    await waitFor(() => expect(H.shown).toHaveLength(1));
    expect(H.shown[0]!.title).toContain('앨리스'); // b 하나만 알린다
  });

  it('**셸이 `visible`이라고 답해도 포커스가 없으면 뜬다**(제보: 앱을 닫아 둬도 오지 않는다)', async () => {
    // 이 한 줄이 제보의 전부다 — 창은 트레이에 숨어 있는데 Page Visibility API가
    // 꺼져 있어 `visible`이 돌아온다. 그 값 하나로 판단하면 배너는 영영 안 뜬다.
    setVisibility('visible');
    setFocus(false);
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await waitFor(() => expect(H.shown).toHaveLength(1));
  });

  it('`hidden`으로 제대로 답하는 판에서도 뜬다(macOS 가림·throttling을 켠 셸)', async () => {
    setVisibility('hidden');
    setFocus(true);
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await waitFor(() => expect(H.shown).toHaveLength(1));
  });

  it('멘션이 아닌 종류는 알리지 않는다(메일·푸시와 같은 범위)', async () => {
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'r', kind: 'reply' }), note({ id: 's', kind: 'share' }), note({ id: 'c', kind: 'comment' })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0);
  });

  it('한 시간보다 늙은 멘션은 알리지 않는다', async () => {
    const { store, push } = makeStore([]);
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'old', createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0);
  });

  it('설정이 꺼져 있으면 알리지 않는다', async () => {
    const { store, push } = makeStore([], { emailMentions: true, pushMentions: false });
    renderWith(store);
    await waitFor(() => expect(H.shown).toHaveLength(0));

    push([note({ id: 'a' })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0);
  });

  it('브라우저에서는 아무 일도 하지 않는다(그쪽은 웹 푸시가 맡는다)', async () => {
    H.desktop = false;
    const { store, push } = makeStore([]);
    renderWith(store);
    push([note({ id: 'a' })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(H.shown).toHaveLength(0);
  });
});

describe('배너 문구', () => {
  it('한 건이면 부른 사람과 문서를 그대로 말한다', () => {
    expect(mentionBanner([note()])).toEqual({ title: '앨리스님이 회원님을 불렀어요', body: '로드맵' });
  });

  it('여럿이면 건수로 묶고 문서도 접는다', () => {
    const b = mentionBanner([note({ id: 'a' }), note({ id: 'b', actorName: '밥', docTitle: '회고' })]);
    expect(b.title).toBe('읽지 않은 멘션 2건');
    expect(b.body).toBe('로드맵 외 1곳');
  });

  it('이름이 비어 있어도 문장이 성립한다', () => {
    expect(mentionBanner([note({ actorName: '', docTitle: '' })])).toEqual({
      title: '누군가님이 회원님을 불렀어요',
      body: 'Geurio에서 확인해 주세요',
    });
  });
});
