// 공용 팝오버 껍데기 — Radix Popover(MIT) 위에 **우리 스타일 그대로** 얹는다.
// `Modal`(Dialog)·`Menu`(DropdownMenu)와 같은 판단이다: 시각은 이미 우리 것이고,
// 손으로 짜고 있던 것은 행동이었다.
//
// 팝오버가 메뉴와 다른 점은 **내용이 목록이 아니라는 것**이다 — 프로필 블록,
// 알림 목록, 설명 한 덩어리처럼 "화살표로 훑는 항목들"이 아니다. 그래서 메뉴가
// 아니라 이 프리미티브가 맞다(항목 사이를 ↑/↓로 옮겨 다니지 않고 Tab으로 다닌다).
//
// 팝오버에서 손으로 짜던 것:
//  · 자리 — 트리거 아래에 붙이고 화면 밖으로 나가면 안쪽으로 당기는 계산. 앵커에
//    걸치려고 부모의 `position`을 조정하던 자리도 있었다(공유 모달의 "?" 툴팁).
//  · 바깥 클릭·Escape — 창마다 리스너를 달거나, 홈은 전역 mousedown 한 곳에서
//    `closest('.settings-pop,.settings-btn')`으로 걸러 냈다.
//  · 닫힘 애니메이션을 위해 **닫힌 뒤에도 마운트를 유지**하던 장치(`usePopAnim`).
//    Radix는 `data-state="closed"`에 걸린 CSS 애니메이션이 끝날 때까지 스스로
//    붙잡아 두므로 그 장치가 필요 없다.
//  · `aria-expanded`/`aria-controls`, 닫은 뒤 초점 복귀.

import type { CSSProperties, ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 트리거 — `asChild`로 넘기므로 **초점을 받을 수 있는 요소 하나**여야 한다. */
  trigger: ReactNode;
  /** 패널 스타일(폭·면·라운드·그늘). */
  panel?: CSSProperties;
  panelClass?: string;
  /** 패널에 붙일 표식 — 테스트·프로브가 쓰는 이름을 지킨다. */
  panelAttrs?: Record<string, string>;
  /** 접근 이름 — 내용에 제목이 없는 패널(설명 툴팁 등)이 쓴다. */
  label?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  alignOffset?: number;
  collisionPadding?: number;
  /** 열릴 때 초점을 패널로 옮기지 않는다 — 트리거에 초점을 남겨야 하는 자리(설명
   * 툴팁처럼 "읽기만 하는" 패널)가 쓴다. */
  keepTriggerFocus?: boolean;
  children: ReactNode;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  panel,
  panelClass,
  panelAttrs,
  label,
  align = 'start',
  side = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  collisionPadding = 8,
  keepTriggerFocus,
  children,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          className={panelClass}
          aria-label={label}
          {...panelAttrs}
          align={align}
          side={side}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          onOpenAutoFocus={(e) => {
            if (keepTriggerFocus) e.preventDefault();
          }}
          // ⚠️ 메뉴 트리거로 초점이 돌아오는 것을 닫힘으로 읽지 않는다 — GNB에서
          // 메뉴가 열린 채 팝오버 트리거(스타일)를 누르면, 닫히는 메뉴가 자기
          // 트리거로 초점을 돌려주고(Radix 기본) 방금 열린 팝오버가 그걸 "초점이
          // 바깥으로 나갔다"로 읽어 스스로 닫혔다(`Menu`에서 같은 사고를 잡았다).
          onFocusOutside={(e) => {
            const t = e.detail.originalEvent.target as HTMLElement | null;
            if (t?.closest?.('[data-menu-trigger]')) e.preventDefault();
          }}
          style={panel}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** 트리거 폭에 맞추는 패널 — Radix가 실측해 내려 주는 변수. 예전에는 팝오버를
 * `left: 0; right: 0`으로 부모에 맞췄다(부모가 곧 트리거였을 때만 성립한다). */
export const TRIGGER_WIDTH = 'var(--radix-popover-trigger-width)';
