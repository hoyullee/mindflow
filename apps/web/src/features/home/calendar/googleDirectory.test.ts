import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchRooms, filterRooms, searchPeople } from './googleDirectory';

/**
 * 참석자 이름 검색 · 회의실 목록 — 캘린더 API **밖**의 두 API.
 *
 * 여기서 지키는 계약은 "**못 찾는 것과 못 물어보는 것을 가른다**"다. 빈 배열은
 * "정말 없다", `null`은 "그 스코프가 없거나 조직이 막았다"이고, 호출부는 후자에서
 * 그 기능만 접는다(연동 자체는 살아 있다).
 */
function stubFetch(map: Record<string, { status?: number; body?: unknown }>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string) => {
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    const { status = 200, body = {} } = hit[1];
    return { ok: status < 400, status, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', f);
  return f as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => vi.unstubAllGlobals());

describe('참석자 이름 검색', () => {
  it('디렉터리와 주고받은 사람을 합치고, 같은 사람은 하나로', async () => {
    stubFetch({
      'people:searchDirectoryPeople': { body: { people: [{ names: [{ displayName: '여은진' }], emailAddresses: [{ value: 'Eunjin@Example.com' }] }] } },
      'otherContacts:search': {
        body: {
          results: [
            { person: { names: [{ displayName: '여은진(개인)' }], emailAddresses: [{ value: 'eunjin@example.com' }] } },
            { person: { names: [{ displayName: '김철수' }], emailAddresses: [{ value: 'chulsoo@example.com' }] } },
          ],
        },
      },
    });
    const r = await searchPeople('t', '여은', { directory: true, otherContacts: true });
    // 이메일은 소문자로 정규화하고, 디렉터리 쪽 이름을 먼저 잡는다
    expect(r).toEqual([
      { email: 'eunjin@example.com', name: '여은진', emails: ['eunjin@example.com'] },
      { email: 'chulsoo@example.com', name: '김철수', emails: ['chulsoo@example.com'] },
    ]);
  });

  it('별칭 주소로 물어도 그 사람의 **모든 주소**를 돌려준다 — 기본 주소가 앞(라이브 제보)', async () => {
    // 라이브 로그 그대로: `johan.kim@mail.…`로 물었는데 응답은 기본 주소가 첫 번째다.
    stubFetch({
      'people:searchDirectoryPeople': {
        body: {
          people: [
            {
              names: [{ displayName: '김요한 (Johan Kim)' }],
              emailAddresses: [
                { metadata: { primary: true }, value: 'johan.kim@example.com' },
                { value: 'johan.kim@mail.example.com' },
                { value: 'Johan.Kim@newsletter.example.com' },
              ],
            },
          ],
        },
      },
    });
    const r = await searchPeople('t', 'johan.kim@mail.example.com', { directory: true, otherContacts: false });
    expect(r).toEqual([{ email: 'johan.kim@example.com', name: '김요한 (Johan Kim)', emails: ['johan.kim@example.com', 'johan.kim@mail.example.com', 'johan.kim@newsletter.example.com'] }]);
  });

  it('이름이 없으면 이메일을 이름 자리에 쓴다', async () => {
    stubFetch({ 'people:searchDirectoryPeople': { body: { people: [{ emailAddresses: [{ value: 'x@y.com' }] }] } } });
    expect(await searchPeople('t', 'x', { directory: true, otherContacts: false })).toEqual([{ email: 'x@y.com', name: 'x@y.com', emails: ['x@y.com'] }]);
  });

  it('둘 다 못 물어보면 null — 그 기능만 접는다', async () => {
    stubFetch({ 'people.googleapis.com': { status: 403 } });
    expect(await searchPeople('t', 'x', { directory: true, otherContacts: true })).toBeNull();
    // 스코프가 아예 없으면 요청도 하지 않는다
    expect(await searchPeople('t', 'x', { directory: false, otherContacts: false })).toBeNull();
  });

  it('하나만 응답해도 결과다 — 빈 배열은 "정말 없다"', async () => {
    stubFetch({ 'people:searchDirectoryPeople': { status: 403 }, 'otherContacts:search': { body: { results: [] } } });
    expect(await searchPeople('t', 'x', { directory: true, otherContacts: true })).toEqual([]);
  });

  it('빈 질의는 왕복 없이 빈 결과', async () => {
    const f = stubFetch({});
    expect(await searchPeople('t', '   ', { directory: true, otherContacts: true })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('회의실 목록', () => {
  it('회의실만 골라 이름순으로 — 다른 리소스(차량·프로젝터)는 뺀다', async () => {
    stubFetch({
      'resources/calendars': {
        body: {
          items: [
            { resourceEmail: 'b@r.com', generatedResourceName: '회의실-35-02', resourceCategory: 'CONFERENCE_ROOM', capacity: 8 },
            { resourceEmail: 'car@r.com', generatedResourceName: '법인 차량', resourceCategory: 'OTHER' },
            { resourceEmail: 'a@r.com', generatedResourceName: '회의실-35-01', resourceCategory: 'CONFERENCE_ROOM', capacity: 23, buildingId: '판교' },
          ],
        },
      },
    });
    expect(await fetchRooms('t')).toEqual([
      { email: 'a@r.com', name: '회의실-35-01', where: '판교', capacity: 23 },
      { email: 'b@r.com', name: '회의실-35-02', capacity: 8 },
    ]);
  });

  it('403이면 null — 관리자 동의가 필요한 조직이다(구획을 그리지 않는다)', async () => {
    stubFetch({ 'resources/calendars': { status: 403 } });
    expect(await fetchRooms('t')).toBeNull();
  });

  it('검색은 화면에서 좁힌다 — 이름과 위치를 함께 본다(왕복 0)', () => {
    const rooms = [
      { email: 'a@r.com', name: '회의실-35-01', where: '판교' },
      { email: 'b@r.com', name: '대회의실', where: '서울' },
    ];
    expect(filterRooms(rooms, '35').map((r) => r.email)).toEqual(['a@r.com']);
    expect(filterRooms(rooms, '서울').map((r) => r.email)).toEqual(['b@r.com']);
    expect(filterRooms(rooms, '').length).toBe(2);
  });
});
