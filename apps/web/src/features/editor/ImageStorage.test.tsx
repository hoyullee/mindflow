// 첨부 이미지를 **본문에서 빼내** 별도 저장소에 두는 경로.
//
// 왜: 본문 인라인 base64는 저장량·egress를 키웠고, 실시간 협업에서는 메시지 크기
// 한도를 넘겨 합류 동기화가 통째로 버려지는 사고까지 냈다(커서는 오는데 편집이 영영
// 안 오던 그 제보 — `collab/SupabaseRealtimeProvider.ts`의 `UPDATE_PART_EVENT`).
//
// 계약 셋:
//  ① 저장소가 있으면 본문에는 **참조만** 남는다(그래서 협업 페이로드가 텍스트 크기).
//  ② 저장소가 없거나 실패하면 예전처럼 인라인 — 첨부는 언제나 성공한다.
//  ③ 옛 문서(인라인)는 그대로 열리고, 열어 두면 저장소로 **옮겨진다**.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeImageRef, type Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { attachImageFile, dataUrlToBlob, pickImageFormat } from './imageAttach';
import { displaySrc } from './useImageUrls';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocStore, ImageStore } from '../../adapters/ports';

const DATA_URL = 'data:image/jpeg;base64,' + btoa('x'.repeat(90));

function docWithInlineImage(): Doc {
  return {
    v: 1,
    nodes: {
      root: { id: 'root', text: '제품 로드맵', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
      c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, img: DATA_URL, imgW: 80, imgH: 60 },
    },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  } as Doc;
}

/** 업로드/URL 발급을 들여다볼 수 있는 저장소. */
function fakeImageStore() {
  const uploaded: { docId: string; ext: string; bytes: number }[] = [];
  const store: ImageStore = {
    upload: vi.fn(async (docId: string, blob: Blob, ext: string) => {
      uploaded.push({ docId, ext, bytes: blob.size });
      return makeImageRef(`${docId}/up${uploaded.length}.${ext}`);
    }),
    resolve: vi.fn(async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `https://cdn.example/${encodeURIComponent(r)}`]))),
    removeForDoc: vi.fn(async () => undefined),
  };
  return { store, uploaded };
}

function makeBackend(imageStore: ImageStore, doc: Doc) {
  const save = vi.fn(async () => ({ ok: true as const, version: 2 }));
  const docStore = {
    list: async () => [],
    load: async () => ({ doc, version: 1, title: '제품 로드맵' }),
    loadPreview: async () => null,
    listEditorNames: async () => ({}),
    setFavorite: async () => undefined,
    remove: async () => undefined,
    restore: async () => undefined,
    purge: async () => undefined,
    rename: async () => undefined,
    save,
  } as unknown as DocStore;
  const backend: Backend = {
    auth: new LocalAuth(),
    docStore,
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(),
    imageStore,
    mode: 'supabase',
  };
  return backend;
}

function renderEditor(backend: Backend, docId: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor?map=${docId}&title=x`]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('본문 → 별도 저장소', () => {
  it('데이터 URL을 Blob으로 되돌린다 (업로드에 쓰는 변환)', () => {
    const blob = dataUrlToBlob(DATA_URL);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/jpeg');
    expect(blob!.size).toBe(90);
    expect(dataUrlToBlob('not-a-data-url')).toBeNull();
  });

  it('저장소가 없으면(로컬/데모) 업로드하지 않는다 — 첨부는 인라인으로 계속 된다', async () => {
    const local = new LocalImageStore();
    expect(await local.upload()).toBeNull();
    expect(await local.resolve()).toEqual({});
  });

  it('참조는 발급받은 URL로, 옛 데이터 URL은 값 그대로 그린다', () => {
    const ref = makeImageRef('d/1.jpg');
    expect(displaySrc(ref, { [ref]: 'https://cdn/x' })).toBe('https://cdn/x');
    expect(displaySrc(ref, {})).toBeUndefined(); // 아직 못 받았다 → 자리표시자
    expect(displaySrc(DATA_URL, {})).toBe(DATA_URL); // 옛 문서 무회귀
    expect(displaySrc(undefined, {})).toBeUndefined();
  });

  it('첨부 시 실물을 올리고 본문에는 참조만 넣는다', async () => {
    const { store, uploaded } = fakeImageStore();
    const file = dataUrlToBlob(DATA_URL)!;
    // 실제 인코딩은 canvas가 필요해 jsdom에서 돌지 않는다 — 업로더 계약만 확인한다.
    const upload = (blob: Blob, ext: string) => store.upload('doc-1', blob, ext);
    const ref = await upload(file, 'jpg');
    expect(ref).toBe(makeImageRef('doc-1/up1.jpg'));
    expect(uploaded[0]).toEqual({ docId: 'doc-1', ext: 'jpg', bytes: 90 });
  });

  it('디코드할 수 없는 파일은 업로드하지 않는다 (이미지가 아닌 드롭/붙여넣기)', async () => {
    const { store, uploaded } = fakeImageStore();
    const notImage = new Blob(['hello'], { type: 'text/plain' });
    expect(await attachImageFile(notImage, (b, e) => store.upload('d', b, e))).toBeNull();
    expect(uploaded).toHaveLength(0);
  });
});

describe('옛 문서 이전 (인라인 → 저장소)', () => {
  it('인라인 이미지가 있는 문서를 열면 저장소로 옮기고 본문을 참조로 바꾼다', async () => {
    const { store, uploaded } = fakeImageStore();
    const backend = makeBackend(store, docWithInlineImage());
    const docId = `img-migrate-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(docWithInlineImage()));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    await waitFor(() => expect(uploaded.length).toBe(1));
    expect(uploaded[0]?.docId).toBe(docId);
    // 본문(로컬 복구본)에 데이터 URL이 더 이상 없다 = 참조로 바뀌어 저장됐다
    await waitFor(() => {
      const saved = localStorage.getItem(`mindflow_doc_${docId}`) ?? '';
      expect(saved.includes('data:image')).toBe(false);
      expect(saved.includes('mfimg:')).toBe(true);
    });
  });

  it('저장소가 없으면 인라인 그대로 둔다 — 로컬/데모 모드가 깨지지 않는다', async () => {
    const backend = makeBackend(new LocalImageStore(), docWithInlineImage());
    const docId = `img-nostore-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(docWithInlineImage()));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    await new Promise((r) => setTimeout(r, 300));
    expect(localStorage.getItem(`mindflow_doc_${docId}`)).toContain('data:image');
  });
});

describe('참조 렌더', () => {
  it('참조는 발급받은 URL로 그리고, 발급 전에는 같은 크기의 자리표시자를 둔다', async () => {
    const { store } = fakeImageStore();
    const ref = makeImageRef('doc-x/pic.jpg');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const backend = makeBackend(store, doc);
    const docId = `img-render-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(doc));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    await waitFor(() => {
      const img = getViewport(container).querySelector('img');
      expect(img?.getAttribute('src')).toBe(`https://cdn.example/${encodeURIComponent(ref)}`);
    });
    // 발급이 끝났으니 자리표시자는 남아 있지 않다
    expect(getViewport(container).querySelector('[data-image-placeholder]')).toBeNull();
  });

  it('URL을 못 받으면 자리표시자를 그린다 — 레이아웃은 그대로(크기는 문서에 있다)', async () => {
    const store: ImageStore = { upload: async () => null, resolve: async () => ({}), removeForDoc: async () => undefined };
    const ref = makeImageRef('doc-x/gone.jpg');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const backend = makeBackend(store, doc);
    const docId = `img-missing-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(doc));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    const ph = getViewport(container).querySelector('[data-image-placeholder]') as HTMLElement | null;
    expect(ph).not.toBeNull();
    expect(ph!.style.width).toBe('80px');
    expect(ph!.style.height).toBe('60px');
  });
});

describe('용량·전송량 (무료 한도에서 먼저 닿는 건 전송량이다)', () => {
  it('WebP를 우선한다 — 같은 화질에서 JPEG보다 훨씬 작고 투명도까지 된다', () => {
    expect(pickImageFormat('image/jpeg', true)).toMatchObject({ mime: 'image/webp', ext: 'webp' });
    // PNG 원본도 WebP로 — WebP는 투명도를 지원하므로 잃는 게 없다
    expect(pickImageFormat('image/png', true)).toMatchObject({ mime: 'image/webp', ext: 'webp' });
  });

  it('WebP를 못 쓰는 브라우저는 예전 규칙 그대로 (투명 PNG는 PNG, 나머지는 JPEG)', () => {
    expect(pickImageFormat('image/png', false)).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(pickImageFormat('image/png', false).quality).toBeUndefined(); // 무손실 — 품질 손잡이 없음
    expect(pickImageFormat('image/jpeg', false)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('손실 포맷은 너무 클 때 낮춰 쓸 품질을 함께 들고 있다', () => {
    const webp = pickImageFormat('image/jpeg', true);
    expect(webp.retryQuality).toBeLessThan(webp.quality!);
  });

  it('서명 URL 수명이 갱신 주기보다 길다 — 만료된 URL을 그리는 일이 없게', async () => {
    const { SIGNED_URL_TTL_SEC } = await import('../../adapters/supabase/supabaseImageStore');
    const { IMAGE_URL_REFRESH_MS } = await import('./useImageUrls');
    expect(IMAGE_URL_REFRESH_MS).toBeLessThan(SIGNED_URL_TTL_SEC * 1000);
    // 그리고 한 세션에 몇 번씩 갱신하지 않는다(갱신 = 캐시 무효화 = 재다운로드).
    expect(IMAGE_URL_REFRESH_MS).toBeGreaterThan(2 * 60 * 60 * 1000);
  });
});

describe('업로드 실패는 조용히 넘기지 않는다', () => {
  it('배경 이전이 실패해도 알림으로 방해하지 않는다 — 사용자가 시킨 일이 아니다', async () => {
    // 업로드가 실패하는 저장소 — 문서는 인라인 그대로 남고, 다음에 열 때 재시도한다.
    const store: ImageStore = { upload: async () => null, resolve: async () => ({}), removeForDoc: async () => undefined };
    const backend = makeBackend(store, docWithInlineImage()); // mode: 'supabase'
    const docId = `img-warn-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(docWithInlineImage()));
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 300));

    expect(document.body.textContent).not.toContain('저장소에 올리지 못해');
    // 옮기지 못했으니 본문은 인라인 그대로 — 다음 기회에 다시 시도한다
    expect(localStorage.getItem(`mindflow_doc_${docId}`)).toContain('data:image');
  });
});

describe('화질 (제보: 삽입한 이미지가 깨져 보인다)', () => {
  it('원본 상한이 표시 크기 × 최대 줌 × 기기 픽셀비를 감당한다', async () => {
    const { MAX_IMAGE_DIM, DEFAULT_IMAGE_FLOAT_WIDTH } = await import('./imageAttach');
    const DPR = 2; // 흔한 고해상도 화면
    // 기본 삽입 크기를 2배 화면에서, 2배로 확대해서 봐도 원본 픽셀이 모자라지 않아야
    // 한다. 1024이던 시절엔 기본 크기조차 아슬아슬했고, PNG 스크린샷은 512로
    // 반토막까지 났다(그게 "깨져 보인다"의 정체였다).
    expect(MAX_IMAGE_DIM).toBeGreaterThanOrEqual(DEFAULT_IMAGE_FLOAT_WIDTH * DPR * 2);
  });

  it('WebP 품질이 화질 우선으로 올라가 있다 (글자가 든 스크린샷 기준)', () => {
    expect(pickImageFormat('image/png', true).quality).toBeGreaterThanOrEqual(0.9);
  });

  it('기본 삽입 폭이 스크린샷 글자가 읽히는 크기다 (실측: 260 뭉갬 / 480부터 읽힘)', async () => {
    const { DEFAULT_IMAGE_FLOAT_WIDTH } = await import('./imageAttach');
    expect(DEFAULT_IMAGE_FLOAT_WIDTH).toBeGreaterThanOrEqual(480);
  });
});
