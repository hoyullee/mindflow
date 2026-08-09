// 데모/로컬 `ShareStore` — 다른 어댑터들과 같은 `mf_`/`mindflow_` 네임스페이스의
// localStorage 한 칸(`mf_doc_shares`)에 초대 목록을 담는다.
//
// 이 모드에는 서버도, 다른 사용자도 없다. 그래서 공유가 **실제로 접근을 열어 주지는
// 않는다** — 초대 목록을 만들고 지우고 보여 주는 계약만 Supabase 모드와 동일하게
// 지켜서, UI가 모드에 따라 다르게 동작하지 않도록 하는 것이 목적이다(다른 로컬
// 어댑터들과 같은 자리). 실제 권한은 Supabase 모드에서 RLS가 판단한다.

import type { DocumentShare, ShareParticipant, ShareRole, ShareStore, SharedWithMe } from '../ports';
import { readSavedProfileName } from '../../features/home/storage';
import { localDocTitle, pushLocalNotification } from './localNotifications';

const KEY = 'mf_doc_shares';
const LINK_KEY = 'mf_doc_links';

function readLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

interface StoredShare {
  documentId: string;
  email: string;
  role: ShareRole;
  createdAt: string;
  /** 초대받은 사람이 확인한 시각(0019의 `seen_at`과 같은 뜻). */
  seenAt?: string | null;
}

function readAll(): StoredShare[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is StoredShare => {
      const o = s as Partial<StoredShare> | null;
      return !!o && typeof o.documentId === 'string' && typeof o.email === 'string';
    });
  } catch {
    return [];
  }
}

/** 이 브라우저의 데모 세션 이메일(소문자). 없으면 빈 문자열. */
function demoEmail(): string {
  try {
    const session = JSON.parse(localStorage.getItem('mf_demo_session') || 'null') as { user?: { email?: string | null } } | null;
    return (session?.user?.email ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function writeAll(list: StoredShare[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode, quota, …) — non-fatal */
  }
}

export class LocalShareStore implements ShareStore {
  /** 링크 공유도 같은 태도 — 실제로 열어 주지는 않지만 계약과 UI 흐름은 동일하다. */
  async getLink(documentId: string): Promise<ShareRole | null> {
    return readLinks()[documentId] === 'view' ? 'view' : null;
  }

  async setLink(documentId: string, role: ShareRole | null): Promise<{ error?: string }> {
    const all = readLinks();
    if (role === 'view') all[documentId] = 'view';
    else delete all[documentId];
    try {
      localStorage.setItem(LINK_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable — non-fatal */
    }
    return {};
  }

  async list(documentId: string): Promise<DocumentShare[]> {
    return readAll()
      .filter((s) => s.documentId === documentId)
      .map((s) => ({ documentId: s.documentId, email: s.email, role: s.role, createdAt: s.createdAt }));
  }

  async add(documentId: string, email: string, role: ShareRole = 'edit'): Promise<{ error?: string }> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return { error: '이메일을 입력해 주세요.' };
    const all = readAll();
    const at = all.findIndex((s) => s.documentId === documentId && s.email === normalized);
    // Supabase 쪽 upsert와 같은 의미 — 이미 있으면 권한만 갱신한다.
    if (at >= 0) all[at] = { ...all[at]!, role };
    else {
      all.push({ documentId, email: normalized, role, createdAt: new Date().toISOString() });
      // 알림 생성 — Supabase의 0022 트리거처럼 **처음 초대에만**(권한 변경 제외).
      pushLocalNotification({ recipientEmail: normalized, kind: 'share', documentId, nodeId: null, actorName: demoEmail().split('@')[0] ?? '', preview: '', docTitle: localDocTitle(documentId) });
    }
    writeAll(all);
    return {};
  }

  async remove(documentId: string, email: string): Promise<{ error?: string }> {
    const normalized = email.trim().toLowerCase();
    writeAll(readAll().filter((s) => !(s.documentId === documentId && s.email === normalized)));
    return {};
  }

  async listSharedWithMe(): Promise<SharedWithMe[]> {
    // Supabase와 **같은 규칙**: 이 저장소의 초대 중 내 이메일로 온 것.
    // 데모에는 "남"이 없어 보통은 비어 있지만(자기 자신 초대는 UI가 막는다),
    // 규칙을 하드코딩된 `[]` 대신 실제 판정으로 두면 모드에 따라 화면이 달라지지
    // 않는다 — 알림 배지 같은 후속 기능이 로컬 모드에서도 같은 길을 탄다.
    const me = demoEmail();
    if (!me) return [];
    return readAll()
      .filter((s) => s.email === me)
      .map((s) => ({ documentId: s.documentId, role: s.role, seenAt: s.seenAt ?? null }));
  }

  /** 데모 모드에는 보낼 서버도 받을 사람도 없다 — 계약만 지키고 아무것도 하지 않는다. */
  async notifyInvite(): Promise<void> {
    /* no-op */
  }

  async markSharedSeen(documentIds: string[]): Promise<void> {
    if (!documentIds.length) return;
    const me = demoEmail();
    if (!me) return;
    const ids = new Set(documentIds);
    const now = new Date().toISOString();
    writeAll(readAll().map((s) => (s.email === me && ids.has(s.documentId) && !s.seenAt ? { ...s, seenAt: now } : s)));
  }

  async listParticipants(documentId: string): Promise<ShareParticipant[] | null> {
    // 데모: 소유자는 항상 "나"(데모 세션의 이메일), 초대는 이 브라우저의 초대 목록.
    // 프로필명은 같은 브라우저의 캐시(mf_profile_names)에서만 알 수 있다 — 실제
    // 다른 사용자는 없으므로 초대 이메일의 이름은 대개 비어 "가입 대기"처럼 보인다
    // (Supabase 모드의 RPC 계약과 같은 모양을 유지하는 것이 목적).
    const ownerEmail = demoEmail();
    const out: ShareParticipant[] = [];
    if (ownerEmail) {
      out.push({ kind: 'owner', email: ownerEmail, displayName: readSavedProfileName(ownerEmail), joined: true, role: 'edit' });
    }
    for (const s of readAll().filter((s) => s.documentId === documentId)) {
      const name = readSavedProfileName(s.email);
      out.push({ kind: 'invitee', email: s.email, displayName: name, joined: !!name, role: s.role });
    }
    return out;
  }
}
