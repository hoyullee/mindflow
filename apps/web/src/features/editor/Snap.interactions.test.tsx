import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

/**
 * 맞춤(격자·안내선)을 **고스트로 끄는 두 경로**까지 넓힌 것(요청).
 *
 * 메모·이미지·영역은 매 이동마다 실물을 커밋하므로 그 좌표를 맞추면 끝이지만,
 * 자유 주제(`node-move`)와 그룹 드래그는 **점선 고스트로 끌고 놓는 순간 한 번**
 * 커밋한다. 그래서 두 지점(끄는 동안의 고스트 / 놓을 때의 커밋)이 **같은 함수**를
 * 지나야 한다 — 갈리면 놓는 순간 자리가 튄다. 여기서 보는 것이 그 계약이다.
 *
 * 주제의 x/y는 **중심**이라(메모는 좌상단) 단정은 언제나 렌더된 상자의 **왼쪽 끝**으로
 * 한다 — 앱이 실제로 그린 기하를 읽으므로 이 테스트가 측정 코드를 다시 구현하지 않는다.
 */

const NODE = (id: string, x: number, y: number, text: string) => ({
  id,
  text,
  emoji: '',
  parent: null,
  children: [],
  collapsed: false,
  color: null,
  x,
  y,
  free: true,
});

const DOC = {
  v: 1,
  nodes: {
    root: { ...NODE('root', 0, 0, '루트'), free: false },
    fx: NODE('fx', 600, 300, '끌 주제'),
    // y를 fx와 다르게 둔다 — 같은 높이면 fy의 위쪽 변이 fx와 같은 줄이라
    // 세로축까지 안내선이 잡아, 격자 폴백을 볼 수 없다(그 자체는 맞는 동작).
    fy: NODE('fy', 1000, 700, '같이 끌 주제'),
  },
  // 기준이 되는 이웃. 왼쪽 끝 23은 **격자(10)의 배수가 아니다** — 여기 붙으면
  // 격자가 아니라 안내선이 이겼다는 뜻이 된다.
  floats: [{ id: 'ref', x: 23, y: -300, w: 200, h: 90, text: '기준 메모' }],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

function renderEditor(map: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor?map=${map}&title=x`]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** jsdom에는 PointerEvent가 없어 fireEvent.pointerDown이 좌표·수정 키를 떨어뜨린다. */
function firePointer(
  target: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { pointerId?: number; clientX?: number; clientY?: number; button?: number; shiftKey?: boolean; altKey?: boolean } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

/** 팬 레이어의 transform에서 읽는 화면 변환 — 캔버스 좌표를 클라이언트 좌표로 옮기는 데 쓴다.
 * jsdom의 `getBoundingClientRect()`는 0이므로 `toCanvasPoint`가 하는 계산과 정확히 맞는다. */
function panZoom(container: HTMLElement): { px: number; py: number; zoom: number } {
  const t = (container.querySelector('[data-pan-layer]') as HTMLElement).style.transform || '';
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(t);
  if (!m) throw new Error(`pan layer transform not parsed: ${t}`);
  return { px: Number(m[1]), py: Number(m[2]), zoom: Number(m[3]) };
}
const toClient = (pz: ReturnType<typeof panZoom>, x: number, y: number) => ({ clientX: x * pz.zoom + pz.px, clientY: y * pz.zoom + pz.py });

/** 렌더된 주제 상자(캔버스 좌표) — NodeLayer가 left/top/width/height를 px로 쓴다. */
function boxOf(container: HTMLElement, id: string): { left: number; top: number; w: number; h: number } {
  const el = container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
  if (!el) throw new Error(`node ${id} not rendered`);
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
}

async function open(map: string) {
  localStorage.setItem(`mindflow_doc_${map}`, JSON.stringify(DOC));
  const { container } = renderEditor(map);
  await waitFor(() => expect(container.querySelector('[data-node-id="fx"]')).toBeTruthy());
  return container;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('맞춤을 주제·그룹 드래그까지', () => {
  it('자유 주제를 끌면 이웃 메모의 기준선에 붙고 그 자리에 안내선이 뜬다', async () => {
    const container = await open('s1');
    const pz = panZoom(container);
    const b0 = boxOf(container, 'fx');
    const el = container.querySelector('[data-node-id="fx"]') as HTMLElement;
    // 왼쪽 끝을 26으로 — 기준 메모(23)에서 3만큼 어긋난 자리다.
    const dx = 26 - b0.left;
    // 잡는 자리는 도형 안, 놓는 지점(커서)은 빈 캔버스 — 다른 주제 위면 부착이 된다.
    const grab = toClient(pz, b0.left + 10, b0.top + 10);
    const drop = { clientX: grab.clientX + dx * pz.zoom, clientY: grab.clientY };
    firePointer(el, 'pointerdown', { pointerId: 7, ...grab });
    firePointer(document.body, 'pointermove', { pointerId: 7, ...drop });

    const guide = container.querySelector('[data-guide-axis="x"]');
    expect(guide, '끄는 동안 안내선이 보인다').toBeTruthy();
    expect(guide!.getAttribute('data-guide-at')).toBe('23');

    firePointer(document.body, 'pointerup', { pointerId: 7, ...drop });
    // 손을 떼면 사라진다 — 문서에 남는 것이 아니라 끄는 동안의 눈금이다.
    expect(container.querySelector('[data-guide-axis]')).toBeNull();

    await waitFor(() => {
      const b1 = boxOf(container, 'fx');
      expect(b1.left).toBe(23); // 26 → 23 (격자였다면 30이었다)
      expect(b1.top % 10).toBe(0); // 세로는 걸린 이웃이 없어 격자로(279 → 280)
    });
    // 고스트가 보여 준 자리가 곧 저장된 자리다.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_s1') || 'null');
      expect(saved.nodes.fx.x - b0.w / 2).toBe(23);
    });
  });

  it('그룹으로 끌면 묶음 상자가 맞춰지고 멤버는 같은 만큼 움직인다', async () => {
    const container = await open('s2');
    const pz = panZoom(container);
    const x0 = boxOf(container, 'fx');
    const y0 = boxOf(container, 'fy');
    const elX = container.querySelector('[data-node-id="fx"]') as HTMLElement;
    const elY = container.querySelector('[data-node-id="fy"]') as HTMLElement;
    // Shift+클릭으로 둘만 고른다(기준 메모는 후보로 남는다).
    firePointer(elX, 'pointerdown', { pointerId: 8, shiftKey: true, ...toClient(pz, x0.left + 10, x0.top + 10) });
    firePointer(elY, 'pointerdown', { pointerId: 8, shiftKey: true, ...toClient(pz, y0.left + 10, y0.top + 10) });

    // 묶음의 왼쪽 끝(= fx의 왼쪽 끝)을 26으로 끈다.
    const dx = 26 - x0.left;
    const grab = toClient(pz, x0.left + 10, x0.top + 10);
    const drop = { clientX: grab.clientX + dx * pz.zoom, clientY: grab.clientY };
    firePointer(elX, 'pointerdown', { pointerId: 9, ...grab });
    firePointer(document.body, 'pointermove', { pointerId: 9, ...drop });
    const guide = container.querySelector('[data-guide-axis="x"]');
    expect(guide, '그룹도 안내선이 뜬다').toBeTruthy();
    expect(guide!.getAttribute('data-guide-at')).toBe('23');
    firePointer(document.body, 'pointerup', { pointerId: 9, ...drop });

    await waitFor(() => {
      const x1 = boxOf(container, 'fx');
      expect(x1.left).toBe(23);
      // 멤버끼리의 상대 위치는 그대로 — 같은 이동량이 적용된다.
      expect(boxOf(container, 'fy').left).toBe(y0.left + (23 - x0.left));
    });
  });

  it('부착 대상 위에서는 맞추지 않는다 — 그때 자리는 레이아웃이 정한다', async () => {
    const container = await open('s3');
    const pz = panZoom(container);
    const b0 = boxOf(container, 'fx');
    const root = boxOf(container, 'root');
    const el = container.querySelector('[data-node-id="fx"]') as HTMLElement;
    const grab = toClient(pz, b0.left + 10, b0.top + 10);
    // 커서를 루트 상자 가운데로 — 여기 놓으면 자식으로 붙는다.
    const drop = toClient(pz, root.left + root.w / 2, root.top + root.h / 2);
    firePointer(el, 'pointerdown', { pointerId: 10, ...grab });
    firePointer(document.body, 'pointermove', { pointerId: 10, ...drop });
    expect(container.querySelectorAll('[data-guide-axis]')).toHaveLength(0);
    firePointer(document.body, 'pointerup', { pointerId: 10, ...drop });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_s3') || 'null');
      expect(saved.nodes.fx.parent).toBe('root');
    });
  });

  it('드래그 중 Alt를 누르고 있으면 주제도 맞추지 않는다(미세 조정 탈출구)', async () => {
    const container = await open('s4');
    const pz = panZoom(container);
    const b0 = boxOf(container, 'fx');
    const el = container.querySelector('[data-node-id="fx"]') as HTMLElement;
    const dx = 26 - b0.left;
    const grab = toClient(pz, b0.left + 10, b0.top + 10);
    const drop = { clientX: grab.clientX + dx * pz.zoom, clientY: grab.clientY };
    firePointer(el, 'pointerdown', { pointerId: 11, ...grab });
    firePointer(document.body, 'pointermove', { pointerId: 11, ...drop, altKey: true });
    expect(container.querySelectorAll('[data-guide-axis]')).toHaveLength(0);
    firePointer(document.body, 'pointerup', { pointerId: 11, ...drop, altKey: true });

    await waitFor(() => {
      // 23(안내선)도 30(격자)도 아니다 — 손이 놓은 그 자리.
      expect(boxOf(container, 'fx').left).toBeCloseTo(26, 3);
    });
  });
});
