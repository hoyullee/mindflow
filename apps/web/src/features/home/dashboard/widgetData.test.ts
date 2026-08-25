import { describe, expect, it } from 'vitest';
import { widgetDataOf } from './widgetData';
import { UI_THEME } from '../../editor/theme';
import { columnBg, columnColor, tagColor } from '../../editor/kanbanMeta';
import { colorForSeed } from '../../../collab/identity';

const OPTS = { maxCards: 2 };

describe('widgetDataOf', () => {
  it('못 읽는 본문·빈 값은 null(위젯이 폴백 문구를 그린다)', () => {
    expect(widgetDataOf(null, OPTS)).toBeNull();
    expect(widgetDataOf('not json', OPTS)).toBeNull();
    expect(widgetDataOf('"scalar"', OPTS)).toBeNull();
    // 루트도 메모도 열도 없는 문서
    expect(widgetDataOf(JSON.stringify({ nodes: {}, floats: [] }), OPTS)).toBeNull();
  });

  it('칸반: 열·카드에 에디터의 시각 규칙(열 색·분류 색·기한 문구·아바타 색)이 실린다', () => {
    const raw = JSON.stringify({
      kind: 'kanban',
      themeKey: 'coral',
      columns: [
        { id: 'c1', title: '할 일' },
        { id: 'c2', title: '완료', color: '#3f9e6a' },
      ],
      cards: [
        { id: 'k1', col: 'c1', pos: 1, text: '첫 줄\n둘째 줄', tag: '개발', owner: 'a@x.com', ownerName: '이호율', due: '2000-01-01' },
        { id: 'k2', col: 'c1', pos: 2, text: 'b' },
        { id: 'k3', col: 'c1', pos: 3, text: 'c' },
        { id: 'k4', col: 'c2', pos: 1, text: 'd', due: '2000-01-01' },
      ],
    });
    const d = widgetDataOf(raw, OPTS);
    expect(d?.kind).toBe('kanban');
    if (d?.kind !== 'kanban') return;
    expect(d.columns.map((c) => c.name)).toEqual(['할 일', '완료']);
    expect(d.columns[0]).toMatchObject({ count: 3, more: 1 }); // maxCards 2 → 하나 접힘

    const first = d.columns[0]!.cards[0]!;
    // 카드: 첫 줄만, 분류 색은 에디터의 tagColor에서, 기한은 지났으니 'over',
    // 아바타 색은 접속자 커서와 같은 시드
    expect(first).toMatchObject({ title: '첫 줄', tag: '개발', who: '호율', dueTone: 'over' });
    expect(first.tagBg).toContain('rgba'); // hexA(tagColor, .16)
    expect(first.whoColor).toBe(colorForSeed('a@x.com'));
    expect(tagColor('개발', UI_THEME.palette, [])).toBeTruthy(); // 규칙 자체가 존재함(드리프트 가드)

    // 완료(마지막) 열의 카드는 기한이 지나도 붉지 않다(#448)
    expect(d.columns[1]!.cards[0]!.dueTone).toBe('normal');

    // 열 색·배경은 에디터의 columnColor/columnBg 그대로 — 지정 색이 있으면 그것
    expect(d.columns[0]!.dot).toBe(columnColor({ id: 'c1', title: '할 일' }, 0, UI_THEME.palette));
    expect(d.columns[1]!.dot).toBe('#3f9e6a');
    expect(d.columns[0]!.bg).toBe(columnBg({ bg: undefined }, UI_THEME));

    // 진행 바 = boardProgress 규칙: 완료(마지막 열)부터, 첫 열은 빈 트랙 → 완료 1/4 = 25% 구간 하나
    expect(d.segments).toEqual([{ pct: 25, color: '#3f9e6a' }]);
    expect(d.done).toEqual({ done: 1, total: 4 });
    // 발치 아바타 — 담당이 적힌 카드에서(중복 없이)
    expect(d.avatars).toEqual([{ label: '호율', color: colorForSeed('a@x.com') }]);
    // 면 층은 문서 테마에서 — 홈 다크 CSS 변수가 아니라 hex
    expect(d.surface.board.startsWith('#')).toBe(true);
    expect(d.surface.ink).toBe(UI_THEME.text);
  });

  it('마인드맵·화이트보드: 지표만 만든다(화면은 realPreview 실렌더가 그린다)', () => {
    const mind = widgetDataOf(
      JSON.stringify({
        nodes: {
          root: { id: 'root', text: '분기 계획', children: ['a'] },
          a: { id: 'a', text: '가지 A', children: [] },
        },
      }),
      OPTS,
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
      OPTS,
    );
    expect(board).toEqual({ kind: 'board', noteTotal: 1 });

    // 획만 있는 보드도 그릴 게 있다(실렌더가 잉크를 그린다)
    const inkOnly = widgetDataOf(JSON.stringify({ nodes: {}, floats: [], strokes: [{ id: 's1', pts: [0, 0, 10, 10], color: '#333', w: 4 }] }), OPTS);
    expect(inkOnly).toEqual({ kind: 'board', noteTotal: 0 });
  });
});
