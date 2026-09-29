// 캘린더 색 바꾸기(요청: "이 색상을 변경할 수 있는 방법은 없을까?").
//
// **구글에 쓰지 않는다** — 캘린더 목록의 색을 고치려면 `calendar.calendarlist`
// **쓰기** 스코프가 필요한데 우리가 받은 것은 읽기뿐이고(`calendarlist.readonly`),
// 넓히려면 민감 스코프 검수를 다시 받아야 한다. 그래서 바꾸는 것은 **그리오에서
// 보이는 색**이고, 구글 캘린더 앱의 색은 그대로다 — 판이 그렇게 말한다(아랫줄).
// 값은 워크스페이스 블롭에 남으므로 기기를 옮겨도 따라온다.
//
// 고를 수 있는 색은 **구글의 팔레트**(`/colors`)다. 임의의 hex를 열지 않은 이유:
// 이 색은 구글 캘린더의 색 옆에 나란히 서는 값이라, 같은 팔레트 안에 있어야 두
// 화면이 한 벌로 읽힌다(일정 색 고르개와 같은 판단).

import { useState } from 'react';
import { Popover } from '../../../components/Popover';
import { SwatchGroup } from '../../../components/Swatch';
import { googleColorOptions } from './eventColor';

export function CalendarColorPicker({
  id,
  summary,
  color,
  palette,
  custom,
  onPick,
  dot = 9,
}: {
  id: string;
  summary: string;
  /** 지금 화면에 그려지는 색 — 바꿔 뒀으면 그 값, 아니면 구글이 준 값. */
  color: string | undefined;
  /** 구글이 내려 준 색 팔레트(`/colors`) — 못 받았으면 폴백 표로 그린다. */
  palette: Record<string, string>;
  /** 우리 쪽에서 바꿔 둔 캘린더인가 — 「기본」 칸이 켜질지 이 값이 가른다. */
  custom: boolean;
  onPick: (hex: string | null) => void;
  /** 점의 지름 — 자리마다 다르다(설정 9, 좁은 곳은 더 작게). */
  dot?: number;
}) {
  const [open, setOpen] = useState(false);
  const options = googleColorOptions(palette);
  const shown = color ?? 'var(--mf-accent)';
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`${summary} 색`}
      align="start"
      sideOffset={6}
      panelClass="mf-pop-anim"
      panelAttrs={{ 'data-cal-color-panel': id }}
      panel={{
        width: 238,
        maxWidth: 'calc(100vw - 32px)',
        padding: 12,
        boxSizing: 'border-box',
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        borderRadius: 14,
        boxShadow: '0 28px 60px -28px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.05)',
        zIndex: 60,
      }}
      trigger={
        <button
          type="button"
          data-cal-color={id}
          aria-label={`${summary} 색 바꾸기`}
          title="색 바꾸기"
          // 점은 작아도 **누르는 자리는 크게** — 22px 정사각 안에 점을 가운데 둔다
          // (목록의 ✕ 단추와 같은 치수라 행 높이가 늘지 않는다).
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            padding: 0,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            borderRadius: 999,
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true" style={{ width: dot, height: dot, borderRadius: 999, background: shown, display: 'block' }} />
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</div>
        <SwatchGroup
          label={`${summary} 색`}
          value={custom ? (color ?? null) : null}
          colors={options.map((o) => o.hex)}
          names={options.map((o) => o.name)}
          onPick={(hex) => {
            onPick(hex);
            setOpen(false);
          }}
          attrName="data-cal-color-swatch"
          extraAttrValue="기본"
          grid={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
          extra={{
            ariaLabel: '기본 색 (구글이 정한 색)',
            onSelect: () => {
              onPick(null);
              setOpen(false);
            },
            style: (on) => swatch('transparent', on, true),
          }}
          style={(hex, on) => swatch(hex, on, false)}
        />
        {/* 무엇이 바뀌는지 판이 직접 말한다 — 구글 캘린더를 열어 보고 "안 바뀌었다"가
            되지 않게(우리는 그쪽에 쓸 권한이 없다). */}
        <div data-cal-color-note style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--mf-faint2)' }}>
          그리오에서 보이는 색만 바뀝니다 — Google 캘린더의 색은 그대로예요.
        </div>
      </div>
    </Popover>
  );
}

/** 칸 하나의 시각 — 일정 색 고르개(`EventColorField`)와 같은 문법. */
function swatch(hex: string, on: boolean, blank: boolean) {
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
