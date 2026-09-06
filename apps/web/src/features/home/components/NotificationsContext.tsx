// 알림 우편함의 **상태 한 벌** — 목록·안 읽음 수·갱신 계기(신호·주기·탭 복귀).
//
// 예전에는 이 상태가 벨 컴포넌트 안에 있었고 벨은 스페이스 툴바에만 있었다. 그래서
// 대시보드·일정 화면에는 알림이 **아예 없었다**(제보: 어느 영역에서든 볼 수 있게).
// 지금 벨은 LNB에 있고 세 화면이 그 사이드바를 함께 쓴다 — 폰은 LNB가 서랍이라
// 닫힌 문 뒤에 있으므로 **☰ 버튼의 점**이 그 사실을 알린다. 그 점과 벨이 같은 수를
// 봐야 하므로 상태를 여기로 올렸다(구독·주기 확인도 한 벌로 준다).

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppNotification } from '../../../adapters/ports';
import { useNotificationStore } from '../../../adapters/BackendContext';

/** 탭 복귀 시 다시 읽는 최소 간격 — 포커스가 들락거려도 요청이 몰리지 않게. */
const REFRESH_THROTTLE_MS = 30_000;

/** 홈을 켜 둔 채로도 배지가 서게 하는 주기 확인(제보: 새 알림이 와도 빨간 점이
 * 안 뜨고, 벨을 눌러야 그때서야 보인다). 마운트·탭 복귀만으로는 화면을 떠나지
 * 않는 사용자에게 갱신 계기가 없다 — 작은 select 하나라 60초면 비용은 미미하고,
 * 탭이 가려져 있는 동안은 쉬었다가 복귀 시 기존 wake 경로가 즉시 확인한다. */
const POLL_MS = 60_000;

/** 최신이 위 — 어댑터 순서에 기대지 않는다(로컬 저장은 추가순이라 오래된 것이
 * 먼저 오고, 그러면 '이전' 묶음이 '오늘' 위에 선다 — 실브라우저에서 잡음). */
function byNewest(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  /** 패널이 열려 있는 동안은 주기 확인을 쉰다(읽는 중에 목록이 움직이지 않게). */
  setPaused: (paused: boolean) => void;
  /** 지금 목록을 다시 읽고 그 결과를 돌려준다(열 때 쓴다). */
  refresh: () => Promise<AppNotification[]>;
  /** 전부 읽음으로(열었으면 본 것) — 화면도 즉시 반영한다. */
  markAllRead: () => void;
}

const Ctx = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const store = useNotificationStore();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [paused, setPaused] = useState(false);
  const lastLoadRef = useRef(0);

  const refresh = useCallback(async (): Promise<AppNotification[]> => {
    lastLoadRef.current = Date.now();
    try {
      const list = byNewest(await store.list());
      setItems(list);
      return list;
    } catch {
      /* 알림은 부가 기능 — 홈을 방해하지 않는다 */
      return [];
    }
  }, [store]);

  // 마운트 시 + 탭 복귀 시(30초 스로틀) — 새 배포 감지(#302)와 같은 생각:
  // 확인하러 돌아오는 바로 그 순간이 자연스러운 확인 타이밍이다.
  useEffect(() => {
    void refresh();
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadRef.current < REFRESH_THROTTLE_MS) return;
      void refresh();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [refresh]);

  // 즉시 신호 — 새 알림이 생기면(0027 트리거·로컬 ping) 바로 다시 읽어 배지를
  // 세운다. 신호는 유실될 수 있으므로 아래 주기 확인이 안전망으로 남는다.
  useEffect(() => store.subscribe(() => void refresh()), [store, refresh]);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh, paused]);

  const markAllRead = useCallback(() => {
    // 실패해도 다음 열기에 다시 시도된다 — 화면은 먼저 읽음으로 둔다.
    void store.markAllRead();
    setItems((cur) => cur.map((i) => ({ ...i, read: true })));
  }, [store]);

  return <Ctx.Provider value={{ items, unread: items.filter((i) => !i.read).length, setPaused, refresh, markAllRead }}>{children}</Ctx.Provider>;
}

/** 공급자 밖(테스트 조각 등)에서도 깨지지 않게 빈 값으로 물러선다. */
const EMPTY: NotificationsValue = { items: [], unread: 0, setPaused: () => {}, refresh: async () => [], markAllRead: () => {} };

export function useNotifications(): NotificationsValue {
  return useContext(Ctx) ?? EMPTY;
}
