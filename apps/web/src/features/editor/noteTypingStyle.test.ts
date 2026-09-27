import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armCaretMark, armMarksForReplace, armedMarksOverlay, disarmCaretMark, fireCaretMark, noteBoxValue, noteMarksIn, openArmedAnchor, resetTypingStyle, stripBrowserFormatting } from './noteRichDom';
import { runsToHtml, setLinearSelection } from './richtextDom';

/**
 * 브라우저가 기억하는 **타이핑 스타일**을 지우는 일(제보 5).
 *
 * 제보: 빈 줄에 서식을 켜고 글을 친 뒤 Shift+Home으로 그 줄을 통째로 지우면 툴바
 * 단추는 꺼지는데 **다시 치면 서식이 살아나** 끌 방법이 없다. 실브라우저에서 갈라
 * 본 원인은 크로뮴의 타이핑 스타일이다 — 지운 선택의 서식을 "다음에 칠 글자"에
 * 물려준다. 우리 서식은 언제나 `<span style>`인데 되살아난 글자는 `<b>`였다.
 *
 * jsdom에는 `execCommand`가 없다. 여기서 보는 것은 **부르는 규칙**이다:
 * 켜져 있다고 답하는 것만 토글해 끈다 · 접힌 선택이 아니면 손대지 않는다.
 * (실제로 꺼지는지는 프로브가 봤다 — 지운 뒤 다시 친 글자가 `<b>` 없이 들어왔다.)
 */
describe('타이핑 스타일 비우기(제보 5)', () => {
  let exec: ReturnType<typeof vi.fn>;
  let state: Record<string, boolean>;

  beforeEach(() => {
    document.body.innerHTML = '';
    state = {};
    exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    (document as unknown as { queryCommandState: unknown }).queryCommandState = (cmd: string) => !!state[cmd];
  });
  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    delete (document as unknown as { queryCommandState?: unknown }).queryCommandState;
  });

  /** 빈 줄 하나에 접힌 캐럿을 둔다 — 글을 지운 직후의 상태다. */
  function emptyLine(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = '<br>';
    document.body.appendChild(el);
    const r = document.createRange();
    r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return el;
  }

  it('켜져 있는 서식만 토글해 끈다', () => {
    const el = emptyLine();
    state.bold = true;
    state.underline = true;
    resetTypingStyle(el);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['bold', 'underline']);
  });

  it('켜진 것이 없으면 아무 명령도 걸지 않는다 — 멀쩡한 상태를 뒤집지 않는다', () => {
    const el = emptyLine();
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('네 가지를 모두 본다 — 굵게·기울임·밑줄·취소선', () => {
    const el = emptyLine();
    state.bold = true;
    state.italic = true;
    state.underline = true;
    state.strikeThrough = true;
    resetTypingStyle(el);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['bold', 'italic', 'underline', 'strikeThrough']);
  });

  it('**캐럿이 그 줄에 없으면** 손대지 않는다 — 남의 선택을 건드리는 함수가 아니다', () => {
    const el = emptyLine();
    const other = document.createElement('div');
    other.textContent = '다른 곳';
    document.body.appendChild(other);
    const r = document.createRange();
    r.selectNodeContents(other);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    state.bold = true;
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('선택이 **펼쳐져 있으면** 손대지 않는다 — 그건 글에 거는 서식이지 타이핑 스타일이 아니다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.textContent = '가나다';
    document.body.appendChild(el);
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    state.bold = true;
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('`execCommand`가 없는 환경에서도 터지지 않는다', () => {
    const el = emptyLine();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    state.bold = true;
    expect(() => resetTypingStyle(el)).not.toThrow();
  });
});

/**
 * 브라우저가 남긴 **서식 잔재**를 걷는 일(제보 6).
 *
 * 실측한 그대로의 DOM으로 잰다 — 인라인 코드를 지우고 다시 친 자리에서 크로뮴이
 * 만들어 놓은 마크업이다(`<font color> + <span style="background-color;font-size">`).
 * 그대로 두면 `domToRuns`가 그 색을 **값**으로 읽어 붉은 글자가 저장된다.
 */
describe('브라우저 잔재 걷기(제보 6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function box(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  /** 크로뮴이 실제로 만든 것 — 프로브가 찍어 온 마크업 그대로다. */
  const JUNK =
    '<font color="#c44b40" face="ui-monospace, SFMono-Regular, monospace">' +
    '<span style="font-size: 13.34px; background-color: rgb(244, 237, 228);">AGAIN</span></font>';

  it('`<font>`을 풀고 인라인 배경·글꼴·크기를 지운다 — 글자는 그대로', () => {
    const el = box(`앞글 ${JUNK}`);
    expect(stripBrowserFormatting(el)).toBe(true);
    expect(el.textContent).toBe('앞글 AGAIN');
    expect(el.querySelector('font')).toBeNull();
    expect(el.innerHTML).not.toContain('background-color');
    expect(el.innerHTML).not.toContain('font-family');
    expect(el.innerHTML).not.toContain('font-size');
    // 값으로 새어 나가던 그 색이 사라졌다 — `domToRuns`가 읽을 `color`가 없다.
    expect(el.innerHTML).not.toContain('#c44b40');
  });

  it('**우리 마크업은 건드리지 않는다** — 고른 글자색·굵게·인라인 코드는 그대로', () => {
    const el = box('<span style="color:#3f8fd0">파란 글</span><span style="font-weight:800">굵게</span><code>코드</code>');
    expect(stripBrowserFormatting(el)).toBe(false);
    expect(el.querySelector('[style*="color"]')?.textContent).toBe('파란 글');
    expect(el.querySelector('[style*="font-weight"]')?.textContent).toBe('굵게');
    expect(el.querySelector('code')?.textContent).toBe('코드');
  });

  it('`<font>` 안의 색만 사라진다 — **우리가 만들지 않는 요소**라 그 안의 값은 잔재다', () => {
    const el = box('<font color="#c44b40">잔재</font><span style="color:#3f8fd0">내 색</span>');
    stripBrowserFormatting(el);
    expect(el.innerHTML).not.toContain('#c44b40');
    expect(el.innerHTML).toContain('#3f8fd0');
  });

  it('선언이 다 사라진 빈 스팬은 통째로 푼다 — 껍데기가 쌓이지 않게', () => {
    const el = box('<span style="background-color: rgb(244,237,228);">글</span>');
    stripBrowserFormatting(el);
    expect(el.querySelector('span')).toBeNull();
    expect(el.textContent).toBe('글');
  });

  it('걷을 것이 없으면 DOM을 만지지 않는다', () => {
    const el = box('그냥 글');
    const before = el.innerHTML;
    expect(stripBrowserFormatting(el)).toBe(false);
    expect(el.innerHTML).toBe(before);
  });
});

/**
 * **첫 글자에 서식이 안 걸리는 계열**(제보 2·3·6)과 그 방어.
 *
 * 셋의 뿌리가 하나다 — 조합 껍데기(`openArmedAnchor`)가 **굵게·기울임·취소선·밑줄만**
 * 그리고 색·형광은 빼 놓았고, 예약이 없으면 아예 서지 않았다. 그래서 한글 첫 글자는
 * ① 켜 둔 색이 안 보이고(2) ② 바꾼 색 대신 옛 색이 보이고(3) ③ 지운 인라인 코드의
 * 스타일이 그대로 보였다(6 — 확정될 때 걷혀 "풀린다"로 읽혔다).
 */
describe('조합 껍데기가 그리는 것(제보 2·3·6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

  });

  /** 빈 줄 하나에 캐럿을 두고 껍데기를 세울 수 있는 상태를 만든다. */
  function line(html = '<br>'): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-line', 'b1');
    el.innerHTML = html;
    document.body.appendChild(el);
    el.focus();
    setLinearSelection(el, 0, 0);
    return el;
  }
  const anchor = (el: HTMLElement) => el.querySelector('[data-armed-anchor]') as HTMLElement | null;

  it('켜 둔 **글자색**을 껍데기가 그린다 — 첫 자모부터 그 색이다(제보 2)', () => {
    const el = line();
    expect(armCaretMark(el, 'c', '#d92626')).toBe(true);
    expect(openArmedAnchor(el)).toBe(true);
    expect(anchor(el)?.getAttribute('style')).toContain('color:#d92626');
  });

  it('켜 둔 **형광**도 그린다 — 배경으로', () => {
    const el = line();
    armCaretMark(el, 'hl', 'yellow');
    expect(openArmedAnchor(el)).toBe(true);
    const st = anchor(el)?.getAttribute('style') ?? '';
    expect(st).toContain('background-color:');
    expect(st).not.toContain('background-color:transparent');
  });

  it('**색을 바꾸면 바뀐 색**을 그린다 — 옛 값이 남지 않는다(제보 3)', () => {
    const el = line();
    armCaretMark(el, 'c', '#d92626');
    armCaretMark(el, 'c', '#2266dd');
    expect(openArmedAnchor(el)).toBe(true);
    const st = anchor(el)?.getAttribute('style') ?? '';
    expect(st).toContain('color:#2266dd');
    expect(st).not.toContain('#d92626');
  });

  it('**값이 말하는 것을 전부 적는다** — 색·배경·글꼴까지(브라우저 잔재를 덮는 선언)', () => {
    const el = line();
    armCaretMark(el, 'b');
    expect(openArmedAnchor(el)).toBe(true);
    const st = anchor(el)?.getAttribute('style') ?? '';
    // 켠 것뿐 아니라 **없는 것도** 명시해야 타이핑 스타일을 이긴다(제보 6).
    expect(st).toContain('color:inherit');
    expect(st).toContain('background-color:transparent');
    expect(st).toContain('font-family:inherit');
  });

  it('예약도 잔재도 없으면 **세우지 않는다** — 쓸데없이 DOM을 늘리지 않는다', () => {
    const el = line();
    expect(openArmedAnchor(el)).toBe(false);
    expect(anchor(el)).toBeNull();
  });

  it('껍데기의 폭 0 글자는 **값이 아니다** — 조합 중에 저장돼도 문서에 남지 않는다', () => {
    const el = line();
    armCaretMark(el, 'c', '#d92626');
    openArmedAnchor(el);
    expect(el.textContent).toBe('​');
    expect(noteBoxValue(el).text).toBe('');
  });
});

/**
 * **껍데기는 서식 껍질 밖에 선다**(제보 1·2가 같은 뿌리였다).
 *
 * 빨간 글 끝에서 색을 바꿔 치면 첫 글자가 옛 색으로 들어오고, 줄 끝의 인라인 코드에서는
 * 오른쪽 방향키로도 그 상자를 벗어날 수 없었다. 둘 다 **캐럿이 인라인 요소 안에 갇혀**
 * 있어서다 — 그 자리에 껍데기를 꽂으면 옛 껍질 **안에** 들어가고, 브라우저가 조합 글자를
 * 껍데기 밖(= 옛 껍질 안)에 넣으면 그대로 옛 서식이 된다.
 */
describe('껍데기를 놓는 자리(제보 1·2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** 값을 그린 줄과, 그 줄의 값 좌표 `at`에 놓인 캐럿. */
  function at(rich: Record<string, unknown>[], pos: number): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-line', 'b1');
    el.innerHTML = runsToHtml({ text: '', rich: rich as never });
    document.body.appendChild(el);
    el.focus();
    setLinearSelection(el, pos, pos);
    return el;
  }
  const anchor = (el: HTMLElement) => el.querySelector('[data-armed-anchor]') as HTMLElement | null;

  it('색 스팬의 **끝**에서 색을 바꾸면 껍데기가 그 스팬 **밖**에 선다', () => {
    const el = at([{ t: '가나', b: false, c: '#d92626' }], 2);
    armCaretMark(el, 'c', '#2266dd');
    expect(openArmedAnchor(el)).toBe(true);
    const a = anchor(el)!;
    // 옛 색 스팬 안이 아니다 — 그것이 이 판의 전부다.
    expect(a.parentElement).toBe(el);
    expect(a.closest('[style*="d92626"]')).toBeNull();
    expect(a.getAttribute('style')).toContain('color:#2266dd');
  });

  it('인라인 코드의 **끝**에서도 밖으로 나간다 — 상자를 벗어나는 길이다', () => {
    const el = at([{ t: '앞글 ', b: false, c: null }, { t: 'CODE', b: false, c: null, k: true }], 9);
    armCaretMark(el, 'k');
    expect(openArmedAnchor(el)).toBe(true);
    expect(anchor(el)!.closest('code')).toBeNull();
  });

  it('글 **한복판**에서는 제자리에 꽂는다 — 앞뒤가 같은 껍질이라 옮길 이유가 없다', () => {
    const el = at([{ t: '가나다', b: false, c: '#d92626' }], 1);
    armCaretMark(el, 'b');
    expect(openArmedAnchor(el)).toBe(true);
    expect(anchor(el)!.closest('[style*="d92626"]')).toBeTruthy();
  });

  it('**글자는 옮기지 않는다** — 값 좌표가 그대로다', () => {
    const el = at([{ t: '가나', b: false, c: '#d92626' }], 2);
    armCaretMark(el, 'c', '#2266dd');
    openArmedAnchor(el);
    expect(noteBoxValue(el).text).toBe('가나'); // 폭 0 글자는 값이 아니다
  });
});

/**
 * **고른 것을 글자로 덮어쓸 때 서식을 못박는다**(제보 1).
 *
 * 제보: 서식이 걸린 1번 줄과 평문인 2번 줄을 함께 골라 놓고 글을 치면 **첫 글자만**
 * 그 서식이고 나머지는 평문이 된다. 크로뮴은 지워진 자리의 서식을 첫 글자에만
 * 물려주고, 그 다음 글자는 그 요소 **밖**에서 태어나기 때문이다(플랫폼마다 갈린다 —
 * 리눅스 크로뮴에서는 셋 다 물려받았다).
 *
 * 그래서 결과를 **브라우저가 정하지 않게** 한다: 고른 구간의 시작 서식을 예약으로
 * 들고 있다가 글자마다 다시 못박는다. 방향은 「유지」다(워드·구글 문서·노션 공통).
 *
 * 여기서 재는 것은 그 계약이다 — 브라우저가 서식을 **하나도** 물려주지 않은
 * 최악의 경우를 손으로 만들어 놓고, 예약이 그것을 되살리는지 본다.
 */
describe('덮어쓰기의 서식 못박기(제보 1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** `굵은글` 뒤에 `평문꼬리`가 붙은 줄 — 앞 3글자가 고른 구간이다. */
  function overwritten(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-edit', 'x');
    el.innerHTML = runsToHtml({ text: '', rich: [{ t: '굵은글', b: true, c: '#d92626' }, { t: '평문꼬리', b: false, c: null }] });
    document.body.appendChild(el);
    return el;
  }

  it('브라우저가 평문으로 넣어도 **끝까지** 그 서식이 된다', () => {
    const el = overwritten();
    // 고른 구간(0~3)의 서식을 읽어 두고 예약한다 — 지워질 길이는 3.
    armMarksForReplace(el, 0, 3, noteMarksIn(el, 0, 1));
    // 브라우저가 그 3글자를 **평문** `가나다`로 갈아 끼웠다고 치자(최악의 경우).
    el.innerHTML = '가나다' + runsToHtml({ text: '', rich: [{ t: '평문꼬리', b: false, c: null }] });
    setLinearSelection(el, 3, 3);

    const runs = fireCaretMark(el);
    expect(runs).toBeTruthy();
    const head = (runs ?? []).filter((r) => '가나다'.includes(r.t[0] ?? ''));
    expect(head.every((r) => r.b)).toBe(true);
    expect(head.every((r) => r.c === '#d92626')).toBe(true);
    // 꼬리는 건드리지 않는다 — 못박는 것은 **친 글자**뿐이다.
    expect((runs ?? []).find((r) => r.t.includes('평문꼬리'))?.b).toBeFalsy();
  });

  it('평문을 덮어쓰면 **평문으로 못박는다** — 서식이 새지 않는다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-edit', 'x');
    el.innerHTML = runsToHtml({ text: '', rich: [{ t: '평문', b: false, c: null }, { t: '굵은꼬리', b: true, c: null }] });
    document.body.appendChild(el);
    armMarksForReplace(el, 0, 2, noteMarksIn(el, 0, 1));
    // 브라우저가 굵게 물려준 채로 넣었다 — 시작 서식은 평문이므로 풀려야 한다.
    el.innerHTML = '<b>가나</b>' + runsToHtml({ text: '', rich: [{ t: '굵은꼬리', b: true, c: null }] });
    setLinearSelection(el, 2, 2);

    const runs = fireCaretMark(el);
    expect(runs).toBeTruthy();
    expect((runs ?? [])[0]?.b).toBeFalsy();
  });

  it('**예약은 살아 있다** — 다음 글자에도 같은 서식이 걸린다', () => {
    const el = overwritten();
    armMarksForReplace(el, 0, 3, noteMarksIn(el, 0, 1));
    el.innerHTML = '가' + runsToHtml({ text: '', rich: [{ t: '평문꼬리', b: false, c: null }] });
    setLinearSelection(el, 1, 1);
    expect(fireCaretMark(el)).toBeTruthy();

    // 두 번째 글자 — 브라우저가 또 평문으로 넣었다고 치자.
    const now = noteBoxValue(el);
    el.innerHTML = runsToHtml({ text: '', rich: [...(now.rich ?? []).slice(0, 1), { t: '나', b: false, c: null }, ...(now.rich ?? []).slice(1)] });
    setLinearSelection(el, 2, 2);
    const runs = fireCaretMark(el);
    expect(runs).toBeTruthy();
    expect((runs ?? []).find((r) => r.t.includes('나'))?.b).toBe(true);
  });
});

/**
 * **글자가 들어오는 찰나에도 툴바가 같은 답을 내야 한다**(제보 1·2).
 *
 * 제보: 켜 둔 서식으로 글을 치면 첫 글자에는 단추에 불이 들어오는데 **두 번째부터
 * 꺼지고**, 띄어쓰기를 하면 다시 켜진다(형광·글자색은 두 번째에서만 꺼졌다 세 번째에
 * 다시 켜진다).
 *
 * 왜 그런가: 조합이 끝나면 `compositionend`가 **캡처 단계**에서 툴바를 먼저 깨우고
 * (`NoteEditor`의 읽기), 값을 고치는 쪽(`fireCaretMark`)은 그 뒤 버블 단계에서 돈다.
 * 그 찰나의 DOM에는 **아직 서식이 걸리지 않은 맨 글자**가 있고, 예약은 한 칸 뒤에
 * 있어 예전 `armedMarksOverlay`는 "내 자리가 아니다"라며 빈손을 돌려줬다 — 그래서
 * 툴바가 맨 글자를 읽어 불을 껐다. 공백은 조합이 없어 그 틈이 생기지 않는다(제보의
 * "띄어쓰기 후에는 다시 켜진다"가 그 증거다).
 *
 * 고친 뒤의 계약: **예약이 살아 있는지 재는 자를 `fireCaretMark`와 같은 것으로** 쓴다.
 */
describe('글자가 들어오는 찰나의 툴바(제보 1·2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    disarmCaretMark();
  });

  /** 빈 줄에 굵게를 켜 둔다 — 그 줄과 예약을 돌려준다. */
  function armedLine(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-edit', 'x');
    el.innerHTML = '<br>';
    document.body.appendChild(el);
    const r = document.createRange();
    r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    expect(armCaretMark(el, 'b')).toBe(true);
    return el;
  }

  it('켠 직후에는 그 자리에서 보인다(회귀 없음)', () => {
    const el = armedLine();
    expect(armedMarksOverlay(el).b).toBe(true);
  });

  it('**맨 글자가 막 들어온 찰나**에도 보인다 — 값은 아직 고쳐지기 전이다', () => {
    const el = armedLine();
    // 브라우저가 서식 없이 한 글자를 넣었다(아직 `fireCaretMark`가 돌기 전).
    el.innerHTML = '가';
    setLinearSelection(el, 1, 1);
    expect(armedMarksOverlay(el).b).toBe(true);
  });

  it('두 글자가 들어온 찰나에도 보인다 — 늘어난 만큼 캐럿도 갔다', () => {
    const el = armedLine();
    el.innerHTML = '가나';
    setLinearSelection(el, 2, 2);
    expect(armedMarksOverlay(el).b).toBe(true);
  });

  it('**캐럿만 옮긴 자리**는 그 약속이 아니다 — 늘어난 글자가 없다', () => {
    const el = armedLine();
    el.innerHTML = '가나다';
    // 글자는 셋 늘었는데 캐럿은 하나만 갔다 — 예약해 놓고 딴 데를 누른 모양이다.
    setLinearSelection(el, 1, 1);
    expect(armedMarksOverlay(el).b).toBeUndefined();
  });

  it('형광·글자색도 같은 창에서 보인다(제보 2)', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.setAttribute('data-note-edit', 'x');
    el.innerHTML = '<br>';
    document.body.appendChild(el);
    const r = document.createRange();
    r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    armCaretMark(el, 'hl', 'yellow');
    armCaretMark(el, 'c', '#d92626');
    el.innerHTML = '가';
    setLinearSelection(el, 1, 1);
    expect(armedMarksOverlay(el).hl).toBe('yellow');
    expect(armedMarksOverlay(el).c).toBe('#d92626');
  });
});
