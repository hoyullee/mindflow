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
  signInWithOAuth(provider: 'google'): Promise<{ error?: string }>;
  signOut(): Promise<void>;
  /** Returns an unsubscribe function. */
  onAuthChange(listener: AuthChangeListener): () => void;
  sendPasswordReset(email: string): Promise<{ error?: string }>;
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
  /** `'local'` = demo/localStorage fallback (no env configured); `'supabase'`
   * = real Postgres + Auth. Used to decide whether auth routes are gated. */
  mode: 'local' | 'supabase';
}
