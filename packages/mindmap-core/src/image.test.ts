import { describe, expect, it } from 'vitest';
import { collectImageRefs, collectInlineImages, imageRefPath, isImageRef, makeImageRef, replaceInlineImages } from './image';
import type { Doc, Float, Node } from './model';

const node = (id: string, extra: Partial<Node> = {}): Node => ({
  id,
  text: id,
  emoji: '',
  parent: id === 'root' ? null : 'root',
  children: [],
  collapsed: false,
  color: null,
  x: 0,
  y: 0,
  ...extra,
});

const float = (id: string, extra: Partial<Float> = {}): Float => ({ id, x: 0, y: 0, w: 100, text: '', ...extra }) as Float;

function doc(nodes: Node[], floats: Float[] = []): Doc {
  const map: Record<string, Node> = {};
  for (const n of nodes) map[n.id] = n;
  return { v: 1, nodes: map, floats, lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' };
}

const DATA = 'data:image/jpeg;base64,AAAA';

describe('이미지 참조 규칙', () => {
  it('참조와 그냥 소스를 가른다 — 옛 문서의 데이터 URL은 참조가 아니다', () => {
    expect(isImageRef(makeImageRef('doc1/a.jpg'))).toBe(true);
    expect(isImageRef(DATA)).toBe(false);
    expect(isImageRef('https://example.com/a.png')).toBe(false);
    expect(isImageRef(undefined)).toBe(false);
  });

  it('참조에서 저장소 경로를 꺼낸다', () => {
    expect(imageRefPath(makeImageRef('doc1/a.jpg'))).toBe('doc1/a.jpg');
    expect(imageRefPath(DATA)).toBeNull();
    expect(imageRefPath('mfimg:')).toBeNull(); // 경로가 비면 참조로 치지 않는다
  });

  it('문서가 쓰는 참조를 중복 없이 모은다 (노드·메모 모두, 데이터 URL은 제외)', () => {
    const ref = makeImageRef('d/1.jpg');
    const d = doc([node('root'), node('a', { img: ref }), node('b', { img: ref }), node('c', { img: DATA })], [float('f1', { img: makeImageRef('d/2.jpg') }), float('f2')]);
    expect(collectImageRefs(d).sort()).toEqual([ref, makeImageRef('d/2.jpg')].sort());
  });

  it('아직 인라인인 이미지를 어디에 붙어 있는지까지 알려 준다 (이전 대상)', () => {
    const d = doc([node('root'), node('a', { img: DATA }), node('b', { img: makeImageRef('d/1.jpg') })], [float('f1', { img: DATA })]);
    expect(collectInlineImages(d)).toEqual([
      { kind: 'node', id: 'a', dataUrl: DATA },
      { kind: 'float', id: 'f1', dataUrl: DATA },
    ]);
  });

  it('인라인을 참조로 갈아 끼운다 — 같은 이미지가 여러 곳에 있어도 한 참조를 공유한다', () => {
    const d = doc([node('root'), node('a', { img: DATA })], [float('f1', { img: DATA })]);
    const ref = makeImageRef('d/1.jpg');
    const next = replaceInlineImages(d, { [DATA]: ref });
    expect(next.nodes.a?.img).toBe(ref);
    expect(next.floats[0]?.img).toBe(ref);
    expect(collectInlineImages(next)).toEqual([]);
  });

  it('옮기지 못한 것은 그대로 둔다 — 일부만 올라가도 문서는 온전하다', () => {
    const other = 'data:image/png;base64,BBBB';
    const d = doc([node('root'), node('a', { img: DATA }), node('b', { img: other })]);
    const next = replaceInlineImages(d, { [DATA]: makeImageRef('d/1.jpg') });
    expect(next.nodes.a?.img).toBe(makeImageRef('d/1.jpg'));
    expect(next.nodes.b?.img).toBe(other);
  });

  it('바꿀 게 없으면 **같은 문서 객체**를 돌려준다 (CRDT diff가 헛돌지 않게)', () => {
    const d = doc([node('root'), node('a', { img: makeImageRef('d/1.jpg') })]);
    expect(replaceInlineImages(d, { [DATA]: makeImageRef('d/2.jpg') })).toBe(d);
  });
});
