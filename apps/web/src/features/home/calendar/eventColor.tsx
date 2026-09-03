// 일정 색 지정(요청) — 새 일정 팝업과 상세 팝업이 **같은 필드**를 쓴다.
//
// 두 원천의 색 모델이 다르다:
//  - **Geurio 일정**은 임의의 hex를 그 행(`calendar_events.color`, 0033)에 담는다.
//  - **구글 일정**은 색을 **번호**(`colorId` 1~11)로 든다 — 팔레트가 구글 것이다.
//
// 그래서 칸 하나는 `{ value, hex, name }`이다: 화면에 그릴 색(`hex`)과 **저장할
// 값**(`value` — Geurio는 hex, 구글은 번호)을 갈라 둔다. 팝업은 `value`를 모르는
// 문자열로 들고 다니고, 원천이 그것을 자기 방식으로 저장한다(구글은 `colorId`로).
//
// 이름·화살표 이동은 `SwatchGroup`이 준다(#51의 규칙) — 다만 **구글 팔레트는 이름을
// 이미 들고 있다**(구글 캘린더가 부르는 그 이름). hex에서 유도한 이름('보라')보다
// 그쪽이 정확하므로 그대로 쓴다(칸반 카드 라벨과 같은 판단).

import type { ReactNode } from 'react';
import { SwatchGroup } from '../../../components/Swatch';
import { swatchNames } from '../../../components/colorNames';
import { UI_THEME } from '../../editor/theme';
import { GOOGLE_EVENT_COLORS } from './googleCalendar';

export interface EventColorOption {
  /** 저장할 값 — Geurio는 hex, 구글은 색 번호(`colorId`). */
  value: string;
  /** 화면에 그릴 색. */
  hex: string;
  name: string;
}

/** 구글 이벤트 색의 이름 — 구글 캘린더가 부르는 그 이름(번호 → 이름). */
export const GOOGLE_COLOR_NAMES: Record<string, string> = {
  '1': '라벤더',
  '2': '세이지',
  '3': '포도',
  '4': '플라밍고',
  '5': '바나나',
  '6': '귤',
  '7': '공작',
  '8': '그래파이트',
  '9': '블루베리',
  '10': '바질',
  '11': '토마토',
};

/**
 * 구글의 색 — **팔레트가 정하는 만큼 전부** 보여 준다(요청 ⑥: 구글에서는 색을 더
 * 많이 고를 수 있는데 우리는 열한 개뿐이었다).
 *
 * 목록을 우리가 적어 두지 않는 이유: 고를 수 있는 색은 **구글이 정한다**(값이
 * `colorId`이므로 표에 없는 번호를 우리가 지어내면 그 저장은 거절된다). 그래서
 * `/colors`가 돌려준 번호를 전부 싣고 — 그 응답에 24개가 있으면 24개가 뜬다 —
 * 순서만 우리가 번호순으로 못박는다(응답 순서에는 보장이 없다).
 *
 * 이름은 아는 것만 구글의 낱말로 쓰고, 모르는 번호는 hex에서 계산한다(#51의 규칙 —
 * 글자 없는 동그라미에 접근 이름·툴팁이 없으면 무슨 색인지 알 길이 없다).
 * 팔레트를 못 받았으면 폴백 표(`GOOGLE_EVENT_COLORS`)로 그린다.
 */
export function googleColorOptions(palette?: Record<string, string>): EventColorOption[] {
  const src = palette && Object.keys(palette).length > 0 ? palette : GOOGLE_EVENT_COLORS;
  const ids = Object.keys(src).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const hexes = ids.map((id) => src[id] ?? GOOGLE_EVENT_COLORS[id] ?? '#9aa0a6');
  // 겹치는 이름에 번호를 붙이는 일은 `swatchNames`가 한다 — 아는 이름을 섞어 넣고
  // 나머지를 그 계산으로 메우면 같은 낱말이 둘 생길 수 있으므로 **모르는 것만** 받아
  // 계산하고, 그 결과를 아는 이름이 없는 자리에만 끼운다.
  const computed = swatchNames(hexes);
  return ids.map((id, i) => ({
    value: id,
    hex: hexes[i]!,
    name: GOOGLE_COLOR_NAMES[id] ?? computed[i] ?? '',
  }));
}

/** Geurio 일정의 색 — 앱 팔레트(칸반 분류·가지 색과 같은 아홉 색)를 그대로 쓴다. */
export function geurioColorOptions(): EventColorOption[] {
  return UI_THEME.palette.map((hex) => ({ value: hex, hex, name: '' }));
}

/**
 * 색 고르기 한 줄 — 첫 칸은 **기본**(지정 없음)이다: 대각선으로 "색 없음"을 말하는
 * 이 앱의 관례를 그대로 쓰고, 고르면 원천의 기본색으로 되돌아간다(Geurio는 강조색,
 * 구글은 그 캘린더의 색).
 */
export function EventColorField({
  value,
  options,
  onPick,
  disabled,
  hint,
}: {
  /** 지금 지정된 값(hex 또는 colorId) — 없으면 `null`(기본 칸이 켜진다). */
  value: string | null | undefined;
  options: readonly EventColorOption[];
  onPick: (value: string | null) => void;
  disabled?: boolean;
  /** 라벨 오른쪽의 한 마디 — 왜 못 고치는지(비활성일 때). */
  hint?: ReactNode;
}) {
  // `SwatchGroup`은 **hex를 라디오 값**으로 쓴다(색 칸의 정체가 색이므로) — 팔레트
  // 안에서 hex는 유일하니 되돌려 받은 hex로 저장할 값을 찾는다.
  const hexOf = (v: string | null | undefined): string | null => options.find((o) => o.value === v)?.hex ?? null;
  const valueOf = (hex: string): string | null => options.find((o) => o.hex === hex)?.value ?? null;
  // 이름이 없는 팔레트(Geurio)는 `SwatchGroup`이 hex에서 계산한다.
  const named = options.every((o) => !!o.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>일정 색</span>
        {hint ? (
          <>
            <span style={{ flex: 1, minWidth: 0 }} />
            <span data-color-hint style={{ fontSize: 11, color: 'var(--mf-faint2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</span>
          </>
        ) : null}
      </span>
      <SwatchGroup
        label="일정 색"
        value={hexOf(value)}
        colors={options.map((o) => o.hex)}
        {...(named ? { names: options.map((o) => o.name) } : {})}
        onPick={(hex) => onPick(valueOf(hex))}
        disabled={disabled}
        attrName="data-event-color"
        extraAttrValue="기본"
        grid={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
        extra={{
          ariaLabel: '기본 색',
          onSelect: () => onPick(null),
          style: (on) => swatchStyle('transparent', on, true),
        }}
        style={(hex, on) => swatchStyle(hex, on, false)}
      />
    </div>
  );
}

/** 칸 하나의 시각 — 22px 원, 고른 칸은 강조색 테두리 + 링(속성 패널과 같은 문법). */
function swatchStyle(hex: string, on: boolean, blank: boolean) {
  return {
    width: 24,
    height: 24,
    borderRadius: 999,
    padding: 0,
    background: blank ? 'transparent' : hex,
    ...(blank
      ? {
          backgroundImage:
            'linear-gradient(to top right, transparent calc(50% - 1px), var(--mf-faint2) calc(50% - 1px), var(--mf-faint2) calc(50% + 1px), transparent calc(50% + 1px))',
        }
      : {}),
    border: on ? '2px solid var(--mf-text)' : '1px solid var(--mf-border)',
    boxShadow: on ? '0 0 0 2px var(--mf-accent-mute)' : 'none',
    cursor: 'pointer',
  };
}
