// 첨부 이미지의 **서명 URL을 이 기기에 캐시**한다.
//
// 왜 필요한가: `createSignedUrls`는 부를 때마다 **새 토큰**을 만든다. 그림은 같은데
// URL 문자열이 달라지므로 브라우저 캐시가 통째로 빗나가고, 같은 사진을 매번 다시
// 내려받는다. 이미지 객체에 1년짜리 `Cache-Control`을 붙여 둔 것도 URL이 바뀌면
// 소용이 없다 — 캐시 키가 URL이기 때문이다.
//
// 그래서 발급받은 URL을 만료 전까지 재사용한다. 효과는 두 가지다:
//  - 홈을 다시 방문해도 카드 썸네일이 **같은 URL**을 가리켜 네트워크가 0이다.
//  - 홈에서 본 이미지를 에디터에서 열 때도 같은 URL이라 또 받지 않는다(같은 캐시를
//    쓴다 — 그래서 어댑터가 아니라 이 공용 모듈에 둔다).
//
// 저장은 localStorage다. 서명 URL은 이 기기의 세션에서 쓰는 임시 자격이고, 만료가
// 있어 새더라도 유효 시간이 묶여 있다(비공개 버킷을 고른 이유 — 0016 참고).

const KEY = 'mf_img_urls';
/**
 * 캐시된 URL을 재사용하는 창(ms) = 11시간.
 *
 * 어댑터의 서명 만료(`SIGNED_URL_TTL_SEC` = 12시간)보다 **짧게** 잡는다 — 만료
 * 직전의 URL을 넘겨주면 화면에 붙자마자 깨진다. 남는 1시간이 그 여유다.
 */
export const IMAGE_URL_CACHE_MS = 11 * 60 * 60 * 1000;
/** 항목 상한 — 오래된 것부터 버린다(맵을 오래 쓰면 참조가 계속 쌓인다). */
const MAX_ENTRIES = 400;

interface Entry {
  url: string;
  /** 발급 시각(ms) — 만료 판단용. */
  at: number;
}

type Store = Record<string, Entry>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Store;
  } catch {
    // 손상된 값이 있어도 앱이 멈추면 안 된다 — 캐시가 없는 것으로 본다.
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 쿼터 초과 등 — 캐시는 있으면 좋은 것이지 필수가 아니다. 조용히 포기한다.
  }
}

function fresh(e: Entry | undefined, now: number): e is Entry {
  return !!e && typeof e.url === 'string' && typeof e.at === 'number' && now - e.at < IMAGE_URL_CACHE_MS;
}

/** 아직 쓸 수 있는 URL만 돌려준다. 없는 참조는 결과에서 빠진다(호출부가 발급받는다). */
export function cachedImageUrls(refs: string[], now = Date.now()): Record<string, string> {
  if (!refs.length) return {};
  const store = read();
  const out: Record<string, string> = {};
  for (const ref of refs) {
    const e = store[ref];
    if (fresh(e, now)) out[ref] = e.url;
  }
  return out;
}

/** 새로 발급받은 URL을 캐시에 넣는다(같은 참조는 덮어쓴다). */
export function rememberImageUrls(urls: Record<string, string>, now = Date.now()): void {
  const keys = Object.keys(urls);
  if (!keys.length) return;
  const store = read();
  for (const ref of keys) {
    const url = urls[ref];
    if (url) store[ref] = { url, at: now };
  }
  // 상한 — 발급 시각이 오래된 것부터 버린다.
  const entries = Object.entries(store);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
    const kept: Store = {};
    for (const [ref, e] of entries.slice(0, MAX_ENTRIES)) kept[ref] = e;
    write(kept);
    return;
  }
  write(store);
}
