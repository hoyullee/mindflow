// 키보드로 고른 이미지·파일 고르개를 **곧바로 띄우지 않는** 기기인가 — Windows의 포인터 숨김(제보).
//
// Windows에는 「입력하는 동안 포인터 숨기기」가 있고, Chromium(Chrome·Edge·설치형 앱)이 이 설정을
// 따르기 시작했다 — 글을 치면 포인터를 숨기고 **마우스가 움직이면** 다시 보인다. 키보드(방향키 + Enter)로
// 연 열기 창은 포인터가 숨은 채로 앱을 막고, 그 뒤의 움직임은 막힌 앱 창에 닿지 않아 포인터가 돌아오지
// 않는다. 웹에서 포인터를 되살릴 길은 없다 — 마우스 움직임을 기다렸다 여는 판(3판)도 Enter를 한 번 더
// 누르면 그대로 숨었고, 움직이기 전엔 창이 뜨지 않아 어색했다(제보).
//
// 그래서 Notion과 같이 간다 — 키보드로 고르면 **「올리기」 자리만 넣고** 그 단추를 마우스로 누르게 한다.
// 마우스로 고르면(이미 움직였으므로 포인터가 보인다) 지금처럼 곧바로 연다.

/** 이 기기가 「입력하는 동안 포인터 숨기기」에 걸리는가 — Windows + 마우스(정밀 포인터). */
export function pointerHidesWhileTyping(nav: Pick<Navigator, 'userAgent'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav || !/Windows/i.test(nav.userAgent)) return false;
  try {
    return typeof matchMedia !== 'function' || matchMedia('(any-pointer: fine)').matches;
  } catch {
    return true;
  }
}
