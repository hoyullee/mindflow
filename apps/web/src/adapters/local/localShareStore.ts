// 데모/로컬 `ShareStore` — 다른 어댑터들과 같은 `mf_`/`mindflow_` 네임스페이스의
// localStorage 한 칸(`mf_doc_shares`)에 초대 목록을 담는다.
//
// 이 모드에는 서버도, 다른 사용자도 없다. 그래서 공유가 **실제로 접근을 열어 주지는
// 않는다** — 초대 목록을 만들고 지우고 보여 주는 계약만 Supabase 모드와 동일하게
// 지켜서, UI가 모드에 따라 다르게 동작하지 않도록 하는 것이 목적이다(다른 로컬
// 어댑터들과 같은 자리). 실제 권한은 Supabase 모드에서 RLS가 판단한다.

import type { DocumentShare, ShareParticipant, ShareRole, ShareStore, SharedWithMe } from '../ports';
import { readSavedProfileName } from '../../features/home/storage';

const KEY = 'mf_doc_shares';

interface StoredShare {
  documentId: string;
  email: string;
  role: ShareRole;
  createdAt: string;
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

function writeAll(list: StoredShare[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode, quota, …) — non-fatal */
  }
}

export class LocalShareStore implements ShareStore {
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
    else all.push({ documentId, email: normalized, role, createdAt: new Date().toISOString() });
    writeAll(all);
    return {};
  }

  async remove(documentId: string, email: string): Promise<{ error?: string }> {
    const normalized = email.trim().toLowerCase();
    writeAll(readAll().filter((s) => !(s.documentId === documentId && s.email === normalized)));
    return {};
  }

  async listSharedWithMe(): Promise<SharedWithMe[]> {
    // 이 모드에는 "남"이 없다 — 내가 만든 초대뿐이므로 공유받은 문서는 항상 없다.
    return [];
  }

  async listParticipants(documentId: string): Promise<ShareParticipant[] | null> {
    // 데모: 소유자는 항상 "나"(데모 세션의 이메일), 초대는 이 브라우저의 초대 목록.
    // 프로필명은 같은 브라우저의 캐시(mf_profile_names)에서만 알 수 있다 — 실제
    // 다른 사용자는 없으므로 초대 이메일의 이름은 대개 비어 "가입 대기"처럼 보인다
    // (Supabase 모드의 RPC 계약과 같은 모양을 유지하는 것이 목적).
    let ownerEmail = '';
    try {
      const session = JSON.parse(localStorage.getItem('mf_demo_session') || 'null') as { user?: { email?: string | null } } | null;
      ownerEmail = (session?.user?.email ?? '').trim().toLowerCase();
    } catch {
      /* 세션 없음 — 소유자 행 생략 */
    }
    const out: ShareParticipant[] = [];
    if (ownerEmail) {
      out.push({ kind: 'owner', email: ownerEmail, displayName: readSavedProfileName(ownerEmail), joined: true });
    }
    for (const s of readAll().filter((s) => s.documentId === documentId)) {
      const name = readSavedProfileName(s.email);
      out.push({ kind: 'invitee', email: s.email, displayName: name, joined: !!name });
    }
    return out;
  }
}
