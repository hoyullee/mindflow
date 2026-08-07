import { useCallback, useEffect, useState } from 'react';

/**
 * 설치 안내 — "홈 화면에 추가"(모바일) / "앱으로 설치"(데스크톱).
 *
 * 브라우저가 `beforeinstallprompt`를 던져 주면 **버튼 한 번으로 설치**할 수 있다.
 * 이건 모바일만의 이야기가 아니다 — 데스크톱 크롬·엣지도 같은 이벤트를 주고,
 * 설치하면 주소창 없는 창 하나로 열린다. 그래서 그 경우엔 기기를 가리지 않는다
 * (사용자 요청).
 *
 * 반대로 iOS 사파리에는 그 이벤트도 설치 배너도 없어서, 공유 시트의 "홈 화면에
 * 추가"를 사용자가 스스로 찾아야 한다 — 그 **수동 절차 안내만** 모바일 전용이다
 * (데스크톱 사파리에는 대응하는 절차가 없다).
 *
 * 이 파일은 **판단만** 한다(표현은 `InstallHint.tsx`). 판단부는 순수 함수라
 * 테스트가 규칙을 그대로 고정한다.
 */

export type InstallHintMode = 'prompt' | 'ios' | null;

export interface InstallEnv {
  /** 모바일 화면인가 — iOS 수동 절차 안내에만 쓴다(한 번에 설치되는 길은 공통). */
  isMobile: boolean;
  /** 이미 홈 화면(독립 창)에서 실행 중인가. */
  standalone: boolean;
  /** 이 기기에서 이미 닫았거나 설치했는가. */
  dismissed: boolean;
  /** `beforeinstallprompt`를 받아 뒀는가(=버튼 한 번으로 설치 가능). */
  canPrompt: boolean;
  /** iOS(사파리)인가 — 수동 절차를 안내해야 하는 쪽. */
  ios: boolean;
}

export function installHintMode(env: InstallEnv): InstallHintMode {
  if (env.standalone || env.dismissed) return null;
  // 한 번에 설치되는 길이 있으면 기기를 가리지 않는다(데스크톱 크롬·엣지 포함).
  if (env.canPrompt) return 'prompt';
  // 손으로 하는 절차 안내는 iOS 모바일에만 — 데스크톱엔 안내할 절차가 없다.
  return env.isMobile && env.ios ? 'ios' : null;
}

const KEY = 'mf_install_hint';

export function loadDismissed(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false; // 저장소가 막힌 브라우저 — 안내는 그냥 보여 준다
  }
}

export function saveDismissed(reason: 'dismissed' | 'installed'): void {
  try {
    localStorage.setItem(KEY, reason);
  } catch {
    /* 저장 못 해도 이번 세션에서는 상태로 숨긴다 */
  }
}

/** 홈 화면(독립 창)에서 실행 중인가 — 그럼 안내할 이유가 없다. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS 사파리는 display-mode 대신 이 비표준 플래그를 쓴다.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iOS인가 — iPadOS 13+는 UA가 Macintosh라 터치 지원으로 함께 가린다. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** `beforeinstallprompt`의 최소 타입(표준화 전이라 lib.dom에 없다). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallHint {
  mode: InstallHintMode;
  /** 안드로이드: 브라우저의 설치 프롬프트를 띄운다. */
  install: () => void;
  /** 다시 보지 않기(이 기기). */
  dismiss: () => void;
}

export function useInstallHint(isMobile: boolean): InstallHint {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => loadDismissed());

  useEffect(() => {
    const onBeforeInstall = (e: Event): void => {
      // 기본 배너를 막고 우리 안내로 대체한다(사용자가 고른 시점에 prompt()).
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = (): void => {
      saveDismissed('installed');
      setDismissed(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    saveDismissed('dismissed');
    setDismissed(true);
  }, []);

  const install = useCallback(() => {
    const ev = deferred;
    if (!ev) return;
    setDeferred(null);
    // 사용자가 취소해도 다시 묻지 않는다 — 한 번 거절한 안내를 계속 띄우는 건 소음이다.
    saveDismissed('dismissed');
    setDismissed(true);
    void ev.prompt();
  }, [deferred]);

  const mode = installHintMode({
    isMobile,
    standalone: isStandaloneDisplay(),
    dismissed,
    canPrompt: !!deferred,
    ios: isIOS(),
  });

  return { mode, install, dismiss };
}
