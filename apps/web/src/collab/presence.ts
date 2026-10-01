// Shared presence types — the JSON shape stored as each client's `Awareness`
// state (`y-protocols/awareness`). Kept framework-free (no React) so both
// `usePresence.ts` and the editor's rendering components can import just the
// types without pulling in the hook.

export interface PresenceUser {
  name: string;
  color: string;
  /** `true` when this identity came from a real logged-in Supabase session
   * (the user's own email/name) rather than a random "adjective+animal"
   * guest identity — see `identity.ts`. Not currently rendered differently,
   * but kept on the wire in case the UI wants to distinguish later. */
  authed?: boolean;
  /** 프로필 이미지 주소(0031) — 있으면 접속자 아바타가 이 사진을 그린다. 없으면
   * 이름 첫 글자. **awareness로 실어 보낸다**: 상대의 사진을 서버에 다시 물으면
   * 접속자 수만큼 왕복이 늘고, 어차피 지금 붙어 있는 사람의 정보다. */
  avatar?: string | null;
  /**
   * **계정 하나에 하나인 열쇠** — 로그인한 이메일의 짧은 해시(이메일 자체는 싣지 않는다).
   *
   * 왜(제보): 공책에서 혼자 쓰는데 `공유` 옆에 내 얼굴이 하나 더 떴다. awareness는 **연결**
   * 마다 한 칸이라, 같은 계정의 다른 탭·설치형 앱·폰은 물론 재연결 전의 낡은 연결(30초
   * 동안 남는다)도 "또 한 사람"으로 셌다. 얼굴 줄은 연결이 아니라 **사람**을 세야 하므로
   * 이 열쇠로 나를 빼고 겹친 사람을 하나로 접는다(`peopleOf`).
   */
  uid?: string;
}

export interface PresenceCursor {
  /** Canvas (untransformed, pan/zoom-independent) coordinates — the SAME
   * space `useEditorState`'s `toCanvasPoint`/`geom` use, so a remote cursor
   * renders correctly under this tab's own pan/zoom without any conversion. */
  x: number;
  y: number;
}

/** Mirrors `MultiSelection` (`features/editor/types.ts`) plus `zones` (which
 * `MultiSelection` itself deliberately excludes, matching the original's own
 * `msel` — but a single zone selection is real and worth broadcasting, so
 * presence's own selection shape isn't just a re-export of `MultiSelection`). */
export interface PresenceSelection {
  nodes: string[];
  floats: string[];
  lines: string[];
  zones: string[];
}

export const EMPTY_PRESENCE_SELECTION: PresenceSelection = { nodes: [], floats: [], lines: [], zones: [] };

/** One remote client's current awareness state, as stored/retrieved via
 * `Awareness#setLocalState`/`getStates()`. `cursor` is `null` while the
 * pointer isn't over the canvas (or hasn't moved there yet). */
export interface PresenceState {
  user: PresenceUser;
  cursor: PresenceCursor | null;
  selection: PresenceSelection;
}

export interface RemotePeer extends PresenceState {
  /** `Awareness#clientID` of the remote Yjs client — stable per browser tab/
   * connection, unique among currently-connected peers (never this client's
   * own, `usePresence` filters that out). */
  clientId: number;
}

/**
 * 얼굴 줄에 세울 **사람** 목록 — 연결이 아니라 사람을 센다(`PresenceUser.uid` 머리말).
 *
 * - 나와 같은 계정(`uid`가 같다)은 뺀다 — 다른 탭·기기·낡은 연결의 나다.
 * - 같은 계정이 여러 연결로 붙어 있으면 하나로 접는다(처음 것).
 * - `uid`가 없는 옛 클라이언트는 로그인한 이름+색(색은 이메일에서 나온다)으로, 손님은
 *   연결마다 따로 센다(손님은 연결마다 정체가 다르다 — `identity.ts`).
 *
 * 커서·원격 선택·저장 신호는 **연결** 단위가 맞으므로 이 목록이 아니라 `peers`를 그대로 쓴다.
 */
export function peopleOf<P extends { clientId: number; user: PresenceUser }>(peers: P[], me?: PresenceUser | null): P[] {
  const keyOf = (u: PresenceUser, clientId: number): string => (u.uid ? `u:${u.uid}` : u.authed ? `n:${u.name}|${u.color}` : `c:${clientId}`);
  const mine = me ? keyOf(me, -1) : null;
  const seen = new Set<string>();
  const out: P[] = [];
  for (const p of peers) {
    const k = keyOf(p.user, p.clientId);
    if (k === mine || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
