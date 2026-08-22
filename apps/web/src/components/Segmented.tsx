// 세그먼트 컨트롤 — Radix ToggleGroup(MIT) 위에 **우리 스타일 그대로**.
//
// "여럿 중 하나를 고른다"를 우리는 `<button aria-pressed>` 여러 개로 그려 왔다.
// 시각은 맞지만 **키보드가 없었다**: 묶음 안에서 ←/→로 옮겨 다닐 수 없고(Tab이
// 칸마다 멈춘다), `aria-pressed`는 "눌린 버튼"이지 "고른 값"이 아니다.
//
// Radix ToggleGroup(single)이 그 둘을 준다 — 로빙 tabindex(묶음 전체가 Tab 한
// 번, 안에서는 화살표)와 `data-state="on"`. 시각은 우리가 계속 들고 있으므로
// 색·높이·그늘은 호출부가 그대로 넘긴다.

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as RadioGroup from '@radix-ui/react-radio-group';


/** 화살표로 옮긴 초점을 **선택까지** 따라가게 한다.
 *
 * ⚠️ Radix가 스스로 하지 못한다: RadioGroup은 "직전에 화살표를 눌렀는가"를
 * `document` keydown 리스너로 기억한 뒤 새로 초점을 받은 항목을 클릭하는데,
 * React 18은 이벤트를 **루트 컨테이너**에 위임하므로 로빙 포커스가 초점을 옮기는
 * 처리가 그 document 리스너보다 **먼저** 돈다 — 플래그가 늦게 서서 클릭이 일어나지
 * 않는다(실브라우저 실측: 화살표는 초점만 옮기고 Space를 눌러야 선택됐다).
 * 우리가 `role="radio"`로 알리는 이상 화살표로 값이 바뀌어야 하므로 직접 처리한다.
 */
function useArrowSelect<T extends string>(order: T[], value: T, onChange: (v: T) => void) {
  return (e: KeyboardEvent<HTMLElement>): void => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || !order.length) return;
    // 초점이 이미 다른 칸에 있으면 그 칸을 기준으로 — 초점과 값이 어긋나 있어도
    // (Tab으로 들어왔다 나간 경우) 사용자가 보는 자리에서 한 칸 움직인다.
    const focused = (e.target as HTMLElement)?.getAttribute?.('data-seg-value') as T | null;
    const from = order.indexOf(focused && order.includes(focused) ? focused : value);
    if (from < 0) return;
    onChange(order[(from + dir + order.length) % order.length]!);
  };
}

export interface SegmentedItem<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  /** 칸 스타일 — `on`(고른 칸인가)에 따라 달라진다. */
  style: (on: boolean) => CSSProperties;
  attrs?: Record<string, string>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  track,
  trackAttrs,
  itemClass,
}: {
  value: T;
  onChange: (v: T) => void;
  items: SegmentedItem<T>[];
  /** 묶음의 접근 이름 — 무엇을 고르는 묶음인지 말한다. */
  label: string;
  /** 트랙(묶음 상자) 스타일. */
  track?: CSSProperties;
  trackAttrs?: Record<string, string>;
  itemClass?: string;
}) {
  const arrowSelect = useArrowSelect(
    items.map((i) => i.value),
    value,
    onChange,
  );
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // ⚠️ 빈 문자열은 무시한다 — ToggleGroup은 고른 칸을 **다시 누르면** 해제로
      // 읽는데(`''`), 세그먼트는 언제나 하나가 고른 상태여야 한다.
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      aria-label={label}
      onKeyDown={arrowSelect}
      {...trackAttrs}
      style={track}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <ToggleGroup.Item key={it.value} value={it.value} title={it.title} className={itemClass} data-seg-value={it.value} {...it.attrs} style={it.style(on)}>
            {it.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}

// ── 라디오 카드 ──────────────────────────────────────────────────────────────
// "여럿 중 하나"를 **카드 격자**로 고르는 자리(설정의 색상 테마). 손으로 짠 것은
// `role="radiogroup"`/`aria-checked`까지였고 **화살표 이동이 없었다** — Tab이 칸
// 여섯 개마다 멈췄다. Radix RadioGroup이 로빙 tabindex와 ←/→/↑/↓를 준다.

export interface RadioCardItem<T extends string> {
  value: T;
  label: string;
  /** 접근 이름 — 보이는 글자와 다르게 읽어야 할 때(예: "코랄 테마"). */
  ariaLabel?: string;
  style: (on: boolean) => CSSProperties;
  children: ReactNode;
}

export function RadioCards<T extends string>({
  value,
  onChange,
  items,
  label,
  grid,
}: {
  value: T;
  onChange: (v: T) => void;
  items: RadioCardItem<T>[];
  label: string;
  grid?: CSSProperties;
}) {
  const arrowSelect = useArrowSelect(
    items.map((i) => i.value),
    value,
    onChange,
  );
  return (
    <RadioGroup.Root value={value} onValueChange={(v) => onChange(v as T)} aria-label={label} onKeyDown={arrowSelect} style={grid}>
      {items.map((it) => (
        <RadioGroup.Item key={it.value} value={it.value} aria-label={it.ariaLabel ?? it.label} data-seg-value={it.value} style={it.style(it.value === value)}>
          {it.children}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
