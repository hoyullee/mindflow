// 첨부 파일의 실물을 두는 곳 — **Cloudflare R2**(0049 · Edge Function `files`).
//
// 흐름은 셋이다: ① 함수에 "이 문서에 이 파일을 올려도 되나"를 묻는다(권한·파일 크기·계정 총량을
// 서버가 본다) → ② 받은 서명 주소로 **브라우저가 R2에 직접** 올린다(파일이 우리 함수를 지나지
// 않는다 — 함수의 실행 시간·메모리와 무관하게 20MB가 간다) → ③ 끝났다고 알리면 서버가 실물의
// 크기를 다시 재고 `ready`로 바꾼다(①에서 크기를 속였어도 여기서 걸린다).
//
// 함수가 아직 배포되지 않았거나 R2 키가 없으면 `not-configured` — 화면은 "아직 준비 중"이라고
// 말하고 아무것도 깨지지 않는다(배포 순서와 무관하게).

import type { SupabaseClient } from '@supabase/supabase-js';
import { FileUploadError, type FileQuota, type FileStore, type FileUploadReason, type UploadedFile } from '../ports';

type Fail = { ok: false; reason?: string; fileLimit?: number; used?: number; limit?: number };
type UploadOk = { ok: true; fileId: string; uploadUrl: string; headers?: Record<string, string> };
type CompleteOk = { ok: true; file: UploadedFile };
type DownloadOk = { ok: true; url: string };

/** R2로 올리는 한 번 — 진행률이 필요해서 `fetch`가 아니라 XHR이다(fetch는 올리는 진행률을 주지 않는다). */
export type PutFn = (url: string, body: Blob, headers: Record<string, string>, onProgress?: (ratio: number) => void, signal?: AbortSignal) => Promise<void>;

export const xhrPut: PutFn = (url, body, headers, onProgress, signal) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.total ? e.loaded / e.total : 0);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new FileUploadError('network')));
    xhr.onerror = () => reject(new FileUploadError('network'));
    xhr.onabort = () => reject(new FileUploadError('aborted'));
    if (signal) {
      if (signal.aborted) {
        reject(new FileUploadError('aborted'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });

const REASONS: readonly FileUploadReason[] = ['too-large', 'quota', 'forbidden', 'not-configured', 'network', 'missing', 'aborted'];
const reasonOf = (r: unknown): FileUploadReason => (REASONS.includes(r as FileUploadReason) ? (r as FileUploadReason) : 'unknown');

export class SupabaseFileStore implements FileStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly put: PutFn = xhrPut,
  ) {}

  async quota(): Promise<FileQuota | null> {
    const { data, error } = await this.client.rpc('my_file_quota');
    if (error || !data) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      plan: String(row.plan ?? 'free'),
      planName: String(row.plan_name ?? '무료'),
      used: Number(row.used ?? 0),
      limit: Number(row.storage_limit ?? 0),
      fileLimit: Number(row.file_limit ?? 0),
    };
  }

  async upload(docId: string, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<UploadedFile> {
    // 서명에 실은 형식과 보내는 형식이 **한 글자라도** 다르면 R2가 403을 준다 — 한 번 정해 양쪽에 쓴다.
    const mime = file.type || 'application/octet-stream';
    const asked = await this.call<UploadOk>({ action: 'upload', docId, name: file.name, size: file.size, mime });
    try {
      await this.put(asked.uploadUrl, file, asked.headers ?? { 'Content-Type': mime }, onProgress, signal);
    } catch (e) {
      // 반쯤 올라간 자리는 서버의 정리(`files-sweep`)도 지우지만, 쓴 양에 하루 동안 잡혀 있지 않게 바로 지운다.
      void this.remove(asked.fileId).catch(() => undefined);
      throw e instanceof FileUploadError ? e : new FileUploadError('network');
    }
    onProgress?.(1);
    const done = await this.call<CompleteOk>({ action: 'complete', fileId: asked.fileId });
    return done.file;
  }

  async downloadUrl(fileId: string, inline = false): Promise<string | null> {
    try {
      const res = await this.call<DownloadOk>({ action: 'download', fileId, inline });
      return res.url;
    } catch {
      return null;
    }
  }

  async remove(fileId: string): Promise<void> {
    await this.call<{ ok: true }>({ action: 'remove', fileId });
  }

  private async call<T extends { ok: true }>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke<T | Fail>('files', { body });
    if (error) {
      // 함수가 아직 없으면(배포 전) 404 — "준비 중"으로 읽는다. 나머지는 네트워크 쪽 실패.
      const status = (error as { context?: { status?: number } }).context?.status;
      throw new FileUploadError(status === 404 ? 'not-configured' : status === 401 || status === 403 ? 'forbidden' : 'network');
    }
    if (!data || !data.ok) {
      const fail = (data ?? {}) as Fail;
      throw new FileUploadError(reasonOf(fail.reason), { ...(fail.fileLimit !== undefined ? { fileLimit: fail.fileLimit } : {}), ...(fail.used !== undefined ? { used: fail.used } : {}), ...(fail.limit !== undefined ? { limit: fail.limit } : {}) });
    }
    return data as T;
  }
}
