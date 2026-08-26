import { beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_URL_CACHE_MS, cachedImageUrls, rememberImageUrls } from './imageUrlCache';

beforeEach(() => localStorage.clear());

// 서명 URL은 부를 때마다 토큰이 달라진다 — 문자열이 바뀌면 브라우저 캐시가 통째로
// 빗나가 같은 사진을 매번 다시 내려받는다. 그래서 만료 전까지 **같은 URL**을 쓴다.
describe('imageUrlCache', () => {
  const A = 'mfimg:doc-1/a.webp';
  const B = 'mfimg:doc-1/b.webp';

  it('발급받은 URL을 만료 전까지 그대로 돌려준다', () => {
    const t0 = 1_000_000;
    rememberImageUrls({ [A]: 'https://x/a?t=1' }, t0);
    expect(cachedImageUrls([A], t0 + 60_000)).toEqual({ [A]: 'https://x/a?t=1' });
  });

  it('만료가 지나면 빼고 돌려준다 — 죽은 URL을 화면에 붙이지 않는다', () => {
    const t0 = 1_000_000;
    rememberImageUrls({ [A]: 'https://x/a?t=1' }, t0);
    expect(cachedImageUrls([A], t0 + IMAGE_URL_CACHE_MS + 1)).toEqual({});
  });

  it('없는 참조는 결과에서 빠진다(호출부가 그것만 발급받는다)', () => {
    const t0 = 1_000_000;
    rememberImageUrls({ [A]: 'https://x/a' }, t0);
    expect(cachedImageUrls([A, B], t0)).toEqual({ [A]: 'https://x/a' });
  });

  it('저장소가 깨져 있어도 앱이 멈추지 않는다 — 캐시가 없는 것으로 본다', () => {
    localStorage.setItem('mf_img_urls', '{not json');
    expect(cachedImageUrls([A])).toEqual({});
    expect(() => rememberImageUrls({ [A]: 'https://x/a' })).not.toThrow();
  });

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 420; i++) many[`mfimg:d/${i}.webp`] = `https://x/${i}`;
    rememberImageUrls(many, 1_000);
    // 새로 넣은 것은 살아 있다.
    rememberImageUrls({ [A]: 'https://x/a' }, 2_000);
    expect(cachedImageUrls([A], 2_000)).toEqual({ [A]: 'https://x/a' });
    const kept = Object.keys(JSON.parse(localStorage.getItem('mf_img_urls') ?? '{}') as object).length;
    expect(kept).toBeLessThanOrEqual(400);
  });
});
