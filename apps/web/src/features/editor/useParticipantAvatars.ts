// 참가자 아바타 찾기 — "이 문서에 있는 사람들의 지금 프로필 이미지".
//
// 한 문서 안에서 아바타가 필요한 자리가 셋이다: 칸반 카드의 **담당**(이메일로 적혀
// 있다), 카드 상세의 담당 고르기, 그리고 **댓글 작성자**(0020의 uuid). 셋이 각각
// 조회하면 같은 목록을 세 번 받으므로 훅 하나로 모아 **문서당 한 번** 받는다.
//
// 출처는 `share_participants`(0011→0018→0031) — 프로필 조인이라 사진을 바꾸면
// 옛 댓글의 아바타도 함께 바뀐다(이름은 스냅샷이라 그대로: 0020의 절충).

import { useEffect, useState } from 'react';
import { useShareStore } from '../../adapters/BackendContext';
import type { ShareParticipant } from '../../adapters/ports';

export interface ParticipantAvatars {
  /** 이메일(소문자) → 사진 주소. */
  byEmail: Record<string, string>;
  /** 계정 id → 사진 주소. */
  byUserId: Record<string, string>;
}

const EMPTY: ParticipantAvatars = { byEmail: {}, byUserId: {} };

export function participantAvatars(rows: ShareParticipant[]): ParticipantAvatars {
  const byEmail: Record<string, string> = {};
  const byUserId: Record<string, string> = {};
  for (const r of rows) {
    const url = r.avatarUrl?.trim();
    if (!url) continue;
    if (r.email) byEmail[r.email.toLowerCase()] = url;
    if (r.userId) byUserId[r.userId] = url;
  }
  return { byEmail, byUserId };
}

/** 문서 참가자의 아바타 표. 못 읽으면 빈 표(화면은 이름 첫 글자로 그린다). */
export function useParticipantAvatars(docId: string, enabled = true): ParticipantAvatars {
  const shareStore = useShareStore();
  const [map, setMap] = useState<ParticipantAvatars>(EMPTY);
  useEffect(() => {
    if (!enabled || !docId) {
      setMap(EMPTY);
      return;
    }
    let alive = true;
    void shareStore.listParticipants(docId).then((rows) => {
      if (alive) setMap(rows ? participantAvatars(rows) : EMPTY);
    });
    return () => {
      alive = false;
    };
  }, [shareStore, docId, enabled]);
  return map;
}
