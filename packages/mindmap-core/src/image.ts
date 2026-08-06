// 문서 안의 이미지를 **어떻게 가리키는가**.
//
// 원래 이미지는 본문에 `data:` URL로 통째로 인라인됐다(첨부 한 장이면 수백 KB).
// 그게 저장량·egress를 키웠고, 실시간 협업에서는 **메시지 크기 한도를 넘겨** 합류
// 동기화가 통째로 버려지는 사고까지 냈다(apps/web `SupabaseRealtimeProvider`의
// `UPDATE_PART_EVENT` 주석). 그래서 본문에는 **참조만** 두고 실물은 별도 저장소에
// 둔다 — 본문은 다시 텍스트 크기가 된다.
//
// 참조 형식은 `mfimg:<경로>` 한 줄짜리 문자열이다. 필드는 그대로 `img`를 쓴다:
//   · 직렬화·CRDT 바인딩·undo·내보내기가 **아무것도 바뀌지 않는다**(전부 문자열 값)
//   · `data:`로 시작하는 **옛 문서가 그대로 동작한다**(참조가 아니면 값 그 자체가 소스)
// 즉 이 모듈은 "이 문자열이 참조인가, 아니면 바로 그릴 수 있는 소스인가"를 판별하는
// 규칙 하나를 앱 전체에 제공한다. 실제 업로드/URL 발급은 앱(어댑터)의 몫이다.

import type { Doc } from './model';

/** 참조 접두사. `data:`/`http:`와 겹치지 않는 우리 전용 스킴. */
export const IMAGE_REF_PREFIX = 'mfimg:';

/** 이 `img` 값이 별도 저장소를 가리키는 참조인가(아니면 그릴 수 있는 소스인가). */
export function isImageRef(img: string | undefined | null): boolean {
  return typeof img === 'string' && img.startsWith(IMAGE_REF_PREFIX);
}

/** 참조에서 저장소 경로를 꺼낸다. 참조가 아니면 `null`. */
export function imageRefPath(img: string | undefined | null): string | null {
  if (!isImageRef(img)) return null;
  const path = (img as string).slice(IMAGE_REF_PREFIX.length);
  return path ? path : null;
}

/** 저장소 경로 → 본문에 넣을 참조 문자열. */
export function makeImageRef(path: string): string {
  return `${IMAGE_REF_PREFIX}${path}`;
}

/**
 * 문서가 쓰는 **모든** 이미지 참조(중복 제거). 화면에 그리기 전에 한 번에 URL을
 * 발급받고(왕복 1회), 내보내기 전에 미리 받아 두는 데 쓴다.
 */
export function collectImageRefs(doc: Doc): string[] {
  const out = new Set<string>();
  for (const id of Object.keys(doc.nodes)) {
    const img = doc.nodes[id]?.img;
    if (isImageRef(img)) out.add(img!);
  }
  for (const f of doc.floats) {
    if (isImageRef(f.img)) out.add(f.img!);
  }
  return Array.from(out);
}

/**
 * 아직 본문에 인라인돼 있는 이미지들(`data:` URL) — 별도 저장소로 옮길 대상.
 * `{ kind, id }`로 어디에 붙어 있는지까지 알려 준다(옮긴 뒤 그 자리를 참조로 바꾼다).
 */
export interface InlineImage {
  kind: 'node' | 'float';
  id: string;
  dataUrl: string;
}

/**
 * 인라인 이미지를 참조로 갈아 끼운 **새 문서**를 만든다(`byDataUrl`: 데이터 URL →
 * 참조). 옮기지 못한 것은 그대로 둔다 — 일부만 올라가도 문서는 언제나 온전하다.
 * 순수 함수: 바뀐 곳만 새 객체가 되고 나머지는 참조가 유지된다(CRDT diff가 그
 * 항등성을 읽어 실제로 바뀐 필드만 연산으로 만든다).
 */
export function replaceInlineImages(doc: Doc, byDataUrl: Record<string, string>): Doc {
  let touched = false;
  const nodes = { ...doc.nodes };
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    const ref = n?.img ? byDataUrl[n.img] : undefined;
    if (!ref) continue;
    nodes[id] = { ...n!, img: ref };
    touched = true;
  }
  const floats = doc.floats.map((f) => {
    const ref = f.img ? byDataUrl[f.img] : undefined;
    if (!ref) return f;
    touched = true;
    return { ...f, img: ref };
  });
  return touched ? { ...doc, nodes, floats } : doc;
}

export function collectInlineImages(doc: Doc): InlineImage[] {
  const out: InlineImage[] = [];
  for (const id of Object.keys(doc.nodes)) {
    const img = doc.nodes[id]?.img;
    if (typeof img === 'string' && img.startsWith('data:')) out.push({ kind: 'node', id, dataUrl: img });
  }
  for (const f of doc.floats) {
    if (typeof f.img === 'string' && f.img.startsWith('data:')) out.push({ kind: 'float', id: f.id, dataUrl: f.img });
  }
  return out;
}
