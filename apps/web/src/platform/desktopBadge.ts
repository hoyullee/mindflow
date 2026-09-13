// 설치형 앱의 **작업 표시줄 배지** — 안 읽은 알림 수를 OS 아이콘 위에 얹는다.
//
// 플랫폼마다 그리는 길이 달라서 셸이 갈라 처리하는데(`apps/desktop/src/main.ts`의
// `applyBadge`), Windows에는 숫자를 그려 주는 API가 없다(`app.setBadgeCount`는
// macOS·Linux 전용). 그쪽은 16×16 **오버레이 아이콘**을 얹는 길뿐이라 **그림이
// 필요하고, 그리는 일은 렌더러가 맡는다** — 여기에는 캔버스도 앱의 글꼴도 있고,
// 배지 색은 앱 안 LNB 배지의 그 코랄과 같아야 한다.
//
// 브라우저·PWA·옛 설치본에서는 조용히 아무 일도 하지 않는다.

import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../features/home/theme';
import { desktopBridge } from './desktopBridge';

/**
 * 그리는 크기. Windows가 요구하는 것은 16×16이지만 그 크기에서 두 글자는 뭉갠다 —
 * 2배로 그려 OS가 줄이게 한다(고DPI 화면에서는 그 해상도가 그대로 쓰인다).
 */
const SIZE = 32;

/** 배지에 적는 글자 — LNB 알림 배지와 **같은 규칙**(10을 넘으면 `9+`). */
export function badgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * 배지 한 장을 PNG 데이터 URL로. 캔버스를 쓸 수 없으면(jsdom·차단된 환경) `null`이고,
 * 그때도 **개수는 그대로 보낸다** — macOS·Linux는 그림 없이 그려진다.
 */
export function badgeDataUrl(count: number): string | null {
  if (count <= 0 || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const r = SIZE / 2;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fillStyle = UNREAD_BADGE_BG;
    ctx.fill();
    const label = badgeLabel(count);
    // 두 글자는 한 글자보다 작게 — 원 안에 들어가야 한다.
    ctx.font = `800 ${label.length > 1 ? 17 : 21}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = UNREAD_BADGE_INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 대부분의 글꼴에서 숫자의 시각 중심은 기준선 위쪽이라 살짝 내린다.
    ctx.fillText(label, r, r + 1);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * 지금 개수를 셸에 알린다. 0이면 배지를 지운다 — 로그아웃·전부 읽음이 그 경로다.
 *
 * 셸이 없으면(브라우저·PWA) 아무 일도 하지 않고, `setBadge`를 내주지 않는 **옛
 * 설치본**에서도 조용히 물러난다.
 */
export function setDesktopBadge(count: number): void {
  const b = desktopBridge();
  if (!b?.setBadge) return;
  const n = Math.max(0, Math.floor(count));
  void b.setBadge({ count: n, png: badgeDataUrl(n) }).catch(() => undefined);
}
