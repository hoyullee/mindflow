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
  /** 종류가 붙은 조각들 — 결과 화면이 "어디서 걸렸는지"를 말할 때 쓴다. */
  pieces: Piece[];
}

const cache = new Map<string, Entry>();
const CACHE_MAX = 400;

/**
 * 검색 결과가 **어디서** 걸렸는지 — 디자인의 종류 칩(`페이지`·`본문`·`카드`·`메모`).
 *
 * 제목만 보여 주면 "왜 이 문서가 나왔는지"를 알 수 없다. 특히 공책은 한 문서 안에
 * 페이지가 여럿이라 "어느 장에 있는가"가 곧 다음 행동이다.
 */
export type SearchHitKind = '페이지' | '본문' | '주제' | '메모' | '영역' | '열' | '카드';

/** 한 문서 안에서 걸린 한 조각. */
export interface SearchHit {
  kind: SearchHitKind;
  /** 원문 한 줄(스니펫은 화면에서 만든다 — 질의 위치가 필요하므로). */
  text: string;
  /** 공책일 때 그 페이지 id — 눌러서 그 장으로 바로 갈 수 있게. */
  pageId?: string;
  /** 공책일 때 그 페이지 제목 — 결과 카드의 경로(`스페이스 › 공책 › 페이지`). */
  pageTitle?: string;
}

interface Piece {
  kind: SearchHitKind;
  text: string;
  pageId?: string;
  pageTitle?: string;
}

/** 이 값들만 검색 대상 — 나머지(이미지·좌표·색·id)는 글자가 아니다. */
function collectText(doc: unknown, out: Piece[]): void {
  const d = doc as {
    nodes?: Record<string, { text?: unknown; note?: unknown }>;
    floats?: { text?: unknown }[];
    zones?: { label?: unknown }[];
    columns?: { title?: unknown }[];
    cards?: { text?: unknown }[];
    pages?: unknown;
  } | null;
  if (!d || typeof d !== 'object') return;
  const push = (kind: SearchHitKind, v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push({ kind, text: v });
  };
  if (d.nodes && typeof d.nodes === 'object') {
    for (const n of Object.values(d.nodes)) {
      if (!n || typeof n !== 'object') continue;
      push('주제', n.text);
      push('주제', n.note);
    }
  }
  if (Array.isArray(d.floats)) for (const f of d.floats) push('메모', f?.text);
  if (Array.isArray(d.zones)) for (const z of d.zones) push('영역', z?.label);
  // 칸반 — 열 제목과 카드 글자도 사용자가 쓴 내용이다.
  if (Array.isArray(d.columns)) for (const c of d.columns) push('열', c?.title);
  if (Array.isArray(d.cards)) for (const c of d.cards) push('카드', c?.text);
  // 공책 — **페이지 제목과 본문 둘 다**(요청). 페이지가 여럿이라 한 문서 안에서도
  // 어디서 걸렸는지가 중요해 종류를 갈라 둔다.
  collectNoteText(d.pages, out);
}

/** 공책 페이지들의 글 — 블록 종류마다 글이 들어 있는 칸이 다르다. */
function collectNoteText(pages: unknown, out: Piece[]): void {
  if (!Array.isArray(pages)) return;
  for (const raw of pages) {
    const pg = raw as { id?: unknown; title?: unknown; blocks?: unknown } | null;
    if (!pg || typeof pg !== 'object') continue;
    const pageId = typeof pg.id === 'string' ? pg.id : undefined;
    const title = typeof pg.title === 'string' ? pg.title.trim() : '';
    // 페이지 이름은 **그 장에서 걸린 모든 줄**에 함께 실린다 — 결과 카드가
    // `일반 공간 › 제품 회의록 › 9월 3주 회의록`처럼 어디서 걸렸는지 말해야 한다.
    const at = { ...(pageId ? { pageId } : {}), ...(title ? { pageTitle: title } : {}) };
    if (title) out.push({ kind: '페이지', text: pg.title as string, ...at });
    if (!Array.isArray(pg.blocks)) continue;
    for (const b of pg.blocks) {
      const block = b as { runs?: unknown; items?: unknown; rows?: unknown } | null;
      if (!block || typeof block !== 'object') continue;
      // 저장본을 **직접** 읽는다(코어 `blockText`를 쓰지 않는다): 여기 오는 것은
      // 검증되지 않은 JSON이고, 검색이 손상된 문서 하나에 던져서는 안 된다.
      const line = runsLine(block.runs);
      if (line) out.push({ kind: '본문', text: line, ...at });
      if (Array.isArray(block.items)) {
        for (const it of block.items) {
          const t = runsLine((it as { runs?: unknown } | null)?.runs);
          if (t) out.push({ kind: '본문', text: t, ...at });
        }
      }
      if (Array.isArray(block.rows)) {
        for (const row of block.rows) {
          if (!Array.isArray(row)) continue;
          const cells = row.map((c) => runsLine(c)).filter(Boolean);
          if (cells.length) out.push({ kind: '본문', text: cells.join(' · '), ...at });
        }
      }
    }
  }
}

/** 런 배열 → 한 줄(모르는 모양이면 빈 문자열). */
function runsLine(runs: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs
    .map((r) => ((r as { t?: unknown } | null)?.t))
    .filter((t): t is string => typeof t === 'string')
    .join('')
    .trim();
}

/**
 * 문서 본문의 검색용 소문자 텍스트. 파싱 결과는 `docId`로 캐시하되 원문 문자열이
 * 바뀌면 다시 만든다(저장돼 내용이 바뀐 경우).
 */
function entryFor(docId: string, raw: string): Entry {
  const hit = cache.get(docId);
  if (hit && hit.raw === raw) return hit;
  let pieces: Piece[] = [];
  try {
    const parts: Piece[] = [];
    collectText(JSON.parse(raw), parts);
    pieces = parts;
  } catch {
    pieces = []; // 손상된 본문은 제목으로만 찾힌다
  }
  const entry: Entry = { raw, text: pieces.map((p) => p.text).join('\n').toLowerCase(), pieces };
  cache.set(docId, entry);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry;
}

export function docSearchText(docId: string, raw: string | undefined): string {
  if (!raw) return '';
  return entryFor(docId, raw).text;
}

/**
 * 이 문서 안에서 질의에 걸린 **조각들**. 같은 종류·같은 줄이 여럿이면 앞의 것만 남기고,
 * 한 문서가 결과를 통째로 덮지 않게 `max`로 끊는다.
 *
 * `query`는 이미 소문자·trim된 값이다(`matchesQuery`와 같은 계약).
 */
export function docSearchHits(docId: string, raw: string | undefined, query: string, max = 4): SearchHit[] {
  if (!raw || !query) return [];
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const p of entryFor(docId, raw).pieces) {
    if (out.length >= max) break;
    if (!p.text.toLowerCase().includes(query)) continue;
    const key = `${p.kind}\u0000${p.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: p.kind, text: p.text, ...(p.pageId ? { pageId: p.pageId } : {}), ...(p.pageTitle ? { pageTitle: p.pageTitle } : {}) });
  }
  return out;
}

/**
 * 걸린 자리 앞뒤를 잘라 보여 줄 한 조각 — 긴 문단에서 질의가 가운데 오게 한다.
 * 잘린 쪽에는 `…`가 붙는다(어느 쪽이 잘렸는지 보이게).
 */
export function snippetAround(text: string, query: string, width = 76): string {
  const at = text.toLowerCase().indexOf(query);
  if (at < 0 || text.length <= width) return text;
  const start = Math.max(0, at - Math.floor((width - query.length) / 2));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** 제목 또는 본문에 질의가 들어 있는가. `query`는 이미 소문자·trim된 값. */
export function matchesQuery(title: string, bodyText: string, query: string): boolean {
  if (!query) return true;
  return title.toLowerCase().includes(query) || bodyText.includes(query);
}
