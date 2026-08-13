// 스티커 반응·점 투표(화이트보드) — 메모 카드 **아래 바깥**에 붙는 칩 줄.
//
// 카드 밖(top:100%)에 두는 이유는 캡션과 같다: 히트 박스·리사이즈 핸들·겹침
// 계산·측정이 모두 카드 크기 기준이라, 안에 넣으면 반응 하나에 레이아웃이
// 흔들린다. 밖에 얹으면 표가 몇 개든 메모의 기하는 그대로다.
//
// 점 투표(`VOTE_EMOJI`)와 이모지 반응은 **같은 모델**이고 렌더만 다르다 —
// 회고에서 먼저 보는 값이라 언제나 맨 앞(코어 `reactionGroups`가 정렬).

import { useEffect, useRef, useState } from 'react';
import type { ReactionGroup } from '@mindflow/mindmap-core';
import { VOTE_EMOJI } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/** 고를 수 있는 반응 — 점 투표 + 회고에서 자주 쓰는 넷. 많아지면 고르는 일이
 * 일이 된다(슬랙·피그마도 기본 줄은 짧게 두고 전체 목록은 따로 연다). */
export const REACTION_EMOJIS = [VOTE_EMOJI, '👍', '❤️', '😂', '❓'];

interface Props {
  controller: EditorController;
  target: string;
  /** 이 대상이 지금 선택돼 있는가 — 추가(+) 버튼은 그때만 보인다. */
  active: boolean;
}

export function ReactionRow({ controller, target, active }: Props) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  // 폰에서는 칩이 곧 터치 타깃이다 — 22px은 손가락으로 누를 수 없다.
  const H = isMobile ? 30 : 22;
  const groups = controller.reactionsOf(target);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭·Esc로 닫는다(메뉴들과 같은 규칙).
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setPicking(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPicking(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [picking]);

  // 선택이 풀리면 고르는 중이던 것도 닫는다.
  useEffect(() => {
    if (!active) setPicking(false);
  }, [active]);

  if (controller.readOnly) return null; // 보기 전용은 표를 던지지 못한다(누를 수 없는 칩만 남으면 소음)
  if (!groups.length && !active) return null;

  // `.mf-ed-vp`(배경 드래그 소유) 안이라 pointerdown이 새면 배경 마퀴가 포인터를
  // 캡처해 버튼이 click을 영영 못 받는다(도구 막대·컨텍스트 메뉴와 같은 함정).
  const stop = {
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };

  const chip = (g: ReactionGroup) => {
    const vote = g.emoji === VOTE_EMOJI;
    return (
      <button
        key={g.emoji}
        type="button"
        data-reaction={g.emoji}
        data-mine={g.mine ? '1' : undefined}
        aria-label={`${vote ? '투표' : g.emoji} ${g.count}${g.mine ? ' (내 표 포함)' : ''}`}
        aria-pressed={g.mine}
        title={g.names.join(', ')}
        onClick={() => controller.toggleReaction(target, g.emoji)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          height: H,
          padding: isMobile ? '0 10px' : '0 7px',
          borderRadius: 999,
          // 내 표 표시는 **은은하게**(제보: 배경색이 너무 강렬하다) — 칩은 메모 옆의
          // 곁다리 정보지 강조 대상이 아니다. 테두리를 강조색 반투명으로 낮추고
          // 배경은 거의 비치지 않을 만큼만 깔아, 글자(개수)로 읽히게 둔다.
          border: `1px solid ${g.mine ? hexA(th.accent, 0.4) : th.border}`,
          background: g.mine ? hexA(th.accent, 0.06) : th.panel,
          color: vote && g.mine ? th.accent : th.text,
          fontSize: isMobile ? 13 : 11.5,
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: vote ? 9 : 12, color: vote ? (g.mine ? th.accent : th.subtext) : undefined }}>{g.emoji}</span>
        <span>{g.count}</span>
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      data-reaction-row={target}
      {...stop}
      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', zIndex: 7 }}
    >
      {groups.map(chip)}
      {active && (
        <button
          type="button"
          data-reaction-add
          aria-label="반응 추가"
          title="반응 · 투표"
          onClick={() => setPicking((v) => !v)}
          style={{
            width: H,
            height: H,
            borderRadius: 999,
            border: `1px dashed ${th.border}`,
            background: th.panel,
            color: th.subtext,
            fontSize: 12,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          +
        </button>
      )}
      {picking && (
        <div
          role="menu"
          aria-label="반응 고르기"
          style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: th.panel, border: `1px solid ${th.border}`, boxShadow: '0 6px 18px rgba(0,0,0,.14)' }}
        >
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              data-reaction-pick={e}
              aria-label={e === VOTE_EMOJI ? '투표' : e}
              onClick={() => {
                controller.toggleReaction(target, e);
                setPicking(false);
              }}
              style={{
                width: isMobile ? 32 : 24,
                height: isMobile ? 32 : 24,
                border: 'none',
                borderRadius: 999,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: e === VOTE_EMOJI ? 10 : 13,
                lineHeight: 1,
                padding: 0,
                color: e === VOTE_EMOJI ? th.subtext : undefined,
                fontFamily: 'inherit',
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
