import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { addImageFloatItem, clearNodeImage, setNodeImage } from './mutations';
import { defaultFloatSize, fitWithin, firstImageFile, DEFAULT_IMAGE_FLOAT_WIDTH, MAX_IMAGE_DIM } from './imageAttach';

const IMG_SRC = 'data:image/jpeg;base64,QUJDREVG';

// 이미지 플로트가 하나 있는 문서 (jsdom은 <img>를 로드하지 않지만 렌더는 함)
const DOC_WITH_IMAGE = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [
    { id: 'memo1', x: -260, y: 160, w: 200, text: '일반 메모' },
    { id: 'img1', x: 100, y: 100, w: 260, h: 195, text: '', img: IMG_SRC },
  ],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('image attach — pure helpers', () => {
  it('fitWithin caps the long side and keeps aspect', () => {
    expect(fitWithin(2048, 1024, MAX_IMAGE_DIM)).toEqual({ w: 1024, h: 512 });
    expect(fitWithin(500, 300, MAX_IMAGE_DIM)).toEqual({ w: 500, h: 300 }); // 이미 작으면 그대로
    expect(fitWithin(1000, 4000, 1024)).toEqual({ w: 256, h: 1024 });
  });

  it('defaultFloatSize keeps aspect at the default display width', () => {
    expect(defaultFloatSize(1024, 512)).toEqual({ w: DEFAULT_IMAGE_FLOAT_WIDTH, h: 130 });
    // 원본이 기본 폭보다 작으면 원본 크기 그대로
    expect(defaultFloatSize(120, 90)).toEqual({ w: 120, h: 90 });
  });

  it('firstImageFile picks the first image out of mixed clipboard items', () => {
    const img = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['y'], 'b.txt', { type: 'text/plain' });
    const dt = {
      items: [
        { kind: 'file', getAsFile: () => txt },
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => img },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(firstImageFile(dt)).toBe(img);
    expect(firstImageFile(null)).toBeNull();
  });

  it('addImageFloatItem appends an image float with explicit display size', () => {
    const out = addImageFloatItem([], 'f9', 5, 6, IMG_SRC, 260, 195);
    expect(out).toEqual([{ id: 'f9', x: 5, y: 6, w: 260, h: 195, text: '', img: IMG_SRC }]);
  });

  it('setNodeImage/clearNodeImage keep img/imgW/imgH as an all-or-nothing trio', () => {
    const base = { root: { id: 'root', text: 'x', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } };
    const withImg = setNodeImage(base, 'root', IMG_SRC, 180, 135);
    expect(withImg.root).toMatchObject({ img: IMG_SRC, imgW: 180, imgH: 135 });
    const cleared = clearNodeImage(withImg, 'root');
    // 키 자체가 사라져야 직렬화/CRDT에서 필드가 제거된다 (undefined 잔존 금지)
    expect('img' in cleared.root!).toBe(false);
    expect('imgW' in cleared.root!).toBe(false);
    expect('imgH' in cleared.root!).toBe(false);
  });
});

describe('node image in the editor', () => {
  const DOC_NODE_IMG = {
    ...DOC_WITH_IMAGE,
    nodes: {
      root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
      c1: { id: 'c1', text: '사진 노드', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, img: IMG_SRC, imgW: 180, imgH: 135 },
    },
    floats: [],
  };

  it('renders the thumbnail inside the node box, above the text', () => {
    localStorage.setItem('mindflow_doc_nodeimg', JSON.stringify(DOC_NODE_IMG));
    const { container } = renderEditor('/editor?map=nodeimg&title=t');
    const vp = getViewport(container);
    const nodeBox = vp.querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(nodeBox).toBeTruthy();
    const img = nodeBox.querySelector('img') as HTMLImageElement;
    expect(img?.getAttribute('src')).toBe(IMG_SRC);
    expect(within(nodeBox).getByText('사진 노드')).toBeTruthy();
  });

});

describe('image float in the editor', () => {
  it('renders as an <img> without the memo fold-toggle or placeholder text', () => {
    localStorage.setItem('mindflow_doc_imgdoc', JSON.stringify(DOC_WITH_IMAGE));
    const { container } = renderEditor('/editor?map=imgdoc&title=t');
    const vp = getViewport(container);

    const img = vp.querySelector(`img[src="${IMG_SRC}"]`);
    expect(img).toBeTruthy();
    // 이미지 카드 안에는 접기 토글(－)이나 '메모 입력…' 플레이스홀더가 없다
    const card = img!.parentElement as HTMLElement;
    expect(within(card).queryByText('−')).toBeNull();
    expect(within(card).queryByText('메모 입력…')).toBeNull();
    // 일반 메모는 여전히 접기 토글을 가진다
    expect(within(vp).getByText('일반 메모')).toBeTruthy();
  });

  it('double-click selects but does NOT open a text editor (images have no text)', async () => {
    localStorage.setItem('mindflow_doc_imgdoc', JSON.stringify(DOC_WITH_IMAGE));
    const user = userEvent.setup();
    const { container } = renderEditor('/editor?map=imgdoc&title=t');
    const vp = getViewport(container);
    const card = vp.querySelector(`img[src="${IMG_SRC}"]`)!.parentElement as HTMLElement;

    await user.dblClick(card);
    // 편집 textarea가 아니라 이미지 속성 패널이 뜬다
    expect(card.querySelector('textarea')).toBeNull();
    expect(screen.getByText('선택한 이미지')).toBeTruthy();
  });

  it('insert menu offers 이미지 추가', async () => {
    localStorage.setItem('mindflow_doc_imgdoc', JSON.stringify(DOC_WITH_IMAGE));
    const user = userEvent.setup();
    renderEditor('/editor?map=imgdoc&title=t');
    await user.click(screen.getByRole('button', { name: '삽입' }));
    expect(screen.getByText('이미지 추가')).toBeTruthy();
  });
});
