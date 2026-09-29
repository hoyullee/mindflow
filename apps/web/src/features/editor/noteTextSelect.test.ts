// 공책 본문 선택의 **좌표계** — 화면의 자리와 값의 자리는 같은 수여야 한다.
//
// 왜 이 파일이 있나(제보): `2222`를 골라 굵게를 눌렀는데 `222`가 굵어졌다.
// 고른 자리는 텍스트 노드만 훑어 셌고(`<br>`을 세지 않았다) 서식을 거는 쪽은
// 값(`domToRuns`)의 좌표를 기대했다 — `<br>` 하나만큼 어긋나 있었다.
import { describe, it, expect } from 'vitest';
import { charOffset, drawSelLayer, lineLength, lineText, pointAt } from './noteTextSelect';

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

  /**
   * **끝의 줄바꿈 하나는 세지 않는다** — 값을 읽는 쪽과 같은 자를 쓴다(제보 2).
   *
   * 줄을 통째로 지우면 크로뮴이 보초 `<br>`을 남기는데, 거기에 **조합으로** 글자를
   * 넣으면 그것이 남아 DOM이 `가<br>`이 된다(실브라우저로 재현 — 영문 타이핑은
   * 크로뮴이 걷어 내므로 이 길로만 온다). 그 `<br>`을 한 글자로 세면 길이가 2가 되어
   * 캐럿(1)이 영영 「글 끝」이 아니고, ↓가 다음 줄로 넘어가지 못한다.
   */
  it('**끝의 줄바꿈 하나**는 값과 같이 세지 않는다 — `가<br>`은 한 글자다', () => {
    const el = box('가<br>');
    expect(lineText(el)).toBe('가');
    expect(lineLength(el)).toBe(1);
    // 앞쪽 자리는 하나도 움직이지 않는다 — `charOffset`과의 왕복이 그대로여야 한다.
    expect(charOffset(el, el.firstChild as Text, 1)).toBe(1);
  });

  it('**보초까지 둘**이면 하나만 걷는다 — Shift+Enter로 만든 빈 마지막 행', () => {
    // 값이 `가\n`인 줄의 DOM(`softBreak`·`codeHtml`이 보초 `<br>`을 하나 더 붙인다).
    const el = box('가<br><br>');
    expect(lineText(el)).toBe('가\n');
    expect(lineLength(el)).toBe(2); // 줄바꿈 뒤의 캐럿(2)이 곧 글 끝이다
  });

  it('가운데의 줄바꿈은 그대로 센다 — 끝이 아니면 걷지 않는다', () => {
    const el = box('가<br>나');
    expect(lineLength(el)).toBe(3);
  });

  it('`<br>`이 없으면 예전과 같은 수다(회귀 없음)', () => {
    const el = box('가나다라마');
    expect(lineLength(el)).toBe(5);
    expect(charOffset(el, el.firstChild as Text, 3)).toBe(3);
    expect(pointAt(el, 3).offset).toBe(3);
  });
});

/**
 * **선택 덮개** — 고른 글자를 **줄 높이의 띠**로 그린다(제보: 윈도우에서도 선택 배경을 줄 높이만큼).
 *
 * `::highlight()`는 글자 상자만 덮고 높이를 바꿀 수 없어서, 구간의 사각형을 받아 행마다 줄 높이로
 * 늘린 띠를 그린다. jsdom에는 배치가 없으므로 사각형을 세워 **무엇을 그리나**만 지킨다 — 실제
 * 높이는 크로뮴 프로브로 쟀다(글자 17px → 띠 26.8px = 그 줄의 `line-height`).
 */
describe('drawSelLayer — 줄 높이의 띠', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  it('한 행의 조각들은 **한 띠**로 잇고, 높이는 그 줄의 line-height다', () => {
    const col = document.createElement('div');
    col.setAttribute('data-note-col', '');
    const line = document.createElement('div');
    line.setAttribute('data-note-line', 'a');
    line.style.lineHeight = '26px';
    line.innerHTML = '보통 <b>굵게</b> 둘째 행';
    const layer = document.createElement('div');
    layer.setAttribute('data-note-sel-layer', '');
    col.append(line, layer);
    document.body.appendChild(col);
    layer.getBoundingClientRect = () => rect(0, 500, 0, 0);
    const r = document.createRange();
    r.selectNodeContents(line);
    // 첫 행에 조각 둘(보통 · 굵게 — 굵은 글자는 상자가 조금 크다) + 둘째 행 하나 + 요소 경계의 빈 사각형.
    r.getClientRects = () => [rect(10, 104, 40, 17), rect(50, 103.5, 30, 18), rect(0, 104, 0, 17), rect(10, 130, 60, 17)] as unknown as DOMRectList;

    drawSelLayer([r]);
    const bands = [...layer.querySelectorAll<HTMLElement>('[data-note-sel-band]')].map((b) => [b.style.left, b.style.top, b.style.width, b.style.height]);
    // 원점(덮개의 자리 y=500)에서 잰다 · 첫 행은 10~80 한 띠(가운데 112.5 ± 13) · 둘째 행은 가운데
    // 138.5 ± 13 — 앞 띠의 아래 끝(125.5)에 맞닿아 **겹치지 않는다**(겹치면 이음매가 짙어진다).
    expect(bands).toEqual([
      ['10px', '-400.5px', '70px', '26px'],
      ['10px', '-374.5px', '60px', '26px'],
    ]);

    drawSelLayer([]);
    expect(layer.children).toHaveLength(0);
    col.remove();
  });
});
