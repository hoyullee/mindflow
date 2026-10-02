// 로컬/데모 모드의 `FileStore` — 서버가 없으니 **이 탭의 메모리**에 둔다.
//
// 데모는 혼자 쓰고 localStorage에만 남는 모드라, 파일 실물(최대 20MB)을 localStorage(5MB 남짓)에
// 넣을 수 없다. 그래서 새로 고치면 실물은 사라지고 카드는 「이 기기에서 열 수 없어요」를 그린다 —
// 실서비스(Supabase + R2)에서는 일어나지 않는 일이다. 한도는 무료 플랜과 같은 숫자로 흉내 낸다
// (설정의 사용량 막대·한도 안내를 데모에서도 볼 수 있게).

import { FileUploadError, type FileQuota, type FileStore, type UploadedFile } from '../ports';

export const LOCAL_FILE_LIMIT = 20 * 1024 * 1024;
export const LOCAL_STORAGE_LIMIT = 200 * 1024 * 1024;

let seq = 0;

export class LocalFileStore implements FileStore {
  private files = new Map<string, { meta: UploadedFile; blob: Blob; url: string | null }>();

  async quota(): Promise<FileQuota> {
    return { plan: 'free', planName: '무료', used: this.used(), limit: LOCAL_STORAGE_LIMIT, fileLimit: LOCAL_FILE_LIMIT };
  }

  async upload(_docId: string, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<UploadedFile> {
    if (signal?.aborted) throw new FileUploadError('aborted');
    if (file.size > LOCAL_FILE_LIMIT) throw new FileUploadError('too-large', { fileLimit: LOCAL_FILE_LIMIT });
    const used = this.used();
    if (used + file.size > LOCAL_STORAGE_LIMIT) throw new FileUploadError('quota', { used, limit: LOCAL_STORAGE_LIMIT });
    seq += 1;
    const meta: UploadedFile = { id: `local-${Date.now().toString(36)}${seq.toString(36)}`, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' };
    this.files.set(meta.id, { meta, blob: file, url: null });
    onProgress?.(1);
    return meta;
  }

  async downloadUrl(fileId: string): Promise<string | null> {
    const f = this.files.get(fileId);
    if (!f) return null;
    if (!f.url && typeof URL.createObjectURL === 'function') f.url = URL.createObjectURL(f.blob);
    return f.url;
  }

  async remove(fileId: string): Promise<void> {
    const f = this.files.get(fileId);
    if (f?.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(f.url);
    this.files.delete(fileId);
  }

  private used(): number {
    let n = 0;
    for (const f of this.files.values()) n += f.meta.size;
    return n;
  }
}
