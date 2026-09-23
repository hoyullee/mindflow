// 로컬/데모 모드의 `TagStore` — 서버가 없으니 이 브라우저에 판을 적는다.
//
// 키(`mf_note_tags`)는 **`features/editor/noteTags.ts`의 기기 캐시와 같은 것**이다:
// 데모 모드에서 판이 사는 곳은 어차피 그 한 곳이고, 키를 갈라 두면 같은 내용을 두
// 벌로 들고 다니다 어긋난다. 같은 모양(`{ made, colors, hidden }`)을 쓰므로 캐시가
// 쓴 값을 이쪽이 읽고, 이쪽이 쓴 값을 캐시가 읽는다(같은 값을 두 번 쓸 뿐이다).

import type { NoteTagBoard, TagStore } from '../ports';

const KEY = 'mf_note_tags';

function coerce(raw: string | null): NoteTagBoard | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<NoteTagBoard>;
    return {
      made: Array.isArray(v.made) ? v.made.filter((t): t is string => typeof t === 'string') : [],
      colors: v.colors && typeof v.colors === 'object' ? (v.colors as Record<string, string>) : {},
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((t): t is string => typeof t === 'string') : [],
    };
  } catch {
    return null; // 깨진 값 — 없는 것으로 본다(지우지는 않는다)
  }
}

export class LocalTagStore implements TagStore {
  async load(): Promise<NoteTagBoard | null> {
    try {
      return coerce(localStorage.getItem(KEY));
    } catch {
      return null; // 저장소를 막아 둔 환경
    }
  }

  async save(board: NoteTagBoard): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify({ made: board.made, colors: board.colors, hidden: board.hidden }));
    } catch {
      /* 쿼터 초과·비공개 모드 — 이 세션 동안만 화면에 남는다 */
    }
  }
}
