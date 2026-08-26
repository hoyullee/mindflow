// 색 고르기 묶음 — 이름과 화살표 이동을 **여기 한 곳**에서 준다.
//
// 예전엔 색 칸이 자리마다 손으로 짠 `<button aria-pressed>`였다. 시각은 맞지만 둘이
// 없었다: ① 접근 **이름**(글자 없는 동그라미라 스크린리더가 "버튼"이라고만 읽었다)
// ② **화살표 이동**(Tab이 칸마다 멈췄고, `aria-pressed`는 "눌린 버튼"이지 "고른
// 값"이 아니다). 세그먼트 컨트롤에서 이미 쓰는 `RadioCards`(Radix RadioGroup)가
// 로빙 tabindex와 ←/→/↑/↓를 주므로 그 위에 얹는다.
//
// 이름은 호출부가 적지 않는다 — `swatchNames`가 hex에서 계산하고 같은 묶음에서
// 겹치면 번호를 붙인다. 그래서 새 팔레트를 넣거나 테마를 늘려도 이름이 따라오고,
// "이 자리 이름 붙이는 걸 잊었다"가 생길 수 없다.
//
// **시각은 호출부가 계속 들고 있다**(`style(hex, on)`) — 자리마다 크기·테두리·활성
// 표시가 달라서, 그걸 여기로 끌어오면 디자인이 한 벌로 뭉개진다.

import type { CSSProperties, ReactNode } from 'react';
import { RadioCards } from './Segmented';
import { swatchNames } from './colorNames';

/** '자동(테마 기본)'처럼 색이 아닌 칸의 값 — hex와 섞이지 않는 문자열. */
export const SWATCH_AUTO = 'auto';

export interface SwatchExtra {
  /** 접근 이름 — 색이 아니므로 직접 적는다(예: '자동 (테마 기본)'). */
  ariaLabel: string;
  style: (on: boolean) => CSSProperties;
  children?: ReactNode;
  onSelect: () => void;
}

export function SwatchGroup({
  label,
  value,
  colors,
  names,
  onPick,
  style,
  children,
  grid,
  gridClass,
  disabled,
  extra,
  suffix,
  attrName,
  extraAttrValue = 'auto',
}: {
  /** 묶음의 접근 이름 — 무엇의 색인지 말한다(예: '가지 색'). */
  label: string;
  /** 지금 고른 색(hex). 없으면 `null` — `extra`가 있으면 그 칸이 켜진다. */
  value: string | null | undefined;
  colors: readonly string[];
  /** 이름을 **이미 들고 있는** 팔레트는 그걸 쓴다(칸반 카드 라벨의 '빨강'처럼
   *  손으로 고른 톤 이름이 유도한 이름보다 정확할 때). 없으면 hex에서 계산. */
  names?: readonly string[];
  onPick: (hex: string) => void;
  style: (hex: string, on: boolean) => CSSProperties;
  /** 칸 안에 그릴 것 — 고른 칸의 체크 표시처럼. */
  children?: (hex: string, on: boolean) => ReactNode;
  grid?: CSSProperties;
  gridClass?: string;
  /** 보기 전용 화면 — 묶음째 끈다. */
  disabled?: boolean;
  /** 색 칸 앞에 끼우는 특별 칸(자동/없음). 화살표 이동에도 함께 걸린다. */
  extra?: SwatchExtra;
  /** 칸마다 붙는 `data-*` 표식의 이름 — 값은 hex(특별 칸은 `extraAttrValue`).
   *  테스트·실브라우저 프로브가 칸을 집는 손잡이다. */
  attrName?: string;
  extraAttrValue?: string;
  /** 이름 뒤에 붙는 말 — 같은 화면에 색 묶음이 여럿일 때 구별용은 `label`이 맡고,
   *  이건 칸 하나하나의 뜻이 색 이름만으로 부족할 때 쓴다(예: '분류'). */
  suffix?: string;
}) {
  const derived = names ?? swatchNames(colors);
  const selected = value && colors.includes(value) ? value : extra ? SWATCH_AUTO : '';
  return (
    <RadioCards
      label={label}
      value={selected}
      onChange={(v) => {
        if (v === SWATCH_AUTO) extra?.onSelect();
        else onPick(v);
      }}
      grid={grid}
      gridClass={gridClass}
      disabled={disabled}
      items={[
        ...(extra
          ? [
              {
                value: SWATCH_AUTO,
                label: extra.ariaLabel,
                ariaLabel: extra.ariaLabel,
                title: extra.ariaLabel,
                style: extra.style,
                children: extra.children ?? null,
                ...(attrName ? { attrs: { [attrName]: extraAttrValue } } : {}),
              },
            ]
          : []),
        ...colors.map((hex, i) => ({
          value: hex,
          label: derived[i]!,
          ariaLabel: suffix ? `${derived[i]!} ${suffix}` : derived[i]!,
          // 마우스로 쓰는 사람도 이름이 필요하다 — 글자 없는 동그라미라 색을
          // 눈으로 봐도 "이게 무슨 색이라 불리는지"는 알 수 없다.
          title: derived[i]!,
          style: (on: boolean) => style(hex, on),
          children: children ? ((on: boolean) => children(hex, on))(hex === selected) : (null as ReactNode),
          ...(attrName ? { attrs: { [attrName]: hex } } : {}),
        })),
      ]}
    />
  );
}
