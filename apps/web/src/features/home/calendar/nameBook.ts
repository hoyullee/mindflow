/**
 * 이름 장부 — 이 탭이 **어디서든 한 번 본** 이메일→이름을 기억한다(제보: 같은 사람이
 * "일정을 만든 사람"에서는 이름으로, 참석자에서는 이메일 앞부분으로 보였다).
 *
 * 왜 갈렸나: 구글은 `organizer`에는 `displayName`을 잘 실어 주지만 `attendees`에는
 * 자주 비워 둔다. 우리는 자리마다 **그 자리에 온 값만** 봤으므로 같은 사람이 두
 * 이름을 얻었다. 디렉터리 검색(선택 스코프)이 메우기도 하지만, 스코프가 없거나
 * 검색이 그 사람을 못 찾으면 로컬파트로 떨어진다.
 *
 * 그래서 원천을 하나로 모은다: 받아 온 모든 일정의 주최자·참석자 이름, 디렉터리
 * 검색 결과, 사용자가 후보에서 고른 이름 — 어디서 알게 됐든 여기 적고, 화면은
 * 여기서 읽는다. 같은 사람은 어느 자리에서나 같은 이름이다.
 *
 * 순수 모듈(DOM 없음). 계정을 바꾸면(연결 해제·다른 계정 연결) 비운다 — 이름은
 * 계정의 디렉터리에서 온 것이라 다음 계정에 남기면 안 된다.
 */

const book = new Map<string, string>();

const key = (email: string): string => email.trim().toLowerCase();

/** 이름을 적는다 — 이미 아는 사람은 **덮지 않는다**(먼저 본 값이 대개 구글이 준 값이다). */
export function rememberName(email: string, name: string | undefined | null): void {
  const k = key(email);
  const n = (name ?? '').trim();
  if (!k || !n || n === k || book.has(k)) return;
  book.set(k, n);
}

/** 여러 명을 한 번에. */
export function rememberNames(names: Record<string, string> | undefined | null): void {
  if (!names) return;
  for (const [email, name] of Object.entries(names)) rememberName(email, name);
}

/** 아는 이름, 없으면 `undefined`(없는 이름을 지어내지 않는다 — 로컬파트는 화면이 정한다). */
export function knownName(email: string): string | undefined {
  return book.get(key(email));
}

/** 주어진 이메일들 중 아는 것만 `이메일→이름`으로 — 필드 묶음의 `names`에 섞어 쓴다. */
export function knownNamesFor(emails: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of emails) {
    const n = book.get(key(e));
    if (n) out[e] = n;
  }
  return out;
}

export function clearNameBook(): void {
  book.clear();
}
