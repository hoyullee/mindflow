import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MarqueeText } from './MarqueeText';

/**
 * **넘칠 때만 흐른다**(스펙: 홈·LNB 변경 2.2). jsdom에는 레이아웃이 없어 폭이 늘 0이므로
 * (`docs/probe-pitfalls.md` F1) 두 폭을 심어 두 갈래를 가른다 — 글자의 **그려진 폭**
 * (`getBoundingClientRect`)과 칸 폭(`clientWidth`).
 *
 * ⚠️ 글자 쪽을 `scrollWidth`로 심으면 안 된다(F39) — 실브라우저에서 인라인 요소의
 * `scrollWidth`는 늘 0이다. 예전에 그 값을 심은 이 테스트는 통과했고 실제 화면에서는
 * 한 번도 흐르지 않았다. 앱이 읽는 것과 **같은 속성**을 심는다.
 */
function stubWidths(text: number, box: number): () => void {
  const br = HTMLElement.prototype.getBoundingClientRect;
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 14, right: text, width: text, height: 14, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => box });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = br;
    if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
  };
}

describe('MarqueeText — 넘칠 때만 흐르는 한 줄', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    cleanup();
  });

  it('칸에 들어가면 **아무것도 하지 않는다** — 두 번째 벌도, 흐름도, 가장자리 흐림도 없다', () => {
    restore = stubWidths(120, 180);
    const { container } = render(<MarqueeText text="멘션 · 짧은 말 · 방금 전" />);
    const box = container.querySelector('[data-marquee-text]') as HTMLElement;
    expect(box.dataset.marqueeText).toBe('still');
    expect(box.querySelector('.mf-marquee-track')).toBeNull();
    expect(box.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(box.style.maskImage).toBe('');
    expect(box.textContent).toBe('멘션 · 짧은 말 · 방금 전');
  });

  it('넘치면 **같은 문구를 두 벌** 잇고 흐른다 — 두 번째 벌은 읽히지 않고, 오른쪽 14px이 흐려진다', () => {
    restore = stubWidths(320, 180);
    const { container } = render(<MarqueeText text="멘션 · 아주 긴 댓글 내용이라 한 줄에 다 들어가지 않습니다 · 2시간 전" />);
    const box = container.querySelector('[data-marquee-text]') as HTMLElement;
    expect(box.dataset.marqueeText).toBe('run');
    const track = box.querySelector('.mf-marquee-track') as HTMLElement;
    expect(track).toBeTruthy();
    const copies = [...track.children] as HTMLElement[];
    expect(copies).toHaveLength(2);
    // 두 벌의 틈이 같아야 `translateX(-50%)`가 정확히 한 벌만큼이다 — 끊김 없는 되풀이의 조건.
    expect(copies[0]!.style.paddingRight).toBe('28px');
    expect(copies[1]!.style.paddingRight).toBe('28px');
    expect(copies[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(copies[0]!.textContent).toBe(copies[1]!.textContent);
    expect(box.style.maskImage).toContain('calc(100% - 14px)');
  });

  it('흐름의 모양은 CSS가 든다 — 9초, 처음 12%는 멈춤, 움직임을 줄이면 끈다', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const cssPath = ['src/features/home/home.css', 'apps/web/src/features/home/home.css'].find((f) => existsSync(f))!;
    const css = readFileSync(cssPath, 'utf8');
    const kf = css.slice(css.indexOf('@keyframes mf-marquee'));
    expect(kf.slice(0, 200)).toMatch(/12%\s*\{\s*transform: translateX\(0\)/);
    expect(kf.slice(0, 200)).toContain('translateX(-50%)');
    expect(css).toMatch(/\.mf-marquee-track\s*\{[^}]*animation: mf-marquee 9s cubic-bezier\(0\.44, 0, 0\.56, 1\) infinite/);
    const reduced = css.slice(css.indexOf('.mf-marquee-track {'));
    expect(reduced.slice(0, 400)).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.mf-home \.mf-marquee-track\s*\{\s*animation: none/);
  });
});
