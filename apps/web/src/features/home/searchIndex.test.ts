import { describe, expect, it } from 'vitest';
import { docSearchText, matchesQuery } from './searchIndex';

const doc = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    nodes: {
      root: { id: 'root', text: '분기 회고', emoji: '📝', parent: null, children: ['n1'], collapsed: false, color: null, x: 0, y: 0 },
      n1: { id: 'n1', text: '이탈률 개선', emoji: '', note: '지표는 대시보드 참고', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
    },
    floats: [{ id: 'f1', x: 0, y: 0, w: 200, text: '다음 회의 때 공유' }],
    lines: [],
    zones: [{ id: 'z1', x: 0, y: 0, w: 10, h: 10, label: '보류 구역' }],
    layoutMode: 'radial',
    themeKey: 'coral',
    ...extra,
  });

describe('홈 본문 검색 색인', () => {
  it('주제·노트·메모·영역 이름을 모두 모은다 (소문자)', () => {
    const t = docSearchText('d1', doc());
    expect(t).toContain('분기 회고');
    expect(t).toContain('이탈률 개선');
    expect(t).toContain('지표는 대시보드 참고');
    expect(t).toContain('다음 회의 때 공유');
    expect(t).toContain('보류 구역');
  });

  it('영문은 대소문자를 가리지 않는다', () => {
    const t = docSearchText('d-en', JSON.stringify({ nodes: { root: { text: 'Roadmap Q3' } } }));
    expect(matchesQuery('제목', t, 'roadmap')).toBe(true);
  });

  it('이미지 데이터는 검색 대상이 아니다 — base64에 우연히 걸리지 않는다', () => {
    // 로컬 모드의 본문에는 이미지가 데이터 URL로 인라인돼 있다(백엔드는 RPC가 뗀다).
    const withImg = JSON.stringify({
      nodes: { root: { text: '사진 맵', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg', imgW: 10, imgH: 10 } },
      floats: [{ id: 'f1', img: 'data:image/webp;base64,UklGRh4AAABXRUJQ' }],
    });
    const t = docSearchText('d2', withImg);
    expect(t).toContain('사진 맵');
    expect(t).not.toContain('base64');
    expect(t).not.toContain('ivbor');
    expect(t).not.toContain('data:image');
  });

  it('좌표·색·id 같은 값도 들어오지 않는다', () => {
    const t = docSearchText('d3', doc());
    expect(t).not.toContain('coral');
    expect(t).not.toContain('radial');
    expect(t).not.toContain('root');
  });

  it('본문이 없거나 손상돼도 던지지 않는다 (제목으로만 찾힌다)', () => {
    expect(docSearchText('d4', undefined)).toBe('');
    expect(docSearchText('d5', '{ 깨진 json')).toBe('');
    expect(matchesQuery('회고 맵', '', '회고')).toBe(true);
  });

  it('같은 docId라도 본문이 바뀌면 다시 읽는다 (저장 후 새 내용이 찾혀야 한다)', () => {
    expect(docSearchText('same', JSON.stringify({ nodes: { root: { text: '옛 내용' } } }))).toContain('옛 내용');
    expect(docSearchText('same', JSON.stringify({ nodes: { root: { text: '새 내용' } } }))).toContain('새 내용');
  });

  it('빈 질의는 모두 통과 (검색하지 않는 상태)', () => {
    expect(matchesQuery('아무 제목', '', '')).toBe(true);
  });

  it('제목과 본문 어느 쪽이든 걸린다', () => {
    const t = docSearchText('d6', doc());
    expect(matchesQuery('분기 회고', t, '회고')).toBe(true); // 제목
    expect(matchesQuery('분기 회고', t, '이탈률')).toBe(true); // 본문
    expect(matchesQuery('분기 회고', t, '없는낱말')).toBe(false);
  });
});
