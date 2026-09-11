// 설치형 데스크톱 앱(Electron 셸)의 **타이틀 바**. 셸이 OS 프레임을 숨기고
// (`titleBarStyle: 'hidden'`) 이 바를 우리가 그린다 — 브라우저·PWA·옛 설치본에서는
// 아무것도 그리지 않는다(`desktopTitleBarHeight()`가 0).
//
// **창 컨트롤(최소화·최대화·닫기)은 우리가 그리지 않는다.** 네이티브 오버레이
// (Windows)·신호등(macOS)이 그 자리에 그대로 남는다: 그래야 Windows 11의 최대화
// 호버 스냅 레이아웃, 접근성(스크린리더가 아는 창 버튼), 더블클릭 최대화 같은 OS
// 관례가 공짜로 성립하고, 우리는 상태(최대화됐는가)를 셸과 주고받지 않아도 된다.
// 우리 몫은 **면·브랜드·드래그 영역**이다.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BrandMark } from '../components/BrandMark';
import { desktopBridge, desktopTitleBarHeight } from './desktopBridge';

/** 창 컨트롤 색으로 셸에 넘길 CSS 변수 — 면과 그 위 글자색. */
const BAR_BG_VAR = '--mf-card';
const BAR_INK_VAR = '--mf-subtext';

/** macOS 신호등 자리를 비운다(셸의 `trafficLightPosition` x=15 + 버튼 셋 ≈ 67). */
const MAC_INSET = 80;

/**
 * 브랜드를 **창 가운데**에 두는가 — macOS만 그렇다(제보: 신호등 바로 오른쪽에 붙어
 * 있다). 두 OS의 관례가 반대이기 때문이다: macOS는 창 제목을 가운데 두고
 * (왼쪽은 신호등이 쓴다), Windows 11은 왼쪽에 둔다(오른쪽은 네이티브 오버레이가
 * 쓴다). 그래서 자리를 한 값으로 통일하지 않고 플랫폼을 따른다.
 *
 * 가운데는 **남은 폭의 가운데가 아니라 창의 가운데**다(macOS 제목 표시 방식) —
 * 그래서 흐름에서 빼내 절대 배치한다. 신호등과 부딪힐 일은 없다: 창 최소 폭이
 * 940(`MIN_WIDTH`)이라 가운데(470)에 선 브랜드의 왼쪽 끝도 신호등 자리(80)에서
 * 300px 넘게 떨어져 있다.
 */
function brandPlacement(mac: boolean): CSSProperties {
  if (!mac) return {};
  return { position: 'absolute', left: '50%', transform: 'translateX(-50%)' };
}

/** `-webkit-app-region`은 CSSProperties에 없다(Electron 전용). */
const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties;

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function DesktopTitleBar() {
  const height = desktopTitleBarHeight();
  const bridge = desktopBridge();
  const mac = bridge?.platform === 'darwin';
  // 지금 테마의 면·글자색. 홈 테마는 `applyHomeTheme`이 `documentElement`의
  // **인라인 변수**로 심으므로, 그 attribute가 바뀔 때 다시 읽는다.
  const [tone, setTone] = useState<{ bg: string; ink: string } | null>(null);
  const sentRef = useRef<string>('');

  useEffect(() => {
    if (!height) return;
    const root = document.documentElement;
    root.style.setProperty('--mf-titlebar', `${height}px`);
    const read = () => setTone({ bg: readVar(BAR_BG_VAR), ink: readVar(BAR_INK_VAR) });
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
    return () => {
      mo.disconnect();
      root.style.removeProperty('--mf-titlebar');
    };
  }, [height]);

  // 네이티브 컨트롤도 같은 색으로 — 그러지 않으면 다크 테마의 어두운 바에 흰
  // 컨트롤이 홀로 남는다. 같은 값을 두 번 보내지 않는다(테마를 바꿀 때만).
  useEffect(() => {
    if (!tone || !bridge?.setTitleBarTheme) return;
    const key = `${tone.bg}|${tone.ink}`;
    if (key === sentRef.current) return;
    sentRef.current = key;
    void bridge.setTitleBarTheme(tone.bg, tone.ink);
  }, [tone, bridge]);

  if (!height) return null;

  return (
    <div
      data-titlebar
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height,
        // 모달·메뉴보다 위 — 팝업이 열려 있는 동안에도 창을 옮기고 닫을 수 있어야
        // 하고, 막(dim)에 덮여 사라진 것처럼 보이면 고장으로 읽힌다.
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // macOS는 브랜드를 흐름에서 빼 가운데 두므로 이 여백이 자리를 잡지는 않지만,
        // "이 왼쪽 띠는 신호등이 쓴다"는 선언으로 남긴다(나중에 왼쪽에 무언가를
        // 흐름으로 더해도 신호등 아래로 들어가지 않게).
        paddingLeft: mac ? MAC_INSET : 12,
        background: `var(${BAR_BG_VAR})`,
        borderBottom: '1px solid var(--mf-border-soft)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        ...dragRegion,
      }}
    >
      {/* 드래그를 명시한다 — 절대 배치한 자식까지 바와 같은 드래그 영역이어야
          브랜드를 잡고도 창을 옮길 수 있다(`-webkit-app-region`은 Electron 전용이라
          브라우저 프로브로는 확인되지 않는 값이다). */}
      <span
        data-titlebar-brand
        style={{ display: 'flex', alignItems: 'center', gap: 8, ...brandPlacement(mac), ...dragRegion }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: 'var(--mf-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {/* `size`는 박스 크기다 — 앱 아이콘·파비콘과 같은 비율로 그려진다. */}
          <BrandMark size={22} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)' }}>Geurio</span>
      </span>
    </div>
  );
}
