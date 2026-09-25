// 인라인 칩의 **표시 규칙** — 사람 멘션의 색과 머리글자, 날짜 칩의 글자.
//
// 여기 있는 것은 전부 **순수 함수**다(DOM·React 없음). 세 곳이 같은 값을 써야 하기
// 때문이다: 편집 박스에 그리는 `runsToHtml`, 멘션 허브 목록, 프로필 카드. 한 곳에서
// 색을 정하지 않으면 같은 사람이 줄 안에서와 목록에서 다른 색으로 보인다.

import { avatarLabel } from '../home/components/ProfileAvatar';
import { DOW, partsOf } from '../home/calendar/model';

/**
 * 사람 칩의 색 여덟 벌.
 *
 * 테마 변수가 아니라 **고정값**인 이유: 이 색은 면이 아니라 **사람의 표식**이다.
 * 테마를 바꿨다고 김서연이 다른 색이 되면 얼굴을 못 알아본다(형광펜을 테마에서
 * 뺀 것과 같은 판단 — `editor.css`의 `.mf-hl` 주석).
 */
export const MENTION_TONES = ['#e8845c', '#7c9bd8', '#69b08a', '#c58ac0', '#d8a24f', '#8fa3b8', '#b88a6e', '#7fa88f'] as const;

/**
 * 그 사람의 색 — **언제나 같은 값**이 나와야 한다(이메일로 정한다).
 *
 * 이름이 아니라 이메일로 미는 이유: 표시 이름은 프로필에서 바뀌지만 색까지 따라
 * 바뀌면 "어제 파랗던 사람"을 찾지 못한다. 우리 멘션의 정체는 이메일이다.
 */
export function mentionTone(email: string): string {
  const key = (email || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return MENTION_TONES[h % MENTION_TONES.length]!;
}

/**
 * 16px 원 안에 들어갈 **한 글자**.
 *
 * 홈의 아바타(`avatarLabel`)는 한글 이름을 뒤 두 글자로 주는데(`이호율` → `호율`),
 * 칩의 원은 그 절반 크기라 두 글자를 넣으면 겹친다 — 그 값의 **첫 글자만** 쓴다.
 */
export function mentionInitial(label: string): string {
  const name = (label || '').replace(/^@/, '');
  return avatarLabel(name).charAt(0) || 'M';
}

/** 칩에 보일 이름 — 저장된 글자(`@김서연`)에서 `@`를 뗀 것. */
export function mentionName(label: string): string {
  return (label || '').replace(/^@/, '');
}

/**
 * 날짜 칩에 보일 글자 — `8월 27일 목`(스펙 3-1).
 *
 * 허브 목록의 이름표(`오늘`·`이번 주 금요일`)와 **다르다**: 목록은 고르기 전이라
 * 상대 표현이 빠르지만, 본문에 박히는 글자는 **한 달 뒤에 다시 읽어도 같은 날**을
 * 가리켜야 한다. `오늘`이라고 적힌 칩은 내일 거짓말이 된다.
 */
export function dateChipLabel(iso: string): string {
  const p = partsOf(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return `${p.m}월 ${p.d}일 ${DOW[d.getUTCDay()] ?? ''}`;
}
