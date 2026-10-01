import { useEffect, useMemo, useRef, useState } from 'react';
import './home.css';
import { LoadingOverlay } from '../auth/LoadingOverlay';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { MapGrid } from './components/MapGrid';
import { SearchResults } from './components/SearchResults';
import { RecentStrip, RecentStripSkeleton } from './components/RecentStrip';
import { CalendarView } from './calendar/CalendarView';
import { CalendarSkeleton } from './components/CalendarSkeleton';
import { AuthModal } from './components/modals/AuthModal';
import { ToastModal } from './components/modals/ToastModal';
import { NewSpaceModal } from './components/modals/NewSpaceModal';
import { FolderModal } from './components/modals/FolderModal';
import { MapRenameModal } from './components/modals/MapRenameModal';
import { HomeContextMenu } from './components/HomeContextMenu';
import { Modals } from './components/modals/Modals';
import { AccountSettingsModal } from './components/modals/AccountSettingsModal';
import { DeleteAccountModal } from './components/modals/DeleteAccountModal';
import { FeedbackModal } from '../../components/FeedbackModal';
import { FeedbackFab } from './components/FeedbackFab';
import { ShareModal } from '../../components/ShareModal';
import { ChangePasswordModal } from './components/modals/ChangePasswordModal';
import { SetPasswordModal } from './components/modals/SetPasswordModal';
import { ProfileNameModal } from './components/modals/ProfileNameModal';
import { TemplateGallery } from './components/modals/TemplateGallery';
import { useHomeController } from './useHomeController';
import { deriveHomeView, isSpaceView } from './viewModel';
import { predictLanding } from './storage';
import { homeModalTheme } from './theme';
import { homeUpdateRisk } from './updateRisk';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useUpdateGuard } from '../../pwa/updateGate';
import { InstallHint } from '../../pwa/InstallHint';
import { useInstallHint } from '../../pwa/installHint';
import { OfflineBar } from '../../components/OfflineBar';
import { useOnline } from '../../hooks/useOnline';
import { useMarqueeSelect } from './marquee';
import { WorkStatusView } from '../tools/workstatus/WorkStatusView';
import { JiraSetupHost, openJiraSetup } from '../tools/jira/JiraSetupModal';
import { ToolToastHost, toolToast } from '../tools/ui';
import { jiraReasonText } from '../tools/jira/jiraApi';
import { onJiraConnected } from '../tools/jira/jiraStore';
import { MobileTabBar, type MobileTab } from './mobile/MobileTabBar';
import { MobileSpaceView } from './mobile/MobileSpaceView';
import { MobileNotificationsPage } from './mobile/MobileNotificationsPage';
import { MobileMorePage } from './mobile/MobileMorePage';

/**
 * React port of Home.dc.html — the map home. State/behavior lives in
 * {@link useHomeController} (1:1 with the original `class Component extends
 * DCLogic`); {@link deriveHomeView} mirrors `renderVals()`'s derived data.
 *
 * 모바일(767px 이하)은 LNB 대신 **하단 탭 네 개**(스페이스·일정·알림·전체 — 모바일 홈
 * 디자인)다. 예전에는 LNB가 햄버거로 여는 서랍이었다(M6). 알림·전체 탭은 컨트롤러 상태가
 * 아니라 여기의 로컬 상태(`mPanel`)다 — 데스크톱에는 그런 "화면"이 없고(알림은 떠 있는 창,
 * 전체는 LNB 자체), 화면 전환(스페이스·일정·도구)이 일어나면 저절로 닫혀야 한다.
 */
export function Home() {
  const controller = useHomeController();
  const { state } = controller;
  // Derive the view (card metadata + `realPreview` sketches) only when the ported
  // state actually changes — not on every Home re-render (e.g. the mobile tab
  // switch below). `realPreview` is memoized too (see mapPreview), so unchanged
  // cards return the same element reference and React skips their SVG subtrees.
  const view = useMemo(() => deriveHomeView(state), [state]);
  // 에디터와 함께 쓰는 모달(공유·피드백)은 CSS 변수를 스스로 읽지 않으므로
  // 지금 테마의 색을 만들어 넘긴다 — 다크에서도 홈과 같은 면·글자색이 된다.
  const modalTheme = useMemo(() => homeModalTheme(state.theme), [state.theme]);
  const isMobile = useIsMobile();
  // 빈 자리에서 끌어 카드를 한 번에 고른다(요청) — 마우스에서만. 터치에는 길게
  // 누르기(선택 모드)가 이미 있고, 손가락 드래그는 목록 스크롤이다.
  // **대시보드 화면에서는 걸지 않는다**(제보: 위젯 우측 하단으로 끌면 영역 지정
  // 사각형이 떴다) — 마퀴가 고르는 것은 맵·폴더 카드이고 대시보드에는 그런 카드가
  // 없다. 게다가 그 자리는 편집 모드의 리사이즈 손잡이라 조작이 겹친다.
  const marquee = useMarqueeSelect({
    onSelect: controller.marqueeSelect,
    currentSelection: () => controller.state.selectedCards,
    disabled: isMobile || !isSpaceView(state),
  });
  const installHint = useInstallHint(isMobile);
  // 예상은 **마운트 때 한 번** 잡는다 — 착지하면서 힌트가 갱신되므로 매 렌더 읽으면
  // 로딩 중에 모양이 바뀔 수 있다.
  const landingGuess = useRef<'space' | 'cal'>(predictLanding());
  const online = useOnline();
  /** 모바일의 알림·전체 탭 — 스페이스·일정·도구 화면 **위에** 덮는 화면(아래 설명). */
  const [mPanel, setMPanel] = useState<'noti' | 'more' | null>(null);
  // 로딩 스켈레톤의 모양 — 아직 착지 화면을 모르는 첫 프레임에 쓴다(`predictLanding`:
  // 이 탭이 기억한 화면 → 이 기기의 힌트). 일정으로 착지할 예정이면 일정 껍데기를
  // 그린다(제보: 스페이스 스켈레톤이 떴다가 통째로 갈아 끼워졌다). 시작 화면을 고를
  // 수 있게 된 뒤로는(설정 › 시작 화면) 이 진입이 흔하다.
  const calSkeleton = view.loading && landingGuess.current === 'cal';
  // 새 배포 자동 적용 게이트: 목록은 리로드해도 그대로 다시 그려지니 기본은 조용히
  // 적용하고, 입력 중인 팝업·확인 다이얼로그·검색어가 있을 때만 물어본다.
  useUpdateGuard(homeUpdateRisk(state));

  // Jira 연결에서 돌아왔다(`/auth/jira` → `/home?jira=…`) — 작업 현황을 열고, 프로젝트를 아직 안
  // 골랐으면 곧바로 고르게 한다(결정: "프로젝트는 연결 시 선택"). **하이드레이션 뒤에** 연다 —
  // 그 전에 열면 착지(탭이 기억한 화면 복원)가 도구 화면을 덮는다. 주소의 신호는 한 번 읽고 지운다.
  const jiraReturn = useRef<string | null>(null);
  if (jiraReturn.current === null) jiraReturn.current = new URLSearchParams(window.location.search).get('jira') ?? '';
  useEffect(() => {
    const sig = jiraReturn.current;
    if (!state.loaded || !sig) return;
    jiraReturn.current = '';
    const q = new URLSearchParams(window.location.search);
    const reason = q.get('reason') ?? '';
    q.delete('jira');
    q.delete('reason');
    const rest = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    if (sig === 'error') {
      toolToast(reason === 'denied' ? 'Jira 연결을 취소했어요' : `연결하지 못했어요 · ${jiraReasonText(reason)}`);
      return;
    }
    controller.openTool('jira');
    toolToast('Jira를 연결했어요 · 도구에 작업 현황이 생겼어요');
    if (sig === 'setup') openJiraSetup();
  }, [state.loaded, controller]);

  // 설치형 앱의 Jira 연결 — 브라우저가 딥링크로 돌려준 코드를 앱이 교환하면 여기로 온다(웹의 `?jira=…`와 같은 일).
  const openToolRef = useRef(controller.openTool);
  openToolRef.current = controller.openTool;
  useEffect(
    () =>
      onJiraConnected((e) => {
        if (!e.ok) {
          toolToast(`연결하지 못했어요 · ${jiraReasonText(e.reason)}`);
          return;
        }
        openToolRef.current('jira');
        toolToast('Jira를 연결했어요 · 도구에 작업 현황이 생겼어요');
        if (e.needsSetup) openJiraSetup();
      }),
    [],
  );

  // 화면이 바뀌면(스페이스·일정·도구 — 알림의 일정 항목, 전체의 작업 현황 …) 알림·전체 탭을
  // 걷는다. 탭 막대가 그 화면을 가리키도록 한 곳에서 다룬다 — 행마다 닫기를 챙기면 새 길이
  // 생길 때마다 빠뜨린다(서랍 시절의 같은 교훈).
  useEffect(() => {
    setMPanel(null);
  }, [state.activeSpace, state.activeCal, state.activeTool]);
  // 데스크톱 폭으로 넘어가면 모바일 탭 상태는 뜻을 잃는다(LNB가 다시 선다).
  useEffect(() => {
    if (!isMobile) setMPanel(null);
  }, [isMobile]);

  const mobileTab: MobileTab = mPanel ?? (state.activeTool ? 'more' : state.activeCal ? 'cal' : 'space');
  const selectTab = (tab: MobileTab) => {
    // 고르던 것은 다른 탭으로 가면 놓는다 — 선택 바가 없는 화면에 선택만 남으면 다음 길게
    // 누르기가 "이미 모드 안"으로 읽혀 첫 항목을 잡지 못한다.
    if (state.selectMode) controller.exitSelectMode();
    if (tab === 'noti' || tab === 'more') {
      setMPanel(tab);
      return;
    }
    setMPanel(null);
    if (tab === 'cal') {
      controller.openCalendar();
      return;
    }
    // 스페이스 — 이미 스페이스 화면이면 **맨 위(스페이스 첫 화면)**로(탭을 다시 누르는 관례).
    controller.setActiveSpace(state.activeSpace);
  };
  const mobileSpace = isMobile && !mPanel && !state.activeTool && !state.activeCal && !calSkeleton;

  // 루트는 `100dvh`(에디터와 동일, M6) — 모바일에서 `100vh`는 주소창을 무시한
  // **큰** 뷰포트라 루트가 화면보다 길어지고, 그 차이만큼 **페이지 스크롤이 하나
  // 더** 생겨 안쪽 목록(main) 스크롤과 이중이 됐다(제보: 최상단↔최하단 이동 시
  // 두 스크롤이 따로 움직임). 데스크톱에서는 100vh와 같다.
  // 알림 우편함(`NotificationsProvider`)은 여기가 아니라 **문지기 안**에 있다 —
  // 작업 표시줄 배지가 에디터에서도 움직여야 하기 때문(`platform/DesktopBadgeHost`).
  return (
    <div className="mf-home" style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'var(--mf-app-h)', width: '100%', background: isMobile ? 'var(--mf-m-bg)' : 'var(--mf-bg)', fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif", color: 'var(--mf-text)', overflow: 'hidden' }}>
      {/* `instant`: Home의 로더는 뒤 배경을 함께 바꾸는 동작(새로 만들기=카드 추가,
          로그아웃/탈퇴=목록 정리)에 쓰이므로, 페이드인 중 반투명 구간으로 그 변화가
          비쳐 깜빡이지 않도록 첫 프레임부터 화면을 덮는다. */}
      {state.creatingMap && <LoadingOverlay message={state.loaderMsg || '잠시만 기다려 주세요'} instant veil="var(--mf-overlay-veil)" ink="var(--mf-text)" subInk="var(--mf-muted)" accent="var(--mf-accent)" accentSoft="var(--mf-accent-soft)" />}

      {/* 모바일에는 LNB가 없다 — 그 자리는 하단 탭(맨 아래)과 「전체」 탭이 나눠 갖는다. */}
      {!isMobile && <Sidebar state={state} view={view} controller={controller} />}

      <ToastModal state={state} controller={controller} />

      {/* "홈 화면에 추가" 안내(모바일). iOS에는 설치 배너가 없어 공유 시트의 절차를
          사용자가 스스로 찾아야 하고, 안드로이드는 버튼 한 번으로 끝난다 —
          `useInstallHint`가 그 차이를 판단하고 여기서는 띄우기만 한다. 홈에만
          두는 이유: 로그인·랜딩은 아직 "쓰기로 한" 화면이 아니다. */}
      {/* 오프라인이면 설치 안내 대신 연결 상태를 말한다 — 지금 급한 정보가 그쪽이고,
          같은 자리를 두 카드가 다투지도 않는다. */}
      <OfflineBar visible={!online} />
      <InstallHint mode={online ? installHint.mode : null} onInstall={installHint.install} onDismiss={installHint.dismiss} isMobile={isMobile} />

      {/* `scrollbarGutter: 'stable'` reserves the vertical scrollbar's width
          whether or not it's showing, so crossing from "few maps" (no scroll) to
          "many maps" (scroll appears) doesn't shrink the content box and shift the
          whole grid/toolbar left on devices with classic (space-taking) scrollbars.
          It's a no-op with overlay scrollbars (mobile), where there's no shift anyway. */}
      <main
        onPointerDown={marquee.onPointerDown}
        onContextMenu={(e) => {
          // 빈 자리 우클릭 = "새로 만들기 · 새 폴더 · 가져오기 · 설정"(요청).
          // 카드·폴더는 자기 메뉴를 열고 전파를 끊으므로 여기까지 오지 않고,
          // 입력창·검색어 위에서는 브라우저 기본 메뉴(붙여넣기 등)를 지킨다.
          const t = e.target as HTMLElement;
          if (t.closest && t.closest('input, textarea, [contenteditable="true"], .mf-home-ctx')) return;
          e.preventDefault();
          // 폰의 `contextmenu`는 길게 누르기다 — 빈 자리 메뉴는 데스크톱의 우클릭 몫이고, 폰에서
          // 만들기는 ＋가 맡는다(카드를 길게 눌렀을 때 이 메뉴까지 뜨면 선택 모드와 겹친다).
          if (isMobile) return;
          // 이 메뉴의 항목(새로 만들기·새 폴더·가져오기)은 **스페이스 화면의 일**이다 —
          // 일정·대시보드 화면에서 뜨면 보이지 않는 스페이스에 폴더가 생긴다(제보:
          // 일정 화면 우클릭에 스페이스 메뉴). 그 화면들에서는 기본 메뉴만 막는다
          // (마퀴 가드와 같은 `isSpaceView` 판정 — 네 번째 화면이 생겨도 그 함수만).
          if (!isSpaceView(state)) return;
          controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'bg' });
        }}
        // 첫 진입에 살짝 떠오르며 나타난다(디자인 원본의 `ghFade`) — 마운트 때 한 번만
        // 돌고, 움직임을 줄이라고 한 사용자에게는 home.css가 끈다.
        className="mf-home-main"
        // 본문 패딩은 디자인 원본(24/32/44). 모바일은 좁은 폭에 맞춰 줄인다.
        //
        // **일정 화면은 예외**로 패딩을 0으로 두고 스크롤도 넘긴다(제보: 캔버스가
        // 화면을 다 채우지 않고 90% 배율처럼 보인다). 그 화면은 헤더 + [달력 | 사이드]
        // 구조라 자기 높이를 스스로 채워야 하는데, 여기 패딩 안에 들어 있으면 사방이
        // 24~44px 안쪽으로 밀리고 격자가 뷰포트 높이까지 자라지 못한다. 대시보드는
        // 같은 문제를 음수 마진으로 상쇄하지만(그 화면은 세로로 흐른다), 일정은 안쪽
        // 두 영역이 각자 스크롤하므로 **패딩을 아예 걷는 편**이 정확하다.
        // 본문 면은 **흰 면**이다(요청 — 대시보드·스페이스·일정 셋 다). 예외는
        // 최근 항목 띠 하나로, `home.css`가 그 띠만 따뜻한 면으로 되돌린다(그러지
        // 않으면 흰 카드가 흰 배경에 묻힌다).
        // 스페이스 화면에도 **점 격자**를 얹는다(요청) — 대시보드·일정은 자기 본문에
        // 같은 격자를 이미 그리므로(그 위를 덮는 불투명 면이다) 여기서는 스페이스일
        // 때만 그린다. 두 겹으로 그리면 스크롤 위치에 따라 점이 어긋나 보인다.
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          overflowY: state.activeCal || state.activeTool || isMobile ? 'hidden' : 'auto',
          // 도구 화면은 본문을 꽉 채운다(`inset: 0` — 도구 스펙 §5) — 그 기준 상자.
          position: 'relative',
          scrollbarGutter: 'stable',
          // 아래 여백은 **떠 있는 피드백 단추**(46px, 바닥에서 22px)가 마지막 줄의 카드를
          // 덮지 않을 만큼이다 — 끝까지 굴렸을 때 카드의 오른쪽 아래가 단추 밑에 깔리면
          // 거기 있는 것을 누를 수 없다.
          // 모바일은 화면마다 제 머리·굴림을 갖는다(머리는 서 있고 목록만 구른다) — 패딩·스크롤을 넘긴다.
          padding: state.activeCal || state.activeTool || isMobile ? 0 : '24px 32px 84px',
          minWidth: 0,
          minHeight: 0,
          backgroundColor: isMobile ? 'var(--mf-m-bg)' : 'var(--mf-page)',
          ...(isSpaceView(state) && !isMobile ? { backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '17px 17px' } : {}),
        }}
      >
        {/* Cross-space "최근 항목" strip sits ABOVE the space toolbar so it reads as a
            global "recently opened" bar, not part of the current space's maps.
            로딩 중엔(저장된 최근 기록이 있을 때) 같은 footprint의 스켈레톤을 미리
            깔아, 로드 완료 시 트레이가 끼어들며 툴바가 아래로 튀는 점프를 막는다. */}
        {/* 검색 중에는 최근 항목을 감춘다 — 질의로 걸러지지 않는 목록이 결과 위에
            남아 있으면 무엇이 결과인지 흐려진다. */}
        {/* 화면은 언제나 한쪽만 그린다(일정 ↔ 스페이스). 최근 항목·툴바·그리드는
            스페이스의 것이라 함께 접는다. */}
        {isMobile && mPanel === 'noti' ? (
          <MobileNotificationsPage onOpenVersion={controller.openVersionSetup} />
        ) : isMobile && mPanel === 'more' ? (
          <MobileMorePage state={state} view={view} controller={controller} />
        ) : state.activeTool === 'jira' ? (
          /* 도구 화면(작업 현황) — LNB는 그대로 두고 본문만 갈아 끼운다(도구 스펙 §5). */
          <div data-tool-screen="jira" style={{ position: 'absolute', inset: 0, animation: 'mf-fade .3s ease' }}>
            <WorkStatusView isMobile={isMobile} />
          </div>
        ) : state.activeCal ? (
          /* 일정 보기 — 스페이스와 나란한 두 번째 화면. */
          <CalendarView state={state} controller={controller} isMobile={isMobile} />
        ) : calSkeleton ? (
          /* 로딩 중이고 이번 진입이 일정으로 착지할 예정 — 스페이스 스켈레톤(최근
             항목 띠 + 카드 격자)을 띄우면 곧 통째로 갈아 끼워진다(제보). */
          <CalendarSkeleton isMobile={isMobile} />
        ) : mobileSpace ? (
          <MobileSpaceView state={state} view={view} controller={controller} />
        ) : (
          <>
            {view.loading && state.recent.length > 0 && !view.searchQuery && <RecentStripSkeleton count={state.recent.length} />}
            {/* 검색으로 들어갈 때 **접힌다**(지우지 않는다 — 요청·디자인). 높이·투명도·
                위치가 함께 줄어 전환이 이어져 보이고, 검색을 지우면 같은 길로 되돌아온다.
                접힌 동안에는 `inert`로 키보드 초점까지 막는다 — `max-height: 0`은 화면에서
                감출 뿐이라 안의 카드가 여전히 탭으로 잡히면 "보이지 않는 곳에 초점이 있는"
                상태가 된다(pointer-events만으로는 못 막는 자리다). */}
            {view.recentSectionVisible && (
              <div
                className="mf-recent-bleed"
                data-recent-collapse={view.recentCollapsed ? '1' : '0'}
                aria-hidden={view.recentCollapsed || undefined}
                {...(view.recentCollapsed ? { inert: '' } : {})}
                style={{
                  overflow: 'hidden',
                  maxHeight: view.recentCollapsed ? 0 : 460,
                  opacity: view.recentCollapsed ? 0 : 1,
                  transform: view.recentCollapsed ? 'translateY(-6px)' : 'none',
                  // ⚠️ 여기 **음수 마진을 쓰지 않는다**(제보: 검색 제목이 잘린다).
                  // 예전에는 접힐 때 `-34`로 당겨 빈 자리를 없앴는데, 그 34px은 이 상자
                  // **안쪽** 여백이라 `max-height: 0`이 이미 걷어 간다 — 그래서 한 번 더
                  // 당기면 뒤따르는 검색 제목이 위 툴바 아래로 밀려 들어가 윗부분이
                  // 잘렸다. 높이만 0으로 만들면 그 자리는 정확히 사라진다.
                  pointerEvents: view.recentCollapsed ? 'none' : undefined,
                  transition: 'max-height .36s cubic-bezier(.4,0,.2,1), opacity .22s ease, transform .3s ease',
                }}
              >
                <RecentStrip cards={view.recentCards} controller={controller} />
              </div>
            )}
            {/* 툴바(검색창이 그 안에 있다)는 검색 중에도 남는다 — 검색창이 사라지면
                글자를 고칠 수도, 지울 수도 없다. 스페이스 제목은 "지금 어디에 있는가",
                즉 검색을 지웠을 때 돌아갈 자리를 계속 가리킨다. */}
            <Toolbar state={state} view={view} controller={controller} />
            {view.searchQuery ? <SearchResults view={view} controller={controller} /> : <MapGrid view={view} controller={controller} />}
          </>
        )}
      </main>

      {isMobile && <MobileTabBar active={mobileTab} onSelect={selectTab} sharedNew={view.sharedUnread} />}

      {/* 마퀴 — 화면 좌표라 `position: fixed`. 포인터를 가로채면 그 아래 카드가
          hover·drop 대상을 잃으므로 `pointer-events: none`. */}
      {marquee.rect && (
        <div
          data-marquee
          style={{
            position: 'fixed',
            left: marquee.rect.x,
            top: marquee.rect.y,
            width: marquee.rect.w,
            height: marquee.rect.h,
            border: '1px solid var(--mf-accent)',
            background: 'rgba(var(--mf-accent-rgb), .10)',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 60,
          }}
        />
      )}

      <AuthModal state={state} controller={controller} />
      <AccountSettingsModal state={state} controller={controller} />
      <ProfileNameModal state={state} controller={controller} />
      <ChangePasswordModal state={state} controller={controller} />
      <SetPasswordModal state={state} controller={controller} />
      <DeleteAccountModal state={state} controller={controller} />
      {/* 피드백(사용자 의견 수집) — 화면 오른쪽 아래의 떠 있는 단추에서 연다(스펙: 홈·LNB
          변경 7). 모달이 떠 있을 때는 단추가 스스로 물러선다. 폰에서는 띄우지 않는다 — 오른쪽
          아래는 ＋(새로 만들기)의 자리이고, 피드백은 「전체」 탭에 있다. */}
      {!isMobile && <FeedbackFab onOpen={controller.openFeedback} />}
      <FeedbackModal open={state.feedbackOpen} onClose={controller.closeFeedback} page="home" theme={modalTheme} />
      {/* 공유 — 카드 메뉴에서 연다(요청). 에디터와 **같은 모달**이고 색만 홈 테마다.
          그리드의 카드는 언제나 내 맵이라 보기 전용이 아니다(공유받은 맵은 LNB에만). */}
      <ShareModal open={!!state.shareDocId} docId={state.shareDocId ?? ''} onClose={controller.closeShare} theme={modalTheme} kindName={view.shareKindName} docName={view.shareDocName} />
      <TemplateGallery state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
      <MapRenameModal state={state} controller={controller} />

      {/* 홈의 단 하나뿐인 메뉴 — 카드 ☰·카드 우클릭·빈 자리 우클릭이 모두 이걸 연다. */}
      <HomeContextMenu state={state} view={view} controller={controller} />
      <JiraSetupHost />
      <ToolToastHost />
    </div>
  );
}
