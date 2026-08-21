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
