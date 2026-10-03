import { beforeEach, describe, expect, it } from 'vitest';
import { clearAccountCache, pendingLocalEdits } from './accountCache';

describe('로그아웃 — 이 기기의 계정 데이터 사본 지우기', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('문서·기록·캐시 사본은 지우고, 기기 설정과 남의 키는 남긴다', () => {
    localStorage.setItem('mindflow_doc_n1', '{"pages":[]}');
    localStorage.setItem('mindflow_doc_n1__pending', '1');
    localStorage.setItem('mindflow_doc_meta_n1', '{}');
    localStorage.setItem('mindflow_nhist_n1', '[]');
    localStorage.setItem('mf_spaces', '{}');
    localStorage.setItem('mf_preview_bodies', '{}');
    localStorage.setItem('mf_gcal_token', 'tok');
    localStorage.setItem('mf_home_theme', 'white');
    localStorage.setItem('mf_home_landing', 'calendar');
    localStorage.setItem('mf_embed_h', '{}');
    localStorage.setItem('sb-abc-auth-token', 'x');
    sessionStorage.setItem('mf_note_scroll_n1', '120');

    expect(pendingLocalEdits()).toBe(1);
    const n = clearAccountCache();
    expect(n).toBe(8);
    expect(Object.keys({ ...localStorage }).sort()).toEqual(['mf_embed_h', 'mf_home_landing', 'mf_home_theme', 'sb-abc-auth-token']);
    expect(sessionStorage.length).toBe(0);
    expect(pendingLocalEdits()).toBe(0);
  });

  it('저장소가 막혀 있으면(사파리 사생활 모드 등) 조용히 0', () => {
    const broken = {
      get length(): number {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(clearAccountCache(broken, broken)).toBe(0);
    expect(pendingLocalEdits(broken)).toBe(0);
  });
});
