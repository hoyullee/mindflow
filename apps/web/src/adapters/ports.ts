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
  /** **이번 로그인에 쓴 수단**(Supabase `app_metadata.provider`) — 'email' | 'google' …
   * 계정에 연결된 수단이 여럿일 때 "무엇으로 들어왔는가"를 구분하는 유일한 값이다. */
  signInProvider?: string | null;
  /** 이 계정에 **연결된 수단 전부**(Supabase `app_metadata.providers`). */
  linkedProviders?: string[];
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
/** 이 계정에 붙어 있는 로그인 수단(설정 → 로그인 수단). */
export interface SigninMethods {
  /** 비밀번호가 걸려 있는가 = 이메일·비밀번호로 들어올 수 있는가. */
  hasPassword: boolean;
  /** 연결된 소셜 신원 목록(`'google'` …). 이메일 가입 계정은 `'email'`도 담는다. */
  providers: string[];
}

/** `AuthProvider.signOut`의 범위 — 세션 정책의 유일한 손잡이. */
export type SignOutScope = 'local' | 'global' | 'others';

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
  /**
   * 로그아웃 범위(세션 정책 — `server/supabase/docs/backend.md` §15):
   * - `'local'`(기본) = 이 기기의 세션만. 다른 기기는 그대로 로그인 상태다.
   * - `'global'` = **모든 기기**의 세션 해지(기기 분실·공용 PC 회수 수단).
   * - `'others'` = 지금 이 세션만 남기고 나머지 해지(비밀번호 변경 뒤에 쓴다).
   * 로컬/데모 어댑터는 세션이 하나뿐이라 범위와 무관하게 그 하나를 지운다.
   */
  signOut(scope?: SignOutScope): Promise<void>;
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
  /**
   * 그 이메일이 **어떤 방법으로** 가입돼 있는지 — `['google']`, `['email']`,
   * 둘 다 연결됐다면 `['email','google']`, 미가입이면 `[]`. 확인 불가(로컬
   * 모드·RPC 미배포·네트워크 실패)면 `null`.
   *
   * 왜 필요한가: Supabase `signUp`은 이메일 열거 방지로 **이미 가입된 주소에도
   * 성공을 돌려준다** — 메일은 발송되지 않는데 UI는 인증 코드 화면으로 넘어가
   * 사용자가 영영 코드를 기다리게 된다(제보: Google로 가입한 계정으로 이메일
   * 가입 시도). 가입 전에 이 목록을 확인해 "이미 Google로 가입된 계정"임을
   * 알려 주고 막는다. Supabase는 `email_signin_providers` RPC(0013).
   */
  emailSignInProviders(email: string): Promise<string[] | null>;
  verifyOtp(email: string, token: string, type: 'signup' | 'recovery'): Promise<AuthResult>;
  updatePassword(newPassword: string): Promise<{ error?: string }>;
  /**
   * 로그인한 사용자가 **스스로** 비밀번호를 바꾼다(설정 → 비밀번호 변경).
   *
   * 복구 흐름의 `updatePassword`와 다른 점은 **현재 비밀번호 확인**이다: Supabase는
   * 세션만 있으면 비밀번호를 바꿔 주므로, 공용 PC에 남은 로그인으로 남이 비밀번호를
   * 갈아 계정을 가져가는 것을 막으려면 본인 확인이 필요하다(업계 관례).
   * 성공하면 `updatePassword`와 같은 규칙으로 **다른 기기의 세션을 해지**한다(§15).
   *
   * 오류는 원문(영문)을 그대로 돌려준다 — 문구 번역은 호출부(`localizeAuthError`)가
   * 맡되, "현재 비밀번호가 틀렸다"는 이 어댑터가 아는 사실이라 전용 코드로 구분한다.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string; wrongCurrent?: boolean }>;
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
  /**
   * 프로필 이미지를 바꾼다(요청). `blob`이 있으면 올리고, `null`이면 지운다.
   *
   * 성공하면 새 주소(또는 지웠으면 `null`)를 돌려준다 — 화면은 그 값을 바로 쓰고,
   * 다음 세션부터는 `AuthUser.avatarUrl`이 같은 값을 준다(같은 칸을 쓴다).
   */
  updateAvatar(blob: Blob | null): Promise<{ url?: string | null; error?: string }>;
  /**
   * 내 계정의 **로그인 수단** — 설정 → 로그인 수단이 읽는다. 확인 불가(RPC 미배포·
   * 네트워크 실패)면 `null`(그때 화면은 "확인할 수 없어요"로 말하고 잠그지 않는다).
   *
   * `hasPassword`를 신원 목록으로 대신할 수 없다: Google로 가입한 사용자가 나중에
   * 비밀번호를 설정해도 identities에는 'email'이 생기지 않는다 — 그래서 Supabase는
   * `my_signin_methods()` RPC(0029)가 `auth.users.encrypted_password`를 직접 본다.
   */
  signinMethods(): Promise<SigninMethods | null>;
  /**
   * 비밀번호를 **처음 설정**하기 전 본인 확인 코드를 계정 이메일로 보낸다
   * (Supabase `auth.reauthenticate()` — 6자리 nonce 메일).
   *
   * 왜 코드를 거치나: Google로 가입한 계정에는 확인할 현재 비밀번호가 없다. 세션만
   * 있으면 비밀번호를 걸 수 있게 두면 공용 PC에 남은 로그인으로 남이 두 번째 출입구를
   * 만들 수 있다 — "이 메일함의 주인인가"가 그 자리의 본인 확인이다.
   */
  sendPasswordSetupCode(): Promise<{ error?: string }>;
  /** 메일로 받은 코드로 본인을 확인하고 비밀번호를 설정한다(Supabase
   * `updateUser({ password, nonce })`). 코드가 틀리면 `wrongCode`. */
  setPasswordWithCode(code: string, newPassword: string): Promise<{ error?: string; wrongCode?: boolean }>;
  /**
   * 비밀번호를 설정한 계정에 **이메일 신원(identity)을 등록**한다 — 새로 만들었으면 `true`.
   *
   * 왜 필요한가: Supabase는 연결 해제 시 신원을 최소 하나 요구하는데
   * `updateUser({ password })`는 `auth.identities`에 'email'을 만들지 않는다(비밀번호는
   * 신원이 아니다). 그래서 Google로 가입한 계정은 비밀번호를 설정해도 신원이
   * `['google']` 하나뿐이라 Google을 뗄 수 없었다(제보). 이 호출이 그 빈자리를 메운다.
   * Supabase는 `register_email_identity()` RPC(0030) — 조건(본인·확인된 이메일·비밀번호
   * 있음·중복 없음)은 SQL에 못박혀 있다. 만들지 않았으면(또는 못 했으면) `false`.
   */
  registerEmailIdentity(): Promise<boolean>;
  /**
   * 이 계정에 Google 로그인을 **연결**한다(Supabase `auth.linkIdentity` — 리다이렉트).
   * Supabase 대시보드에서 Manual Linking을 켜 두어야 동작한다(backend.md §16).
   */
  linkGoogle(): Promise<{ error?: string }>;
  /** 연결된 Google 로그인을 **해제**한다. 남는 수단이 없으면(비밀번호도 없다면)
   * 계정에 들어올 길이 사라지므로 호출부가 먼저 막는다. */
  unlinkGoogle(): Promise<{ error?: string }>;
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
  /**
   * 이 문서를 **마지막으로 저장한 사람이 나인가**(0015 `documents.updated_by`).
   * 홈 카드는 이 값이 `false`일 때만 편집자 이름을 붙인다 — 혼자 쓰는 사람의
   * 카드마다 자기 이름이 반복되면 정보가 아니라 잡음이다.
   *
   * `undefined` = 알 수 없음: 아직 한 번도 저장되지 않은 옛 행(`updated_by` null),
   * 세션에서 내 uid를 못 읽은 경우, 로컬/데모 모드. 그때는 이름을 표시하지 않는다.
   */
  editedByMe?: boolean;
}

export interface LoadedDoc {
  doc: Doc;
  version: number;
  title: string;
  /**
   * 이 문서가 **내 것**인가. 링크 공유(0017) 이후로 필요해졌다: 링크로 들어온
   * 사람은 `document_shares`에 행이 없어서 초대 목록만으로는 소유자와 구별되지
   * 않는다(둘 다 "내 행 없음"). 그러면 뷰어에게 편집 UI를 내주고 저장은 서버가
   * 거부하는 화면이 된다.
   *
   * `undefined` = 알 수 없음(로컬/데모 모드) — 호출부는 기존 동작(편집)을 유지한다.
   */
  ownedByMe?: boolean;
}

export type SaveResult =
  | { ok: true; version: number }
  /** `prevVersion` didn't match the server's current version — someone else
   * (another tab/device) saved first. Caller decides how to reconcile
   * (reload, prompt, force-overwrite with a fresh `save()` call). */
  | { ok: false; reason: 'conflict'; currentVersion: number }
  /**
   * 그 id의 행이 **이미 있는데 내가 읽을 수도 없다** = 다른 계정의 문서다.
   *
   * 왜 별도 결과인가: RLS는 "행이 없다"와 "행이 있지만 안 보인다"를 똑같이
   * 빈 결과로 만든다. 그래서 `load()`가 `null`이면 호출부는 신규 문서로 오해하고
   * 강제로 써 버렸고, 그 쓰기가 남의 행에 부딪혀 Supabase 로그에 42501
   * (`row-level security policy (USING expression)`)이 반복해서 쌓였다(제보).
   * 이 결과를 받은 호출부는 그 id를 포기하고 **새 id로 옮겨 저장**해야 한다.
   */
  | { ok: false; reason: 'idTaken' }
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
  /**
   * 내가 이 공유를 **확인한 시각**(0019). `null`이면 아직 못 본 초대 —
   * 홈의 "공유받음" 배지가 이걸 센다. 서버에 두는 이유는 기기 간 일관성이다:
   * 폰에서 확인한 배지가 PC에서 또 뜨면 알림이 아니라 소음이 된다.
   * 값을 못 얻는 환경(구 서버·오류)에서는 `undefined` — 배지를 띄우지 않는다
   * (없는 알림을 만들어 내는 쪽이 더 나쁘다).
   */
  seenAt?: string | null;
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
  /** 프로필 이미지 주소(0031) — 없으면 null(화면은 이름 첫 글자로 그린다). */
  avatarUrl?: string | null;
  /** 그 사람의 계정 id(0031). 댓글 작성자(`DocComment.authorId`)를 잇는 열쇠다. */
  userId?: string | null;
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
   * 이 공유들을 "봤다"고 표시한다(배지에서 뺀다). 부가 기능이므로 실패해도
   * throw하지 않는다 — 알림 표시가 맵 열기를 막아서는 안 된다.
   */
  markSharedSeen(documentIds: string[]): Promise<void>;
  /**
   * 방금 만든 초대를 **메일로** 알린다(초대 알림 ②).
   *
   * `add()`가 아니라 별도 메서드인 이유: "처음 초대인가"는 초대 목록을 들고 있는
   * 화면만 안다(`add`는 upsert라 권한 변경과 구분되지 않는다). 같은 사람에게 같은
   * 알림을 반복하면 스팸으로 읽히므로, 보낼지 말지는 호출부가 정한다.
   *
   * 실패해도 throw하지 않는다 — 초대는 이미 걸렸고 앱 안 배지가 그 사실을 알린다.
   */
  notifyInvite(documentId: string, email: string): Promise<void>;
  /**
   * 공유 팝업용 참가자 정보(소유자 + 초대받은 사람의 프로필명/가입 여부).
   * `null` = 정보를 얻을 수 없음(RPC 미적용 서버, 일시 오류) — UI는 이메일만
   * 보여주는 기존 렌더로 폴백한다. 실패해도 공유 자체는 동작해야 하므로 throw하지
   * 않는다.
   */
  listParticipants(documentId: string): Promise<ShareParticipant[] | null>;
  /**
   * 링크 공유 상태(0017). `'view'` = 링크를 아는 **로그인한** 사람이 열람 가능,
   * `null` = 꺼짐. 조회 불가(구 서버·오류)도 `null`로 본다 — 켜져 있는데 꺼진 것으로
   * 보이는 쪽이 안전하다(UI가 실수로 "공유 중"이라 말하지 않는다).
   */
  getLink(documentId: string): Promise<ShareRole | null>;
  /** 링크 공유를 켜고 끈다. 소유자만(RLS). `null` = 끄기. */
  setLink(documentId: string, role: ShareRole | null): Promise<{ error?: string }>;
  /**
   * **내가 공유해 둔** 문서들의 요약 — 홈 맵 카드의 "공유 중" 표식이 읽는다.
   * docId → { 초대 수, 링크 공유 여부 }. 한 번의 조회로 전 카드를 커버해야 하므로
   * (카드마다 `list()`를 부르면 왕복이 카드 수만큼 난다) 목록 전체를 돌려준다.
   * 조회 실패(구 서버·오류)는 빈 객체 — 표식이 빠질 뿐 홈은 그대로 동작한다.
   */
  listSharedByMe(): Promise<Record<string, { invitees: number; link: boolean }>>;
}

/**
 * Document CRUD + list, shared by `features/home` (map grid, favorites, trash)
 * and `features/editor` (load/autosave). Doc bodies are the core's `Doc`
 * (`serializeDoc`/`parseDoc` wire format) — stored as opaque JSON(B) server-side.
 */
export interface DocStore {
  list(): Promise<DocMeta[]>;
  load(id: string): Promise<LoadedDoc | null>;
  /**
   * 홈 썸네일 전용 본문 — `realPreview`가 그대로 파싱할 직렬화 JSON 문자열
   * (`null` = 본문 없음). `load()`와 분리한 이유는 비용이다: 이미지 첨부가
   * 본문 jsonb 안에 data URL로 인라인이라, 썸네일이 전문을 받으면 카드마다
   * 수백 KB~수 MB가 실려 온다(무료 egress 잠식).
   *
   * - Supabase: `preview_doc` RPC(0012)로 **이미지 데이터만 자리표시 문자열로
   *   바꾼** 본문을 받고(크기 필드는 유지 — 박스 계산 불변), `(id, version,
   *   updatedAt)` 키의 localStorage 캐시로 같은 판을 재방문할 때 네트워크를
   *   건너뛴다. RPC 미적용 서버는 `load()` 전문으로 폴백.
   * - Local: localStorage 본문 그대로(네트워크 비용이 없어 캐시·스트립 불필요).
   *
   * 동시 편집 안전성: `version`은 저장마다 낙관적 잠금으로만 증가하므로
   * (id, version)→본문은 원칙적으로 유일하고, 유일성이 깨질 수 있는 단 하나의
   * 경로(prevVersion 없는 강제 저장 — version 1로 재설정)는 서버가 항상 새로
   * 찍는 `updatedAt`이 캐시 키에 함께 들어가 무효화한다. 협업 중 아직 저장되지
   * 않은 CRDT 변경은 지금까지도 썸네일에 없었다(마지막 저장본) — 무회귀.
   */
  loadPreview(id: string, meta?: { version: number; updatedAt: string }): Promise<string | null>;
  save(id: string, doc: Doc, opts?: SaveOptions): Promise<SaveResult>;
  /** Soft-delete (moves to trash; `list()` still returns it with `deletedAt` set). */
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** HARD delete — the doc body and meta are gone for good (`list()` no longer
   * returns it). Irreversible; only reachable from the trash UI behind a
   * confirm dialog. Must be idempotent (purging an unknown id is a no-op). */
  purge(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  /**
   * 주어진 문서들을 **마지막으로 저장한 사람**의 표시 이름 — 홈 카드의
   * "수정일 · 3시간 전 · 홍길동". 반환은 `{ docId: 이름 }`이고, 이름을 알 수 없거나
   * 마지막 저장자가 **나 자신**인 문서는 키 자체가 없다.
   *
   * - Supabase: `document_editors` RPC(0015). 클라이언트는 `auth.users`도 남의
   *   `profiles`도 읽을 수 없으므로 SECURITY DEFINER 함수가 조인을 대신하고,
   *   노출 범위는 0009 공유 정책(소유 또는 공유받음)으로 제한된다. RPC가 아직
   *   배포되지 않은 서버에서는 `{}`로 떨어진다(배포 순서 안전 — 이름만 안 보인다).
   * - Local(데모): 계정이 하나뿐이라 언제나 `{}`.
   */
  listEditorNames(docIds: string[]): Promise<Record<string, string>>;
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
  /** 홈 색상 테마 키(`features/home/theme.ts`). 스페이스·최근 항목과 같은 per-user
   * 블롭에 실어 기기 간에 따라오게 한다. 예전에 저장된 워크스페이스에는 없으므로
   * 선택("아직 고른 적 없음" = 기본 테마). 값의 유효성은 홈 쪽에서 판별한다. */
  theme?: string;
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

// ── Feedback (사용자 의견 수집) ──────────────────────────────────────────

/** 피드백 분류 — DB check 제약(0014)과 같은 목록. */
export type FeedbackCategory = 'bug' | 'ux' | 'idea' | 'other';

export interface FeedbackEntry {
  category: FeedbackCategory;
  message: string;
  /** 어느 화면에서 보냈는가 ('home' | 'editor'). */
  page: string;
  /** 재현에 도움되는 맥락(빌드 스탬프·userAgent 등) — 작게 유지한다. */
  meta?: Record<string, unknown>;
}

/**
 * 사용자 피드백 제출함. **쓰기 전용** — 제출만 있고 조회는 없다(운영자가
 * Supabase Studio에서 본다, 0014). 로컬/데모 모드는 localStorage에 쌓는다
 * (실제 전송은 안 되지만 UI 흐름이 깨지지 않는다 — ShareStore와 같은 태도).
 */
export interface FeedbackStore {
  submit(entry: FeedbackEntry): Promise<{ error?: string }>;
}

// ── Comments ───────────────────────────────────────────────────────────────

/** 멘션 대상 — 이메일이 (이후) 알림이 겨냥할 키, 이름은 본문의 "@이름" 표시용. */
export interface CommentMention {
  email: string;
  name: string;
}

export interface DocComment {
  id: string;
  /** 대상 주제의 id. 그 주제가 지워졌으면 앱이 "사라진 주제"로 보여 준다. */
  nodeId: string;
  /** 답글이면 스레드 뿌리(최상위 댓글)의 id — 단층 스레드(대댓글 없음, 0021 트리거). */
  parentId: string | null;
  /** 작성 시점의 표시 이름 스냅샷(0020) — 조인 없이 목록 하나로 끝내기 위해. */
  authorName: string;
  /** 작성자 계정 id(탈퇴하면 null). 참가자 목록의 `userId`와 이어 **지금** 프로필
   * 이미지를 찾는다 — 이름은 스냅샷이지만 사진은 바꾸면 옛 댓글에도 반영된다. */
  authorId?: string | null;
  /** 내가 쓴 댓글인가 — 지우기 버튼을 내줄지 가른다(진짜 게이트는 RLS). */
  mine: boolean;
  body: string;
  createdAt: string;
  /** 해결됨(스레드 뿌리에만 의미) — 해결한 사람의 이름 스냅샷과 함께.
   * UI에서는 걷어냈지만(요청: 해결 대신 좋아요) 서버 컬럼과 포트는 그대로 둔다. */
  resolved: boolean;
  resolvedByName: string | null;
  /** 좋아요 수(0028) — 한 사람의 한 표가 행 하나다. */
  likes: number;
  /** 내가 눌렀는가 — 버튼 활성 표시. */
  likedByMe: boolean;
  mentions: CommentMention[];
}

/**
 * 주제(노드)에 붙는 댓글(0020).
 *
 * 문서 본문이 아니라 별도 저장소인 이유는 마이그레이션 주석 참고 — 요약하면
 * 수명이 다르고(버전 되돌리기), CRDT 병합 대상이 되면 안 되며, 자동저장마다
 * 통째로 오가는 값에 얹을 것이 아니다.
 *
 * 로컬/데모 모드는 localStorage에 쌓는다 — 혼자 쓰는 메모처럼 동작하지만 UI 흐름은
 * 같다(ShareStore·FeedbackStore와 같은 태도).
 */
export interface CommentStore {
  /** 그 문서의 댓글 전부(오래된 것부터). 읽을 수 없으면 빈 배열. */
  list(documentId: string): Promise<DocComment[]>;
  /** 댓글/답글 달기. 실패는 사용자 문구로 돌려준다(throw하지 않는다). */
  add(documentId: string, nodeId: string, body: string, opts?: { parentId?: string; mentions?: CommentMention[] }): Promise<{ error?: string }>;
  /** 지우기 — 쓴 사람 본인 또는 문서 소유자만(RLS). 스레드 뿌리를 지우면 답글도 함께. */
  remove(documentId: string, commentId: string): Promise<{ error?: string }>;
  /**
   * 스레드 해결/해제(뿌리 댓글만). 권한은 댓글을 쓸 수 있는 사람 전원 — body는
   * 손댈 수 없는 좁은 RPC(0021 `set_comment_resolved`)라 "수정은 열지 않는다"가
   * 유지된다.
   */
  setResolved(documentId: string, commentId: string, resolved: boolean): Promise<{ error?: string }>;
  /** 좋아요 토글(0028) — 자기 표만 넣고 뺀다(RLS). */
  setLiked(documentId: string, commentId: string, liked: boolean): Promise<{ error?: string }>;
  /**
   * "이 문서의 댓글이 바뀌었다"는 신호 구독. 반환값은 해지 함수.
   *
   * **신호에는 내용이 없다** — 받는 쪽이 `list()`로 다시 읽는다(그 select에 RLS가
   * 걸려 있으므로, 신호 채널 자체는 비밀을 나르지 않는다). Supabase는 공개
   * broadcast 채널의 ping(0009 발신 정책이 edit 전용이라 보기 전용 참가자는 private
   * 채널에 발신할 수 없는데, 댓글은 보기 전용도 쓴다 — 내용 없는 ping이라 공개
   * 채널로 충분하다), 로컬/데모는 BroadcastChannel(같은 브라우저의 다른 탭).
   */
  subscribe(documentId: string, onChange: () => void): () => void;
}

// ── Notifications ──────────────────────────────────────────────────────────

export type NotificationKind = 'mention' | 'reply' | 'comment' | 'share' | 'doc_mention';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  documentId: string | null;
  /** 댓글류 알림의 대상 주제 — 에디터 딥링크(`?comments=<nodeId>`)가 쓴다. */
  nodeId: string | null;
  /** 행위자(댓글 작성자·초대한 사람) 이름 스냅샷. */
  actorName: string;
  /** 댓글 본문 일부(댓글류) — 공유 초대는 빈 문자열. */
  preview: string;
  /** 알림 시점의 맵 제목 스냅샷. */
  docTitle: string;
  createdAt: string;
  read: boolean;
}

/**
 * 알림 우편함(0022) — 홈의 알림 센터가 읽는다.
 *
 * **알림은 클라이언트가 만들지 않는다**: Supabase는 DB 트리거(댓글 insert →
 * 멘션/답글/새 스레드, 공유 insert → 초대)가 넣고, 로컬/데모는 "서버 역할"인
 * 로컬 어댑터들이 같은 시점에 넣는다(`localNotifications.ts`). 클라이언트
 * insert를 열면 아무나 남의 우편함에 가짜 알림을 꽂을 수 있다.
 */
export interface NotificationStore {
  /** 내 알림(최신 순, 상한 50). 읽을 수 없으면(테이블 미적용 등) 빈 배열. */
  list(): Promise<AppNotification[]>;
  /** 전부 읽음 처리 — 알림 센터를 **열었을 때** 부른다(0019 공유 배지와 같은 규칙). */
  markAllRead(): Promise<{ error?: string }>;
  /**
   * 내 우편함에 새 알림이 생기면 부른다 — 댓글 실시간(#0021)과 같은 **내용 없는
   * 신호(ping)**: Supabase는 DB 트리거(0027)가 수신자 채널로 쏘고, 로컬/데모는
   * BroadcastChannel. 받는 쪽이 `list()`로 다시 읽으므로 채널은 비밀을 나르지
   * 않는다. 신호가 유실될 수 있으므로 호출부의 주기 확인은 안전망으로 남긴다.
   * @returns 구독 해제 함수.
   */
  subscribe(onChange: () => void): () => void;
}

// ── Images ─────────────────────────────────────────────────────────────────

/**
 * 첨부 이미지의 **실물**을 두는 곳. 본문에는 참조(`mfimg:<경로>`)만 남는다 —
 * 왜 그렇게 하는지는 core `image.ts`의 doc comment 참고(본문 인라인이 저장량과
 * 실시간 메시지 크기를 함께 밀어 올렸다).
 *
 * 구현이 없으면(로컬/데모 모드) `upload`가 `null`을 돌려주고, 호출부는 예전처럼
 * 본문에 인라인한다 — 데모가 깨지지 않고, 옛 문서도 그대로 열린다.
 */
export interface ImageStore {
  /**
   * 이미지를 올리고 **본문에 넣을 참조**를 돌려준다. 실패하거나 지원하지 않으면
   * `null`(호출부가 인라인으로 폴백).
   * @param docId 접근 권한이 문서를 따라가도록 경로의 첫 조각으로 쓴다.
   */
  upload(docId: string, blob: Blob, ext: string): Promise<string | null>;
  /**
   * 참조들을 **지금 화면에 그릴 수 있는 URL**로 바꾼다(한 번에 — 왕복 1회).
   * 못 푼 참조는 결과에서 빠진다(호출부는 자리표시자를 그린다).
   */
  resolve(refs: string[]): Promise<Record<string, string>>;
  /** 문서가 영구 삭제될 때 실물도 지운다. 지원하지 않으면 no-op. */
  removeForDoc(docId: string): Promise<void>;
}

// ── Backend bundle ───────────────────────────────────────────────────────

export interface Backend {
  auth: AuthProvider;
  docStore: DocStore;
  /** Per-user spaces/folders structure (cross-device in Supabase mode). */
  spaceStore: SpaceStore;
  /** 문서 공유(초대 목록). 로컬/데모 모드에서도 같은 계약으로 동작한다. */
  shareStore: ShareStore;
  /** 사용자 피드백 제출(쓰기 전용 우편함 — 0014). */
  feedbackStore: FeedbackStore;
  /** 첨부 이미지 실물 저장소(본문에는 참조만 — 0016). */
  imageStore: ImageStore;
  /** 주제에 붙는 댓글(0020). */
  commentStore: CommentStore;
  /** 알림 우편함(0022) — 홈 알림 센터. */
  notificationStore: NotificationStore;
  /** `'local'` = demo/localStorage fallback (no env configured); `'supabase'`
   * = real Postgres + Auth. Used to decide whether auth routes are gated. */
  mode: 'local' | 'supabase';
}
