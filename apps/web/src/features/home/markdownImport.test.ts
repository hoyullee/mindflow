import { describe, expect, it } from 'vitest';
import { parseOutline } from './markdownImport';

/** 루트에서 시작해 트리를 [글자, [자식…]] 꼴로 펴 본다 — 계층을 눈으로 확인하기 위해. */
function tree(doc: NonNullable<ReturnType<typeof parseOutline>>, id = 'root'): unknown {
  const n = doc.nodes[id];
  if (!n) return null;
  const kids = n.children.map((c) => tree(doc, c));
  return kids.length ? [n.text, kids] : n.text;
}

describe('마크다운 가져오기', () => {
  describe('우리가 내보낸 형식 (왕복)', () => {
    it('제목·가지·노트·개별 주제·메모를 되읽는다', () => {
      const md = ['# 개요 맵', '  > 루트 노트', '- 가지', '  - 손자', '', '## 개별 주제', '- 자유 도형', '', '## 메모', '- 메모 하나'].join('\n');
      const d = parseOutline(md, '무시됨')!;
      expect(d.nodes.root?.text).toBe('개요 맵');
      expect(d.nodes.root?.note).toBe('루트 노트');
      expect(tree(d)).toEqual(['개요 맵', [['가지', ['손자']]]]);
      const free = Object.values(d.nodes).filter((n) => n.free);
      expect(free.map((n) => n.text)).toEqual(['자유 도형']);
      expect(d.floats.map((f) => f.text)).toEqual(['메모 하나']);
    });

    it('내보내기가 쓴 인라인 서식이 rich 런으로 되살아난다', () => {
      const d = parseOutline('# 맵\n- **굵게** 와 *기울임* 과 [링크](https://ex.com/a)', 'x')!;
      const n = Object.values(d.nodes).find((x) => x.id !== 'root')!;
      expect(n.text).toBe('굵게 와 기울임 과 링크'); // 마커는 사라진다
      const runs = (n.rich ?? []) as { t: string; b?: boolean; i?: boolean; href?: string }[];
      expect(runs.find((r) => r.b)?.t).toBe('굵게');
      expect(runs.find((r) => r.i)?.t).toBe('기울임');
      expect(runs.find((r) => r.href)?.t).toBe('링크');
    });
  });

  describe('바깥에서 만든 마크다운', () => {
    it('제목(##~######)이 계층이 된다', () => {
      const md = ['# 문서', '## 배경', '### 지난 분기', '## 계획'].join('\n');
      expect(tree(parseOutline(md, 'x')!)).toEqual(['문서', [['배경', ['지난 분기']], '계획']]);
    });

    it('목록은 가장 가까운 제목 아래에 쌓인다', () => {
      const md = ['# 문서', '## 배경', '- 하나', '  - 하나의 하나', '## 계획', '- 둘'].join('\n');
      expect(tree(parseOutline(md, 'x')!)).toEqual(['문서', [['배경', [['하나', ['하나의 하나']]]], ['계획', ['둘']]]]);
    });

    it('번호 목록도 항목으로 읽는다', () => {
      const md = ['# 문서', '1. 첫째', '2. 둘째', '   1) 둘째의 하나'].join('\n');
      expect(tree(parseOutline(md, 'x')!)).toEqual(['문서', ['첫째', ['둘째', ['둘째의 하나']]]]);
    });

    it('체크박스는 표시를 떼고 글자만 남긴다', () => {
      const d = parseOutline('# 할 일\n- [ ] 안 한 일\n- [x] 한 일', 'x')!;
      expect(Object.values(d.nodes).filter((n) => n.id !== 'root').map((n) => n.text)).toEqual(['안 한 일', '한 일']);
    });

    it('문단은 바로 앞 노드의 노트가 된다 — 산문을 통째로 잃지 않는다', () => {
      const md = ['# 문서', '이 문서는 배경을 설명한다.', '## 배경', '작년에 이런 일이 있었다.', '한 줄 더.'].join('\n');
      const d = parseOutline(md, 'x')!;
      expect(d.nodes.root?.note).toBe('이 문서는 배경을 설명한다.');
      const bg = Object.values(d.nodes).find((n) => n.text === '배경')!;
      expect(bg.note).toBe('작년에 이런 일이 있었다.\n한 줄 더.');
    });

    it('코드 펜스 안은 읽지 않는다 — 그 안의 `- `가 가지가 되면 구조가 어그러진다', () => {
      const md = ['# 문서', '- 진짜 항목', '```sh', '- 가짜 항목', '# 가짜 제목', '```', '- 또 진짜'].join('\n');
      expect(tree(parseOutline(md, 'x')!)).toEqual(['문서', ['진짜 항목', '또 진짜']]);
    });

    it('YAML 프런트매터를 건너뛴다', () => {
      const md = ['---', 'title: 메타', 'tags: [a, b]', '---', '# 진짜 제목', '- 항목'].join('\n');
      const d = parseOutline(md, 'x')!;
      expect(d.nodes.root?.text).toBe('진짜 제목');
      expect(tree(d)).toEqual(['진짜 제목', ['항목']]);
    });

    it('수평선은 무시한다 (항목으로 읽히면 안 된다)', () => {
      const d = parseOutline('# 문서\n- 하나\n\n---\n\n- 둘', 'x')!;
      expect(tree(d)).toEqual(['문서', ['하나', '둘']]);
    });

    it('제목이 없으면 파일 이름이 맵 이름이 된다', () => {
      const d = parseOutline('- 하나\n- 둘', '내 노트')!;
      expect(d.nodes.root?.text).toBe('내 노트');
      expect(tree(d)).toEqual(['내 노트', ['하나', '둘']]);
    });

    it('구조가 없으면 가져오지 않는다 — 산문만 있는 파일은 맵이 아니다', () => {
      // 예전 규칙 그대로. 문단(노트)은 구조에 딸려 오는 살이라 그것만으로는 안 된다.
      expect(parseOutline('# 제목뿐인 문서', 'x')).toBeNull();
      expect(parseOutline('# 오늘 회의\n결론은 미루기로 했다.', 'x')).toBeNull();
      // 제목이 하나라도 계층을 이루면 그 산문까지 함께 들어온다.
      const d = parseOutline('# 오늘 회의\n들어가는 말\n## 결론\n미루기로 했다.', 'x')!;
      expect(d.nodes.root?.note).toBe('들어가는 말');
      const c = Object.values(d.nodes).find((n) => n.text === '결론')!;
      expect(c.note).toBe('미루기로 했다.');
    });

    it('가져올 게 정말 없으면 null', () => {
      expect(parseOutline('', 'x')).toBeNull();
      expect(parseOutline('```\n- 코드 안뿐\n```', 'x')).toBeNull();
    });
  });
});
