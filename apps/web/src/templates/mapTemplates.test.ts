import { describe, expect, it } from 'vitest';
import { ROOT_ID, layout, parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import { BOARD_TEMPLATES, BOARD_THEME_KEY, KANBAN_TEMPLATES, MAP_TEMPLATES, buildTemplateDoc, findBoardTemplate, findKanbanTemplate, findTemplate } from './mapTemplates';
import { CARD_LABELS } from '../features/editor/kanbanLabels';

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

describe('화이트보드 템플릿', () => {
  // 메모 카드의 최소 높이(`measureFloatHeight`의 `f.h || 44`) — h를 적지 않은
  // 제목 카드는 이 높이로 그려진다.
  const MIN_H = 44;

  it('id가 맵 템플릿과도 서로 겹치지 않는다 — 주소의 tpl 값 하나로 갈린다', () => {
    const ids = [...BOARD_TEMPLATES.map((t) => t.id), ...MAP_TEMPLATES.map((t) => t.id), 'board'];
    expect(new Set(ids).size).toBe(ids.length);
    expect(findBoardTemplate('없는-보드')).toBeNull();
    expect(findBoardTemplate(null)).toBeNull();
    // 맵 조회는 보드 id를 모른다(그 반대도) — 두 목록이 섞이지 않는다.
    expect(findTemplate('board-retro')).toBeNull();
    expect(findBoardTemplate('meeting')).toBeNull();
  });

  it.each(BOARD_TEMPLATES.map((t) => [t.id, t] as const))('%s: 트리 없는 board 문서로 만들어진다', (_id, tpl) => {
    const d = buildTemplateDoc(tpl.id)!;
    expect(d).not.toBeNull();
    // board = `nodes: {}`인 평범한 Doc — 숨은 루트를 두지 않는다(M1 결정).
    expect(d.kind).toBe('board');
    expect(Object.keys(d.nodes)).toEqual([]);
    expect(d.themeKey).toBe(BOARD_THEME_KEY);
    // 보드가 실제로 만들 수 있는 어휘(메모·이미지·잉크)만 쓴다 — 사용자가 지웠을 때
    // 다시 만들 수 없는 물건(영역·연결선)을 템플릿만 슬쩍 심어 두지 않는다.
    expect(d.lines).toEqual([]);
    expect(d.zones).toEqual([]);
    expect(d.floats.length).toBe(tpl.memos.length);

    // 저장 포맷을 통과한다(= 그대로 저장하고 다시 열 수 있다)
    const round = parseDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
    expect(round).not.toBeNull();
    expect(round!.kind).toBe('board');
    expect(round!.floats.length).toBe(d.floats.length);
    expect(round!.floats[0]?.rich?.[0]?.t).toBe(d.floats[0]?.rich?.[0]?.t);
  });

  it('굵은 제목 카드의 rich 런 글자가 text와 같다(모델 계약)', () => {
    for (const tpl of BOARD_TEMPLATES) {
      const d = buildTemplateDoc(tpl.id)!;
      d.floats.forEach((f, i) => {
        const bold = tpl.memos[i]!.bold;
        if (!bold) {
          expect(f.rich).toBeUndefined();
          return;
        }
        expect(f.rich).toEqual([{ t: f.text, b: true }]);
      });
    }
  });

  it('어떤 두 메모도 겹치지 않는다 — 열자마자 카드가 포개져 보이면 첫인상이 나쁘다', () => {
    for (const tpl of BOARD_TEMPLATES) {
      const boxes = buildTemplateDoc(tpl.id)!.floats.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h ?? MIN_H }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(hit, `${tpl.id}: 메모 ${i}·${j}가 겹친다`).toBe(false);
        }
      }
    }
  });

  it('메모 id가 에디터가 만드는 id와 모양이 달라 부딪히지 않는다', () => {
    for (const tpl of BOARD_TEMPLATES) {
      for (const f of buildTemplateDoc(tpl.id)!.floats) expect(f.id).toMatch(/^bt\d+$/);
    }
  });

  it('빈 화이트보드(`tpl=board`)는 그대로다 — 안내 메모 하나로 시작', () => {
    const d = buildTemplateDoc('board')!;
    expect(d.kind).toBe('board');
    expect(d.floats.length).toBe(1);
    expect(d.floats[0]?.text.length).toBeGreaterThan(0);
  });
});

describe('칸반 템플릿', () => {
  it('id가 다른 목록과 겹치지 않는다 — 주소의 tpl 값 하나로 갈린다', () => {
    const ids = [...KANBAN_TEMPLATES.map((t) => t.id), ...BOARD_TEMPLATES.map((t) => t.id), ...MAP_TEMPLATES.map((t) => t.id), 'board', 'kanban'];
    expect(new Set(ids).size).toBe(ids.length);
    expect(findKanbanTemplate('없는-칸반')).toBeNull();
    expect(findKanbanTemplate(null)).toBeNull();
    // 목록끼리 섞이지 않는다.
    expect(findTemplate('kanban-sprint')).toBeNull();
    expect(findBoardTemplate('kanban-sprint')).toBeNull();
    expect(findKanbanTemplate('board-retro')).toBeNull();
  });

  it.each(KANBAN_TEMPLATES.map((t) => [t.id, t] as const))('%s: 열·카드가 있는 칸반 문서이고 직렬화 왕복을 견딘다', (_id, tpl) => {
    const doc = buildTemplateDoc(tpl.id);
    expect(doc).not.toBeNull();
    const d = doc!;
    expect(d.kind).toBe('kanban');
    expect(Object.keys(d.nodes)).toHaveLength(0); // 칸반에는 트리가 없다
    expect(d.floats).toHaveLength(0);
    expect(d.columns?.map((c) => c.title)).toEqual(tpl.columns);
    expect(d.cards).toHaveLength(tpl.cards.length);
    const back = parseDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
    expect(back).not.toBeNull();
    expect(back!.columns).toEqual(d.columns);
    expect(back!.cards).toEqual(d.cards);
  });

  it.each(KANBAN_TEMPLATES.map((t) => [t.id, t] as const))('%s: 모든 카드가 실제 열에 속하고, 열 안 순서가 배열 순서와 같다', (_id, tpl) => {
    const d = buildTemplateDoc(tpl.id)!;
    const colIds = new Set(d.columns!.map((c) => c.id));
    d.cards!.forEach((c) => expect(colIds.has(c.col)).toBe(true));
    // 열마다 pos 순 = 템플릿에 적은 순서.
    d.columns!.forEach((col, ci) => {
      const wanted = tpl.cards.filter((c) => c.col === ci).map((c) => c.text);
      const got = d
        .cards!.filter((c) => c.col === col.id)
        .sort((a, b) => a.pos - b.pos)
        .map((c) => c.text);
      expect(got).toEqual(wanted);
    });
  });

  it('색 라벨은 고를 수 있는 값만 쓴다 — 템플릿만 아는 색을 심지 않는다', () => {
    const allowed = new Set(CARD_LABELS.map((l) => l.bg).filter(Boolean));
    KANBAN_TEMPLATES.forEach((t) => t.cards.forEach((c) => c.bg && expect(allowed.has(c.bg)).toBe(true)));
  });

  it('카드 id가 에디터가 만드는 id와 모양이 달라 부딪히지 않는다', () => {
    const d = buildTemplateDoc('kanban-sprint')!;
    [...d.columns!.map((c) => c.id), ...d.cards!.map((c) => c.id)].forEach((id) => expect(id).not.toMatch(/^x\d+_/));
  });
});
