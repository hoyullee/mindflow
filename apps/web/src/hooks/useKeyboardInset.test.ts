import { describe, expect, it } from 'vitest';
import { KEYBOARD_MIN_INSET, keyboardInsetOf } from './useKeyboardInset';

// 모바일 브라우저는 키보드가 떠도 레이아웃 뷰포트(`window.innerHeight`, `100dvh`)를
// 줄이지 않는다 — 줄어드는 건 `visualViewport`뿐이다. 그 차이가 "가려진 높이".
describe('keyboardInsetOf', () => {
  it('키보드가 없으면 0', () => {
    expect(keyboardInsetOf({ height: 780, offsetTop: 0 }, 780)).toBe(0);
  });

  it('줄어든 만큼이 가려진 높이', () => {
    expect(keyboardInsetOf({ height: 444, offsetTop: 0 }, 780)).toBe(336);
  });

  it('iOS가 레이아웃 뷰포트를 밀어 올린 만큼도 가려진 것으로 센다', () => {
    // 시각 뷰포트가 아래로 내려가면(offsetTop) 그만큼 화면 아래가 더 가려진다.
    expect(keyboardInsetOf({ height: 444, offsetTop: 60 }, 780)).toBe(276);
  });

  it('임계값 아래의 잔변동(액세서리 바·주소창)은 키보드로 치지 않는다', () => {
    expect(keyboardInsetOf({ height: 780 - (KEYBOARD_MIN_INSET - 1), offsetTop: 0 }, 780)).toBe(0);
    expect(keyboardInsetOf({ height: 780 - KEYBOARD_MIN_INSET, offsetTop: 0 }, 780)).toBe(KEYBOARD_MIN_INSET);
  });

  it('페이지를 확대한 상태는 키보드로 오인하지 않는다', () => {
    // 두 손가락 확대도 시각 뷰포트를 줄인다 — 글씨를 키워 읽는 중에 캔버스가
    // 저절로 움직이면 안 된다.
    expect(keyboardInsetOf({ height: 520, offsetTop: 0, scale: 1.5 }, 780)).toBe(0);
    // 소수점 오차 수준(1.0x)은 확대가 아니다 — 키보드 판정을 그대로 한다.
    expect(keyboardInsetOf({ height: 444, offsetTop: 0, scale: 1.0 }, 780)).toBe(336);
  });

  it('visualViewport를 모르는 환경(jsdom 등)은 0 — 쓰는 쪽은 평소 동작', () => {
    expect(keyboardInsetOf(null, 780)).toBe(0);
    expect(keyboardInsetOf(undefined, 780)).toBe(0);
  });
});
