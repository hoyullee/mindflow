// 문서 버전 히스토리 — **이 기기(브라우저) 로컬** 스냅샷 보관함.
//
// 저장이 성공할 때마다 직렬화된 본문을 localStorage(`mindflow_hist_<docId>`)에
// 쌓는다. 서버 테이블이 아니라 로컬인 이유: 본문에 이미지가 base64로 인라인이라
// 판마다 서버에 쌓으면 무료 티어 저장량/egress가 감당이 안 되고(썸네일 비용 절감
// 작업과 같은 제약), 로컬이면 오프라인·데모 모드에서도 똑같이 동작한다.
// 트레이드오프: 기록은 기기별이다 — UI가 "이 기기에서의 기록"임을 밝힌다.
//
// 알갱이(granularity): 마지막 스냅샷이 MIN_INTERVAL 안이면 새 항목을 만들지 않고
// **마지막 항목을 갱신**한다 — 자동저장(0.9초)마다 판이 쌓여 금방 넘치는 것을
// 막으면서도 최신 상태는 항상 잡혀 있다(IntelliJ 로컬 히스토리와 같은 방식).

import type { Doc } from '@mindflow/mindmap-core';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';

export interface VersionEntry {
  /** 스냅샷 시각(ms). 항목의 id 역할도 한다. */
  at: number;
  /** 직렬화된 본문(JSON 문자열). */
  body: string;
  /** 기록 시점의 노드 수 — 목록에 파싱 없이 보여 주기 위한 메타. */
  nodes: number;
}

const KEY_PREFIX = 'mindflow_hist_';
/** 문서당 최대 항목 수. */
export const MAX_ENTRIES = 30;
/** 문서당 저장 총량 상한(문자 수 ≈ UTF-16 코드 유닛). 이미지 인라인 문서가
 * localStorage(통상 5MB)를 독차지하지 않게 — 넘치면 오래된 것부터 버린다. */
export const MAX_TOTAL_CHARS = 3_000_000;
/** 이 간격 안의 연속 저장은 마지막 항목을 갱신한다(새 판을 만들지 않음). */
export const MIN_INTERVAL_MS = 3 * 60_000;

function keyOf(docId: string): string {
  return `${KEY_PREFIX}${docId}`;
}

function load(docId: string): VersionEntry[] {
  try {
    const raw = localStorage.getItem(keyOf(docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is VersionEntry => !!e && typeof (e as VersionEntry).at === 'number' && typeof (e as VersionEntry).body === 'string');
  } catch {
    return [];
  }
}

function store(docId: string, entries: VersionEntry[]): void {
  try {
    localStorage.setItem(keyOf(docId), JSON.stringify(entries));
  } catch {
    // 쿼터 초과 — 오래된 절반을 버리고 한 번 더. 그래도 안 되면 조용히 포기
    // (히스토리는 부가 기능이다 — 저장 자체를 방해하면 안 된다).
    try {
      localStorage.setItem(keyOf(docId), JSON.stringify(entries.slice(Math.ceil(entries.length / 2))));
    } catch {
      /* give up */
    }
  }
}

/** 상한(개수·총량)을 적용해 오래된 항목부터 버린 목록을 돌려준다. */
function enforceCaps(entries: VersionEntry[]): VersionEntry[] {
  let out = entries.slice(-MAX_ENTRIES);
  let total = out.reduce((acc, e) => acc + e.body.length, 0);
  while (out.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= out[0]!.body.length;
    out = out.slice(1);
  }
  return out;
}

/**
 * 저장 성공 직후 호출 — 현재 본문을 스냅샷으로 기록한다.
 * `force`면 간격 규칙을 건너뛰고 **항상 새 항목**을 만든다(복원 직전의 현재
 * 상태 보존용 — 갱신으로 합쳐지면 "복원 전으로 돌아가기"가 사라진다).
 */
export function recordVersion(docId: string, doc: Doc, opts?: { force?: boolean; now?: number }): void {
  if (!docId) return;
  const now = opts?.now ?? Date.now();
  const body = JSON.stringify(serializeDoc(doc));
  const entries = load(docId);
  const last = entries[entries.length - 1];
  if (last && last.body === body) return; // 내용이 그대로면 기록할 것도 없다
  // 화이트보드는 주제가 늘 0이라 "주제 0개"가 판을 구별해 주지 못한다 —
  // 내용의 단위인 메모(플로트) 수를 대신 센다(표시 라벨도 함께 갈린다).
  const nodes = doc.kind === 'board' ? doc.floats.length : Object.keys(doc.nodes).length;
  if (!opts?.force && last && now - last.at < MIN_INTERVAL_MS) {
    entries[entries.length - 1] = { at: now, body, nodes };
  } else {
    entries.push({ at: now, body, nodes });
  }
  store(docId, enforceCaps(entries));
}

/** 목록(최신 먼저) — 본문 없이 메타만. */
export function listVersions(docId: string): Array<{ at: number; nodes: number; chars: number }> {
  return load(docId)
    .map((e) => ({ at: e.at, nodes: e.nodes, chars: e.body.length }))
    .reverse();
}

/** 특정 시각의 본문(직렬화 문자열) — 미리보기(`realPreview`)가 그대로 먹는 형태. */
export function versionBody(docId: string, at: number): string | null {
  return load(docId).find((e) => e.at === at)?.body ?? null;
}

/** 특정 시각의 스냅샷을 Doc으로 — 복원용. 손상됐으면 null. */
export function versionDoc(docId: string, at: number): Doc | null {
  const body = versionBody(docId, at);
  if (!body) return null;
  try {
    return parseDoc(JSON.parse(body));
  } catch {
    return null;
  }
}
