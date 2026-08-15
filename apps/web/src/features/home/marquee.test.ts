import { describe, expect, it } from 'vitest';
import { canStartMarquee, keysInRect, rectFrom } from './marquee';

const box = (key: string, left: number, top: number, w = 100, h = 60) => ({ key, left, top, right: left + w, bottom: top + h });

describe('마퀴 선택 — 사각형 계산', () => {
  it('어느 방향으로 끌어도 양수 크기다', () => {
    expect(rectFrom(10, 10, 40, 50)).toEqual({ x: 10, y: 10, w: 30, h: 40 });
    // 왼쪽 위로 끌어도 같은 사각형.
    expect(rectFrom(40, 50, 10, 10)).toEqual({ x: 10, y: 10, w: 30, h: 40 });
  });

  it('닿기만 해도 고른다 — 완전히 감쌀 필요는 없다(탐색기 관례)', () => {
    const boxes = [box('a', 0, 0), box('b', 120, 0), box('c', 0, 80)];
    // a의 오른쪽 아래 귀퉁이만 스치는 사각형.
    expect(keysInRect(rectFrom(90, 50, 130, 70), boxes)).toEqual(['a', 'b']);
    // 아무것도 닿지 않으면 빈 목록.
    expect(keysInRect(rectFrom(300, 300, 320, 320), boxes)).toEqual([]);
    // 전부 감싸면 넘겨받은 순서 그대로(=화면 순서).
    expect(keysInRect(rectFrom(0, 0, 400, 400), boxes)).toEqual(['a', 'b', 'c']);
  });

  it('가장자리가 맞닿기만 한 것은 고르지 않는다', () => {
    const boxes = [box('a', 0, 0)];
    expect(keysInRect(rectFrom(100, 0, 140, 60), boxes)).toEqual([]);
  });
});

describe('마퀴 선택 — 시작 지점', () => {
  const el = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };

  it('빈 자리에서만 시작한다 — 카드·메뉴·조작 요소 위는 아니다', () => {
    expect(canStartMarquee(el('<div class="grid"><span id="t">x</span></div>').querySelector('#t'))).toBe(true);
    expect(canStartMarquee(el('<a class="map-card"><span id="t">x</span></a>').querySelector('#t'))).toBe(false);
    expect(canStartMarquee(el('<div class="mf-home-ctx"><span id="t">x</span></div>').querySelector('#t'))).toBe(false);
    expect(canStartMarquee(el('<button><span id="t">x</span></button>').querySelector('#t'))).toBe(false);
    expect(canStartMarquee(el('<input />'))).toBe(false);
    expect(canStartMarquee(null)).toBe(false);
  });
});
