// 편집 박스의 **캐럿 정책 한 벌** — 리치텍스트를 고치는 모든 상자가 같은 규칙을 쓴다.
//
// ## 왜 한 곳인가
//
// 이 앱에는 글을 고치는 상자가 셋이다: 맵의 도형 편집(`NodeLayer`)·메모 편집
// (`FloatLayer`)·공책의 한 줄(`NoteLine` — 문단·제목·목록 항목·**표의 칸**).
// 셋은 마크업도 모델도 다르지만 **키보드로 캐럿을 옮기는 감각은 하나**여야 한다.
//
// 그러지 못해 값을 치렀다(제보): 마커 구역을 건너뛰는 규칙과 [마커|내용] flex 행을
// 오르내리는 규칙은 맵 쪽에만 있었고, 뒤늦게 생긴 표의 칸에는 `keyup` 스냅 하나뿐이라
// ① 방향키를 **길게 누르면**(keyup이 오지 않는다) 캐럿이 마커를 뚫고 지나가고
// ② ←로는 앞 줄로 넘어가지 못해 문장 첫머리에 갇히고 ③ ↑로는 윗 줄로 올라가지
// 못했다. 셋 다 맵에서는 이미 고쳐진 것들이다 — 정책이 두 곳에 흩어져 있었던 값이다.
//
// 그래서 **이 파일이 그 정책의 단일 소스**다. 새 편집 상자를 만들면 keydown에서
// 이 함수 하나를 부르면 된다.

import { caretRightToWrapEnd, listArrowLeft, listArrowVertical, snapCaretOffListMarker } from './richtextDom';

/** 이 정책이 보는 키(리액트 이벤트와 네이티브 이벤트 둘 다 이 모양을 갖는다). */
export interface CaretKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface CaretPolicyOpts {
  /** 조합 중(IME)에는 캐럿을 건드리지 않는다 — 건드리면 자모가 갈린다. */
  composing: boolean;
  /**
   * **마커 규칙을 적용하는 상자인가**(기본 `true`).
   *
   * 마커가 박스 **안의 글자**인 상자(맵의 도형·메모, 공책 표의 칸)만 해당한다.
   * 공책 본문의 목록은 마커를 항목 **옆에** 따로 그리므로 박스 안에 마커가 없고,
   * 표의 칸도 *고르기만* 한 상태에서는 방향키가 칸 이동이라 꺼 둔다.
   */
  list?: boolean;
}

/**
 * keydown 한 번에 대한 캐럿 정책 — **처리했으면 `true`**(호출부가 `preventDefault`).
 *
 * 순서에 뜻이 있다:
 * 1. **먼저 스냅**한다 — 캐럿이 마커 구역에 앉아 있으면 내용 시작으로. 이 자리가
 *    중요한 이유는 `keyup`이 오지 않는 **길게 누름**(auto-repeat) 때문이다: keydown만
 *    되풀이되므로 교정도 keydown에 있어야 한다.
 * 2. **그리고 한 프레임 뒤에 또 스냅**한다(rAF) — 방향키의 기본 동작은 이 핸들러
 *    **뒤에** 실행되므로, 막지 않은 키가 캐럿을 마커에 떨어뜨렸다면 그것은 여기서만
 *    잡힌다. rAF는 같은 프레임의 페인트 전에 돌아 잘못된 자리가 화면에 나가지 않는다.
 * 3. 그다음 방향키를 하나씩 가른다(←는 마커를 통째로 건너, ↑↓는 flex 행을 건너,
 *    →는 감긴 줄의 끝에 서게).
 */
export function editCaretKeydown(el: HTMLElement, e: CaretKey, opts: CaretPolicyOpts): boolean {
  if (opts.composing) return false;
  const list = opts.list !== false;
  if (list) {
    snapCaretOffListMarker(el);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (el.isConnected) snapCaretOffListMarker(el);
      });
    }
  }
  const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  if (!plain) return false;
  if (list && e.key === 'ArrowLeft' && listArrowLeft(el)) return true;
  if (list && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && listArrowVertical(el, e.key === 'ArrowUp' ? -1 : 1)) return true;
  // 감긴 줄의 오른끝 — 마커와 무관하므로 **모든** 편집 박스에 건다(제보 ④).
  if (e.key === 'ArrowRight' && caretRightToWrapEnd(el)) return true;
  return false;
}
