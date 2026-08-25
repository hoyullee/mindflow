import { describe, expect, it } from 'vitest';
import { widgetDataOf } from './widgetData';
import { UI_THEME } from '../../editor/theme';
import { colorForSeed } from '../../../collab/identity';

describe('widgetDataOf', () => {
  it('못 읽는 본문·빈 값은 null(위젯이 폴백 문구를 그린다)', () => {
    expect(widgetDataOf(null)).toBeNull();
    expect(widgetDataOf('not json')).toBeNull();
    expect(widgetDataOf('"scalar"')).toBeNull();
    // 루트도 메모도 열도 없는 문서
    expect(widgetDataOf(JSON.stringify({ nodes: {}, floats: [] }))).toBeNull();
  });

  it('칸반: 열·카드·분류를 실물 그대로 넘기고, 색은 UI_THEME 고정(doc.themeKey 무시)', () => {
    const columns = [
      { id: 'c1', title: '할 일' },
      { id: 'c2', title: '완료' },
    ];
    const cards = [
      { id: 'k1', col: 'c1', pos: 1, text: '첫 줄\n둘째 줄', tag: '개발', owner: 'a@x.com', ownerName: '이호율', due: '2000-01-01' },
      { id: 'k2', col: 'c1', pos: 2, text: 'b' },
      { id: 'k3', col: 'c1', pos: 3, text: 'c' },
      { id: 'k4', col: 'c2', pos: 1, text: 'd', due: '2000-01-01' },
    ];
    // themeKey 'white' = 실제 칸반 문서가 싣는 값(템플릿의 관성) — 에디터는 이 값을
    // 쓰지 않고 항상 UI_THEME으로 그리므로(스타일 메뉴 없음) 위젯도 같아야 한다(제보).
    const d = widgetDataOf(JSON.stringify({ kind: 'kanban', themeKey: 'white', columns, cards, tags: [{ id: 't1', name: '개발' }] }));
    expect(d?.kind).toBe('kanban');
    if (d?.kind !== 'kanban') return;

    // 실물 그대로 — 문구·색으로 미리 접지 않는다(접은 만큼 에디터와 어긋난다).
    expect(d.columns).toEqual(columns);
    expect(d.cards).toEqual(cards);
    expect(d.tags).toEqual([{ id: 't1', name: '개발' }]);

    // 진행 바 = boardProgress 규칙: 완료(마지막 열)부터, 첫 열은 빈 트랙 → 완료 1/4 = 25%.
    // 지정 색 없는 열의 색은 **UI_THEME 팔레트**에서(doc의 white 팔레트가 아니라).
    expect(d.segments).toEqual([{ pct: 25, color: UI_THEME.palette[1] }]);
    expect(d.done).toEqual({ done: 1, total: 4 });
    // 발치 아바타 — 담당이 적힌 카드에서(중복 없이), 색은 접속자 커서와 같은 시드
    expect(d.avatars).toEqual([{ label: '호율', color: colorForSeed('a@x.com') }]);
  });

  it('마인드맵·화이트보드: 지표만 만든다(화면은 realPreview 실렌더가 그린다)', () => {
    const mind = widgetDataOf(
      JSON.stringify({
        nodes: {
          root: { id: 'root', text: '분기 계획', children: ['a'] },
          a: { id: 'a', text: '가지 A', children: [] },
        },
      }),
    );
    expect(mind).toEqual({ kind: 'mind', nodeCount: 2 });

    const board = widgetDataOf(
      JSON.stringify({
        nodes: {},
        floats: [
          { id: 'f1', x: 0, y: 0, w: 100, text: '메모' },
          { id: 'f2', x: 50, y: 50, img: 'mfimg:doc/x.webp' }, // 이미지 플로트는 메모 수에서 제외
        ],
      }),
    );
    expect(board).toEqual({ kind: 'board', noteTotal: 1 });

    // 획만 있는 보드도 그릴 게 있다(실렌더가 잉크를 그린다)
    const inkOnly = widgetDataOf(JSON.stringify({ nodes: {}, floats: [], strokes: [{ id: 's1', pts: [0, 0, 10, 10], color: '#333', w: 4 }] }));
    expect(inkOnly).toEqual({ kind: 'board', noteTotal: 0 });
  });
});
