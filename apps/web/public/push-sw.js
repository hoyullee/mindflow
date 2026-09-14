/* 웹 푸시를 받는 서비스 워커 조각(0040).
 *
 * ## 왜 별도 파일인가
 *
 * 이 앱의 서비스 워커는 Workbox가 **생성한다**(`vite.config.ts`의 `generateSW`).
 * 생성된 파일은 빌드마다 새로 쓰이므로 손댈 수 없다 — 대신 `workbox.importScripts`로
 * 이 파일을 그 안에 끌어들인다. 그래서 프리캐시·업데이트 전략은 그대로 두고 푸시
 * 처리만 얹을 수 있다(`injectManifest`로 갈아타면 SW 전체를 우리가 떠안는다).
 *
 * ## 왜 평범한 JS인가
 *
 * 번들러를 지나지 않고 **그대로** 산출물에 복사돼 SW 안에서 실행된다(`public/`).
 * 그래서 import도 TypeScript도 쓸 수 없고, `self`는 `ServiceWorkerGlobalScope`다.
 */

/* 서비스 워커 전역 — flat config에서는 `eslint-env` 주석이 더는 읽히지 않는다
   (v10부터는 오류가 된다). 그래서 쓰는 전역을 `global`로 직접 적는다. */
/* global self, clients */

self.addEventListener('push', (event) => {
  // 페이로드가 없거나 JSON이 아니면 **그래도 띄운다** — `userVisibleOnly: true`로
  // 구독했으므로 아무것도 안 띄우면 브라우저가 경고를 남기고, 반복되면 구독을
  // 거둬 간다. 내용을 모를 때의 기본 문장이 그래서 필요하다.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'Geurio';
  const options = {
    body: data.body || '새 알림이 있어요',
    icon: '/icons/pwa-192x192.png',
    badge: '/icons/pwa-192x192.png',
    // 같은 태그의 알림은 **겹쳐 쌓인다** — 회차마다 새 배너가 쌓이면 알림 목록이
    // 같은 말로 뒤덮인다(서버가 `geurio-mention` 하나로 보낸다).
    tag: data.tag || 'geurio',
    renotify: true,
    data: { url: data.url || '/home' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/home';
  event.waitUntil(
    // **이미 열려 있는 탭이 있으면 그리로 간다** — 누를 때마다 새 탭이 열리면
    // 편집 중이던 문서가 뒤에 남아 두 탭이 같은 문서를 연 꼴이 된다(실시간
    // 공동 편집에서 자기 자신과 겹친다).
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        // 같은 출처의 창이면 그 창을 목적지로 옮긴다(`navigate`를 못 쓰는 브라우저는
        // 포커스만 준다 — 아무 일도 안 하는 것보다는 낫다).
        if ('focus' in client) {
          if ('navigate' in client) return client.navigate(target).then((c) => (c ? c.focus() : undefined));
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
