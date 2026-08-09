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
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { collectImageRefs, collectInlineImages, makeImageRef, type Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { attachImageFile, dataUrlToBlob, pickImageFormat } from './imageAttach';
import { displaySrc, type ImageUrlMap } from './useImageUrls';
import { inlineImagesForExport } from './imageExport';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocStore, ImageStore } from '../../adapters/ports';

/** 내려받은 파일 내용을 가로챈다 — jsdom에는 createObjectURL이 없고, 어차피
 * 확인하고 싶은 건 "무엇을 담아 내려보냈는가" 하나다. */
const dl = vi.hoisted(() => ({ files: [] as { name: string; data: string }[] }));
vi.mock('./download', () => ({
  downloadFile: (name: string, data: unknown) => {
    dl.files.push({ name, data: String(data) });
  },
}));

/** PNG 래스터라이즈는 jsdom에 없다(canvas 2D 없음) — 그리기 대신 **무엇을 들고
 * 들어갔는지**(참조가 풀린 URL 표)를 확인한다. */
type ExportPngFn = (...args: unknown[]) => Promise<{ missingImages: number }>;
const pngMock = vi.hoisted(() => ({ exportPng: vi.fn<ExportPngFn>(async () => ({ missingImages: 0 })) }));
vi.mock('./png', () => ({
  exportPng: pngMock.exportPng,
  exportDocPng: vi.fn(async () => ({ missingImages: 0 })),
}));

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
    commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(),
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
    // 그릴 수 없는 값은 자리표시자로 — 예전 홈 내보내기가 썸네일 본문을 담아
    // 만들어진 문서(`img: 'stripped'`)가 깨진 이미지 아이콘으로 뜨지 않게.
    expect(displaySrc('stripped', {})).toBeUndefined();
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

// 내보내는 파일은 **그 자체로 완결**돼야 한다. 참조만 담으면 두 가지가 깨진다:
// ① 그 계정·그 문서에 접근할 수 있어야만 이미지가 보인다(예전엔 파일 하나로 끝났다)
// ② 가져오기는 새 문서 id로 저장하는데, 참조 경로의 첫 조각은 **원본 문서 id**이고
//    Storage 정책이 그걸로 권한을 판단한다 → 가져온 맵에서 이미지가 안 보인다.
describe('내보내기 — 이미지를 파일에 다시 담는다', () => {
  const PIXEL = 'data:image/webp;base64,' + btoa('webp-bytes');

  /** 참조를 서명 URL로 풀어 주고, 그 URL을 fetch하면 실물 바이트를 돌려주는 저장소. */
  function exportableStore(fail = false): ImageStore {
    return {
      upload: async () => null,
      resolve: async (refs: string[]) => (fail ? {} : Object.fromEntries(refs.map((r) => [r, `https://cdn.example/${encodeURIComponent(r)}`]))),
      removeForDoc: async () => undefined,
    };
  }

  beforeEach(() => {
    pngMock.exportPng.mockReset();
    pngMock.exportPng.mockResolvedValue({ missingImages: 0 });
    // fetch → blob → FileReader 경로를 실물 바이트로 흉내낸다.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }) })));
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: PIXEL, configurable: true });
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('참조를 실물 데이터 URL로 되돌린다 — 가져오기에서 그대로 열린다', async () => {
    const ref = makeImageRef('원본문서/pic.webp');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const { doc: full, missing } = await inlineImagesForExport(doc, exportableStore());

    expect(missing).toBe(0);
    expect(full.nodes.c1?.img).toBe(PIXEL);
    expect(collectImageRefs(full)).toEqual([]); // 참조가 남지 않았다 = 자족적이다
    // 가져오는 쪽은 손댈 게 없다 — 데이터 URL이 든 문서를 열면 기존 자동 이전이
    // **새 문서 폴더로** 올려 준다(위 '옛 문서 이전' describe와 같은 경로).
    expect(collectInlineImages(full)).toHaveLength(1);
  });

  it('참조가 없으면 네트워크를 타지 않고 원본 문서를 그대로 돌려준다', async () => {
    const doc = docWithInlineImage(); // 데이터 URL만 (로컬/데모 모드, 텍스트 맵)
    const { doc: same, missing } = await inlineImagesForExport(doc, exportableStore());
    expect(same).toBe(doc);
    expect(missing).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('받지 못한 이미지는 참조로 남기고 **몇 장인지 알린다** (조용히 빠뜨리지 않게)', async () => {
    const ref = makeImageRef('원본문서/pic.webp');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const { doc: partial, missing } = await inlineImagesForExport(doc, exportableStore(true));

    expect(missing).toBe(1);
    expect(partial.nodes.c1?.img).toBe(ref); // 텍스트까지 못 내보내는 것보다 낫다
  });

  it('에디터 JSON 내보내기에 참조가 아니라 실물이 들어간다 (수리 전 회귀 가드)', async () => {
    const ref = makeImageRef('원본문서/pic.webp');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const backend = makeBackend(exportableStore(), doc);
    const docId = `img-export-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(doc));

    dl.files.length = 0;

    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    fireEvent.click(await screen.findByText('JSON 파일 (.json)'));

    await waitFor(() => expect(dl.files).toHaveLength(1));
    const json = dl.files[0]!.data;
    expect(json).toContain('data:image'); // 수리 전: 'mfimg:'만 들어 있었다
    expect(json).not.toContain('mfimg:');
  });

  // PNG는 참조를 **URL로 풀어서** 그린다. 예전엔 화면 렌더용으로 받아 둔 표만 썼기
  // 때문에, 그 발급이 아직 안 끝났으면(막 연 맵, 느린 네트워크) 빈 표로 그려졌다 —
  // 사진 자리가 통째로 빈 상자인 PNG가 나온다.
  it('PNG 내보내기는 화면용 URL이 아직 안 왔어도 직접 받아서 그린다 (수리 전 회귀 가드)', async () => {
    const ref = makeImageRef('원본문서/pic.webp');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    const drawnWith: ImageUrlMap[] = [];
    pngMock.exportPng.mockImplementation(async (...args: unknown[]) => {
      drawnWith.push((args[4] as ImageUrlMap) ?? {});
      return { missingImages: 0 };
    });

    // 첫 발급(화면 렌더용)은 끝나지 않는다 = 아직 URL이 없는 상태.
    let calls = 0;
    const backend = makeBackend(
      {
        upload: async () => null,
        resolve: async (refs: string[]) => {
          calls++;
          if (calls === 1) return await new Promise<Record<string, string>>(() => undefined);
          return Object.fromEntries(refs.map((r) => [r, `https://cdn.example/${encodeURIComponent(r)}`]));
        },
        removeForDoc: async () => undefined,
      },
      doc,
    );
    const docId = `img-png-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(doc));

    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    fireEvent.click(await screen.findByText('PNG 이미지'));

    await waitFor(() => expect(drawnWith).toHaveLength(1));
    // 수리 전: `{}` — 참조가 풀리지 않아 `displaySrc`가 undefined를 돌려주고
    // 그 자리에 아무것도 그려지지 않았다.
    expect(drawnWith[0]![ref]).toBe(`https://cdn.example/${encodeURIComponent(ref)}`);
  });

  it('그리지 못한 이미지가 있으면 알린다 — 빈 상자만 남은 PNG를 모른 채 두지 않게', async () => {
    const ref = makeImageRef('원본문서/pic.webp');
    const doc = docWithInlineImage();
    doc.nodes.c1 = { ...doc.nodes.c1!, img: ref };
    pngMock.exportPng.mockResolvedValue({ missingImages: 1 });

    const backend = makeBackend(exportableStore(true), doc);
    const docId = `img-png-miss-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(doc));

    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    fireEvent.click(await screen.findByText('PNG 이미지'));

    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => /PNG에 담지 못했어요/.test(el.textContent || ''))).toBe(true));
  });
});
