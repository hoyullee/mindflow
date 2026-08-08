// 홈 검색이 읽는 "맵 본문 텍스트".
//
// 원문 JSON을 그대로 훑지 않고 **글자 필드만 골라 모은다**. 이유 둘:
//  · 로컬 모드의 본문에는 이미지가 데이터 URL로 인라인돼 있다(백엔드 모드는 RPC가
//    떼어 준다). 원문을 통째로 훑으면 base64 더미에 우연히 걸려 "png"·"iVBOR" 같은
//    질의가 엉뚱한 맵을 물어 온다.
//  · 좌표·색·id 같은 값도 검색 대상이 아니다.
//
// 본문은 `previewDocs`(썸네일이 이미 받아 둔 그 문자열)를 그대로 쓴다 — 검색을
// 위해 새로 내려받는 것이 없다.

interface Entry {
  /** 파싱의 출처. 문자열 참조가 그대로면 다시 파싱하지 않는다(키 입력마다 재파싱 방지). */
  raw: string;
  text: string;
}

const cache = new Map<string, Entry>();
const CACHE_MAX = 400;

/** 이 값들만 검색 대상 — 나머지(이미지·좌표·색·id)는 글자가 아니다. */
function collectText(doc: unknown, out: string[]): void {
  const d = doc as {
    nodes?: Record<string, { text?: unknown; note?: unknown }>;
    floats?: { text?: unknown }[];
    zones?: { label?: unknown }[];
  } | null;
  if (!d || typeof d !== 'object') return;
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v);
  };
  if (d.nodes && typeof d.nodes === 'object') {
    for (const n of Object.values(d.nodes)) {
      if (!n || typeof n !== 'object') continue;
      push(n.text);
      push(n.note);
    }
  }
  if (Array.isArray(d.floats)) for (const f of d.floats) push(f?.text);
  if (Array.isArray(d.zones)) for (const z of d.zones) push(z?.label);
}

/**
 * 문서 본문의 검색용 소문자 텍스트. 파싱 결과는 `docId`로 캐시하되 원문 문자열이
 * 바뀌면 다시 만든다(저장돼 내용이 바뀐 경우).
 */
export function docSearchText(docId: string, raw: string | undefined): string {
  if (!raw) return '';
  const hit = cache.get(docId);
  if (hit && hit.raw === raw) return hit.text;
  let text = '';
  try {
    const parts: string[] = [];
    collectText(JSON.parse(raw), parts);
    text = parts.join('\n').toLowerCase();
  } catch {
    text = ''; // 손상된 본문은 제목으로만 찾힌다
  }
  cache.set(docId, { raw, text });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return text;
}

/** 제목 또는 본문에 질의가 들어 있는가. `query`는 이미 소문자·trim된 값. */
export function matchesQuery(title: string, bodyText: string, query: string): boolean {
  if (!query) return true;
  return title.toLowerCase().includes(query) || bodyText.includes(query);
}
