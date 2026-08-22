// 공용 메뉴 껍데기 — Radix DropdownMenu(MIT) 위에 **우리 스타일 그대로** 얹는다.
// `Modal`(Radix Dialog)과 같은 판단이다: 시각은 이미 우리 것이고, 손으로 짜고 있던
// 것은 행동이었다.
//
// 메뉴에서 손으로 짜던 것:
//  · 위치 — 트리거 아래에 붙이고 화면 밖으로 나가면 안쪽으로 당기는 계산(clamp)과
//    resize·scroll 리스너. 파일마다 조금씩 달라 같은 버그를 여러 번 고쳤다.
//  · 바깥 클릭으로 닫기 — 창마다 `window` mousedown 리스너를 달고, 메뉴 안 클릭이
//    거기에 닿지 않게 `stopPropagation`을 뿌렸다(그 전파 차단이 배경 드래그·마퀴와
//    부딪혀 또 다른 버그를 만들었다 — ContextMenu 머리말의 기록).
//  · 키보드 — **없었다**. 열린 메뉴에서 ↑/↓·Home/End·글자 타이핑(typeahead)이
//    통하지 않고 Tab만 됐다. Escape도 창마다 있는 곳과 없는 곳이 갈렸다.
//
// Radix가 그 셋을 준다(위치는 Floating UI 기반 충돌 회피). 스타일 없는 프리미티브만
// 쓰므로 남의 브랜드·폰트·아이콘이 들어오지 않는다.

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

/** 메뉴 카드(패널)의 기본 모양 — 예전 `MenuShell`의 값 그대로. */
export function menuPanelStyle(theme: { panel: string; border: string }, minWidth = 200): CSSProperties {
  return {
    minWidth,
    boxSizing: 'border-box',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,.16)',
    padding: 5,
    // 가로로 돌린 폰(높이 350~430px)에서는 항목이 많은 메뉴가 화면을 넘는다 —
    // 넘치는 만큼만 스크롤한다(세로 화면에서는 걸리지 않는다).
    maxHeight: 'calc(100dvh - 64px)',
    overflowY: 'auto',
  };
}

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 트리거 — `asChild`로 넘기므로 버튼 하나여야 한다(우리 버튼 스타일 그대로). */
  trigger: ReactNode;
  /** 패널 스타일(폭·면·그늘). `menuPanelStyle`로 만들어 넘긴다. */
  panel: CSSProperties;
  /** 트리거의 어느 변에 맞출지 — 예전 `align='left'|'right'`와 같은 뜻. */
  align?: 'start' | 'end';
  /** 트리거와의 간격(예전 8px). */
  sideOffset?: number;
  /** 화면 가장자리와의 여유(예전 clamp의 8px). */
  collisionPadding?: number;
  children: ReactNode;
  /** 패널에 붙일 표식 — 테스트·프로브가 쓰는 이름을 지킨다. */
  panelAttrs?: Record<string, string>;
}

/** 트리거 + 드롭다운 한 벌. 상태는 호출부가 들고 있다(툴바가 "어느 메뉴가 열렸나"를
 * 한 칸으로 관리하므로 controlled). */
export function Menu({ open, onOpenChange, trigger, panel, align = 'start', sideOffset = 8, collisionPadding = 8, panelAttrs, children }: MenuProps) {
  // Radix 트리거는 **누를 때**(pointerdown) 여닫는다 — 네이티브 메뉴와 같은 관례다.
  // 그런데 `click`만 오는 경로가 있다: 보조기술이 합성한 활성화, 그리고 코드가
  // 직접 부르는 `.click()`(테스트·스크립트). 그때도 열리도록 click 폴백을 두고,
  // 진짜 마우스에서 두 번 토글되지 않게 **직전 pointerdown을 기억해** 건너뛴다.
  const lastPointerToggle = useRef(0);
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger
        asChild
        onPointerDown={(e) => {
          if (e.button === 0 && !e.ctrlKey) lastPointerToggle.current = Date.now();
        }}
        onClick={() => {
          if (Date.now() - lastPointerToggle.current > 250) onOpenChange(!open);
        }}
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // 예전 표식을 유지한다 — 테스트·프로브가 이 이름으로 메뉴를 찾는다.
          data-anchored-menu
          {...panelAttrs}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          style={{ zIndex: 200, ...panel }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 메뉴 한 줄 — `DropdownMenu.Item`이라 ↑/↓·타이핑·Enter가 통하고, 고르면 메뉴가
 * 스스로 닫힌다. 시각(높이·아이콘 칸·활성 체크·힌트)은 예전 `MenuItem` 그대로. */
export function MenuRow({
  theme: th,
  icon,
  label,
  hint,
  active,
  disabled,
  isMobile,
  onSelect,
  rowAttrs,
}: {
  theme: { panel2: string; subtext: string; text: string; accent: string };
  icon?: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  isMobile?: boolean;
  onSelect: () => void;
  rowAttrs?: Record<string, string>;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={disabled ? undefined : 'mf-ed-btn'}
      {...rowAttrs}
      style={menuRowStyle(th, { active, disabled, isMobile })}
    >
      {icon != null && <span style={{ display: 'flex', width: 18, justifyContent: 'center', color: disabled ? `${th.subtext}73` : active ? th.accent : th.subtext }}>{icon}</span>}
      <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {active && (
        <span style={{ display: 'flex', color: th.accent }} aria-hidden="true">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
      {hint && !active && <span style={{ fontSize: 11, color: `${th.subtext}b0`, whiteSpace: 'nowrap' }}>{hint}</span>}
    </DropdownMenu.Item>
  );
}

/** 행 스타일 — 예전 `MenuItem`의 값 그대로(초점 표시만 더한다: 키보드로 옮겨 다니면
 * "지금 어디"가 보여야 하는데, 예전에는 키보드 이동 자체가 없어 필요가 없었다). */
export function menuRowStyle(
  th: { panel2: string; subtext: string; text: string },
  { active, disabled, isMobile }: { active?: boolean; disabled?: boolean; isMobile?: boolean } = {},
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    height: isMobile ? 44 : 38,
    padding: '0 10px',
    border: 'none',
    borderRadius: 8,
    background: active ? th.panel2 : 'transparent',
    color: disabled ? `${th.subtext}73` : th.text,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'left',
    boxSizing: 'border-box',
    outline: 'none',
  };
}

/** 기존 마크업(버튼)을 그대로 두고 메뉴 항목으로 만들어 주는 어댑터.
 *
 * Radix는 Enter·Space를 받으면 그 요소에 **click을 쏘므로**(`event.currentTarget
 * .click()`) 자식 버튼의 `onClick`을 그대로 두면 마우스와 키보드가 같은 길을 탄다 —
 * 화면마다 다른 행 스타일(내보내기 메뉴처럼)을 건드리지 않고 키보드만 얻는다. */
export function MenuItemWrap({ disabled, children }: { disabled?: boolean; children: ReactElement }) {
  return (
    <DropdownMenu.Item disabled={disabled} asChild>
      {children}
    </DropdownMenu.Item>
  );
}

/** 구분선·구획 라벨 — 키보드 이동에서 건너뛰어야 하므로 Radix 것으로 감싼다. */
export function MenuSeparator({ children }: { children: ReactElement }) {
  return <DropdownMenu.Separator asChild>{children}</DropdownMenu.Separator>;
}

export function MenuLabel({ children }: { children: ReactElement }) {
  return <DropdownMenu.Label asChild>{children}</DropdownMenu.Label>;
}
