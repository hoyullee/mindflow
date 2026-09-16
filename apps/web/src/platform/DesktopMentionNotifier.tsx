// 설치형 앱에서 **창을 닫아 둬도 멘션이 배너로 뜨게** 한다(요청).
//
// ## 왜 이 자리가 비어 있었나
//
// 멘션이 앱 밖으로 나가는 길은 둘이었다 — **웹 푸시**(0040)와 **메일**(0039).
// 그런데 푸시는 설치형 셸에서 쓸 수 없다: Electron에는 푸시 서비스(GCM) 채널이
// 없어 `pushManager.subscribe()`가 실패한다(그래서 `pushAvailable()`이 셸을
// 이름으로 걸러 낸다). 결과적으로 **앱을 닫아 둔 데스크톱 사용자는 30분 뒤
// 메일이 유일한 통로**였다.
//
// ## 왜 푸시 없이도 되는가 (새 설치본이 필요 없다)
//
// 이 셸은 **닫기 = 숨기기**다(트레이 상주, 4단계). 창이 숨어도 렌더러는 살아 있고,
// 그래서 알림 실시간 구독(`NotificationsContext`의 `store.subscribe`)도 계속 돈다 —
// 작업 표시줄 **배지가 이미 그렇게 움직이고 있다**(`DesktopBadgeHost`).
// 즉 "새 멘션이 왔다"는 사실은 이미 알고 있었고, 배너로 **띄우지만 않았다**.
//
// 띄우는 창구도 이미 있다(`geurio:notify` — 일정 알림이 쓴다). 그래서 이 기능은
// **웹 배포만으로 끝난다**: preload 창구를 새로 뚫지 않으므로 이미 깔린 설치본에도
// 그대로 닿는다.
//
// ## 언제 띄우나
//
// **화면이 보이지 않을 때만.** 보고 있을 때는 벨 배지가 이미 말하고 있고, 그 위에
// OS 배너까지 겹치면 소음이다. 보이는 동안 도착한 것은 "본 것"으로 적어 둔다 —
// 안 그러면 나중에 창을 숨기는 순간 묵은 멘션이 뒤늦게 튀어나온다.
//
// ## 무엇을 띄우나
//
// **멘션 둘뿐**(`mention`·`doc_mention`) — 메일·푸시와 같은 범위다(0039 참고).
// `reply`·`comment`·`share`는 뺐다(넓히려면 `KINDS` 한 줄). 본문 미리보기는 싣지
// 않는다 — 잠금 화면에 남의 문장이 그대로 뜨는 것이 이 앱에서 기대되는 동작이
// 아니다(푸시의 `buildPushPayload`와 같은 판단).

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../features/home/components/NotificationsContext';
import type { AppNotification } from '../adapters/ports';
import { useNotificationStore } from '../adapters/BackendContext';
import { isDesktopShell } from './desktopBridge';
import { showOsNotification } from '../features/reminders/reminderPrefs';
import { markMentionsAnnounced, wasMentionAnnounced } from './desktopMentionNotice';

/** 배너로 알릴 종류 — 메일·푸시와 같은 범위. */
const KINDS = new Set<AppNotification['kind']>(['mention', 'doc_mention']);
/** 이보다 늙은 멘션은 배너로 알리지 않는다 — "한 시간 전 일"을 지금 띄우는 것은
 *  소음이다(푸시의 나이 컷과 같은 값·같은 이유). 앱을 오래 꺼 뒀다 켰을 때
 *  묵은 것이 쏟아지지 않게 하는 그물이기도 하다. */
const MAX_AGE_MS = 60 * 60_000;

function isFresh(n: AppNotification, now: number): boolean {
  const t = Date.parse(n.createdAt);
  return Number.isFinite(t) && now - t <= MAX_AGE_MS;
}

/** 배너 문구 — 배너 한 줄에 다 보여야 하므로 짧다. */
export function mentionBanner(list: AppNotification[]): { title: string; body: string } {
  const actors = [...new Set(list.map((n) => n.actorName.trim()).filter(Boolean))];
  const titles = [...new Set(list.map((n) => n.docTitle.trim()).filter(Boolean))];
  const who = actors.length === 1 ? actors[0]! : actors.length > 1 ? `${actors[0]} 외 ${actors.length - 1}명` : '';
  const title = list.length === 1 ? `${who || '누군가'}님이 회원님을 불렀어요` : `읽지 않은 멘션 ${list.length}건`;
  const body = titles.length === 1 ? titles[0]! : titles.length > 1 ? `${titles[0]} 외 ${titles.length - 1}곳` : 'Geurio에서 확인해 주세요';
  return { title, body };
}

export function DesktopMentionNotifier(): null {
  const { items, loaded } = useNotifications();
  const store = useNotificationStore();
  const navigate = useNavigate();
  /** 계정 설정 — 푸시와 **같은 값**을 쓴다(둘 다 "앱 밖으로 나가는 멘션 알림"이고,
   *  기기마다 길이 다를 뿐이다). 도착 전에는 기본값(켜짐)으로 본다. */
  const enabledRef = useRef(true);
  /** 첫 목록은 **기준선**이다 — 앱을 켜는 순간 밀린 멘션이 우르르 뜨지 않게. */
  const seeded = useRef(false);

  useEffect(() => {
    if (!isDesktopShell()) return;
    let alive = true;
    void store.loadPrefs().then((p) => {
      if (alive) enabledRef.current = p.pushMentions;
    });
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(() => {
    if (!isDesktopShell()) return;
    // **첫 조회가 끝나기 전에는 아무 판단도 하지 않는다.** 마운트 직후 한 프레임은
    // 언제나 빈 배열이라, 그걸 기준선으로 잡으면 곧이어 도착하는 진짜 목록이 통째로
    // "새 알림"이 된다(실제로 그렇게 깨졌다 — 아래 테스트가 그 자리를 지킨다).
    if (!loaded) return;
    const now = Date.now();
    const targets = items.filter((n) => !n.read && KINDS.has(n.kind));

    // 첫 회차: 지금 있는 것은 전부 "이미 안 것"으로 적고 끝낸다.
    if (!seeded.current) {
      seeded.current = true;
      markMentionsAnnounced(targets.map((t) => t.id), now);
      return;
    }

    const fresh = targets.filter((n) => !wasMentionAnnounced(n.id));
    if (!fresh.length) return;
    // 알렸든 아니든 **먼저 적는다** — 아래에서 화면이 보인다는 이유로 건너뛰어도
    // 그것은 "봤다"는 뜻이지 "나중에 띄울 것"이 아니다.
    markMentionsAnnounced(fresh.map((n) => n.id), now);

    if (!enabledRef.current) return;
    // 보고 있으면 배지가 이미 말한다 — 배너까지 겹치지 않는다.
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    const show = fresh.filter((n) => isFresh(n, now));
    if (!show.length) return;

    const { title, body } = mentionBanner(show);
    // 문서가 하나로 좁혀졌을 때만 그 문서로 간다(여럿이면 갈 곳은 홈이다 —
    // 푸시의 `buildPushPayload`와 같은 규칙).
    const docs = [...new Set(show.map((n) => n.documentId).filter(Boolean))] as string[];
    const target = docs.length === 1 ? `/editor?map=${encodeURIComponent(docs[0]!)}` : '/home';
    void showOsNotification({
      title,
      body,
      // 같은 태그로 겹쳐 쌓는다 — 회차마다 배너가 쌓이면 알림 목록이 같은 말로 덮인다.
      tag: 'geurio-mention',
      onClick: () => navigate(target),
    });
  }, [items, loaded, navigate]);

  return null;
}
