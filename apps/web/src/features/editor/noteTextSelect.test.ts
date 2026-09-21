// 공책 본문 선택의 **좌표계** — 화면의 자리와 값의 자리는 같은 수여야 한다.
//
// 왜 이 파일이 있나(제보): `2222`를 골라 굵게를 눌렀는데 `222`가 굵어졌다.
// 고른 자리는 텍스트 노드만 훑어 셌고(`<br>`을 세지 않았다) 서식을 거는 쪽은
// 값(`domToRuns`)의 좌표를 기대했다 — `<br>` 하나만큼 어긋나 있었다.
import { describe, it, expect } from 'vitest';
import { charOffset, lineLength, lineText, pointAt } from './noteTextSelect';

function box(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('공책 선택의 좌표계 — 값과 같은 수를 센다', () => {
  it('`<br>`은 **한 글자**다(값의 `\\n`과 같다)', () => {
    const el = box('1111<br>2222');
    expect(lineLength(el)).toBe(9);
    expect(lineText(el)).toBe('1111\n2222');
    const second = el.childNodes[2] as Text; // '2222'
    expect(charOffset(el, second, 0)).toBe(5); // 4글자 + 줄바꿈
    expect(charOffset(el, second, 4)).toBe(9);
  });

  it('`pointAt`은 그 역이다 — 같은 수로 오가야 한다', () => {
    const el = box('1111<br>2222<br>3333');
    for (const at of [0, 3, 4, 5, 8, 9, 10, 14]) {
      const p = pointAt(el, at);
      expect(charOffset(el, p.node, p.offset)).toBe(at);
    }
  });

  it('서식 있는 스팬을 건너도 수는 이어진다', () => {
    const el = box('가<b>나다</b>라<br>마');
    expect(lineLength(el)).toBe(6);
    const tail = el.lastChild as Text; // '마'
    expect(charOffset(el, tail, 0)).toBe(5);
  });

  it('`<br>`이 없으면 예전과 같은 수다(회귀 없음)', () => {
    const el = box('가나다라마');
    expect(lineLength(el)).toBe(5);
    expect(charOffset(el, el.firstChild as Text, 3)).toBe(3);
    expect(pointAt(el, 3).offset).toBe(3);
  });
});
