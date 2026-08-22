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

import type { CSSProperties, ReactNode } from 'react';
import { useRef } from 'react';
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
  children: ReactNode;
}

export function Modal({ open, onClose, label, dim, card, cardAttrs, cardClass, dimAttrs, dismissOnBackdrop = true, dismissOnEscape = true, restoreFocusSelector, children }: ModalProps) {
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
            aria-label={label}
            aria-modal="true"
            className={cardClass}
            {...cardAttrs}
            style={card}
            onOpenAutoFocus={() => rememberFocus()}
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
