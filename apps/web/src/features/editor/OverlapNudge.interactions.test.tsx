import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { layout, parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { CanvasTextMeasurer, computeMetrics } from './metrics';

// 도형 겹침 자동 정리 2건(제보):
// ① 복사한 도형을 붙여넣으면 원본과 겹친 채 놓였다 → 붙여넣은 자유 도형은
//    겹치지 않는 자리로 마그넷된다(pendingNudge 목록 처리).
// ② 도형 크기 조절을 확정했을 때 겹친 **개별(자유) 도형이 밀려나야** 한다 —
//    크기를 조절한 도형이 anchor로 남고 상대가 비켜난다(reflow nudge의 anchor).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
    fx: { id: 'fx', text: '원본도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 600, y: 300, free: true },
    fy: { id: 'fy', text: '이웃도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 940, y: 300, free: true },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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

/** jsdom에는 PointerEvent가 없어 fireEvent.pointerDown이 좌표/버튼을 떨어뜨린다 —
 * 기존 상호작용 테스트들과 동일한 헬퍼. */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { pointerId?: number; clientX?: number; clientY?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  fireEvent(target, event);
}

function selectNodeBox(el: HTMLElement): void {
  firePointer(el, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  firePointer(window, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
}

/** 캔버스 좌표 → 클라이언트 좌표. jsdom은 실제 레이아웃이 없어 fitView 공식을
 * 그대로 재현한다(ContextMenu.interactions.test.tsx와 동일한 방식·상수). */
function computeViewport(doc: Doc): { pan: { x: number; y: number }; zoom: number; geom: Record<string, { x: number; y: number; w: number; h: number }> } {
  const measurer = new CanvasTextMeasurer();
  const sizeOf = (node: Parameters<typeof computeMetrics>[0], depth: number) => {
    const m = computeMetrics(node, depth, measurer);
    return { w: m.w, h: m.h };
  };
  const laidOut = layout(doc, doc.layoutMode, sizeOf, { rootAnchor: { x: 0, y: 0 } });
  const geom: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const id of Object.keys(doc.nodes)) {
    const n = laidOut[id];
    if (!n) continue;
    const m = computeMetrics(n, id === 'root' ? 0 : 1, measurer);
    geom[id] = { x: n.x, y: n.y, w: m.w, h: m.h };
  }
  const FIT_PADDING = 90;
  const MIN_ZOOM = 0.25;
  const vw = 1200;
  const vh = 700;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of Object.values(geom)) {
    minX = Math.min(minX, g.x - g.w / 2);
    maxX = Math.max(maxX, g.x + g.w / 2);
    minY = Math.min(minY, g.y - g.h / 2);
    maxY = Math.max(maxY, g.y + g.h / 2);
  }
  const cx = geom.root ? geom.root.x : (minX + maxX) / 2;
  const cy = geom.root ? geom.root.y : (minY + maxY) / 2;
  const halfW = Math.max(cx - minX, maxX - cx, 1);
  const halfH = Math.max(cy - minY, maxY - cy, 1);
  let z = Math.min((vw - FIT_PADDING) / (2 * halfW), (vh - FIT_PADDING) / (2 * halfH), 1.25);
  z = Math.max(MIN_ZOOM, z);
  return { pan: { x: vw / 2 - cx * z, y: vh / 2 - cy * z }, zoom: z, geom };
}

function clickMenuItem(el: Element): void {
  firePointer(el, 'pointerdown', { pointerId: 3, button: 0 });
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  firePointer(el, 'pointerup', { pointerId: 3, button: 0 });
  fireEvent.click(el);
}

/** 요소의 style 사각형(캔버스 좌표) — NodeLayer가 left/top/width/height를 px로 쓴다. */
function rectOf(el: HTMLElement): { x0: number; y0: number; x1: number; y1: number } {
  const l = parseFloat(el.style.left);
  const t = parseFloat(el.style.top);
  const w = parseFloat(el.style.width);
  const h = parseFloat(el.style.height);
  return { x0: l, y0: t, x1: l + w, y1: t + h };
}

function overlaps(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('도형 겹침 자동 정리', () => {
  it('① 붙여넣은 자유 도형은 원본과 겹치지 않는 자리로 밀려난다', async () => {
    localStorage.setItem('mindflow_doc_ov1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=ov1&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fx"]')).toBeTruthy());

    // 원본 복사
    selectNodeBox(container.querySelector('[data-node-id="fx"]') as HTMLElement);
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

    // 원본 오른쪽 살짝 밖(배경)을 우클릭 → 그 지점에 붙여넣기. 붙여넣은 사본의
    // 중심이 원본 박스에서 반 폭 + 30px 밖이므로 **박스는 확실히 겹친다**.
    const { pan, zoom, geom } = computeViewport(parseDoc(DOC)!);
    const g = geom.fx!;
    const px = g.x + g.w / 2 + 30;
    const py = g.y;
    fireEvent.contextMenu(getViewport(container), { clientX: px * zoom + pan.x, clientY: py * zoom + pan.y, button: 2 });
    const pasteItem = await screen.findByText('붙여넣기');
    clickMenuItem(pasteItem);

    // 사본이 생기고, 마그넷이 돌아 원본·이웃 어느 것과도 겹치지 않는다.
    await waitFor(() => {
      const boxes = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]')).filter((el) => el.textContent?.includes('원본도형'));
      expect(boxes.length).toBe(2);
      const [a, b] = boxes.map(rectOf);
      expect(overlaps(a!, b!)).toBe(false);
    });
    // 이웃 도형과도 겹치지 않는다(밀려난 자리가 또 다른 도형 위가 아님)
    const all = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]')).map(rectOf);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i]!, all[j]!)).toBe(false);
      }
    }
  });

  it('② 자유 도형의 크기 조절 확정 시 겹친 이웃 도형이 밀려나고, 조절한 도형은 그대로다', async () => {
    localStorage.setItem('mindflow_doc_ov2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=ov2&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fy"]')).toBeTruthy());

    const fxEl = () => container.querySelector('[data-node-id="fx"]') as HTMLElement;
    const fyEl = () => container.querySelector('[data-node-id="fy"]') as HTMLElement;
    const fxBefore = rectOf(fxEl());
    const fyBefore = rectOf(fyEl());
    expect(overlaps(fxBefore, fyBefore)).toBe(false); // 시작은 떨어져 있다

    // fx 선택 → 우하단 핸들을 잡고 오른쪽으로 크게 늘린다(fy를 덮을 만큼)
    selectNodeBox(fxEl());
    const handle = fxEl().querySelector<HTMLElement>('[title^="크기 조절"]');
    expect(handle).toBeTruthy();
    firePointer(handle!, 'pointerdown', { pointerId: 12, clientX: 0, clientY: 0, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 12, clientX: 200, clientY: 0 });
    firePointer(window, 'pointermove', { pointerId: 12, clientX: 400, clientY: 0 });
    // 끄는 중에는 fy가 아직 그대로(확정 시에만 밀려난다)
    expect(rectOf(fyEl())).toEqual(fyBefore);
    firePointer(window, 'pointerup', { pointerId: 12, clientX: 400, clientY: 0 });

    await waitFor(() => {
      const fxAfter = rectOf(fxEl());
      const fyAfter = rectOf(fyEl());
      // 크기를 조절한 도형(anchor)의 좌상단은 그대로 — 밀려나는 건 이웃이다
      expect(fxAfter.x0).toBeCloseTo(fxBefore.x0, 1);
      expect(fxAfter.y0).toBeCloseTo(fxBefore.y0, 1);
      expect(fxAfter.x1).toBeGreaterThan(fxBefore.x1); // 실제로 커졌다
      // 이웃이 밀려났다 — 방향은 최소 탈출 축(대개 세로: 박스가 납작해 짧다)
      const moved = Math.abs(fyAfter.x0 - fyBefore.x0) > 0.5 || Math.abs(fyAfter.y0 - fyBefore.y0) > 0.5;
      expect(moved).toBe(true);
      expect(overlaps(fxAfter, fyAfter)).toBe(false);
    });
  });

  it('③ 트리 노드(루트)의 크기 조절 확정도 겹친 자유 도형을 밀어낸다', async () => {
    // 루트 오른쪽 가까이에 자유 도형을 두고 루트를 크게 늘린다.
    const doc = {
      ...DOC,
      nodes: {
        root: { ...DOC.nodes.root },
        fz: { id: 'fz', text: '옆도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 150, y: 0, free: true },
      },
    };
    localStorage.setItem('mindflow_doc_ov3', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ov3&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fz"]')).toBeTruthy());

    const rootEl = () => container.querySelector('[data-node-id="root"]') as HTMLElement;
    const fzEl = () => container.querySelector('[data-node-id="fz"]') as HTMLElement;
    const fzBefore = rectOf(fzEl());
    expect(overlaps(rectOf(rootEl()), fzBefore)).toBe(false);

    selectNodeBox(rootEl());
    const handle = rootEl().querySelector<HTMLElement>('[title^="크기 조절"]');
    expect(handle).toBeTruthy();
    firePointer(handle!, 'pointerdown', { pointerId: 13, clientX: 0, clientY: 0, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 13, clientX: 180, clientY: 0 });
    firePointer(window, 'pointermove', { pointerId: 13, clientX: 360, clientY: 0 });
    firePointer(window, 'pointerup', { pointerId: 13, clientX: 360, clientY: 0 });

    await waitFor(() => {
      const fzAfter = rectOf(fzEl());
      const moved = Math.abs(fzAfter.x0 - fzBefore.x0) > 0.5 || Math.abs(fzAfter.y0 - fzBefore.y0) > 0.5;
      expect(moved).toBe(true); // 자유 도형이 밀려났다
      expect(overlaps(rectOf(rootEl()), fzAfter)).toBe(false);
    });
  });
});
