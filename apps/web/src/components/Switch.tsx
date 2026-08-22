// 켜고 끄는 스위치 — Radix Switch(MIT) 위에 우리 스타일.
//
// 왜 체크박스가 아닌가: "링크가 있는 사람은 열람"은 목록에서 항목을 고르는
// 체크박스가 아니라 **기능을 켜고 끄는 것**이다. `role="switch"`는 보조기술에
// "켜짐/꺼짐"으로 읽히고(체크박스는 "선택됨"), 트랙+손잡이 모양이 그 뜻을
// 눈으로도 말한다. 필터 옵션·카드 필드처럼 진짜 체크박스인 자리는 그대로 둔다.

import * as RadixSwitch from '@radix-ui/react-switch';

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  accent,
  track,
  knob,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
  label: string;
  /** 켜졌을 때 트랙 색(테마 강조색). */
  accent: string;
  /** 꺼졌을 때 트랙 색. */
  track: string;
  /** 손잡이 색(면). */
  knob: string;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      style={{
        flexShrink: 0,
        width: 34,
        height: 20,
        borderRadius: 999,
        border: 'none',
        padding: 2,
        background: checked ? accent : track,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background .16s ease',
        boxSizing: 'border-box',
      }}
    >
      <RadixSwitch.Thumb
        style={{
          display: 'block',
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: knob,
          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
          transform: checked ? 'translateX(14px)' : 'translateX(0)',
          transition: 'transform .16s ease',
        }}
      />
    </RadixSwitch.Root>
  );
}
