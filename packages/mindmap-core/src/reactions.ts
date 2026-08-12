// 스티커 반응·점 투표의 순수 집계 — 렌더/입력은 웹의 몫이고, 여기는 "이 대상에
// 어떤 반응이 몇 개 있고 내가 눌렀는가"만 안다.

import type { Reaction } from './model';
import { VOTE_EMOJI } from './model';

/** 한 대상에 모인 같은 이모지의 묶음. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  /** 내가 눌렀는가(토글 표시). */
  mine: boolean;
  /** 누른 사람 이름들(툴팁) — 스냅샷 이름이 없으면 식별자. */
  names: string[];
}

/**
 * 대상별 집계. 순서는 **첫 등장 순**이라 화면에서 칩이 튀지 않는다(개수로 정렬하면
 * 한 표에 자리가 바뀐다). 투표 점은 언제나 맨 앞 — 회고에서 먼저 보는 값이다.
 */
export function reactionGroups(reactions: Reaction[] | undefined, target: string, me: string): ReactionGroup[] {
  const out: ReactionGroup[] = [];
  const index = new Map<string, ReactionGroup>();
  for (const r of reactions ?? []) {
    if (r.target !== target) continue;
    let g = index.get(r.emoji);
    if (!g) {
      g = { emoji: r.emoji, count: 0, mine: false, names: [] };
      index.set(r.emoji, g);
      out.push(g);
    }
    g.count += 1;
    if (r.by === me) g.mine = true;
    g.names.push(r.byName || r.by);
  }
  out.sort((a, b) => (a.emoji === VOTE_EMOJI ? -1 : 0) - (b.emoji === VOTE_EMOJI ? -1 : 0));
  return out;
}

/** 이 사람이 이 대상에 이 이모지를 이미 눌렀는가 — 토글의 판단 근거. */
export function findReaction(reactions: Reaction[] | undefined, target: string, emoji: string, me: string): Reaction | null {
  return (reactions ?? []).find((r) => r.target === target && r.emoji === emoji && r.by === me) ?? null;
}

/**
 * 토글 결과 목록(순수) — 이미 눌렀으면 그 항목을 빼고, 아니면 하나 더한다.
 *
 * 항목 하나가 한 표라서 두 사람이 동시에 눌러도 CRDT가 둘 다 살린다(#332의 교훈:
 * 배열·객체 **필드**는 통째로 LWW라 한쪽 표가 사라진다).
 */
export function toggleReaction(reactions: Reaction[] | undefined, next: Reaction): Reaction[] {
  const list = reactions ?? [];
  const hit = findReaction(list, next.target, next.emoji, next.by);
  if (hit) return list.filter((r) => r.id !== hit.id);
  return [...list, next];
}

/** 사라진 대상(지워진 메모·주제)에 달린 반응을 걷어낸다 — 삭제 시 함께 정리한다. */
export function pruneReactions(reactions: Reaction[] | undefined, aliveTargets: Set<string>): Reaction[] {
  return (reactions ?? []).filter((r) => aliveTargets.has(r.target));
}
