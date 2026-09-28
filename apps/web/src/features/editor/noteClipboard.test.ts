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

  it('주소가 없거나 클립보드를 통째로 막아 둔 환경에서는 조용히 false', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    expect(await writeImageClipboard('')).toBe(false);

    vi.stubGlobal('navigator', { clipboard: {} });
    expect(await writeImageClipboard('blob:two')).toBe(false);
  });

  /**
   * **PNG를 못 실으면 주소라도**(제보 13) — 예전에는 여기서 아무 일도 일어나지 않았고,
   * 잘라내기는 쓰기가 성공해야 지우므로 ⌘X까지 조용히 죽었다.
   */
  it('그림 쓰기가 거절당하면 **주소를 글자로** 싣는다', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => Promise.reject(new Error('denied'))), writeText } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) })));

    expect(await writeImageClipboard('https://cdn.example/a.webp')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/a.webp');
  });

  it('`ClipboardItem`을 모르는 브라우저에서도 주소로 물러선다', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('ClipboardItem', undefined);
    expect(await writeImageClipboard('https://cdn.example/b.webp')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/b.webp');
  });

  it('`data:` 주소는 **싣지 않는다** — 수백 KB짜리 글자가 클립보드에 들어간다', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => Promise.reject(new Error('denied'))), writeText } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) })));

    expect(await writeImageClipboard('data:image/png;base64,AAAA')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
