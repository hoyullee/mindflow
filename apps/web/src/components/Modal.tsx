// 공용 모달 껍데기 — Radix Dialog(MIT) 위에 **우리 스타일 그대로** 얹는다.
//
// 왜 라이브러리인가: 모달의 시각(막·카드·라운드·그늘)은 이미 우리 것이고 바뀌지
// 않는다. 손으로 짜고 있던 것은 **행동**이었다 — 초점 트랩, 닫힌 뒤 초점 복귀,
// 배경 스크롤 잠금, `aria-modal`, 바깥 클릭·Escape 판정. 모달이 열두 개인데 그
// 규칙이 파일마다 조금씩 달랐다(어떤 모달은 Escape가 없고, 어떤 모달은 닫아도
// 초점이 어디로 가는지 정해져 있지 않았다). 그 열두 벌을 한 곳으로 모은다.
//
// 스타일 없는(unstyled) 프리미티브만 쓰므로 남의 브랜드·폰트·아이콘이 들어오지
// 않는다 — 코드 라이선스와 별개로 상표 노출이 0이라는 점이 이 선택의 절반이다.
//
// **닫히면 언마운트된다**(예전에는 `display: none`으로 계속 떠 있었다): 그래서
// "닫힌 모달이 DOM에 남아 접근성 트리·테스트 조회에 걸리던" 문제가 사라진다.

import type { CSSProperties, ReactNode, Ref, RefCallback } from 'react';
import { useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export interface ModalProps {
  open: boolean;
  /** 닫힘 요청 — Escape·바깥 클릭·프로그램적 닫기가 모두 이리 온다. */
  onClose: () => void;
  /** 접근 이름. 카드 안에 보이는 제목은 디자인이 직접 그리므로 여기서는 라벨만. */
  label: string;
  /** 막(dim) 스타일 — 색·블러·z가 화면마다 다르다. */
  dim?: CSSProperties;
  /** 카드 스타일 — 폭·라운드·그늘·패딩. */
  card?: CSSProperties;
  /** 카드에 붙일 표식(`data-*` 등) — 테스트·프로브가 쓰는 이름을 지킨다. */
  cardAttrs?: Record<string, string>;
  /** 카드 클래스 — 열림 애니메이션 등 CSS로 정해 둔 것이 있는 화면이 쓴다. */
  cardClass?: string;
  /** 막에 붙일 표식 — 프로브가 막을 직접 가리키는 화면이 쓴다. */
  dimAttrs?: Record<string, string>;
  /** 막을 눌러 닫을 수 있는가. 편집 중인 입력이 든 팝업은 false(실수로 버려진다). */
  dismissOnBackdrop?: boolean;
  /** Escape로 닫을 수 있는가. */
  dismissOnEscape?: boolean;
  /** 열기 전 초점 자리가 **사라졌을 때** 대신 초점을 줄 곳(CSS 셀렉터).
   * 메뉴 항목으로 여는 모달은 그 항목이 모달과 함께 사라지므로(팝오버가 닫힌다)
   * 돌아갈 자리가 없어진다 — 그때 그 메뉴의 트리거를 가리킨다. */
  restoreFocusSelector?: string;
  /** 열릴 때 초점을 줄 곳(CSS 셀렉터) — 기본은 첫 포커스 가능 요소인데, 파괴적
   * 선택지가 앞에 선 확인창은 그게 위험하다(Enter 한 번에 실행된다) → 취소를 가리킨다. */
  initialFocusSelector?: string;
  /** 카드 요소 ref — 크기 애니메이션(`useCardMorph`) 등 실측이 필요한 화면이 쓴다. */
  cardRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function Modal({ open, onClose, label, dim, card, cardAttrs, cardClass, dimAttrs, dismissOnBackdrop = true, dismissOnEscape = true, restoreFocusSelector, initialFocusSelector, cardRef, children }: ModalProps) {
  // 닫은 뒤 초점을 **열기 전 그 자리로** 되돌린다. Radix는 `Dialog.Trigger`로 연
  // 모달의 트리거에 초점을 주는데, 우리 모달은 메뉴·행·단축키 등 온갖 곳에서 열려
  // 트리거가 없다 — 그래서 열리는 순간의 활성 요소를 직접 기억한다.
  const restoreRef = useRef<HTMLElement | null>(null);
  /** 열기 직전의 초점 자리를 기억한다. **effect가 아니라 `onOpenAutoFocus`**에서 재는
   * 이유: 자식(Radix Content)의 effect가 부모보다 먼저 돌아 이미 카드 안으로 초점이
   * 옮겨진 뒤라, effect에서 재면 "카드 안의 첫 버튼"을 기억하게 된다(닫는 순간 그
   * 버튼은 사라지므로 복귀가 통째로 실패한다). 이 이벤트는 옮기기 **직전**이다. */
  const rememberFocus = (): void => {
    const el = document.activeElement;
    // `body`는 "초점이 아무 데도 없다"는 뜻 — 기억해 두면 아래 폴백이 돌지 못한다.
    const usable = el instanceof HTMLElement && el !== document.body && el !== document.documentElement;
    restoreRef.current = usable ? el : null;
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        {/* 막이 곧 가운데 정렬 상자다 — 예전 마크업(fixed inset:0 flex center)을
            그대로 유지해 카드 위치가 한 픽셀도 움직이지 않는다. */}
        <Dialog.Overlay data-modal-overlay {...dimAttrs} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...dim }}>
          <Dialog.Content
            ref={cardRef}
            aria-label={label}
            aria-modal="true"
            className={cardClass}
            {...cardAttrs}
            style={card}
            onOpenAutoFocus={(e) => {
              rememberFocus();
              // 기본은 Radix의 첫 포커스 가능 요소 — 지정이 있으면 그리로(위 주석).
              if (initialFocusSelector) {
                const el = document.querySelector<HTMLElement>(initialFocusSelector);
                if (el) {
                  e.preventDefault();
                  el.focus();
                }
              }
            }}
            onEscapeKeyDown={(e) => {
              if (!dismissOnEscape) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (!dismissOnBackdrop) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (!dismissOnBackdrop) e.preventDefault();
            }}
            onCloseAutoFocus={(e) => {
              // Radix 기본은 `Dialog.Trigger`로 되돌리는데 우리 모달은 메뉴·행·단축키
              // 에서 열려 트리거가 없다 — 그대로 두면 초점이 body로 떨어져 키보드
              // 사용자가 자리를 잃는다. 그래서 직접 돌린다.
              e.preventDefault();
              const target = restoreRef.current?.isConnected ? restoreRef.current : null;
              // **한 틱 뒤에** 준다: 초점 트랩이 아직 해제되는 중이라 이 순간의
              // `focus()`는 되돌려진다(실브라우저에서 확인 — body에 머물렀다).
              setTimeout(() => {
                if (target?.isConnected) {
                  target.focus();
                  if (document.activeElement === target) return;
                }
                // 열기 전 자리가 사라졌다(메뉴 항목으로 열었다) — 그 메뉴의 트리거로.
                if (restoreFocusSelector) document.querySelector<HTMLElement>(restoreFocusSelector)?.focus();
              }, 0);
            }}
          >
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 모달 막의 기본값 — 홈·에디터가 함께 쓰는 값(색·블러). z는 화면이 정한다. */
export const MODAL_DIM: CSSProperties = { background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)' };

/**
 * 카드 크기 애니메이션 — 메뉴 선택으로 내용이 늘고 줄 때 카드가 **이전 크기에서
 * 새 크기로 이어지게** 한다(요청 — 설정 팝업의 화면 전환과 같은 0.24s 곡선).
 *
 * 크기는 내용이 정하는 값이라 CSS `transition`이 붙을 곳이 없다 — 그래서 카드를
 * ResizeObserver로 지켜보다 자연 크기가 바뀌면 이전 크기를 고정해 두고 새 크기로
 * 전이시킨 뒤 풀어 준다(설정 모달의 높이 잇기와 같은 기계 — 다만 그쪽은 화면 전환
 * 이라는 한 가지 계기를 렌더 단계에서 재고, 여기는 계기가 여럿이라(목적지·반복·종일
 * ·Meet…) 실측으로 받는다). reduced-motion이면 걸지 않는다.
 *
 * **폭도 이 훅이 함께 잇는다** — 예전에는 폭을 카드의 CSS `transition`에 맡겼는데,
 * 그러면 폭이 아직 옛 값일 때 ResizeObserver가 도착해 **좁게 짜부라진 상태의 높이**를
 * 목표로 잡는다(새 일정 팝업 560→900: 두 열이 560에 눌려 아주 길어진 높이까지 자랐다가
 * 릴리스에서 실제 높이로 툭 줄었다 — 제보: "100까지 늘었다 90으로 리사이즈"). 폭을
 * 훅이 소유하면 React가 새 폭을 **즉시** 적용해 레이아웃이 최종 기하가 되고, RO는
 * 그 참값을 목표로 받는다.
 *
 * `Modal`의 `cardRef`에 그대로 꽂는 ref 콜백을 돌려준다.
 */
export function useCardMorph(): RefCallback<HTMLDivElement> {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last: { w: number; h: number } | null = null;
    let animating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // React가 style prop으로 준 값을 되살릴 수 있게 — 임의로 ''로 지우면 카드가
    // 원래 갖고 있던 overflow/transition까지 함께 사라진다.
    const base = { overflow: el.style.overflow, transition: el.style.transition };
    const ro = new ResizeObserver(() => {
      if (animating) return; // 전이 중의 중간 크기들 — 새 애니메이션의 계기가 아니다
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!last || (w === last.w && h === last.h)) {
        last = { w, h };
        return;
      }
      const from = last;
      last = { w, h };
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      animating = true;
      // 폭은 React가 style prop으로 소유하는 값이다(560/900/'100%') — 릴리스에서 ''로
      // 지우면 React의 인라인 폭이 DOM에서 사라져 카드가 내용 폭으로 주저앉는다
      // (실측: 900 목표가 릴리스 순간 804로 툭 — 제보의 "커졌다 줄어드는" 그 모양).
      // 이 순간의 값(= React가 방금 커밋한 목표)을 들고 있다가 그대로 되살린다.
      const baseW = el.style.width;
      const baseH = el.style.height;
      // **내용은 전이 내내 한 폭으로 머문다**(제보 #8: 목적지를 구글로 바꾸면 "요소들의
      // 정렬이 깨진다"). 카드 폭만 애니메이션하면 그 사이 프레임마다 내용이 중간 폭으로
      // 다시 흐른다 — 두 열 배치가 318px에 눌렸다가 펴지는 것이 실측으로 확인됐다.
      // 그래서 자식들을 **넓은 쪽 폭**에 고정하고 카드가 그것을 잘라 낸다: 넓어질 때는
      // 최종 배치가 드러나고, 좁아질 때는 옛 배치가 밀려 나간다(서랍처럼).
      // 자식이 눕는 자리는 **테두리 안쪽**이다 — offsetWidth를 그대로 주면 테두리
      // 두께(보통 2px)만큼 넓어져 전이 내내 내용이 그만큼 밀린다(실측 558→560).
      const wide = Math.max(from.w, w) - (el.offsetWidth - el.clientWidth);
      const kids = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
      const kidW = kids.map((c) => c.style.width);
      for (const c of kids) c.style.width = `${wide}px`;
      el.style.width = `${from.w}px`;
      el.style.height = `${from.h}px`;
      el.style.overflow = 'hidden';
      void el.offsetHeight; // 강제 리플로우 — 시작 값을 확정한 뒤 목표로 보낸다
      el.style.transition = 'width .24s cubic-bezier(.4,0,.2,1), height .24s cubic-bezier(.4,0,.2,1)';
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 전이 중 React가 폭·높이를 새로 썼다면(연타 전환 등) 그 값을 지킨다 —
        // 우리가 심은 목표 그대로일 때만 원래 값으로 되돌린다.
        if (el.style.width === `${w}px`) el.style.width = baseW;
        if (el.style.height === `${h}px`) el.style.height = baseH;
        kids.forEach((c, i) => {
          if (c.style.width === `${wide}px`) c.style.width = kidW[i] ?? '';
        });
        el.style.overflow = base.overflow;
        el.style.transition = base.transition;
        animating = false;
        // 전이 중 또 바뀌었을 수 있다(async 목록 도착 등) — 지금 값으로 재동기화.
        last = { w: el.offsetWidth, h: el.offsetHeight };
      }, 280);
    });
    ro.observe(el);
    cleanup.current = () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);
}

/** 카드 기본값 — 폭만 다르고 나머지(면·라운드·그늘·패딩·페이드)는 같다. */
export function modalCard(width: number, extra?: CSSProperties): CSSProperties {
  return {
    width,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--mf-panel)',
    borderRadius: 16,
    boxShadow: '0 24px 60px rgba(0,0,0,.28)',
    padding: 26,
    animation: 'mf-fade .2s ease',
    boxSizing: 'border-box',
    ...extra,
  };
}
