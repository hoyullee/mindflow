// 태그 **판** — 공책 밖의 한 벌(요청: "태그는 한판으로 관리됐으면 좋겠어").
//
// 이 파일이 지키는 것: 만든 태그가 **모든 공책**에 보인다 · 기본 여섯도 지울 수
// 있고 그 자리가 남는다(다시 켜지지 않는다) · 권마다 따로 살던 옛 태그를 잃지 않는다.

import { beforeEach, describe, expect, it } from 'vitest';
import { NOTE_TAGS } from '@mindflow/mindmap-core';
import { absorbDocTags, addNoteTag, noteTagBoard, noteTagInk, noteTagOptions, removeNoteTag } from './noteTags';

beforeEach(() => {
  localStorage.clear();
});

describe('태그 판', () => {
  it('처음에는 기본 여섯뿐이다', () => {
    expect(noteTagOptions()).toEqual([...NOTE_TAGS]);
  });

  it('만든 태그는 목록 뒤에 붙고 색까지 기억한다', () => {
    addNoteTag('스프린트', '#7C9BD8');
    expect(noteTagOptions()).toEqual([...NOTE_TAGS, '스프린트']);
    expect(noteTagInk('스프린트')).toBe('#7C9BD8');
    // 문서에 남아 있던 옛 값보다 **판이 먼저**다.
    expect(noteTagInk('스프린트', { 스프린트: '#111111' })).toBe('#7C9BD8');
  });

  it('기본 태그도 지울 수 있다 — 상수라 빼지 못하므로 **가려 둔다**', () => {
    removeNoteTag('회의록');
    expect(noteTagOptions()).not.toContain('회의록');
    expect(noteTagBoard().hidden).toContain('회의록');
    // 같은 이름을 다시 만들면 되살아난다(가린 자리를 걷는다).
    addNoteTag('회의록');
    expect(noteTagOptions()).toContain('회의록');
    expect(noteTagBoard().hidden).not.toContain('회의록');
  });

  it('권마다 따로 살던 옛 태그를 판으로 옮긴다 — 한 번만, 색까지', () => {
    absorbDocTags(['옛태그'], { 옛태그: '#E8845C' });
    expect(noteTagOptions()).toContain('옛태그');
    expect(noteTagInk('옛태그')).toBe('#E8845C');

    // 다시 불러도 두 번 들어가지 않는다.
    absorbDocTags(['옛태그'], { 옛태그: '#E8845C' });
    expect(noteTagBoard().made.filter((t) => t === '옛태그')).toHaveLength(1);
  });

  it('지운 태그는 목록과 색에서 함께 빠진다', () => {
    addNoteTag('임시', '#7C9BD8');
    removeNoteTag('임시');
    expect(noteTagOptions()).not.toContain('임시');
    expect(noteTagBoard().colors['임시']).toBeUndefined();
  });

  it('깨진 값이 들어 있어도 기본 여섯으로 산다', () => {
    localStorage.setItem('mf_note_tags', '{{{');
    expect(noteTagOptions()).toEqual([...NOTE_TAGS]);
  });
});
