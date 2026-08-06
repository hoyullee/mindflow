// 첨부 이미지의 실물을 두는 곳 — Supabase Storage 버킷 `map-images`
// (`supabase/migrations/0016_map_images.sql`).
//
// **왜 Supabase Storage인가**: 이미 쓰는 프로젝트 안이라 새 벤더·새 키·새 요금제가
// 없고, 무엇보다 `storage.objects`에 RLS를 걸 수 있어서 **문서 권한 헬퍼
// (`owns_document`/`shared_with_me`, 0009)를 그대로 재사용**한다 — 이미지 접근
// 권한이 문서 접근 권한과 **자동으로 같아진다**(공유하면 같이 보이고, 공유를 끊으면
// 같이 막힌다). 별도 저장소를 쓰면 그 규칙을 손으로 다시 만들어야 한다.
//
// 경로는 `<docId>/<uuid>.<ext>` — 첫 조각이 문서 id라서 정책이 `split_part`로
// 문서를 알아낼 수 있다(그래서 문서 단위 권한·삭제가 가능하다).
//
// 버킷은 **비공개**다. 공개 버킷 + 추측 불가 경로가 더 간단하지만, 그건 URL이 새면
// 영원히 열려 있다는 뜻이다. 대신 화면에 그릴 때마다 **서명 URL**을 받는다(만료가
// 있으니 새는 범위가 시간으로 묶인다).

import type { SupabaseClient } from '@supabase/supabase-js';
import { imageRefPath, makeImageRef } from '@mindflow/mindmap-core';
import type { ImageStore } from '../ports';

export const IMAGE_BUCKET = 'map-images';
/** 서명 URL 유효 시간(초). 편집 세션은 이보다 길 수 있어서 화면 쪽이 만료 전에
 * 다시 받는다(`useImageUrls`) — 여기서는 넉넉하되 무한하지 않게. */
export const SIGNED_URL_TTL_SEC = 60 * 60;

function randomName(ext: string): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${rand}.${ext.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
}

export class SupabaseImageStore implements ImageStore {
  constructor(private readonly client: SupabaseClient) {}

  async upload(docId: string, blob: Blob, ext: string): Promise<string | null> {
    if (!docId) return null;
    const path = `${docId}/${randomName(ext)}`;
    const { error } = await this.client.storage.from(IMAGE_BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      // 경로마다 uuid라 덮어쓸 일이 없다. upsert를 켜면 실수로 남의 파일을 덮는
      // 요청이 정책에 걸려 update 권한까지 필요해진다.
      upsert: false,
      cacheControl: '3600',
    });
    if (error) {
      // 조용히 죽지 않게 — 실패하면 호출부가 인라인으로 폴백하므로 첨부 자체는 된다.
      console.warn('[geurio] 이미지 업로드 실패 — 본문에 인라인합니다.', error.message);
      return null;
    }
    return makeImageRef(path);
  }

  async resolve(refs: string[]): Promise<Record<string, string>> {
    const paths: string[] = [];
    const byPath = new Map<string, string>();
    for (const ref of refs) {
      const p = imageRefPath(ref);
      if (!p || byPath.has(p)) continue;
      byPath.set(p, ref);
      paths.push(p);
    }
    if (!paths.length) return {};
    const { data, error } = await this.client.storage.from(IMAGE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC);
    if (error || !data) {
      console.warn('[geurio] 이미지 URL 발급 실패', error?.message ?? '');
      return {};
    }
    const out: Record<string, string> = {};
    for (const row of data) {
      // 개별 실패(지워진 파일 등)는 그 항목만 빠진다 — 나머지는 정상적으로 보인다.
      if (!row?.path || !row.signedUrl) continue;
      const ref = byPath.get(row.path);
      if (ref) out[ref] = row.signedUrl;
    }
    return out;
  }

  async removeForDoc(docId: string): Promise<void> {
    if (!docId) return;
    const { data, error } = await this.client.storage.from(IMAGE_BUCKET).list(docId);
    if (error || !data?.length) return;
    const paths = data.map((f) => `${docId}/${f.name}`);
    await this.client.storage.from(IMAGE_BUCKET).remove(paths);
  }
}
