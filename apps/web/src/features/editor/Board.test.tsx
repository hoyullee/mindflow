// 화이트보드(M2) — 에디터 board 모드. board = `nodes: {}`인 Doc이고 에디터는
// `controller.isBoard`로 트리 관련 UI를 감춘다("할 수 없는 것은 보이지 않는다").
// 공유·협업·저장·undo는 문서(Doc) 기반이라 기존 경로 그대로다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const BOARD = {
  v: 1,
  nodes: {},
  floats: [{ id: 'bf1', x: 40, y: 60, w: 180, text: '아이디어 하나' }],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
  kind: 'board',
};

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

// jsdom엔 PointerEvent가 없어 fireEvent.pointer*가 좌표를 통째로 떨어뜨린다 —
// MouseEvent를 pointer 이벤트 이름으로 던지고 pointerId만 심는다
// (EditorC.interactions.test.tsx의 `firePointer`와 같은 처방).
function firePointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { pointerId?: number; clientX?: number; clientY?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('화이트보드 에디터', () => {
  it('tpl=board로 열면 트리 없는 빈 보드가 시드되고, 메모를 추가·저장할 수 있다', async () => {
    const { container } = renderEditor('/editor?map=b1&title=%EB%B3%B4%EB%93%9C&tpl=board&new=1');
    // 커튼이 걷히고 캔버스가 뜬다 — 노드는 0개.
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(0);

    // 시드 메모 하나로 열린다(요청: 텅 빈 화면은 허전하다).
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(1));

    // 하단 도구 막대의 "메모 추가" → 메모가 하나 더 생기고 저장본이 board로 남는다
    // (삽입은 GNB 메뉴가 아니라 도구 막대에 있다 — 요청).
    fireEvent.click(screen.getByRole('button', { name: '메모 추가' }));
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(2));
    // 자동저장 디바운스(0.9s)를 기다리지 않고 지금 저장한다 — 검증 대상은 저장
    // 내용이지 디바운스가 아니다(오프라인 테스트와 같은 처방).
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b1') || 'null');
      expect(saved?.kind).toBe('board');
      expect(saved?.floats).toHaveLength(2);
      expect(Object.keys(saved?.nodes ?? { x: 1 })).toHaveLength(0);
    });
  });

  it('board에서는 주제/선/영역·레이아웃·아웃라인 UI가 없다 — 메모·이미지만', async () => {
    localStorage.setItem('mindflow_doc_b2', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b2&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    // 삽입은 GNB에서 내려가고(같은 동작의 진입점을 둘로 두지 않는다) 하단 도구
    // 막대가 맡는다 — 메모·이미지만.
    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;
    expect(within(bar).getByRole('button', { name: '메모 추가' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '이미지 추가' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '주제 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '선 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '영역 추가' })).toBeNull();

    // 스타일 메뉴: 레이아웃/연결선 구획이 없고 테마는 남는다.
    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('테마')).toBeTruthy());
    expect(screen.queryByText('레이아웃')).toBeNull();
    expect(screen.queryByText('연결선')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // 보기 메뉴: 아웃라인(트리 목차)이 없다.
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    await screen.findByRole('button', { name: '맵' });
    expect(screen.queryByRole('button', { name: '아웃라인' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // 배경 우클릭: 메모/이미지만.
    fireEvent.contextMenu(getViewport(container), { clientX: 300, clientY: 300 });
    await screen.findByText('메모 추가');
    expect(screen.getByText('이미지 추가')).toBeTruthy();
    expect(screen.queryByText('주제 추가')).toBeNull();
    expect(screen.queryByText('선 추가')).toBeNull();
    expect(screen.queryByText('영역 추가')).toBeNull();
  });

  it('board 제목은 메타가 정본 — 독칩에서 고치면 저장 메타에 반영된다(루트가 없어도)', async () => {
    localStorage.setItem('mindflow_doc_b3', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b3&title=%EC%98%9B%20%EC%A0%9C%EB%AA%A9');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());
    // 표시 제목 = URL 메타.
    const title = await screen.findByText('옛 제목');
    fireEvent.doubleClick(title);
    const input = (await screen.findByDisplayValue('옛 제목')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '아이디어 보드' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const meta = JSON.parse(localStorage.getItem('mindflow_doc_meta_b3') || 'null');
      expect(meta?.title).toBe('아이디어 보드');
    });
    expect(screen.getByText('아이디어 보드')).toBeTruthy();
  });

  it('이미지 캡션 — 이미지 아래에 그려지고, 속성 패널에서 고치면 문서에 커밋된다', async () => {
    localStorage.setItem(
      'mindflow_doc_b4',
      JSON.stringify({ ...BOARD, floats: [{ id: 'img1', x: 100, y: 80, w: 200, h: 150, text: '', img: 'data:image/png;base64,iVBORw0KGgo=', caption: '회의 사진' }] }),
    );
    const { container } = renderEditor('/editor?map=b4&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="img1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 캡션이 이미지 아래(박스 밖)에 그려진다.
    expect(floatEl.querySelector('[data-float-caption]')?.textContent).toBe('회의 사진');

    // 선택 → 속성 패널의 제목 입력 → blur 커밋 → 문서 갱신 + 렌더 갱신.
    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    const capInput = (await screen.findByLabelText('이미지 제목')) as HTMLInputElement;
    expect(capInput.value).toBe('회의 사진');
    fireEvent.change(capInput, { target: { value: '킥오프 화이트보드' } });
    fireEvent.blur(capInput);
    await waitFor(() => expect(floatEl.querySelector('[data-float-caption]')?.textContent).toBe('킥오프 화이트보드'));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true }); // 자동저장 디바운스 우회
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b4') || 'null');
      expect(saved?.floats?.[0]?.caption).toBe('킥오프 화이트보드');
    });
  });

  it('새 보드는 화이트 테마로 시드되고, 스타일 메뉴에서 테마를 바꾸면 캔버스가 바뀐다(제보)', async () => {
    const { container } = renderEditor('/editor?map=b13&title=%EB%B3%B4%EB%93%9C&tpl=board&new=1');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());
    const bg = () => container.querySelector('[data-canvas-bg]') as HTMLElement;
    const painted = (): string => bg().style.background || bg().style.backgroundColor;
    // 기본은 순백 — 흰 배경이 덮어쓰기가 아니라 `white` 테마다.
    expect(painted()).toContain('255, 255, 255');

    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('테마')).toBeTruthy());
    // 화이트 스와치가 목록에 있고(요청), 지금 고른 테마다.
    const white = screen.getByRole('button', { name: '화이트' });
    expect(white.getAttribute('aria-pressed')).toBe('true');
    // 다른 테마를 고르면 캔버스가 실제로 바뀐다 — 예전에는 보드만 그대로였다.
    fireEvent.click(screen.getByRole('button', { name: '포레스트' }));
    await waitFor(() => expect(painted()).toContain('233, 243, 236')); // THEMES.forest.canvasBg
    expect(painted()).not.toContain('255, 255, 255');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b13') || 'null');
      expect(saved?.themeKey).toBe('forest');
    });
  });

  it('맵도 화이트 테마를 고를 수 있다(요청)', async () => {
    localStorage.setItem(
      'mindflow_doc_m5',
      JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
    );
    const { container } = renderEditor('/editor?map=m5&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="root"]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('테마')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '화이트' }));
    const bg = container.querySelector('[data-canvas-bg]') as HTMLElement;
    await waitFor(() => expect(bg.style.background || bg.style.backgroundColor).toContain('255, 255, 255'));
  });

  it('board 캔버스는 문서 테마를 따르고(제보: 테마 변경이 안 먹음), 메모에 접기 토글이 없다', async () => {
    // 접힌 메모(collapsed)가 남아 있어도 보드에서는 펼쳐 그린다.
    localStorage.setItem('mindflow_doc_b5', JSON.stringify({ ...BOARD, themeKey: 'dark', floats: [{ id: 'bf1', x: 40, y: 60, w: 180, text: '첫 줄\n둘째 줄', collapsed: true }] }));
    const { container } = renderEditor('/editor?map=b5&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="bf1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 예전에는 보드면 흰색으로 덮어써서 어떤 테마를 골라도 화면이 그대로였다.
    const bg = container.querySelector('[data-canvas-bg]') as HTMLElement;
    const painted = bg.style.background || bg.style.backgroundColor;
    expect(painted).toContain('32, 27, 22'); // THEMES.dark.canvasBg (#201b16)
    expect(painted).not.toContain('255, 255, 255');
    // 접기 토글 부재 + collapsed여도 두 줄이 다 보인다.
    expect(floatEl.querySelector('[data-fold-toggle]')).toBeNull();
    expect(floatEl.textContent).toContain('둘째 줄');
    // 접기 토글이 없으니 좌측 패딩도 우측과 대칭이다(제보: 좌측만 넓다).
    expect(floatEl.style.paddingLeft).toBe(floatEl.style.paddingRight);
  });

  it('맵(무회귀): 메모 좌측 패딩은 접기 토글 자리(32px)를 유지한다', async () => {
    localStorage.setItem(
      'mindflow_doc_m3',
      JSON.stringify({
        v: 1,
        nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
        floats: [{ id: 'mf1', x: 40, y: 60, w: 180, text: '맵 메모' }],
        lines: [],
        zones: [],
        layoutMode: 'right',
        themeKey: 'coral',
      }),
    );
    const { container } = renderEditor('/editor?map=m3&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="mf1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(floatEl.style.paddingLeft).toBe('32px');
    expect(floatEl.querySelector('[data-fold-toggle]')).toBeTruthy();
  });

  it('펜으로 그린 획이 문서에 커밋되고(저장·undo 한 단계) 획 레이어에 그려진다(M4)', async () => {
    localStorage.setItem('mindflow_doc_b6', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b6&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    // 도구 막대에서 펜 선택 → 그리기 오버레이가 뜬다.
    fireEvent.click(screen.getByRole('button', { name: '펜' }));
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // 포인터 스트로크: down → move ×3 → up = 커밋 한 번.
    firePointer(layer, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 240, clientY: 220 });
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 280, clientY: 260 });
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 320, clientY: 240 });
    firePointer(layer, 'pointerup', { pointerId: 1, clientX: 320, clientY: 240 });

    // 획이 문서에 커밋되어 StrokeLayer가 그린다.
    await waitFor(() => expect(container.querySelector('[data-stroke-id]')).toBeTruthy());

    // 저장본에 남는다(자동저장 디바운스 우회).
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b6') || 'null');
      expect(saved?.strokes).toHaveLength(1);
      expect(saved.strokes[0].pts.length).toBeGreaterThanOrEqual(4);
      expect(saved.strokes[0].w).toBe(4);
    });

    // undo 한 번 = 획 하나가 통째로 사라진다(획은 원자 커밋).
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(container.querySelector('[data-stroke-id]')).toBeNull());
  });

  it('지우개는 닿은 획만 지운다(M4)', async () => {
    localStorage.setItem(
      'mindflow_doc_b7',
      JSON.stringify({
        ...BOARD,
        floats: [],
        strokes: [
          { id: 's1', pts: [0, 0, 40, 0], color: '#2b2b2b', w: 4 },
          { id: 's2', pts: [0, 400, 40, 400], color: '#2b2b2b', w: 4 },
        ],
      }),
    );
    const { container } = renderEditor('/editor?map=b7&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-id]')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: '지우개' }));
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // s1의 화면 좌표: 캔버스 (20,0) → 클라이언트 (pan.x + 20*zoom, pan.y).
    // jsdom에서는 뷰포트 크기 실측이 안 되므로 pan/zoom을 셈에 넣지 않고,
    // 획 레이어(팬 레이어 안 SVG)의 bounding box 대신 **컨트롤러와 같은 변환**을
    // 신뢰한다 — 초기 fit이 센터링한 pan을 모르니, s1 위 지점을 다른 획(s2,
    // y=400)과 충분히 떨어진 화면 좌표로 때려 맞히는 대신 s1 좌표를 직접 계산:
    // 초기 뷰는 centerOnRoot(장면 중심) 기반이라 zoom=1.25 상한/최소 줌 사이 —
    // 안전하게, 문서 좌표를 아는 두 획의 **중간 y**보다 위(=s1 쪽)를 huge 범위로
    // 지우는 대신 pan 값을 pan-layer transform에서 읽는다.
    const panLayer = container.querySelector('[data-pan-layer]') as HTMLElement;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(panLayer.style.transform || '');
    if (!m) throw new Error(`pan transform not parsable: ${panLayer.style.transform}`);
    const pan = { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
    const zoom = parseFloat(m[3]!);
    const cx = pan.x + 20 * zoom;
    const cy = pan.y + 0 * zoom;
    firePointer(layer, 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy });
    firePointer(layer, 'pointerup', { pointerId: 1, clientX: cx, clientY: cy });

    await waitFor(() => {
      expect(container.querySelector('[data-stroke-id="s1"]')).toBeNull();
      expect(container.querySelector('[data-stroke-id="s2"]')).toBeTruthy();
    });
  });

  it('키보드로 도구를 바꾼다 — V(선택)·P(펜)·E(지우개)(요청)', async () => {
    localStorage.setItem('mindflow_doc_b8', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b8&title=x');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());

    const pressed = (name: string) => (screen.getByRole('button', { name }) as HTMLElement).getAttribute('aria-pressed');
    expect(pressed('선택')).toBe('true');

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await waitFor(() => expect(pressed('펜')).toBe('true'));
    expect(container.querySelector('[data-board-draw-layer]')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'e', code: 'KeyE' });
    await waitFor(() => expect(pressed('지우개')).toBe('true'));

    fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });
    await waitFor(() => expect(pressed('선택')).toBe('true'));
    expect(container.querySelector('[data-board-draw-layer]')).toBeNull();

    // 수정 키가 붙으면 기존 단축키 그대로다 — Ctrl+V는 붙여넣기지 도구 전환이 아니다.
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await waitFor(() => expect(pressed('펜')).toBe('true'));
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(pressed('펜')).toBe('true');
  });

  it('도구 막대에서 메모·이미지 추가와 실행 취소/다시 실행을 한다(요청)', async () => {
    localStorage.setItem('mindflow_doc_b9', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b9&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(1));
    const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;

    // 그리기 도구가 켜져 있어도 메모를 추가할 수 있고, 추가하면 선택 도구로 돌아온다.
    fireEvent.click(within(bar).getByRole('button', { name: '펜' }));
    fireEvent.click(within(bar).getByRole('button', { name: '메모 추가' }));
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(2));
    expect(within(bar).getByRole('button', { name: '선택' }).getAttribute('aria-pressed')).toBe('true');

    // 실행 취소 → 방금 만든 메모가 사라지고, 다시 실행하면 돌아온다.
    // (메모를 추가하면 편집 세션이 곧바로 열리므로 먼저 닫는다 — 열린 채 취소하면
    //  그 편집 커밋이 먼저 되돌려진다. 맵의 메모 추가와 같은 흐름.)
    // 메모를 추가하면 편집 세션이 열린다 — 편집 중에는 되돌리기가 편집 박스의
    // 몫이라 컨트롤러가 가로채지 않는다. 먼저 편집을 닫는다(실사용도 같은 순서).
    const editBox = container.querySelector('.mf-richedit') as HTMLElement;
    fireEvent.keyDown(editBox, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('.mf-richedit')).toBeNull());

    fireEvent.click(within(bar).getByRole('button', { name: '실행 취소' }));
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(1));
    fireEvent.click(within(bar).getByRole('button', { name: '다시 실행' }));
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(2));
  });

  it('모바일: 속성 시트가 하단 도구 막대보다 위에 놓이고, 닫기 손잡이는 없다(제보)', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem(
        'mindflow_doc_b11',
        JSON.stringify({ ...BOARD, floats: [{ id: 'img1', x: 0, y: 0, w: 200, h: 150, text: '', img: 'data:image/png;base64,iVBORw0KGgo=', caption: '사진' }] }),
      );
      const { container } = renderEditor('/editor?map=b11&title=x');
      const floatEl = await waitFor(() => {
        const el = container.querySelector('[data-float-id="img1"]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.click(await screen.findByText('속성'));

      const input = (await screen.findByLabelText('이미지 제목')) as HTMLInputElement;
      const sheet = input.closest('div[style*="position: fixed"]') as HTMLElement;
      const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;
      expect(Number(sheet.style.zIndex)).toBeGreaterThan(Number(bar.style.zIndex));
      expect(screen.queryByLabelText('속성 닫기')).toBeNull();
      // 제목은 20자까지
      expect(input.maxLength).toBe(20);
    } finally {
      restore();
    }
  });

  it('모바일 board: 줌·미니맵 묶음은 우측 하단 그대로이고, 도구 막대가 좌측으로 비켜선다(요청)', async () => {
    // 잠시 묶음을 우측 상단으로 올렸다가 원래 자리가 낫다는 판단으로 되돌렸다 —
    // 겹침은 도구 막대가 좌측 하단으로 붙고 폭을 양보해서 푼다.
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_b12', JSON.stringify(BOARD));
      const { container } = renderEditor('/editor?map=b12&title=x');
      await waitFor(() => expect(container.querySelector('[data-zoom-cluster]')).toBeTruthy());
      const cluster = container.querySelector('[data-zoom-cluster]') as HTMLElement;
      expect(cluster.style.bottom).toBe('16px');
      expect(cluster.style.top).toBe('');

      const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;
      expect(bar.style.left).toBe('12px'); // 좌측 하단 — 중앙 정렬(50%)이 아니다
      expect(bar.style.transform).toBe('');
      // 폭이 묶음 자리를 빼고 잡혀 두 상자가 만나지 않는다.
      expect(bar.style.maxWidth).toMatch(/calc\(100vw - 172px\)/);
      // 도구 3 + 동작 4가 두 행으로 갈린다(한 행이면 좁은 폭을 넘는다).
      expect(bar.querySelectorAll(':scope > div').length).toBe(2);
    } finally {
      restore();
    }
  });

  it('맵(무회귀): 모바일에서도 줌·미니맵 묶음은 하단에 남는다', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem(
        'mindflow_doc_m4',
        JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
      );
      const { container } = renderEditor('/editor?map=m4&title=x');
      await waitFor(() => expect(container.querySelector('[data-zoom-cluster]')).toBeTruthy());
      const cluster = container.querySelector('[data-zoom-cluster]') as HTMLElement;
      expect(cluster.style.bottom).toBe('16px');
    } finally {
      restore();
    }
  });

  it('이미지 제목은 20자까지 — 커밋에서도 잘린다(요청)', async () => {
    localStorage.setItem(
      'mindflow_doc_b13',
      JSON.stringify({ ...BOARD, floats: [{ id: 'img1', x: 0, y: 0, w: 200, h: 150, text: '', img: 'data:image/png;base64,iVBORw0KGgo=' }] }),
    );
    const { container } = renderEditor('/editor?map=b13&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="img1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    const input = (await screen.findByLabelText('이미지 제목')) as HTMLInputElement;
    expect(input.maxLength).toBe(20);
    // maxLength를 우회한 값(붙여넣기 등)도 커밋에서 잘린다.
    fireEvent.change(input, { target: { value: '가'.repeat(40) } });
    fireEvent.blur(input);
    await waitFor(() => expect(floatEl.querySelector('[data-float-caption]')?.textContent).toBe('가'.repeat(20)));
  });

  it('그리기 도구 막대는 board 전용 — 맵에는 없다(M4)', async () => {
    localStorage.setItem(
      'mindflow_doc_m2',
      JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
    );
    const { container } = renderEditor('/editor?map=m2&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('루트')).toBeTruthy());
    expect(container.querySelector('[data-board-toolbar]')).toBeNull();
    expect(container.querySelector('[data-board-draw-layer]')).toBeNull();
  });

  it('맵(무회귀): 삽입 메뉴 5종·스타일 레이아웃·보기 아웃라인이 그대로다', async () => {
    localStorage.setItem(
      'mindflow_doc_m1',
      JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
    );
    const { container } = renderEditor('/editor?map=m1&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('루트')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '삽입' }));
    await screen.findByRole('button', { name: '주제 추가' });
    expect(screen.getByRole('button', { name: '선 추가' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '영역 추가' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('레이아웃')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    await screen.findByRole('button', { name: '아웃라인' });
  });
});
