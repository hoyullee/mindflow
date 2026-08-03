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

/** 모든 노드 박스 쌍이 겹치지 않는지 — 겹침 배터리의 공용 불변식. */
function assertNoNodeOverlap(container: HTMLElement): void {
  const els = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]'));
  const rects = els.map((el) => ({ id: el.dataset.nodeId, ...rectOf(el) }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i]!, rects[j]!)) {
        throw new Error(`겹침: ${rects[i]!.id} × ${rects[j]!.id}`);
      }
    }
  }
}

describe('도형 겹침 자동 정리 — 후속 3건', () => {
  it('④ 노드에 붙여넣기(자식 편입) 후에도 자유 도형과 겹치지 않는다 (트리 리플로우 밀어내기)', async () => {
    // 루트 오른쪽(right 레이아웃에서 새 자식이 놓일 자리)에 자유 도형을 둔다.
    const doc = {
      ...DOC,
      nodes: {
        root: { ...DOC.nodes.root },
        fx: { ...DOC.nodes.fx }, // 복사 원본 (멀리)
        fz: { id: 'fz', text: '옆도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 200, y: 0, free: true },
      },
    };
    localStorage.setItem('mindflow_doc_ov4', JSON.stringify(doc));
    const { container } = renderEditor('/editor?map=ov4&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fz"]')).toBeTruthy());

    selectNodeBox(container.querySelector('[data-node-id="fx"]') as HTMLElement);
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    selectNodeBox(container.querySelector('[data-node-id="root"]') as HTMLElement);
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    // 사본이 루트의 자식으로 붙고(원본도형 2개), 자유 도형이 밀려나 아무것도 안 겹친다
    await waitFor(() => {
      const copies = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]')).filter((el) => el.textContent?.includes('원본도형'));
      expect(copies.length).toBe(2);
      assertNoNodeOverlap(container);
    });
  });

  it('⑤ 그룹 이동으로 다른 도형 위에 놓으면 그룹 멤버가 밀려난다', async () => {
    // fx·fy(그룹)와 장애물 루트. Ctrl+A로 전체 선택 후 그룹을 루트 위로 끌어다 놓는다.
    localStorage.setItem('mindflow_doc_ov5', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=ov5&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fy"]')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); // fx+fy 다중 선택

    // 그룹 멤버(fx)를 잡고 루트 위로 — 캔버스 좌표 (0,0) 근처로 평행이동.
    const { pan, zoom, geom } = computeViewport(parseDoc(DOC)!);
    const from = { x: geom.fx!.x * zoom + pan.x, y: geom.fx!.y * zoom + pan.y };
    const to = { x: geom.root!.x * zoom + pan.x, y: geom.root!.y * zoom + pan.y };
    const fxEl = container.querySelector('[data-node-id="fx"]') as HTMLElement;
    firePointer(fxEl, 'pointerdown', { pointerId: 21, clientX: from.x, clientY: from.y, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 21, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 });
    firePointer(window, 'pointermove', { pointerId: 21, clientX: to.x, clientY: to.y });
    firePointer(window, 'pointerup', { pointerId: 21, clientX: to.x, clientY: to.y });

    await waitFor(() => assertNoNodeOverlap(container));
  });

  it('⑥ 붙여넣기 → 이동 → undo 시 밀어낸 **후** 좌표로 돌아온다 (겹친 자리가 아니라)', async () => {
    localStorage.setItem('mindflow_doc_ov6', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=ov6&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fx"]')).toBeTruthy());

    // 원본 복사 → 원본 바로 옆(겹칠 자리)에 붙여넣기 → 마그넷으로 비켜난 좌표 P1
    selectNodeBox(container.querySelector('[data-node-id="fx"]') as HTMLElement);
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    const { pan, zoom, geom } = computeViewport(parseDoc(DOC)!);
    const g = geom.fx!;
    fireEvent.contextMenu(getViewport(container), { clientX: (g.x + g.w / 2 + 30) * zoom + pan.x, clientY: g.y * zoom + pan.y, button: 2 });
    const pasteItem = await screen.findByText('붙여넣기');
    clickMenuItem(pasteItem);

    const copyEl = (): HTMLElement => {
      const els = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]')).filter((el) => el.textContent?.includes('원본도형'));
      const el = els.find((e) => e.dataset.nodeId !== 'fx');
      if (!el) throw new Error('copy not found');
      return el;
    };
    let p1 = { x0: 0, y0: 0, x1: 0, y1: 0 };
    await waitFor(() => {
      assertNoNodeOverlap(container);
      p1 = rectOf(copyEl());
    });

    // 사본을 빈 곳으로 이동 (node-move 드래그)
    const cid = copyEl().dataset.nodeId!;
    const cx = (p1.x0 + p1.x1) / 2 * zoom + pan.x;
    const cy = (p1.y0 + p1.y1) / 2 * zoom + pan.y;
    firePointer(copyEl(), 'pointerdown', { pointerId: 22, clientX: cx, clientY: cy, button: 0 });
    firePointer(window, 'pointermove', { pointerId: 22, clientX: cx + 200, clientY: cy + 260 });
    firePointer(window, 'pointerup', { pointerId: 22, clientX: cx + 200, clientY: cy + 260 });
    await waitFor(() => {
      const moved = rectOf(container.querySelector(`[data-node-id="${cid}"]`) as HTMLElement);
      expect(Math.abs(moved.x0 - p1.x0) > 10 || Math.abs(moved.y0 - p1.y0) > 10).toBe(true);
    });

    // undo → **밀어낸 후** 좌표(P1)로 복귀 — 겹친 자리(붙여넣기 원좌표)가 아니다
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const back = rectOf(container.querySelector(`[data-node-id="${cid}"]`) as HTMLElement);
      expect(back.x0).toBeCloseTo(p1.x0, 1);
      expect(back.y0).toBeCloseTo(p1.y0, 1);
      assertNoNodeOverlap(container);
    });
    // 한 번 더 undo → 사본 자체가 사라진다(붙여넣기 취소)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const copies = Array.from(getViewport(container).querySelectorAll<HTMLElement>('[data-node-id]')).filter((el) => el.textContent?.includes('원본도형'));
      expect(copies.length).toBe(1);
    });
  });
});

// 제보: 미선택 객체를 잡고 끌면 "브라우저 전체가 이미지화되어 이동"하는 듯한
// 네이티브 드래그 고스트가 떴다. 근원이 무엇이든(남은 텍스트 선택·Ctrl+A의 페이지
// 전체 선택 등) 에디터 안에서는 네이티브 드래그를 차단하고, Ctrl+A는 페이지 텍스트
// 선택 대신 캔버스 객체 전체 선택으로 가로챈다.
describe('네이티브 드래그 고스트 차단', () => {
  it('에디터 안의 dragstart는 기본 동작이 차단된다', async () => {
    localStorage.setItem('mindflow_doc_dg1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=dg1&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fx"]')).toBeTruthy());
    // fireEvent는 preventDefault가 불리면 false를 돌려준다.
    expect(fireEvent.dragStart(container.querySelector('[data-node-id="fx"]')!)).toBe(false);
  });

  it('Ctrl+A는 페이지 텍스트가 아니라 캔버스 객체 전체를 선택한다 (Delete로 일괄 삭제 가능)', async () => {
    localStorage.setItem('mindflow_doc_dg2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=dg2&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fy"]')).toBeTruthy());
    // preventDefault가 불려야 한다 — 브라우저의 전체 텍스트 선택(고스트의 뿌리) 차단
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => {
      expect(container.querySelector('[data-node-id="fx"]')).toBeNull();
      expect(container.querySelector('[data-node-id="fy"]')).toBeNull();
      expect(container.querySelector('[data-node-id="root"]')).toBeTruthy(); // 루트는 제외
    });
  });

  it('텍스트 편집 중의 Ctrl+A는 가로채지 않는다 (편집 박스 안 전체 선택 유지)', async () => {
    localStorage.setItem('mindflow_doc_dg3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=dg3&title=x');
    await waitFor(() => expect(container.querySelector('[data-node-id="fx"]')).toBeTruthy());
    fireEvent.doubleClick(container.querySelector('[data-node-id="fx"]')!);
    const editable = container.querySelector('.mf-richedit') as HTMLElement;
    expect(editable).toBeTruthy();
    // 편집 중에는 우리 핸들러가 손대지 않는다(defaultPrevented 아님)
    expect(fireEvent.keyDown(editable, { key: 'a', ctrlKey: true, bubbles: true })).toBe(true);
  });
});
