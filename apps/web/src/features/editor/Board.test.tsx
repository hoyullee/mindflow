// 화이트보드(M2) — 에디터 board 모드. board = `nodes: {}`인 Doc이고 에디터는
// `controller.isBoard`로 트리 관련 UI를 감춘다("할 수 없는 것은 보이지 않는다").
// 공유·협업·저장·undo는 문서(Doc) 기반이라 기존 경로 그대로다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';
import { BOARD_TEMPLATES } from '../../templates/mapTemplates';
import { HL_COLORS, HL_OPACITY, HL_WIDTHS, PEN_COLORS } from './boardTools';
import { STROKE_Z } from './components/StrokeLayer';
import { VOTE_EMOJI } from '@mindflow/mindmap-core';

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

/** 캔버스 좌표 → 클라이언트 좌표. jsdom은 레이아웃을 재지 않으므로 팬 레이어의
 * transform(초기 fit이 정한 pan/zoom)에서 직접 읽는다(지우개 테스트와 같은 처방). */
function strokePoint(container: HTMLElement, cx: number, cy: number): { x: number; y: number } {
  const panLayer = container.querySelector('[data-pan-layer]') as HTMLElement;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(panLayer.style.transform || '');
  if (!m) throw new Error(`pan transform not parsable: ${panLayer.style.transform}`);
  const zoom = parseFloat(m[3]!);
  return { x: parseFloat(m[1]!) + cx * zoom, y: parseFloat(m[2]!) + cy * zoom };
}

/** jsdom이 인라인 색을 `rgb(...)`로 정규화하므로 헥사로 되돌려 비교한다. */
function rgbHex(v: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(v);
  if (!m) return v.toLowerCase();
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
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

  it('보드 템플릿(tpl=board-retro)은 메모 배치가 그대로 시드된다 — 저장본도 board', async () => {
    const { container } = renderEditor('/editor?map=b14&title=%ED%9A%8C%EA%B3%A0&tpl=board-retro&new=1');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());

    const tpl = BOARD_TEMPLATES.find((t) => t.id === 'board-retro')!;
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(tpl.memos.length));
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(0);
    // 열 제목은 굵은 rich 런으로 들어간다(모델 계약: 런 글자 = text).
    expect(within(getViewport(container)).getByText(tpl.memos[0]!.text)).toBeTruthy();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b14') || 'null');
      expect(saved?.kind).toBe('board');
      expect(saved?.floats).toHaveLength(tpl.memos.length);
      // 보드가 만들 수 없는 물건(영역·연결선)은 템플릿도 쓰지 않는다.
      expect(saved?.lines ?? []).toHaveLength(0);
      expect(saved?.zones ?? []).toHaveLength(0);
    });
  });

  it('board에서는 주제·레이아웃·아웃라인 UI가 없다 — 메모·이미지·연결선·영역만', async () => {
    localStorage.setItem('mindflow_doc_b2', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b2&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    // 삽입은 GNB에서 내려가고(같은 동작의 진입점을 둘로 두지 않는다) 하단 도구
    // 막대가 맡는다 — 보드 어휘 넷(메모·이미지·연결선·영역), 주제만 없다.
    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;
    expect(within(bar).getByRole('button', { name: '메모 추가' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '이미지 추가' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '연결선 추가' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '영역 추가' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '주제 추가' })).toBeNull();

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

    // 배경 우클릭: 보드 어휘 넷. 주제만 없다.
    fireEvent.contextMenu(getViewport(container), { clientX: 300, clientY: 300 });
    await screen.findByText('메모 추가');
    expect(screen.getByText('이미지 추가')).toBeTruthy();
    expect(screen.getAllByText('연결선 추가').length).toBeGreaterThan(0);
    expect(screen.getAllByText('영역 추가').length).toBeGreaterThan(0);
    expect(screen.queryByText('주제 추가')).toBeNull();
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

  it('그린 획은 객체 위에 얹힌다 — 메모 뒤에 그려지고 z-index가 더 높다(제보)', async () => {
    localStorage.setItem(
      'mindflow_doc_b15',
      JSON.stringify({ ...BOARD, floats: [{ id: 'bf1', x: 0, y: 0, w: 180, text: '메모' }], strokes: [{ id: 's1', pts: [10, 10, 80, 60], color: '#d92626', w: 4 }] }),
    );
    const { container } = renderEditor('/editor?map=b15&title=x');
    const ink = await waitFor(() => {
      const el = container.querySelector('[data-stroke-layer]') as SVGElement;
      expect(el).toBeTruthy();
      return el;
    });
    const memo = container.querySelector('[data-float-id="bf1"]') as HTMLElement;
    // 같은 팬 레이어 안에서 잉크가 메모보다 **뒤**(= 위에 그려진다).
    expect(memo.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // DOM 순서만으로는 부족하다 — 메모는 z-index를 쓰므로 잉크가 더 높아야 한다.
    expect(Number(ink.style.zIndex)).toBeGreaterThan(Number(memo.style.zIndex || 0));
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

  // 요청: 펜/지우개가 켜져 있어도 **두 손가락 드래그는 화면 이동**이어야 한다.
  // 그리기 오버레이가 포인터를 전부 가져가므로, 그 레이어가 두 손가락 제스처를
  // 컨트롤러로 넘긴다(한 손가락은 그대로 그리기).
  it('펜을 켠 채로도 두 손가락 드래그는 화면을 옮기고, 획은 남지 않는다(요청)', async () => {
    localStorage.setItem('mindflow_doc_b16', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b16&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '펜' }));
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    const panLayer = (): HTMLElement => container.querySelector('[data-pan-layer]') as HTMLElement;
    const before = panLayer().style.transform;

    // 한 손가락으로 시작했다가 두 번째 손가락이 닿는다 → 그리기는 취소되고 제스처로.
    firePointer(layer, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 210, clientY: 205 });
    firePointer(layer, 'pointerdown', { pointerId: 2, clientX: 300, clientY: 200 });
    // 두 손가락이 나란히 오른쪽 아래로 — 거리는 그대로이므로 배율은 안 변하고 화면만 옮겨진다.
    // 두 점을 **같은 delta**로 옮긴다(거리 불변 = 순수 이동).
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 260, clientY: 245 });
    firePointer(layer, 'pointermove', { pointerId: 2, clientX: 350, clientY: 240 });
    await waitFor(() => expect(panLayer().style.transform).not.toBe(before));
    // 거리가 그대로면 배율도 그대로 — 바뀐 것은 이동(translate)뿐이다.
    const scaleOf = (t: string): string => /scale\(([^)]+)\)/.exec(t)?.[1] ?? '';
    expect(scaleOf(panLayer().style.transform)).toBe(scaleOf(before));

    firePointer(layer, 'pointerup', { pointerId: 2, clientX: 350, clientY: 240 });
    // 남은 손가락이 움직여도 이어서 그리지 않는다(화면을 옮기다 낙서가 생기면 안 된다).
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
    firePointer(layer, 'pointerup', { pointerId: 1, clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b16') || 'null');
      expect(saved?.strokes ?? []).toHaveLength(0);
    });
    expect(container.querySelector('[data-stroke-id]')).toBeNull();
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

  it('모바일 board: 도구 막대는 바닥 전폭, 되돌리기·미니맵은 그 위 띠(시안)', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_b12', JSON.stringify(BOARD));
      const { container } = renderEditor('/editor?map=b12&title=x');
      await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());

      // 막대 = 바닥 전폭 한 줄(선택·펜·형광펜·지우개 | 삽입).
      const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;
      expect(bar.style.left).toBe('12px');
      expect(bar.style.right).toBe('12px');
      expect(bar.style.bottom).toBe('16px');
      expect(bar.style.transform).toBe(''); // 중앙 정렬(50%)이 아니다
      expect(within(bar).getByRole('button', { name: '선택' })).toBeTruthy();
      // 삽입 넷은 폰 폭에 한 줄로 들어가지 않는다 — 진입(＋) 하나만 두고 메뉴로 전환.
      expect(within(bar).getByRole('button', { name: '삽입' })).toBeTruthy();
      expect(within(bar).queryByRole('button', { name: '이미지 추가' })).toBeNull();
      // 되돌리기는 막대에서 빠져 자기 알약으로 — 같은 띠 왼쪽.
      expect(within(bar).queryByRole('button', { name: '실행 취소' })).toBeNull();
      const undoPill = container.querySelector('[data-board-undo]') as HTMLElement;
      expect(undoPill.style.left).toBe('12px');
      expect(undoPill.style.bottom).toBe('80px');
      expect(within(undoPill).getByRole('button', { name: '다시 실행' })).toBeTruthy();

      // 도구(4: 선택·펜·형광펜·지우개)와 삽입 진입(1) 사이에 구분선이 하나 선다(요청).
      const layer = bar.querySelector('div[style*="position: absolute"]') as HTMLElement;
      const kinds = Array.from(layer.children).map((el) => el.tagName);
      expect(kinds).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'DIV', 'BUTTON']);
      expect(layer.style.justifyContent).toBe('space-evenly'); // 양 끝 여백까지 균일

      // 줌·미니맵 묶음은 우측이되, 막대 높이만큼 올라앉는다. 폰에서는 미니맵만 —
      // 아래 버튼 줄(최소화·화면 맞춤)은 두지 않는다(요청).
      const cluster = container.querySelector('[data-zoom-cluster]') as HTMLElement;
      expect(cluster.style.right).toBe('16px');
      expect(cluster.style.bottom).toBe('80px');
      expect(cluster.style.top).toBe('');
      expect(within(cluster).queryByTitle('화면 맞춤')).toBeNull();
      expect(within(cluster).queryByTitle('미니맵 표시/숨기기')).toBeNull();
    } finally {
      restore();
    }
  });

  it('모바일 board: 펜을 누르면 막대가 색·굵기 메뉴로 전환되고 ‹로 돌아온다(요청)', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_b14', JSON.stringify(BOARD));
      const { container } = renderEditor('/editor?map=b14&title=x');
      const bar = await waitFor(() => {
        const el = container.querySelector('[data-board-toolbar]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      fireEvent.click(within(bar).getByRole('button', { name: '펜' }));

      // 전환: 도구 목록 대신 뒤로·색·굵기. 행이 늘지 않는다(바닥이 두꺼워지지 않게).
      await waitFor(() => expect(bar.getAttribute('data-pen-panel')).toBe('true'));
      // 밀어내기 애니메이션 — 들어오는 층은 오른쪽에서, 나가는 도구 목록은 왼쪽으로.
      expect(bar.querySelector('.mf-board-in-right')).toBeTruthy();
      expect(bar.querySelector('.mf-board-out-left')).toBeTruthy();
      expect(within(bar).getByRole('button', { name: '도구 목록으로' })).toBeTruthy();
      expect(within(bar).getByRole('button', { name: '펜 색 #d92626' })).toBeTruthy();
      expect(within(bar).getByRole('button', { name: '펜 굵기 8' })).toBeTruthy();
      expect(within(bar).queryByRole('button', { name: '지우개' })).toBeNull();

      // ‹ = 메뉴 전환일 뿐, 펜은 그대로 켜져 있다. 방향도 반대(오른쪽으로 밀려 나간다).
      fireEvent.click(within(bar).getByRole('button', { name: '도구 목록으로' }));
      await waitFor(() => expect(bar.getAttribute('data-pen-panel')).toBeNull());
      expect(bar.querySelector('.mf-board-in-left')).toBeTruthy();
      expect(bar.querySelector('.mf-board-out-right')).toBeTruthy();
      expect(within(bar).getByRole('button', { name: '펜' }).getAttribute('aria-pressed')).toBe('true');

      // 다른 도구로 가면 펜 메뉴는 저절로 닫힌 상태를 유지한다.
      fireEvent.click(within(bar).getByRole('button', { name: '지우개' }));
      expect(bar.getAttribute('data-pen-panel')).toBeNull();
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
  // ── 하이라이터 + 획 선택·이동 ─────────────────────────────────────────────

  it('형광펜은 반투명·곱하기로 그려지고 저장본에 hl 표시가 남는다', async () => {
    localStorage.setItem('mindflow_doc_b15', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b15&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '형광펜' }));
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(layer, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    firePointer(layer, 'pointermove', { pointerId: 1, clientX: 260, clientY: 200 });
    firePointer(layer, 'pointerup', { pointerId: 1, clientX: 260, clientY: 200 });

    const path = await waitFor(() => {
      const el = container.querySelector('[data-stroke-id]') as SVGPathElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 화면: 반투명 + 곱하기 합성(형광펜은 밑을 가리는 게 아니라 걸러 낸다).
    expect(path.getAttribute('data-stroke-hl')).toBe('1');
    expect(Number(path.getAttribute('opacity'))).toBeCloseTo(HL_OPACITY, 3);
    expect(path.style.mixBlendMode).toBe('multiply');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b15') || 'null');
      expect(saved?.strokes?.[0]?.hl).toBe(true);
      expect(HL_COLORS).toContain(saved.strokes[0].color);
      expect(HL_WIDTHS).toContain(saved.strokes[0].w);
    });

    // 펜으로 돌아오면 펜의 색·굵기 그대로 — 형광펜 설정이 펜을 물들이지 않는다.
    fireEvent.click(screen.getByRole('button', { name: '펜' }));
    firePointer(layer, 'pointerdown', { pointerId: 2, clientX: 300, clientY: 300 });
    firePointer(layer, 'pointermove', { pointerId: 2, clientX: 340, clientY: 300 });
    firePointer(layer, 'pointerup', { pointerId: 2, clientX: 340, clientY: 300 });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b15') || 'null');
      const pen = saved.strokes[1];
      expect(pen.hl).toBeUndefined();
      expect(pen.color).toBe(PEN_COLORS[0]);
      expect(pen.w).toBe(4);
    });
  });

  it('H 단축키로 형광펜, P로 펜 — 옵션 줄이 그 도구의 팔레트로 바뀐다', async () => {
    localStorage.setItem('mindflow_doc_b16', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b16&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
    await waitFor(() => expect(screen.getByRole('button', { name: '형광펜' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: `형광펜 색 ${HL_COLORS[0]}` })).toBeTruthy();
    expect(container.querySelector('[data-board-draw-layer]')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await waitFor(() => expect(screen.getByRole('button', { name: '펜' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: `펜 색 ${PEN_COLORS[0]}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: `형광펜 색 ${HL_COLORS[0]}` })).toBeNull();
  });

  it('선택 도구로 획을 집으면 선택 상자·속성 패널이 뜨고, 끌면 그 획만 움직인다', async () => {
    localStorage.setItem(
      'mindflow_doc_b17',
      JSON.stringify({ ...BOARD, floats: [], strokes: [{ id: 's1', pts: [0, 0, 40, 0], color: '#2b2b2b', w: 4 }] }),
    );
    const { container } = renderEditor('/editor?map=b17&title=x');
    await waitFor(() => expect(container.querySelector('[data-stroke-id="s1"]')).toBeTruthy());

    const vp = getViewport(container);
    const at = strokePoint(container, 20, 0);
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: at.x, clientY: at.y });
    // 선택 표시(획에는 손잡이가 없다) + 속성 패널.
    await waitFor(() => expect(container.querySelector('[data-stroke-selection]')).toBeTruthy());
    expect(screen.getByText('선택한 그림')).toBeTruthy();

    // 그대로 끌면 획이 따라온다 — 커밋은 문서 좌표로.
    firePointer(document.body, 'pointermove', { pointerId: 1, clientX: at.x + 60, clientY: at.y + 40 });
    firePointer(document.body, 'pointerup', { pointerId: 1, clientX: at.x + 60, clientY: at.y + 40 });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    const moved = await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b17') || 'null');
      expect(saved.strokes[0].pts[0]).toBeGreaterThan(0);
      return saved.strokes[0].pts as number[];
    });
    // 모든 점이 같은 만큼 옮겨진다(모양 불변).
    expect(moved[2]! - moved[0]!).toBeCloseTo(40, 1);
    expect(moved[1]).toBeCloseTo(moved[3]!, 1);

    // Delete = 그 획만 삭제.
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelector('[data-stroke-id="s1"]')).toBeNull());
  });

  it('속성 패널에서 획의 색·굵기를 고칠 수 있다(형광펜은 형광 팔레트)', async () => {
    localStorage.setItem(
      'mindflow_doc_b18',
      JSON.stringify({ ...BOARD, floats: [], strokes: [{ id: 's1', pts: [0, 0, 40, 0], color: HL_COLORS[0], w: HL_WIDTHS[1], hl: true }] }),
    );
    const { container } = renderEditor('/editor?map=b18&title=x');
    await waitFor(() => expect(container.querySelector('[data-stroke-id="s1"]')).toBeTruthy());

    const at = strokePoint(container, 20, 0);
    firePointer(getViewport(container), 'pointerdown', { pointerId: 1, clientX: at.x, clientY: at.y });
    firePointer(document.body, 'pointerup', { pointerId: 1, clientX: at.x, clientY: at.y });
    await screen.findByText('형광펜 획');

    // 팔레트는 그 획을 그린 도구의 것 — 형광펜 획에 검정 2px을 제안하지 않는다.
    const swatches = Array.from(container.querySelectorAll('button')).filter((b) => (b as HTMLElement).style.borderRadius === '50%');
    const pick = swatches.find((b) => rgbHex((b as HTMLElement).style.background) === HL_COLORS[2]!.toLowerCase());
    expect(pick).toBeTruthy();
    expect(swatches.some((b) => rgbHex((b as HTMLElement).style.background) === PEN_COLORS[0]!.toLowerCase())).toBe(false);
    fireEvent.click(pick!);
    fireEvent.click(screen.getByTitle(`굵기 ${HL_WIDTHS[2]}`));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b18') || 'null');
      expect(saved.strokes[0].color).toBe(HL_COLORS[2]);
      expect(saved.strokes[0].w).toBe(HL_WIDTHS[2]);
      expect(saved.strokes[0].hl).toBe(true);
    });
  });
  it('폰: 획을 탭하면 선택 바가 속성·삭제만 내준다(편집·메뉴는 할 일이 없다)', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem(
        'mindflow_doc_b19',
        JSON.stringify({ ...BOARD, floats: [], strokes: [{ id: 's1', pts: [0, 0, 40, 0], color: '#2b2b2b', w: 4 }] }),
      );
      const { container } = renderEditor('/editor?map=b19&title=x');
      await waitFor(() => expect(container.querySelector('[data-stroke-id="s1"]')).toBeTruthy());

      const at = strokePoint(container, 20, 0);
      const vp = getViewport(container);
      // (jsdom엔 PointerEvent가 없어 MouseEvent로 대신 던진다 — 여기서 보는 것은
      //  선택 후 **바의 구성**이다. 터치 첫 탭=선택 규칙 자체는 실기기 몫.)
      firePointer(vp, 'pointerdown', { pointerId: 1, clientX: at.x, clientY: at.y });
      firePointer(document.body, 'pointerup', { pointerId: 1, clientX: at.x, clientY: at.y });
      const bar = await waitFor(() => {
        const el = container.querySelector('[role="toolbar"][aria-label="선택 동작"]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      expect(within(bar).getByText('속성')).toBeTruthy();
      expect(within(bar).getByText('삭제')).toBeTruthy();
      expect(within(bar).queryByText('편집')).toBeNull();
      expect(within(bar).queryByRole('button', { name: '객체 메뉴' })).toBeNull();

      fireEvent.click(within(bar).getByText('삭제'));
      await waitFor(() => expect(container.querySelector('[data-stroke-id="s1"]')).toBeNull());
    } finally {
      restore();
    }
  });
  // ── 스티커 반응·점 투표 ───────────────────────────────────────────────────

  it('메모를 고르면 반응 추가 버튼이 뜨고, 고른 표가 칩으로 남는다(저장·토글)', async () => {
    localStorage.setItem('mindflow_doc_b20', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b20&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="bf1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // 고르지 않았으면 아무 것도 없다(빈 캔버스에 (+)가 떠 있으면 소음).
    expect(container.querySelector('[data-reaction-row]')).toBeNull();

    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    const add = await waitFor(() => {
      const el = container.querySelector('[data-reaction-add]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    // (+) → 투표 점을 고른다.
    fireEvent.click(add);

    const pick = await waitFor(() => {
      const el = container.querySelector(`[data-reaction-pick="${VOTE_EMOJI}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(pick);

    const chip = await waitFor(() => {
      const el = container.querySelector(`[data-reaction="${VOTE_EMOJI}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(chip.textContent).toContain('1');
    expect(chip.getAttribute('data-mine')).toBe('1'); // 내 표 표시

    // 저장본에 항목 하나로 남는다(한 표 = 한 항목).
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b20') || 'null');
      expect(saved.reactions).toHaveLength(1);
      expect(saved.reactions[0]).toMatchObject({ target: 'bf1', emoji: VOTE_EMOJI, by: 'me@example.com' });
    });

    // 다시 누르면 내 표만 빠지고 칩이 사라진다.
    fireEvent.click(chip);
    await waitFor(() => expect(container.querySelector(`[data-reaction="${VOTE_EMOJI}"]`)).toBeNull());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b20') || 'null');
      expect(saved.reactions === undefined || saved.reactions.length === 0).toBe(true);
    });
  });

  it('남이 던진 표는 선택하지 않아도 보이고, 내 표가 아니면 mine 표시가 없다', async () => {
    localStorage.setItem(
      'mindflow_doc_b21',
      JSON.stringify({ ...BOARD, reactions: [{ id: 'r1', target: 'bf1', by: 'friend@example.com', byName: '친구', emoji: '👍' }] }),
    );
    const { container } = renderEditor('/editor?map=b21&title=x');
    const chip = await waitFor(() => {
      const el = container.querySelector('[data-reaction="👍"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(chip.textContent).toContain('1');
    expect(chip.getAttribute('data-mine')).toBeNull();
    expect(chip.getAttribute('title')).toBe('친구'); // 누가 눌렀는지 툴팁

    // 내가 같은 이모지를 누르면 2가 되고 내 표 표시가 붙는다(항목이 하나 더 생긴다).
    fireEvent.click(chip);
    await waitFor(() => {
      const c = container.querySelector('[data-reaction="👍"]') as HTMLElement;
      expect(c.textContent).toContain('2');
      expect(c.getAttribute('data-mine')).toBe('1');
    });
  });

  it('메모를 지우면 그 메모의 반응도 함께 사라진다(고아 정리)', async () => {
    localStorage.setItem(
      'mindflow_doc_b22',
      JSON.stringify({ ...BOARD, reactions: [{ id: 'r1', target: 'bf1', by: 'a@x', emoji: '👍' }] }),
    );
    const { container } = renderEditor('/editor?map=b22&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="bf1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelector('[data-float-id="bf1"]')).toBeNull());

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b22') || 'null');
      expect(saved.reactions === undefined || saved.reactions.length === 0).toBe(true);
    });
  });

  it('맵(마인드맵)의 메모에는 반응이 붙지 않는다 — 보드의 어휘다', async () => {
    localStorage.setItem(
      'mindflow_doc_m2',
      JSON.stringify({
        v: 1,
        nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
        floats: [{ id: 'mf1', x: -300, y: 0, w: 180, text: '메모' }],
        lines: [],
        zones: [],
        layoutMode: 'right',
        themeKey: 'coral',
      }),
    );
    const { container } = renderEditor('/editor?map=m2&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="mf1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    await waitFor(() => expect(container.querySelector('[data-float-id="mf1"]')).toBeTruthy());
    expect(container.querySelector('[data-reaction-add]')).toBeNull();
  });
  it('한글 확정 Shift+Enter는 한 줄만 내려간다 — 같은 Enter가 두 번 와도(제보)', async () => {
    localStorage.setItem('mindflow_doc_b23', JSON.stringify({ ...BOARD, floats: [{ id: 'f1', x: 0, y: 0, w: 300, text: '첫줄' }] }));
    const { container } = renderEditor('/editor?map=b23&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="f1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.doubleClick(floatEl);
    const box = await waitFor(() => {
      const el = container.querySelector('.mf-richedit') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 캐럿을 맨 끝으로(한글을 치던 상태)
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(box);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);

    // 한글 IME: 마지막 글자가 조합 중일 때 Shift+Enter → 조합 확정 → **같은 Enter가
    // 평범한 keydown으로 한 번 더**(브라우저·IME 조합에 따라 온다). 한 번만 내려가야 한다.
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true, isComposing: true });
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });

    await waitFor(() => expect(box.innerHTML).toContain('<br>'));
    // 값 `첫줄\n` = `첫줄<br>` + 빈 마지막 줄용 placeholder `<br>` → br 2개.
    // 두 줄 내려가면(`첫줄\n\n`) br이 3개가 된다.
    expect(box.innerHTML.match(/<br>/g)?.length).toBe(2);
  });
  it('반응 칩의 내 표 표시는 은은하다 — 강조색 반투명 테두리·옅은 배경(제보)', async () => {
    localStorage.setItem(
      'mindflow_doc_b24',
      JSON.stringify({ ...BOARD, reactions: [{ id: 'r1', target: 'bf1', by: 'me@example.com', emoji: '👍' }] }),
    );
    const { container } = renderEditor('/editor?map=b24&title=x');
    const chip = await waitFor(() => {
      const el = container.querySelector('[data-reaction="👍"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(chip.getAttribute('data-mine')).toBe('1');
    // 배경·테두리 모두 반투명(rgba) — 불투명 강조색으로 칠하면 메모 옆에서 과하게 튄다.
    expect(chip.style.background).toMatch(/rgba\(/);
    expect(chip.style.border).toMatch(/rgba\(/);
    const alpha = (v: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(v)?.[1] ?? '1');
    expect(alpha(chip.style.background)).toBeLessThanOrEqual(0.08);
    expect(alpha(chip.style.border)).toBeLessThanOrEqual(0.5);
  });

  // ── 연결선(화살표)·영역(프레임) — 보드 어휘 편입(요청) ────────────────────
  it('보드 도구 막대에서 연결선·영역을 만들면 문서에 커밋되고 속성 패널이 뜬다', async () => {
    localStorage.setItem('mindflow_doc_b25', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b25&title=x');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());
    const bar = container.querySelector('[data-board-toolbar]') as HTMLElement;

    fireEvent.click(within(bar).getByRole('button', { name: '연결선 추가' }));
    await waitFor(() => expect(container.querySelector('[data-line-id]')).toBeTruthy());
    // 만든 직후 그것이 선택돼 속성 패널이 연결선 패널이 된다(선 스타일·화살표).
    expect(await screen.findByText('선 스타일')).toBeTruthy();

    fireEvent.click(within(bar).getByRole('button', { name: '영역 추가' }));
    await waitFor(() => expect(container.querySelector('[data-zone-id]')).toBeTruthy());

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b25') || 'null');
      expect(saved?.kind).toBe('board');
      expect(saved?.lines).toHaveLength(1);
      expect(saved?.zones).toHaveLength(1);
    });
  });

  it('미니맵과 화면 맞춤이 영역·연결선도 감싼다 — 프레임만 있는 보드도 지도에 뜬다', async () => {
    // 메모 없이 영역 하나 + 연결선 하나뿐인 보드: 예전 미니맵은 "노드도 메모도
    // 없다"며 통째로 사라졌다(화면에는 보이는데 지도에는 없다).
    localStorage.setItem(
      'mindflow_doc_b26',
      JSON.stringify({
        ...BOARD,
        floats: [],
        zones: [{ id: 'z1', x: -200, y: -140, w: 320, h: 220, label: '프레임', color: null }],
        lines: [{ id: 'l1', x1: 60, y1: 40, x2: 260, y2: 160, startArrow: false, endArrow: true, dashed: false, c1: 0, c2: 0, label: '' }],
      }),
    );
    const { container } = renderEditor('/editor?map=b26&title=x');
    await waitFor(() => expect(container.querySelector('[data-testid="minimap"]')).toBeTruthy());
    const map = container.querySelector('[data-testid="minimap"]') as HTMLElement;
    expect(map.querySelector('[data-minimap-zone="z1"]')).toBeTruthy();
    expect(map.querySelector('[data-minimap-line="l1"]')).toBeTruthy();
  });

  it('폰 board: 삽입(＋)을 누르면 막대가 네 가지 삽입 메뉴로 전환되고, 고르면 도구 목록으로 돌아온다', async () => {
    const restore = mockMatchMedia(true);
    try {
      localStorage.setItem('mindflow_doc_b27', JSON.stringify(BOARD));
      const { container } = renderEditor('/editor?map=b27&title=x');
      const bar = await waitFor(() => {
        const el = container.querySelector('[data-board-toolbar]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });

      fireEvent.click(within(bar).getByRole('button', { name: '삽입' }));
      await waitFor(() => expect(bar.getAttribute('data-board-panel')).toBe('insert'));
      expect(within(bar).getByRole('button', { name: '도구 목록으로' })).toBeTruthy();
      ['메모 추가', '이미지 추가', '연결선 추가', '영역 추가'].forEach((n) => {
        expect(within(bar).getByRole('button', { name: n })).toBeTruthy();
      });
      expect(within(bar).queryByRole('button', { name: '지우개' })).toBeNull();

      // 골라 넣으면 도구 목록으로 되돌아온다 — 방금 만든 것을 바로 만진다.
      fireEvent.click(within(bar).getByRole('button', { name: '영역 추가' }));
      await waitFor(() => expect(container.querySelector('[data-zone-id]')).toBeTruthy());
      await waitFor(() => expect(bar.getAttribute('data-board-panel')).toBe('tools'));
    } finally {
      restore();
    }
  });

  it('영역은 시각이 **맨 위**, 포인터는 아래 판이 받는다 — 안의 객체 클릭이 살아 있다(요청)', () => {
    localStorage.setItem(
      'mindflow_doc_b28',
      JSON.stringify({ ...BOARD, zones: [{ id: 'z1', x: -300, y: -200, w: 600, h: 400, label: '프레임', color: null }] }),
    );
    const { container } = renderEditor('/editor?map=b28&title=x');
    const visual = container.querySelector('[data-zone-id="z1"]') as HTMLElement;
    const hit = container.querySelector('[data-zone-hit="z1"]') as HTMLElement;
    expect(visual).toBeTruthy();
    expect(hit).toBeTruthy();
    // 테두리·라벨 판은 잉크(90)보다 위 + 포인터를 받지 않는다.
    expect(Number(visual.style.zIndex)).toBeGreaterThan(STROKE_Z);
    expect(visual.style.pointerEvents).toBe('none');
    // 올라가는 건 **테두리뿐** — 면(7%)까지 위로 오면 그 안의 노란 스티커·잉크가
    // 통째로 물든다. 면은 아래 판이 그린다.
    expect(visual.style.background).toBe('transparent');
    expect(visual.style.border).toContain('dashed');
    expect(hit.style.background).toMatch(/rgba\(/);
    // 면·히트 판은 콘텐츠(메모 10 · 주제 40)보다 아래 — 안의 객체가 먼저 잡힌다.
    expect(Number(hit.style.zIndex)).toBeLessThan(10);
    // 같은 자리·같은 크기여야 "보이는 대로 잡힌다".
    expect([hit.style.left, hit.style.top, hit.style.width, hit.style.height]).toEqual([visual.style.left, visual.style.top, visual.style.width, visual.style.height]);
  });

  it('마퀴로 획을 여러 개 고르면 선택 상자·다중 패널이 뜨고 한 번에 지워진다(요청)', async () => {
    localStorage.setItem(
      'mindflow_doc_b29',
      JSON.stringify({
        ...BOARD,
        floats: [],
        strokes: [
          { id: 's1', pts: [-100, -60, -60, -20], color: '#d92626', w: 4 },
          { id: 's2', pts: [20, -60, 60, -20], color: '#1a1a1a', w: 8 },
          { id: 's3', pts: [400, 400, 440, 440], color: '#1a1a1a', w: 2 }, // 마퀴 밖
        ],
      }),
    );
    const { container } = renderEditor('/editor?map=b29&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-id]')).toHaveLength(3));

    // 배경 드래그(마퀴)로 앞의 두 획을 감싼다.
    const vp = getViewport(container);
    const a = strokePoint(container, -160, -120);
    const b = strokePoint(container, 120, 40);
    firePointer(vp, 'pointerdown', { pointerId: 5, clientX: a.x, clientY: a.y, button: 0 });
    firePointer(document.body, 'pointermove', { pointerId: 5, clientX: b.x, clientY: b.y });
    firePointer(document.body, 'pointerup', { pointerId: 5, clientX: b.x, clientY: b.y });

    // 두 획에 점선 선택 상자가 뜬다(획에는 손잡이가 없다).
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-selection]')).toHaveLength(2));
    // 속성 패널은 다중 — 색·굵기 중 활성(aria-pressed)인 것이 없다(값이 섞여 있다).
    const panel = (await screen.findByText('그림 2개 선택됨')).parentElement!.parentElement!;
    // 값이 섞여 있을 수 있으므로 색·굵기 중 어느 것도 활성으로 표시하지 않는다.
    expect(panel.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);

    // 삭제는 단일·다중 관계없이 — 고른 둘만 사라진다.
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-id]')).toHaveLength(1));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b29') || 'null');
      expect(saved?.strokes.map((s: { id: string }) => s.id)).toEqual(['s3']);
    });
  });

  it('마퀴가 획을 하나만 물면 단일 선택으로 정규화된다(유령 상태 방지)', async () => {
    localStorage.setItem(
      'mindflow_doc_b30',
      JSON.stringify({ ...BOARD, floats: [], strokes: [{ id: 's1', pts: [-100, -60, -60, -20], color: '#d92626', w: 4 }] }),
    );
    const { container } = renderEditor('/editor?map=b30&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-id]')).toHaveLength(1));

    const vp = getViewport(container);
    const a = strokePoint(container, -160, -120);
    const b = strokePoint(container, 0, 40);
    firePointer(vp, 'pointerdown', { pointerId: 6, clientX: a.x, clientY: a.y, button: 0 });
    firePointer(document.body, 'pointermove', { pointerId: 6, clientX: b.x, clientY: b.y });
    firePointer(document.body, 'pointerup', { pointerId: 6, clientX: b.x, clientY: b.y });

    // 단일 선택 패널(제목이 "선택한 그림")이고, Delete가 그대로 듣는다.
    expect(await screen.findByText('펜 획')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(container.querySelectorAll('[data-stroke-id]')).toHaveLength(0));
  });
  // ── 정렬·분배(요청) ───────────────────────────────────────────────────────
  it('다중 선택 우클릭 → 정렬 ▸ 로 메모들을 줄 맞추고 간격을 균등하게 한다', async () => {
    localStorage.setItem(
      'mindflow_doc_b31',
      JSON.stringify({
        ...BOARD,
        floats: [
          { id: 'f1', x: -300, y: -160, w: 160, h: 80, text: '하나' },
          { id: 'f2', x: -60, y: -60, w: 200, h: 80, text: '둘' },
          { id: 'f3', x: 260, y: 40, w: 120, h: 80, text: '셋' },
        ],
      }),
    );
    const { container } = renderEditor('/editor?map=b31&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(3));

    // Ctrl+A로 셋 다 고른다.
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    await waitFor(() => expect(screen.getByText(/메모 3개 선택됨|3개 선택됨/)).toBeTruthy());

    // 다중 선택 위에서 우클릭 → 정렬 플라이아웃.
    // 우클릭 지점은 f1의 **중심**(캔버스 좌표 → 클라이언트)으로 잡는다 — 다중 선택
    // 메뉴는 "선택 안의 객체 위"에서만 뜨므로 좌표가 빗나가면 다른 메뉴가 열린다.
    const p1 = strokePoint(container, -220, -120);
    fireEvent.contextMenu(container.querySelector('[data-float-id="f1"]')!, { clientX: p1.x, clientY: p1.y });
    fireEvent.mouseDown(await screen.findByText('정렬'));
    const flyout = await waitFor(() => {
      const el = container.querySelector('[data-arrange-flyout]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    fireEvent.mouseDown(flyout.querySelector('[data-arrange="top"]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b31') || 'null');
      // 위쪽 맞춤 — 셋 다 가장 위(-160)에 선다. x는 그대로.
      expect(saved.floats.map((f: { y: number }) => f.y)).toEqual([-160, -160, -160]);
      expect(saved.floats.map((f: { x: number }) => f.x)).toEqual([-300, -60, 260]);
    });

    // 이어서 가로 간격 균등 — 양 끝은 고정되고 가운데가 옮겨진다.
    const p2 = strokePoint(container, -220, -120);
    fireEvent.contextMenu(container.querySelector('[data-float-id="f1"]')!, { clientX: p2.x, clientY: p2.y });
    fireEvent.mouseDown(await screen.findByText('정렬'));
    const fly2 = container.querySelector('[data-arrange-flyout]') as HTMLElement;
    fireEvent.mouseDown(fly2.querySelector('[data-arrange="hspace"]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b31') || 'null');
      const by = Object.fromEntries(saved.floats.map((f: { id: string; x: number; w: number }) => [f.id, f]));
      expect(by.f1.x).toBe(-300); // 양 끝 고정
      expect(by.f3.x).toBe(260);
      const gap1 = by.f2.x - (by.f1.x + by.f1.w);
      const gap2 = by.f3.x - (by.f2.x + by.f2.w);
      expect(gap1).toBeCloseTo(gap2, 6);
    });
  });

  it('둘만 고르면 "간격 균등"은 나오지 않는다 — 둘은 이미 균등하다', async () => {
    localStorage.setItem(
      'mindflow_doc_b32',
      JSON.stringify({
        ...BOARD,
        floats: [
          { id: 'f1', x: -300, y: -160, w: 160, h: 80, text: '하나' },
          { id: 'f2', x: -60, y: -60, w: 200, h: 80, text: '둘' },
          { id: 'far', x: 900, y: 700, w: 120, h: 80, text: '멀리' },
        ],
      }),
    );
    const { container } = renderEditor('/editor?map=b32&title=x');
    await waitFor(() => expect(container.querySelectorAll('[data-float-id]')).toHaveLength(3));

    // 마퀴로 앞의 둘만 담는다(멀리 있는 메모는 사각 밖).
    const vp = getViewport(container);
    const a = strokePoint(container, -360, -220);
    const b = strokePoint(container, 200, 60);
    firePointer(vp, 'pointerdown', { pointerId: 31, clientX: a.x, clientY: a.y, button: 0 });
    firePointer(document.body, 'pointermove', { pointerId: 31, clientX: b.x, clientY: b.y });
    firePointer(document.body, 'pointerup', { pointerId: 31, clientX: b.x, clientY: b.y });
    await screen.findByText(/2개 선택됨/);

    const p3 = strokePoint(container, -220, -120);
    fireEvent.contextMenu(container.querySelector('[data-float-id="f1"]')!, { clientX: p3.x, clientY: p3.y });
    fireEvent.mouseDown(await screen.findByText('정렬'));
    const flyout = await waitFor(() => {
      const el = container.querySelector('[data-arrange-flyout]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(flyout.querySelector('[data-arrange="left"]')).toBeTruthy();
    expect(flyout.querySelector('[data-arrange="hspace"]')).toBeNull();
    expect(flyout.querySelector('[data-arrange="vspace"]')).toBeNull();
  });
  it('격자 스냅 — 메모를 끌면 좌표가 격자에 붙고, 보기 메뉴에서 끄면 그대로다(요청)', async () => {
    localStorage.setItem(
      'mindflow_doc_b33',
      JSON.stringify({ ...BOARD, floats: [{ id: 'f1', x: 0, y: 0, w: 200, h: 90, text: '스티커' }] }),
    );
    const { container } = renderEditor('/editor?map=b33&title=x');
    const el = await waitFor(() => {
      const found = container.querySelector('[data-float-id="f1"]') as HTMLElement;
      expect(found).toBeTruthy();
      return found;
    });

    // 격자(10)에 붙는다 — 화면상 37px 끌면 캔버스 이동량이 얼마든 10의 배수에 선다.
    const zoom = Number(/scale\(([\d.]+)\)/.exec((container.querySelector('[data-pan-layer]') as HTMLElement).style.transform || '')?.[1] ?? 1);
    firePointer(el, 'pointerdown', { pointerId: 41, clientX: 100, clientY: 100, button: 0 });
    firePointer(document.body, 'pointermove', { pointerId: 41, clientX: 100 + 37 * zoom, clientY: 100 + 23 * zoom });
    firePointer(document.body, 'pointerup', { pointerId: 41, clientX: 100 + 37 * zoom, clientY: 100 + 23 * zoom });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b33') || 'null');
      expect(saved.floats[0].x % 10).toBe(0);
      expect(saved.floats[0].y % 10).toBe(0);
      expect(saved.floats[0].x).toBe(40); // 37 → 40
      expect(saved.floats[0].y).toBe(20); // 23 → 20
    });

    // 보기 메뉴에서 끄면 끌린 그대로 남는다.
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    fireEvent.click(await screen.findByRole('button', { name: '격자에 맞추기' }));
    firePointer(el, 'pointerdown', { pointerId: 42, clientX: 100, clientY: 100, button: 0 });
    firePointer(document.body, 'pointermove', { pointerId: 42, clientX: 100 + 3 * zoom, clientY: 100 + 2 * zoom });
    firePointer(document.body, 'pointerup', { pointerId: 42, clientX: 100 + 3 * zoom, clientY: 100 + 2 * zoom });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b33') || 'null');
      expect(saved.floats[0].x).toBe(43);
      expect(saved.floats[0].y).toBe(22);
    });
  });

  it('드래그 중 Alt를 누르고 있으면 스냅이 꺼진다(미세 조정 탈출구)', async () => {
    localStorage.setItem(
      'mindflow_doc_b34',
      JSON.stringify({ ...BOARD, floats: [{ id: 'f1', x: 0, y: 0, w: 200, h: 90, text: '스티커' }] }),
    );
    const { container } = renderEditor('/editor?map=b34&title=x');
    const el = await waitFor(() => {
      const found = container.querySelector('[data-float-id="f1"]') as HTMLElement;
      expect(found).toBeTruthy();
      return found;
    });
    const zoom = Number(/scale\(([\d.]+)\)/.exec((container.querySelector('[data-pan-layer]') as HTMLElement).style.transform || '')?.[1] ?? 1);
    firePointer(el, 'pointerdown', { pointerId: 43, clientX: 100, clientY: 100, button: 0 });
    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 100 + 37 * zoom, clientY: 100 + 23 * zoom, altKey: true });
    Object.defineProperty(move, 'pointerId', { value: 43, configurable: true });
    fireEvent(document.body, move);
    firePointer(document.body, 'pointerup', { pointerId: 43, clientX: 100 + 37 * zoom, clientY: 100 + 23 * zoom });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b34') || 'null');
      expect(saved.floats[0].x).toBe(37);
      expect(saved.floats[0].y).toBe(23);
    });
  });
});
