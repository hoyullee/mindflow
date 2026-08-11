import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import type { Doc } from '@mindflow/mindmap-core';
import { listVersions, MAX_ENTRIES, MIN_INTERVAL_MS, recordVersion, versionBody, versionDoc } from './versionHistory';

// 문서 버전 히스토리(#21) — 로컬 스냅샷 보관함의 순수 로직.

function docWith(text: string): Doc {
  const parsed = parseDoc({
    v: 1,
    nodes: { root: { id: 'root', text, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'right',
    themeKey: 'coral',
  });
  if (!parsed) throw new Error('테스트 픽스처 파싱 실패');
  return parsed;
}

const T0 = 1_700_000_000_000;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('recordVersion / listVersions', () => {
  it('저장 시점마다 항목이 쌓이고, 목록은 최신 먼저다', () => {
    recordVersion('d1', docWith('하나'), { now: T0 });
    recordVersion('d1', docWith('둘'), { now: T0 + MIN_INTERVAL_MS + 1 });
    const list = listVersions('d1');
    expect(list.length).toBe(2);
    expect(list[0]!.at).toBe(T0 + MIN_INTERVAL_MS + 1);
    expect(list[1]!.at).toBe(T0);
    expect(list[0]!.nodes).toBe(1);
  });

  it('본문이 그대로면 기록하지 않는다 (dedupe)', () => {
    recordVersion('d1', docWith('같음'), { now: T0 });
    recordVersion('d1', docWith('같음'), { now: T0 + MIN_INTERVAL_MS * 2 });
    expect(listVersions('d1').length).toBe(1);
  });

  it('간격 안의 연속 저장은 마지막 항목을 갱신한다 (새 판을 만들지 않음)', () => {
    recordVersion('d1', docWith('처음'), { now: T0 });
    recordVersion('d1', docWith('고침'), { now: T0 + 1000 });
    const list = listVersions('d1');
    expect(list.length).toBe(1);
    expect(list[0]!.at).toBe(T0 + 1000);
    expect(versionBody('d1', T0 + 1000)).toContain('고침');
  });

  it('force면 간격 안이라도 항상 새 항목이다 (복원 직전 현재 상태 보존)', () => {
    recordVersion('d1', docWith('처음'), { now: T0 });
    recordVersion('d1', docWith('복원 직전'), { now: T0 + 1000, force: true });
    expect(listVersions('d1').length).toBe(2);
  });

  it('MAX_ENTRIES를 넘으면 오래된 것부터 버린다', () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      recordVersion('d1', docWith(`판 ${i}`), { now: T0 + i * (MIN_INTERVAL_MS + 1) });
    }
    const list = listVersions('d1');
    expect(list.length).toBe(MAX_ENTRIES);
    // 남은 것 중 가장 오래된 항목이 잘려 나간 첫 5판 다음이어야 한다
    expect(list[list.length - 1]!.at).toBe(T0 + 5 * (MIN_INTERVAL_MS + 1));
  });

  it('쿼터 초과면 오래된 절반을 버리고 재시도한다', () => {
    for (let i = 0; i < 6; i++) {
      recordVersion('d1', docWith(`판 ${i}`), { now: T0 + i * (MIN_INTERVAL_MS + 1) });
    }
    const original = Storage.prototype.setItem;
    let threw = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (!threw && key.startsWith('mindflow_hist_')) {
        threw = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      original.call(this, key, value);
    });
    recordVersion('d1', docWith('새 판'), { now: T0 + 7 * (MIN_INTERVAL_MS + 1) });
    const list = listVersions('d1');
    expect(threw).toBe(true);
    expect(list.length).toBeLessThan(7);
    expect(list[0]!.at).toBe(T0 + 7 * (MIN_INTERVAL_MS + 1)); // 최신 판은 살아 있다
  });
});

describe('versionBody / versionDoc', () => {
  it('본문은 realPreview가 먹는 직렬화 문자열 그대로, Doc 왕복도 된다', () => {
    const d = docWith('왕복');
    recordVersion('d1', d, { now: T0 });
    const body = versionBody('d1', T0);
    expect(body).toBe(JSON.stringify(serializeDoc(d)));
    const round = versionDoc('d1', T0);
    expect(round?.nodes['root']?.text).toBe('왕복');
  });

  it('없는 시각·손상된 저장소는 null이다', () => {
    expect(versionBody('d1', T0)).toBeNull();
    expect(versionDoc('d1', T0)).toBeNull();
    localStorage.setItem('mindflow_hist_bad', '{corrupt');
    expect(listVersions('bad')).toEqual([]);
    expect(versionDoc('bad', T0)).toBeNull();
  });
});

// 화이트보드 — 주제가 늘 0이라 "주제 0개"로는 판을 구별할 수 없다. 내용의
// 단위인 메모 수를 대신 센다(recordVersion의 board 분기).
describe('recordVersion — 화이트보드', () => {
  it('board 문서는 nodes 칸에 메모(플로트) 수를 싣는다', () => {
    const board = parseDoc({
      v: 1,
      kind: 'board',
      nodes: {},
      floats: [
        { id: 'f1', x: 0, y: 0, w: 180, text: '하나' },
        { id: 'f2', x: 200, y: 0, w: 180, text: '둘' },
      ],
      lines: [],
      zones: [],
      layoutMode: 'right',
      themeKey: 'coral',
    });
    if (!board) throw new Error('테스트 픽스처 파싱 실패');
    recordVersion('b1', board, { now: T0 });
    expect(listVersions('b1')[0]!.nodes).toBe(2);
  });
});
