// 이 요소가 **화면에 (거의) 닿았는가**를 한 번만 알려 준다.
//
// 쓰는 곳: 홈 카드·대시보드 위젯이 자기 문서의 첨부 이미지 URL을 **볼 때** 발급받게
// 하는 것. 예전엔 스페이스 안의 모든 카드가 한꺼번에 발급받았고, 실측해 보니
// `content-visibility: auto`도 이걸 막지 못한다 — 화면 밖 카드의 이미지까지 전부
// 내려받았다(1000×620 화면에서 카드 12장 중 6장만 보이는데 12장 모두 요청). 무료
// 플랜에서 먼저 닿는 한도가 저장 용량이 아니라 **전송량**이라, 스크롤해서 실제로 본
// 카드만 값을 치르게 한다.
//
// URL이 없으면 미리보기는 예전처럼 자리표시자를 그린다 — 표시 크기는 문서에 있어서
// 늦게 온 이미지가 레이아웃을 밀지 않는다(그래서 이 지연이 안전하다).

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 화면에 들어오기 조금 전부터 준비한다 — 스크롤이 멈추기 전에 사진이 도착하도록. */
const ROOT_MARGIN = '300px';

export function useVisibleOnce(el: RefObject<HTMLElement | null>, onSeen: () => void): void {
  // 콜백은 렌더마다 새 함수라 deps에 넣으면 관측을 매번 다시 건다.
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // 관측을 지원하지 않는 환경(테스트 등)에서는 **미루지 않는다** — 기능이 조용히
    // 꺼지는 것보다 예전처럼 곧바로 받는 편이 낫다.
    if (typeof IntersectionObserver === 'undefined') {
      cb.current();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        cb.current();
      },
      { rootMargin: ROOT_MARGIN },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
}
