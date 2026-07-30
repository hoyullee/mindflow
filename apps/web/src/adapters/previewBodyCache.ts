// 홈 썸네일 본문의 로컬 캐시 — `SupabaseDocStore.loadPreview`가 쓴다.
//
// 키는 (docId, version, updatedAt):
// - `version`은 낙관적 잠금 카운터라 저장마다 단조 증가 → 같은 (id, version)에
//   서로 다른 본문이 존재할 수 없다(동시 편집 안전). 예외는 prevVersion 없는
//   강제 저장(version 1 재설정) 단 하나인데, 그 경우에도 서버 트리거가 항상
//   새로 찍는 `updated_at`이 키에 함께 들어 있어 캐시가 무효화된다.
// - 협업 중 아직 저장 안 된 CRDT 변경은 원래부터 썸네일에 없다(마지막 저장본).
//
// 저장 위치는 localStorage 단일 키(`mf_` 프리픽스 — 회원 탈퇴의 저장소 wipe에
// 자동 포함). 여러 탭이 동시에 써도 값 자체가 (id, 판)→본문이라 어느 쪽이
// 이겨도 유효하다(last-write-wins 무해). 용량 상한을 넘으면 오래 쓴 것부터
// 버린다 — 캐시는 언제 사라져도 되는 성능 최적화일 뿐이다.

const CACHE_KEY = 'mf_preview_bodies';
/** 이보다 큰 본문은 캐시하지 않는다(이미지 스트립 실패/폴백 전문 등). */
const MAX_BODY_LEN = 200_000;
/** 전체 캐시(직렬화 기준)가 이 크기를 넘으면 오래된 항목부터 정리. */
const MAX_TOTAL_LEN = 1_500_000;
const MAX_ENTRIES = 80;

interface CacheEntry {
  /** version */
  v: number;
  /** updatedAt (ISO) */
  u: string;
  /** 직렬화된 본문 */
  b: string;
  /** 마지막 사용 시각(ms) — LRU 정리용 */
  t: number;
}

type CacheBlob = Record<string, CacheEntry>;

function readAll(): CacheBlob {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as CacheBlob) : {};
  } catch {
    return {};
  }
}

function writeAll(blob: CacheBlob): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(blob));
  } catch {
    // 쿼터 초과 등 — 캐시 전체를 비워 다음 기회에 다시 쌓는다(치명적이지 않음).
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function readPreviewBody(id: string, version: number, updatedAt: string): string | null {
  const blob = readAll();
  const e = blob[id];
  if (!e || e.v !== version || e.u !== updatedAt || typeof e.b !== 'string') return null;
  // LRU touch — 매 조회마다 blob 전체를 다시 쓰면 비싸므로, 시각이 1분 이상
  // 낡았을 때만 갱신한다(정리 정확도엔 충분).
  if (Date.now() - (e.t || 0) > 60_000) {
    e.t = Date.now();
    writeAll(blob);
  }
  return e.b;
}

export function writePreviewBody(id: string, version: number, updatedAt: string, body: string): void {
  if (body.length > MAX_BODY_LEN) return;
  const blob = readAll();
  blob[id] = { v: version, u: updatedAt, b: body, t: Date.now() };
  // 정리: 개수/총량 상한 초과 시 오래 쓴 것부터 제거
  let ids = Object.keys(blob);
  if (ids.length > MAX_ENTRIES || JSON.stringify(blob).length > MAX_TOTAL_LEN) {
    ids = ids.sort((a, b) => (blob[a]!.t || 0) - (blob[b]!.t || 0));
    while (ids.length > 1 && (ids.length > MAX_ENTRIES || JSON.stringify(blob).length > MAX_TOTAL_LEN)) {
      const oldest = ids.shift()!;
      if (oldest === id) continue; // 방금 쓴 항목은 남긴다
      delete blob[oldest];
    }
  }
  writeAll(blob);
}

/** 테스트용 — 캐시 전체 비우기. */
export function clearPreviewBodies(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
}
