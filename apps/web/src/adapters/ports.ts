// Backend ports — the interfaces every feature (`features/auth`, `features/home`,
// `features/editor`) codes against. Concrete implementations live in
// `adapters/local/*` (demo, no network) and `adapters/supabase/*` (real Postgres +
// Auth). `adapters/factory.ts` picks one based on env; nothing outside this
// directory should import a concrete adapter directly.
//
// `mindmap-core` must NEVER import from here (core purity, ADR-0001 §2) — these
// types live in `apps/web` because they describe I/O (network/storage), which the
// core is intentionally ignorant of. `Doc` itself (the wire format) is the one
// type shared with the core: doc bodies are stored/transmitted exactly as
// `serializeDoc`/`parseDoc` produce/consume them.

import type { Doc } from '@mindflow/mindmap-core';

// ── Auth ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string | null;
  /** Display name from the identity provider (Google `full_name`/`name` in
   * user_metadata). A better DEFAULT than the email local part — the user's
   * explicit rename (profiles.display_name) still wins over it. */
  name?: string | null;
  /** Avatar image URL from the identity provider (Google `avatar_url`/`picture`). */
  avatarUrl?: string | null;
}

export interface AuthSession {
  user: AuthUser;
}

export type AuthChangeListener = (session: AuthSession | null) => void;

export interface AuthResult {
  session: AuthSession | null;
  /** Human-readable, already-localized (Korean) message safe to show as-is. */
  error?: string;
  /** Supabase email-confirmation signup: account created but no session yet
   * (user must click the emailed link / enter the OTP) — surfaced so the UI
   * can route to a "check your email" step instead of treating it as a login. */
  needsVerification?: boolean;
}

/**
 * Everything Login.dc.html's ported flow (`useLoginController`) needs:
 * email/password login+signup, Google OAuth, password reset, and (for the
 * demo/local adapter) a stand-in for the original's 6-digit `demoCode` step.
 */
export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  /**
   * Re-send the signup confirmation email (OTP) for an account that was created
   * but not yet verified — backs the verify step's "다시 보내기" link. Supabase:
   * `auth.resend({ type: 'signup' })`. Local/demo: no-op `{}` (the controller
   * regenerates its client-side demo code instead of hitting a server).
   */
  resendSignup(email: string): Promise<{ error?: string }>;
  signInWithOAuth(provider: 'google'): Promise<{ error?: string }>;
  /**
   * Sign in with an OAuth ID token obtained CLIENT-SIDE (Google Identity
   * Services button) instead of the redirect flow above. The whole exchange
   * happens on our own origin, so Google's consent screen shows geurio.com —
   * not the supabase.co callback domain the redirect flow surfaces. `nonce` is
   * the RAW nonce whose SHA-256 hash was embedded in the token (replay
   * protection); omit it when the token was requested without one.
   */
  signInWithIdToken(provider: 'google', token: string, nonce?: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** Returns an unsubscribe function. */
  onAuthChange(listener: AuthChangeListener): () => void;
  sendPasswordReset(email: string): Promise<{ error?: string }>;
  /**
   * Whether an account exists for `email`. Backs the password-reset form's
   * "가입되지 않은 이메일" warning: `resetPasswordForEmail` always reports success
   * (anti-enumeration), so without this the UI claims a code was sent to
   * addresses that will never receive one. Supabase: the `email_is_registered`
   * SECURITY DEFINER RPC (0008). Returns `null` when the check can't be made
   * (RPC missing/errored, or local/demo mode) — the caller then proceeds with
   * the send rather than blocking on an unknown answer.
   */
  isEmailRegistered(email: string): Promise<boolean | null>;
  verifyOtp(email: string, token: string, type: 'signup' | 'recovery'): Promise<AuthResult>;
  updatePassword(newPassword: string): Promise<{ error?: string }>;
  /**
   * Permanently deletes the signed-in user's account and every row they own
   * (documents, workspace, profile) and signs them out. Irreversible. Returns
   * `{ error }` on failure so the caller can keep the user on the page. In
   * Supabase mode this calls the `delete_account()` RPC (SECURITY DEFINER),
   * which deletes the `auth.users` row — cascading to all owned tables via
   * their `on delete cascade` FKs. In local/demo mode it wipes the browser's
   * MindFlow storage.
   */
  deleteAccount(): Promise<{ error?: string }>;
  /**
   * The signed-in user's display name (`profiles.display_name` in Supabase),
   * or `null` if unset. Lets a renamed profile survive a browser-cache clear
   * and sync across devices. Local/demo mode returns `null` (there's no server;
   * the app keeps a per-browser localStorage copy for that mode).
   */
  getProfileName(): Promise<string | null>;
  /** Persist the signed-in user's display name. No-op (returns `{}`) in local mode. */
  setProfileName(name: string): Promise<{ error?: string }>;
}

// ── Documents ──────────────────────────────────────────────────────────────

export interface DocMeta {
  id: string;
  title: string;
  /** Optimistic-lock counter — incremented on every successful `save()`. */
  version: number;
  updatedAt: string;
  isFavorite: boolean;
  /** Soft-delete timestamp (trash). `null` = not deleted. */
  deletedAt: string | null;
  /**
   * 이 문서가 **내 것**인가. 공유가 생기면서 `list()`가 남이 나에게 공유한 문서까지
   * 돌려주므로, 홈이 그것을 자기 스페이스의 카드로 삼지 않도록(워크스페이스 블롭은
   * per-user다) 구분이 필요하다. 없으면 `true`로 본다 — 공유 이전에 만들어진
   * 호출부·테스트가 그대로 동작하게.
   */
  ownedByMe?: boolean;
  /** 공유받은 문서일 때의 내 권한. 내 문서면 undefined. */
  sharedRole?: ShareRole;
}

export interface LoadedDoc {
  doc: Doc;
  version: number;
  title: string;
}

export type SaveResult =
  | { ok: true; version: number }
  /** `prevVersion` didn't match the server's current version — someone else
   * (another tab/device) saved first. Caller decides how to reconcile
   * (reload, prompt, force-overwrite with a fresh `save()` call). */
  | { ok: false; reason: 'conflict'; currentVersion: number }
  | { ok: false; reason: 'error'; message: string };

export interface SaveOptions {
  /** Omit for "create or force-write regardless of current version" (e.g. the
   * very first save of a brand-new map). Provide the last-known version for
   * optimistic locking. */
  prevVersion?: number;
  title?: string;
  /**
   * "만들기만 한다" — 그 id의 문서가 **이미 있으면 덮어쓰지 않고** `conflict`를
   * 돌려준다. `prevVersion`을 줄 수 없는 최초 저장(버전을 모르니 잠글 수도 없다)에서
   * 남의 문서를 조용히 날리지 않기 위한 안전장치다.
   *
   * 왜 필요한가: 가져온 맵의 id는 예전엔 `mapId(제목)` — 제목만 같으면 같은 id였다.
   * 두 기기에서 같은 제목을 각각 가져오면 둘 다 "새 문서"라고 여겨 같은 행에 쓰고,
   * 뒤에 저장한 쪽이 앞의 내용을 조용히 지웠다. 이제 가져오기는 랜덤 id를 쓰므로
   * 충돌 자체가 사실상 불가능하지만, 그 가정이 깨져도 **데이터가 사라지지 않게**
   * 이 플래그로 확인 사살을 막는다(호출부는 새 id로 다시 시도한다).
   *
   * `prevVersion`과 함께 주면 의미가 없으므로 무시된다(그쪽이 이미 잠금이다).
   */
  createOnly?: boolean;
}

// ── Sharing (사람 사이의 공동 편집) ──────────────────────────────────────

/**
 * 공유 권한. `view`는 스키마·정책에만 있고 UI는 아직 `edit`만 제공한다 — 뷰어를
 * 제대로 만들려면 CRDT로 자기 편집이 상대에게 전파되는 것부터 막아야 한다
 * (`supabase/migrations/0009_document_shares.sql` 참고).
 */
export type ShareRole = 'edit' | 'view';

/** 한 문서에 걸린 초대 하나. */
export interface DocumentShare {
  documentId: string;
  /** 초대받은 사람의 이메일(소문자). 사용자 id가 아닌 이유는 0009 마이그레이션 참고 —
   * 클라이언트는 `auth.users`를 읽을 수 없고, 미가입자도 초대할 수 있어야 한다. */
  email: string;
  role: ShareRole;
  createdAt: string;
}

/** 내가 공유받은 문서 하나(홈의 "공유받은 맵" 섹션이 읽는다). */
export interface SharedWithMe {
  documentId: string;
  role: ShareRole;
}

/**
 * 공유 팝업에 보여줄 참가자 한 명 — 소유자 또는 초대받은 사람. 클라이언트는
 * `auth.users`를 못 읽으므로 이메일 ↔ 프로필명 연결은 서버 RPC(0011
 * `share_participants`)가 해 준다. 문서에 접근할 수 있는 사람(소유자 + 초대받은
 * 사람) 전원이 같은 명단을 본다 — 함께 편집하는 사이에 참가자를 숨기지 않는다
 * (실사용 제보로 0010의 "소유자만 전체"에서 넓힘). 초대·취소 권한은 별개다(RLS).
 */
export interface ShareParticipant {
  kind: 'owner' | 'invitee';
  email: string;
  /** 프로필명(가입 시 자동 시드 — 0006). 알 수 없으면 null → UI가 이메일로 폴백. */
  displayName: string | null;
  /** 이 이메일로 가입된 계정이 있는가. 초대만 되고 가입 전이면 false("가입 대기"). */
  joined: boolean;
  /** 권한. 소유자 행은 항상 'edit'. */
  role: ShareRole;
}

/**
 * 문서 공유 관리. 실제 접근 제어는 **DB의 RLS**가 한다(0009) — 이 포트는 초대
 * 목록을 읽고 쓰는 창구일 뿐이고, 여기서 무엇을 허용하든 서버가 다시 판단한다.
 */
export interface ShareStore {
  /** 그 문서에 걸린 초대 목록. 소유자만 전체를 볼 수 있다(RLS). */
  list(documentId: string): Promise<DocumentShare[]>;
  /** 초대(이미 있으면 권한만 갱신). 이메일은 어떻게 넘겨도 소문자로 정규화된다. */
  add(documentId: string, email: string, role?: ShareRole): Promise<{ error?: string }>;
  /** 초대 취소. 소유자는 누구든, 초대받은 사람은 자기 자신만(= 공유 나가기). */
  remove(documentId: string, email: string): Promise<{ error?: string }>;
  /** 나에게 공유된 문서들. */
  listSharedWithMe(): Promise<SharedWithMe[]>;
  /**
   * 공유 팝업용 참가자 정보(소유자 + 초대받은 사람의 프로필명/가입 여부).
   * `null` = 정보를 얻을 수 없음(RPC 미적용 서버, 일시 오류) — UI는 이메일만
   * 보여주는 기존 렌더로 폴백한다. 실패해도 공유 자체는 동작해야 하므로 throw하지
   * 않는다.
   */
  listParticipants(documentId: string): Promise<ShareParticipant[] | null>;
}

/**
 * Document CRUD + list, shared by `features/home` (map grid, favorites, trash)
 * and `features/editor` (load/autosave). Doc bodies are the core's `Doc`
 * (`serializeDoc`/`parseDoc` wire format) — stored as opaque JSON(B) server-side.
 */
export interface DocStore {
  list(): Promise<DocMeta[]>;
  load(id: string): Promise<LoadedDoc | null>;
  save(id: string, doc: Doc, opts?: SaveOptions): Promise<SaveResult>;
  /** Soft-delete (moves to trash; `list()` still returns it with `deletedAt` set). */
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** HARD delete — the doc body and meta are gone for good (`list()` no longer
   * returns it). Irreversible; only reachable from the trash UI behind a
   * confirm dialog. Must be idempotent (purging an unknown id is a no-op). */
  purge(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
}

// ── Spaces (per-user workspace structure) ────────────────────────────────

/**
 * The user's workspace structure: their spaces (id/name/color/home + each
 * space's maps and folders) and the map→folder assignment. Stored as one
 * opaque JSON blob per user so it syncs across every device they log in on
 * (Supabase mode) — or per-browser (local/demo mode). The concrete shape of
 * `spaces` is owned by `features/home` (`SpaceData[]`); this port treats it as
 * JSON, so it's typed `unknown[]` here and validated on the feature side.
 */
export interface WorkspaceData {
  spaces: unknown[];
  mapFolders: Record<string, string>;
  /** Titles of recently-opened maps, most-recent first. Synced per-user (like
   * `spaces`/`mapFolders`) so the "recent items" list follows the user across
   * devices. Optional for backward-compat with workspaces saved before it
   * existed — treat a missing value as "no synced recents yet". */
  recent?: string[];
}

/**
 * Loads/saves the current user's `WorkspaceData`. `load()` resolves `null` when
 * the user has no saved workspace yet (first run). Implementations are
 * per-user: Supabase keys by `auth.uid()` (RLS-enforced), local by a single
 * `localStorage` key.
 */
export interface SpaceStore {
  load(): Promise<WorkspaceData | null>;
  save(data: WorkspaceData): Promise<void>;
}

// ── Backend bundle ───────────────────────────────────────────────────────

export interface Backend {
  auth: AuthProvider;
  docStore: DocStore;
  /** Per-user spaces/folders structure (cross-device in Supabase mode). */
  spaceStore: SpaceStore;
  /** 문서 공유(초대 목록). 로컬/데모 모드에서도 같은 계약으로 동작한다. */
  shareStore: ShareStore;
  /** `'local'` = demo/localStorage fallback (no env configured); `'supabase'`
   * = real Postgres + Auth. Used to decide whether auth routes are gated. */
  mode: 'local' | 'supabase';
}
