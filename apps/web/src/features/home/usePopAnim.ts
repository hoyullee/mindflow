import { useEffect, useRef, useState } from 'react';

/** 닫히는 애니메이션을 위한 최소 장치 — 팝업이 `open`이 false가 된 뒤에도 잠깐
 * **마운트를 유지**한다(그러지 않으면 사라질 것이 없어 나가는 애니메이션을 그릴 수
 * 없다). 열려 있는 동안 `'is-in'`, 닫히는 동안 `'is-out'` 클래스를 준다.
 *
 * `render`가 false가 되는 시점은 `ms` 뒤다 — CSS의 애니메이션 길이와 같은 값을
 * 넘겨야 끝나기 전에 사라지거나 끝난 뒤에도 남지 않는다. 처음 상태가 닫힘이면
 * 아무것도 그리지 않는다(첫 페인트에서 나가는 애니메이션이 도는 일 없이).
 */
export function usePopAnim(open: boolean, ms = 130): { render: boolean; cls: string } {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const prev = useRef(open);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (prev.current === open) return;
    prev.current = open;
    clearTimeout(timer.current);
    if (open) {
      setClosing(false);
      setRender(true);
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      setClosing(false);
      setRender(false);
    }, ms);
  }, [open, ms]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { render: render || closing, cls: closing ? 'is-out' : open ? 'is-in' : '' };
}
