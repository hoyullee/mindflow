/**
 * 임베드 판이 **마지막에 몇 px이었나** — 다시 들어왔을 때 그 높이로 자리를 잡아 둔다.
 *
 * 왜 문서가 아니라 기기에 남기나(요청: "마지막 블럭의 크기를 기억하고 재진입 시에도
 * 해당 크기로 유지"): 이 값은 내용이 아니라 **그려진 결과**다. 문서에 쓰면 ①공책을
 * 열어 보기만 해도 `updatedAt`이 찍혀 목록이 "방금 수정"이 되고 ②undo 한 단계가
 * 생기며 ③보기 전용 사용자는 아예 남기지 못한다. 스크롤 위치와 같은 갈래라 기기에
 * 둔다 — 다른 기기에서 처음 열면 그 종류의 기본 높이로 시작한다(한 번 그리고 나면
 * 그 기기도 기억한다).
 */

const KEY = 'mf_embed_h';
/** 터무니없는 값을 물려받지 않게 자른다(0이나 화면 몇 배는 남기지 않는다). */
const MIN = 120;
const MAX = 900;
/** 오래된 것부터 버린다 — 공책을 많이 여는 계정에서 무한히 자라지 않게. */
const CAP = 300;

type Store = Record<string, number>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const out = JSON.parse(raw) as unknown;
    return out && typeof out === 'object' ? (out as Store) : {};
  } catch {
    return {};
  }
}

/** 이 블록이 마지막에 차지했던 높이(px). 모르면 `null`. */
export function readEmbedHeight(blockId: string): number | null {
  const v = read()[blockId];
  return typeof v === 'number' && v >= MIN && v <= MAX ? v : null;
}

/**
 * 그려진 높이를 남긴다. 범위 밖이면 **적지 않는다** — 아직 0인 첫 프레임이나
 * 접힌 판을 기억해 두면 다음 진입이 더 나빠진다.
 */
export function writeEmbedHeight(blockId: string, h: number): void {
  if (!Number.isFinite(h) || h < MIN || h > MAX) return;
  const px = Math.round(h);
  try {
    const store = read();
    if (store[blockId] === px) return;
    // 다시 넣어 **가장 최근**으로 만든다(객체의 키 순서 = 넣은 순서).
    delete store[blockId];
    store[blockId] = px;
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - CAP))) delete store[k];
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 사파리 비공개 모드처럼 쓸 수 없는 곳이 있다 — 기억을 못 할 뿐 기능은 그대로다.
  }
}
