import { describe, expect, it } from 'vitest';
import { ROOT_ID, layout, parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import { MAP_TEMPLATES, buildTemplateDoc, findTemplate } from './mapTemplates';

describe('맵 템플릿', () => {
  it('모르는 id는 null — 호출부가 평범한 빈 맵으로 떨어진다', () => {
    expect(buildTemplateDoc('없는-템플릿')).toBeNull();
    expect(buildTemplateDoc(null)).toBeNull();
    expect(buildTemplateDoc(undefined)).toBeNull();
    expect(findTemplate('없는-템플릿')).toBeNull();
  });

  it('id가 유일하다 — 갤러리 카드와 주소의 tpl 값이 곧 이 id다', () => {
    const ids = MAP_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MAP_TEMPLATES.map((t) => [t.id, t] as const))('%s: 직렬화 왕복을 견디는 온전한 문서다', (_id, tpl) => {
    const doc = buildTemplateDoc(tpl.id);
    expect(doc).not.toBeNull();
    const d = doc!;

    // 루트 = 템플릿 이름 (카드 제목·새 맵 제목과 늘 같다)
    expect(d.nodes[ROOT_ID]?.text).toBe(tpl.name);
    expect(d.nodes[ROOT_ID]?.emoji).toBe(tpl.emoji);
    expect(d.nodes[ROOT_ID]?.parent).toBeNull();

    // 부모/자식 링크가 서로 맞는다 — 어긋나면 레이아웃이 노드를 잃는다
    for (const n of Object.values(d.nodes)) {
      for (const cid of n.children) {
        expect(d.nodes[cid]?.parent).toBe(n.id);
      }
      if (n.parent) expect(d.nodes[n.parent]?.children).toContain(n.id);
      // 빈 글자 노드는 두지 않는다(빈 박스로 열려 미완성처럼 보인다)
      expect(n.text.trim().length).toBeGreaterThan(0);
    }

    // 저장 포맷을 통과한다(= 이 문서를 그대로 저장하고 다시 열 수 있다)
    const round = parseDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
    expect(round).not.toBeNull();
    expect(Object.keys(round!.nodes).length).toBe(Object.keys(d.nodes).length);
    expect(round!.layoutMode).toBe(tpl.layoutMode);
  });

  it('메모는 `right` 레이아웃에만, 트리가 절대 오지 않는 x < 0에만 둔다', () => {
    const size = () => ({ w: 140, h: 44 });
    for (const tpl of MAP_TEMPLATES) {
      if (!tpl.memo) continue;
      // 계약: right 모드는 트리를 전부 x > 0에 놓는다(`layoutSided`).
      expect(tpl.layoutMode).toBe('right');
      const doc = buildTemplateDoc(tpl.id)!;
      const laid = layout(doc, doc.layoutMode, size);
      const leftmost = Math.min(...Object.values(laid).map((n) => n.x - size().w / 2));
      const memoRight = tpl.memo.x + tpl.memo.w;
      expect(memoRight).toBeLessThan(leftmost);
    }
  });

  it('노드 id가 에디터가 만드는 id(`x1_<타임스탬프>`)와 모양이 달라 한 문서 안에서 부딪히지 않는다', () => {
    const doc = buildTemplateDoc('meeting')!;
    const ids = Object.keys(doc.nodes).filter((id) => id !== ROOT_ID);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^t\d+$/);
  });
});
