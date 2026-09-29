// LNB 부제의 **넘칠 때만 흐르는 한 줄**(스펙: 홈·LNB 변경 2.2).
//
// 알림 부제는 `멘션 · 제가 바꿀게요 · 2시간 전`처럼 한 줄에 세 조각이 들어가 250px
// 열에서 자주 잘린다. 말줄임(…)이면 정작 **무슨 말이었는지**가 잘려 나가므로, 넘칠 때만
// 같은 문구를 두 벌 이어 붙여 왼쪽으로 흘린다 — 두 번째 벌이 첫 자리에 오는 순간이 곧
// 처음 모습이라 끊김 없이 되풀이된다.
//
// **넘치지 않으면 아무것도 하지 않는다**: 두 번째 벌도, 애니메이션도, 가장자리 흐림도
// 없다(스펙). 넘치는지는 재서 안다 — 글자 폭은 글꼴·문구·열 폭에 따라 달라서 글자 수로
// 어림하면 곧 틀린다. 못 재는 환경(jsdom)에서는 폭이 0이라 늘 "넘치지 않음"이고, 그게
// 테스트에서 가장 덜 놀라운 모습이다.
//
// 움직임을 줄이라고 한 사용자에게는 `home.css`가 흐름을 끈다(가장자리 흐림은 남아
// 잘린 자리를 부드럽게 알린다).

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** 한 벌 뒤의 틈 — 두 벌이 이어질 때 앞 문장의 끝과 뒷 문장의 머리가 붙지 않게(스펙 28px). */
const GAP = 28;
/** 오른쪽 가장자리를 흐리는 폭(스펙 14px). */
const FADE = 14;

export function MarqueeText({ text, style }: { text: string; style?: CSSProperties }): React.JSX.Element {
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const t = textRef.current;
    if (!box || !t) return;
    // 글자 폭은 **그려진 사각형**으로 잰다 — `scrollWidth`는 인라인 요소에서 늘 0이라
    // (CSSOM: 인라인 상자에는 스크롤 영역이 없다) 실브라우저에서는 영영 "안 넘침"이었다
    // (실측: jsdom에서 그 값을 심은 테스트는 통과했다 — `docs/probe-pitfalls.md` F39).
    // 1px 여유 — 소수점 폭의 반올림으로 "딱 맞는" 문구가 넘친다고 읽히지 않게.
    const check = (): void => setOverflow(t.getBoundingClientRect().width > box.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    // 글꼴이 늦게 도착하면 글자 폭이 바뀐다 — 열과 글자 둘 다 지켜본다.
    const ro = new ResizeObserver(check);
    ro.observe(box);
    ro.observe(t);
    return () => ro.disconnect();
  }, [text]);

  const mask = `linear-gradient(90deg, #000 0, #000 calc(100% - ${FADE}px), transparent)`;
  return (
    <span
      ref={boxRef}
      data-marquee-text={overflow ? 'run' : 'still'}
      style={{
        display: 'block',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        ...(overflow ? { maskImage: mask, WebkitMaskImage: mask } : {}),
        ...style,
      }}
    >
      <span className={overflow ? 'mf-marquee-track' : undefined} style={{ display: 'inline-flex' }}>
        <span style={{ paddingRight: overflow ? GAP : 0, flexShrink: 0 }}>
          {/* `inline-block` — 인라인 상자는 `ResizeObserver`가 지켜보지 못한다(늘 0으로 보고한다).
              글꼴이 늦게 와서 글자 폭만 바뀌어도 다시 재야 한다. */}
          <span ref={textRef} style={{ display: 'inline-block' }}>
            {text}
          </span>
        </span>
        {overflow && (
          <span aria-hidden="true" style={{ paddingRight: GAP, flexShrink: 0 }}>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
