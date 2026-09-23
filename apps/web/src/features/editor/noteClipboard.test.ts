// 그림을 **시스템 클립보드**로(요청 3) — 다른 앱에 그대로 붙여넣을 수 있게.
//
// jsdom에는 `createImageBitmap`도 `canvas.toBlob`도 없어 **PNG로 굽는 길**은 여기서
// 돌릴 수 없다. 대신 이 파일은 그 앞뒤를 잠근다: 무엇을 싣는가(PNG 한 벌뿐) ·
// 못 쓰는 환경에서 조용히 물러서는가 · 덩어리를 **기다리지 않고** 넘기는가
// (사파리는 제스처가 살아 있는 동안에만 쓰기를 받는다).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeImageClipboard } from './noteClipboard';

class FakeItem {
  constructor(public readonly data: Record<string, unknown>) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeImageClipboard', () => {
  it('PNG **한 벌만** 싣는다 — 글자를 함께 실으면 받는 쪽이 주소를 붙여넣는다', async () => {
    const items: FakeItem[] = [];
    const write = vi.fn(async (list: FakeItem[]) => void items.push(...list));
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) })));

    expect(await writeImageClipboard('blob:one')).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(items[0]!.data)).toEqual(['image/png']);
    // 값은 **약속**이다(덩어리가 아니다) — `await` 뒤에 쓰면 사파리가 거절한다.
    expect(items[0]!.data['image/png']).toBeInstanceOf(Promise);
  });

  it('주소가 없거나 클립보드를 막아 둔 환경에서는 조용히 false', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    expect(await writeImageClipboard('')).toBe(false);

    vi.stubGlobal('navigator', { clipboard: {} });
    expect(await writeImageClipboard('blob:two')).toBe(false);

    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) })));
    expect(await writeImageClipboard('blob:three')).toBe(false);
  });
});
