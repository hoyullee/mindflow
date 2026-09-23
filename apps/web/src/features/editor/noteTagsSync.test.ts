// 태그 판이 **계정에 딸린다**(0042) — 기기 캐시와 서버 판을 맞추는 규칙.
//
// 이 파일이 지키는 것: 기기에만 있던 판을 잃지 않는다 · 서버 판과 합쳐 양쪽을 다
// 보여 준다 · **지운 것은 되살아나지 않는다**(묘비) · 앞사람이 쓰던 기기의 판을
// 다음 사람 계정에 섞지 않는다 · 서버가 없거나 끊겨도 화면은 그대로 돈다.

import { beforeEach, describe, expect, it } from 'vitest';
import { NOTE_TAGS } from '@mindflow/mindmap-core';
import type { NoteTagBoard, TagStore } from '../../adapters/ports';
import { addNoteTag, attachNoteTagStore, detachNoteTagStore, noteTagInk, noteTagOptions, removeNoteTag } from './noteTags';

class FakeStore implements TagStore {
  saves = 0;
  constructor(public board: NoteTagBoard | null = null) {}
  async load(): Promise<NoteTagBoard | null> {
    return this.board ? { made: [...this.board.made], colors: { ...this.board.colors }, hidden: [...this.board.hidden] } : null;
  }
  async save(board: NoteTagBoard): Promise<void> {
    this.saves += 1;
    this.board = { made: [...board.made], colors: { ...board.colors }, hidden: [...board.hidden] };
  }
}

/** 던지는 저장소 — 서버가 없거나(마이그레이션 전) 끊긴 상태. */
class DeadStore implements TagStore {
  async load(): Promise<NoteTagBoard | null> {
    throw new Error('offline');
  }
  async save(): Promise<void> {
    throw new Error('offline');
  }
}

/** 태그를 만들면 **기다리지 않고** 서버로 던진다 — 그 던짐이 끝날 틈을 준다. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  detachNoteTagStore();
});

describe('태그 판 — 서버와 맞추기', () => {
  it('서버에 판이 없으면 이 기기 판을 올린다(기기에만 있던 태그를 잃지 않는다)', async () => {
    addNoteTag('스프린트', '#7C9BD8');
    const store = new FakeStore(null);
    await attachNoteTagStore(store, 'u1');
    expect(store.board?.made).toEqual(['스프린트']);
    expect(store.board?.colors['스프린트']).toBe('#7C9BD8');
  });

  it('둘 다 비어 있으면 아무것도 쓰지 않는다(로그인마다 행을 만들지 않는다)', async () => {
    const store = new FakeStore(null);
    await attachNoteTagStore(store, 'u1');
    expect(store.saves).toBe(0);
    expect(noteTagOptions()).toEqual([...NOTE_TAGS]);
  });

  it('서버 판과 기기 판을 합친다 — 양쪽 태그가 모두 보인다', async () => {
    addNoteTag('기기태그');
    const store = new FakeStore({ made: ['서버태그'], colors: { 서버태그: '#E8845C' }, hidden: [] });
    await attachNoteTagStore(store, 'u1');
    expect(noteTagOptions()).toContain('서버태그');
    expect(noteTagOptions()).toContain('기기태그');
    expect(noteTagInk('서버태그')).toBe('#E8845C');
    // 합친 판은 서버에도 올라간다(다음 기기가 둘 다 본다).
    expect(store.board?.made).toEqual(['서버태그', '기기태그']);
  });

  it('지운 태그는 합치기로 되살아나지 않는다(묘비가 이긴다)', async () => {
    removeNoteTag('출장'); // 이 기기에서 지웠다
    const store = new FakeStore({ made: ['출장'], colors: {}, hidden: [] }); // 서버는 아직 들고 있다
    await attachNoteTagStore(store, 'u1');
    expect(noteTagOptions()).not.toContain('출장');
    expect(store.board?.hidden).toContain('출장');
    expect(store.board?.made).not.toContain('출장');
  });

  it('기본 태그를 다른 기기에서 지웠으면 이 기기에서도 사라진다', async () => {
    const store = new FakeStore({ made: [], colors: {}, hidden: [NOTE_TAGS[0] as string] });
    await attachNoteTagStore(store, 'u1');
    expect(noteTagOptions()).not.toContain(NOTE_TAGS[0]);
  });

  it('앞사람이 쓰던 기기의 판은 다음 계정에 섞지 않는다', async () => {
    addNoteTag('개인메모');
    await attachNoteTagStore(new FakeStore(null), 'u1'); // u1의 판으로 찍힌다
    detachNoteTagStore();

    const next = new FakeStore({ made: ['회사'], colors: {}, hidden: [] });
    await attachNoteTagStore(next, 'u2');
    expect(noteTagOptions()).toContain('회사');
    expect(noteTagOptions()).not.toContain('개인메모');
    expect(next.board?.made).toEqual(['회사']); // 남의 태그를 u2 계정에 올리지 않는다
  });

  it('붙은 뒤에 만들거나 지운 태그는 서버로도 간다', async () => {
    const store = new FakeStore({ made: [], colors: {}, hidden: [] });
    await attachNoteTagStore(store, 'u1');

    addNoteTag('배포', '#7C9BD8');
    await settle();
    expect(store.board?.made).toEqual(['배포']);

    removeNoteTag('배포');
    await settle();
    expect(store.board?.made).toEqual([]);
    expect(store.board?.hidden).toContain('배포');
  });

  it('서버를 못 읽어도 화면은 이 기기 판으로 돈다', async () => {
    addNoteTag('오프라인');
    await attachNoteTagStore(new DeadStore(), 'u1');
    expect(noteTagOptions()).toContain('오프라인');
  });

  it('같은 저장소·같은 계정으로 다시 붙어도 다시 쓰지 않는다', async () => {
    addNoteTag('한번');
    const store = new FakeStore(null);
    await attachNoteTagStore(store, 'u1');
    const saves = store.saves;
    await attachNoteTagStore(store, 'u1');
    expect(store.saves).toBe(saves);
  });
});
