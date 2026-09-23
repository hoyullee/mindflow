// 태그 판을 **계정에 잇는 자리**(0042).
//
// `noteTags.ts`는 렌더 중에 동기로 답해야 해서(색을 묻는 자리가 블록마다 있다)
// 모듈 단위 캐시로 산다 — React 훅으로 만들 수 없다. 그래서 "지금 로그인한 사람과
// 그 사람의 저장소"를 알려 주는 일만 이 작은 컴포넌트가 맡는다.
//
// 자리는 `App.tsx`의 문지기 안이다(`ReminderHost`와 같은 이유): 태그 고르개는
// 공책 에디터에 있고 태그 메뉴는 홈에도 있어, 화면마다 붙이면 둘이 어긋난다.

import { useEffect } from 'react';
import { useAuthUser } from '../../adapters/useAuthUser';
import { useBackend } from '../../adapters/BackendContext';
import { attachNoteTagStore, detachNoteTagStore } from './noteTags';

export function NoteTagsHost() {
  const backend = useBackend();
  const user = useAuthUser();
  const uid = user?.id ?? null;

  useEffect(() => {
    // 실서버 모드에서 **세션이 잡히기 전에** 붙이지 않는다: 그 상태로 올리면 RLS가
    // (당연히) 막고 콘솔만 시끄러워진다. 로그아웃하면 떼서, 다음 사람이 이 기기에서
    // 로그인했을 때 앞사람의 판을 섞지 않게 한다(섞지 않는 판단 자체는 `noteTags`의
    // `sync`가 `uid`로 한다 — 여기서는 붙이고 떼기만 한다).
    if (backend.mode === 'supabase' && !uid) {
      detachNoteTagStore();
      return;
    }
    void attachNoteTagStore(backend.tagStore, uid);
  }, [backend, uid]);

  return null;
}
