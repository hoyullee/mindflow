import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { HomeController } from '../../useHomeController';
import { ProfileAvatar, avatarLabel } from '../ProfileAvatar';
import type { HomeState } from '../../types';
import { HOME_THEMES, HOME_THEME_KEYS } from '../../theme';
import { mixHex } from '../../../editor/theme';
import { RadioCards, Segmented } from '../../../../components/Segmented';
import { HOME_LANDING_KEYS, HOME_LANDING_LABEL } from '../../storage';
import { GoogleIcon } from '../../../auth/GoogleIcon';
import { Modal, MODAL_DIM } from '../../../../components/Modal';
import { googlePrefsOf, useGoogleCalendar } from '../../calendar/useGoogleCalendar';
import { GoogleCalendarSection } from './GoogleCalendarSection';
import { VersionSection } from './VersionSection';
import { Switch } from '../../../../components/Switch';
import {
  askNotifyPermission,
  googleRemindersEnabled,
  notifyPermission,
  remindersEnabled,
  resolveNotifyPermission,
  setGoogleRemindersEnabled,
  setRemindersEnabled,
} from '../../../reminders/reminderPrefs';
import {
  desktopBackgroundState,
  setDesktopBackground,
  setDesktopOpenAtLogin,
  type DesktopBackground,
} from '../../../../platform/desktopBridge';
import { nativeNotificationsAvailable } from '../../../../platform/nativeNotifications';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** 설정 (account settings) modal — opened from the profile popover's "설정" row.
 * Shows the signed-in account and hosts the destructive "회원 탈퇴" entry, kept
 * in its own bottom "계정 관리" section so it never sits next to routine actions. */
export function AccountSettingsModal({ state, controller }: Props) {
  // 연동 구획 — 구글 캘린더는 **설정에서만** 켜고 끈다(일정 화면은 결과만 그린다).
  // 여기서는 그릴 달이 없으므로 `list` 모드다(목록만), 그리고 **모달이 열려 있을 때만**
  // — 홈을 켤 때마다 캘린더 목록을 받아 오지 않는다(`accountSettingsOpen`).
  // 이 행은 **계정 설정 화면**에 있다(요청 — 프로필 설정에서 옮겨 `Google 연동`과 한
  // 구획으로). 그래서 목록 조회도 그 화면이 열려 있을 때만이다.
  // **이번 달**을 본다(첨부 이미지: 카드 부제가 `이번 달 일정 3개`라 말한다) — 그
  // 값을 얻으려면 목록만으로는 안 되고 그 달의 일정이 필요하다. 달은 마운트에 한 번
  // 고정한다(렌더마다 `new Date()`면 effect가 매번 돈다). 조회는 **이 화면이 열려
  // 있을 때만**이고, 일정 화면이 이미 받아 둔 달이면 탭 캐시가 그대로 쓰인다.
  const [{ y, m }] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  // 일정 알림(0038) — **이 기기**의 상태다(OS 알림 권한 자체가 기기·브라우저마다 따로).
  // 그래서 워크스페이스 블롭이 아니라 localStorage이고, 여기서 든 두 값은 화면 표시용
  // 사본이다(정본은 `reminderPrefs`).
  const [remindOn, setRemindOn] = useState(() => remindersEnabled());
  const [googleRemindOn, setGoogleRemindOn] = useState(() => googleRemindersEnabled());
  // 알림 권한. 웹은 동기로 알 수 있지만 **모바일 앱은 OS에 물어야** 안다(3단계) —
  // 그래서 첫 값은 웹 기준이고 마운트 직후 실제 값으로 맞춘다. 그 사이 한 프레임은
  // 아래 note의 마지막 갈래("허용하면 …")로 떨어지는데, 켤 수 있다는 말이라 어느
  // 상태에서든 거짓말이 아니다.
  const [perm, setPerm] = useState(() => notifyPermission());
  // 행을 그릴까: 네이티브 셸은 언제나 그린다(WebView에 웹 `Notification`이 없어
  // `perm`만 보면 통째로 사라진다 — 정작 OS 알림이 가장 값진 곳에서).
  const nativeNotify = nativeNotificationsAvailable();
  useEffect(() => {
    let alive = true;
    void resolveNotifyPermission().then((p) => {
      if (alive) setPerm(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  const googleApi = useGoogleCalendar(y, m, googlePrefsOf(state.google), controller.setGoogleCalendars, state.accountSettingsOpen && state.settingsView === 'calendar' ? 'events' : 'off');
  const visible = state.accountSettingsOpen;
  // 설치형 앱의 상주 상태(4단계). `null`이면 **그 자리를 그리지 않는다** — 브라우저·
  // PWA이거나, 상주 창구가 없는 옛 셸이거나, 되돌아올 길이 없는 환경이다.
  const [bg, setBg] = useState<DesktopBackground | null>(null);
  useEffect(() => {
    let alive = true;
    void desktopBackgroundState().then((s) => {
      if (alive) setBg(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 구글 일정 알림 하위 행의 조건 — 이 훅은 `mode: 'off'`에서도 연결 상태를 안다
  // (블롭의 `enabled`이고 끊겼다고 알려진 바 없는가 — `connected` 주석 참고).
  const googleConnected = googleApi.available && googleApi.connected;
  const initial = avatarLabel(state.userName);
  // 로그인 수단 — `null`은 확인 불가(RPC 미배포·네트워크·데모 초기). 그때는
  // 비밀번호가 **있다고 보고** 변경 흐름을 내준다(잠그지 않는다).
  // 같은 모달의 세 화면(요청) — 첫 화면은 계정 요약 + 두 진입 행 + 색상 테마이고,
  // 손보는 일은 한 겹 안이다: '프로필 설정'(사진·이름) / '계정 설정'(로그인 수단·
  // 기기 로그아웃·탈퇴). 뒤로 가기는 하나뿐이라 두 화면 모두 첫 화면으로 돌아온다.
  const view = state.settingsView;
  const detail = view !== 'main'; // 뒤로 가기·전환 애니메이션은 "첫 화면인가"만 본다
  // 화면 전환 — 좌우로 밀지 않고 **제자리에서 드러난다**(제보: 글자가 가로로
  // 지나가는데 상자는 세로로 줄어 두 움직임이 어긋나 보였다). 그래서 방향을
  // 기억할 이유가 없어졌다 — "바뀌었는가"만 알면 된다. **처음 열 때는 걸지
  // 않는다**(카드 자체가 이미 페이드로 뜬다).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 숨은 파일 입력 — 아바타 버튼과 '프로필 이미지 변경' 행이 같은 것을 쓴다. */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fromH = useRef<number | null>(null);
  const prevDetail = useRef(view);
  const [swapped, setSwapped] = useState(false);
  if (prevDetail.current !== view) {
    prevDetail.current = view;
    // 아직 커밋 전 — 여기서 잰 높이가 '바뀌기 전' 높이다(아래 layout effect가 쓴다).
    const box = bodyRef.current?.getBoundingClientRect();
    fromH.current = box ? Math.round(box.height) : null;
    setSwapped(true);
  }
  const viewClass = `mf-settings-view${swapped ? ' is-swap' : ''}`;
  // 높이 잇기 — 바뀌기 **전** 높이는 렌더 단계에서 잡는다(그때 DOM은 아직 이전
  // 화면이다). 커밋 뒤에 재면 이미 새 화면이라 시작값이 목표값과 같아져 아무 일도
  // 일어나지 않는다(뒤로 갈 때 높이가 툭 튀던 원인). 진행 중 반전도 자연스럽게
  // 이어지도록 콘텐츠 높이가 아니라 **지금 보이는 상자 높이**를 잡는다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const from = fromH.current;
    fromH.current = null;
    if (!el || !visible || from === null) return;
    const next = el.scrollHeight;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (from === next || reduce) return;
    el.style.overflow = 'hidden';
    el.style.height = `${from}px`;
    void el.offsetHeight; // 강제 리플로우 — 시작 값을 확정한 뒤 목표로 보낸다
    el.style.transition = 'height .24s cubic-bezier(.4,0,.2,1)';
    el.style.height = `${next}px`;
    const release = () => {
      el.style.height = '';
      el.style.transition = '';
      el.style.overflow = '';
    };
    const timer = setTimeout(release, 280);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [view, visible]);
  const unknown = state.signin === null;
  const hasPassword = state.signin ? state.signin.hasPassword : true;
  const providers = state.signin?.providers ?? [];
  const googleLinked = providers.includes('google');
  // 해제를 막는 이유는 **둘이고 서로 다르다**(제보: 한 문장에 두 이유가 섞여 어느
  // 쪽인지 알 수 없었다).
  //  ① 서버 규칙 — Supabase는 신원(identity)을 최소 하나 요구한다. Google이 유일한
  //     신원이면 `single_identity_not_deletable`로 거절한다. **비밀번호를 설정해도
  //     신원은 늘지 않는다**(비밀번호는 신원이 아니다) → 그때는 해제 자체가 불가.
  //  ② 우리 규칙 — 다른 신원은 있지만 비밀번호가 없다면 해제해도 들어올 길이 없다
  //     (이 앱에는 메일 코드 로그인이 없다) → 비밀번호를 먼저 설정하게 한다.
  const otherIdentity = providers.some((p) => p !== 'google');
  const unlinkBlock: 'lastIdentity' | 'noPassword' | null = !googleLinked ? null : !otherIdentity ? 'lastIdentity' : !hasPassword ? 'noPassword' : null;

  return (
    <Modal
      open={visible}
      onClose={controller.closeAccountSettings}
      label="설정"
      // 이 모달은 프로필 팝오버의 '설정' 행으로 열리고, 그 팝오버는 모달이 열리면
      // 닫힌다 — 돌아갈 자리가 사라지므로 팝오버의 트리거(계정 메뉴)로 되돌린다.
      restoreFocusSelector="[data-account-trigger]"
      dim={{ ...MODAL_DIM, zIndex: 150 }}
      // 카드가 곧 스크롤러다(내용이 화면보다 길 때) — 공용 얇은 스크롤바를 입혀
      // 썸이 22px 라운드 안쪽에 머문다(제보: 스크롤이 팝업을 벗어나 보였다).
      cardClass="lnb-scroll"
      card={{ width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(var(--mf-app-h) - 32px)', overflowY: 'auto', background: 'var(--mf-card)', borderRadius: 22, boxShadow: '0 32px 70px -28px rgba(46,42,38,.5)', animation: 'mf-fade .2s ease' }}
    >
      <>
        {/* header — 제목은 언제나 '설정'이고(요청), 상세 화면에서는 뒤로 가기가 붙는다.
            지금 어느 화면인지는 본문 첫 줄의 부 제목('계정 설정')이 말한다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px', borderBottom: '1px solid var(--mf-hairline)' }}>
          {detail && (
            <button
              className="btn mf-ctl"
              aria-label="뒤로"
              onClick={controller.closeSettingsDetail}
              style={{ width: 32, height: 32, border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, marginLeft: -4 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
          )}
          {/* 제목은 **지금 보고 있는 화면**을 말한다(첨부 이미지: `계정 설정  로그인과
              연동, 계정 관리`) — 예전에는 헤더가 늘 '설정'이고 본문 첫 줄이 화면
              이름을 말했는데, 그러면 같은 말이 두 번 나온다. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            <div data-settings-title style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', flexShrink: 0 }}>
              {view === 'account' ? '계정 설정' : view === 'profile' ? '프로필 설정' : view === 'calendar' ? 'Google 캘린더 연동' : view === 'version' ? '버전 확인' : '설정'}
            </div>
            {detail && (
              <div data-settings-subtitle style={{ fontSize: 12.5, color: 'var(--mf-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {view === 'account' ? '로그인 수단과 계정 관리' : view === 'calendar' ? '보여 줄 캘린더와 공휴일' : view === 'version' ? '현재 버전과 업데이트' : '사진과 표시 이름'}
              </div>
            )}
          </div>
          <button
            className="btn mf-ctl"
            aria-label="닫기"
            onClick={controller.closeAccountSettings}
            style={{ marginLeft: 'auto', width: 36, height: 36, border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 두 화면의 높이가 크게 달라서(첫 화면엔 테마 격자까지) 전환 때
            카드가 툭 줄었다 늘었다 한다. 그 높이도 부드럽게 잇는다(요청):
            바뀌기 전 높이로 고정 → 새 높이로 트랜지션 → 끝나면 auto로 되돌린다
            (`auto`는 전이되지 않으므로 실제 값을 재서 잇는 수밖에 없고, 끝나고
            풀어 줘야 안쪽에서 오류 문구가 늘어나는 것 같은 변화가 다시 살아난다). */}
        <div ref={bodyRef} data-settings-body style={{ padding: 24 }}>
          {view === 'account' ? (
            <div key="detail" className={viewClass}>
          {/* 화면 이름은 헤더가 말한다(첨부 이미지) — 여기서는 구획 라벨만 쓴다.
              앞 구획은 이 계정에 들어오는 **문 목록**이다(한 계정에 수단이 여럿
              붙을 수 있고, 같은 이메일의 Google 신원은 Supabase가 자동 연결한다 — §16.
              비밀번호 유무는 신원 목록으로 알 수 없어 서버가 따로 알려 준다 — 0029). */}
          <div style={{ marginBottom: 9 }}>
            <SectionLabel>로그인</SectionLabel>
          </div>
          <SettingsGroup>
            {/* 이메일·비밀번호 — 비밀번호가 걸려 있으면 '변경'(현재 비밀번호로 본인
                확인), 없으면 '설정'(계정 이메일로 코드를 받아 확인). 확인 불가면
                **변경 쪽**으로 둔다: 진짜 게이트는 확인 단계이므로 모르는 채로 항목을
                잠그는 쪽이 더 나쁘다. */}
            <SettingsRow
              first
              attrs={{ 'data-change-pw-row': '' }}
              onActivate={hasPassword ? controller.openChangePassword : controller.openSetPassword}
              icon={
                <>
                  <rect x="3.5" y="10.5" width="17" height="10.5" rx="2.5" />
                  <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
                </>
              }
              title={hasPassword ? '비밀번호 변경' : '비밀번호 설정'}
              sub={unknown ? '로그인 수단을 확인할 수 없어요 — 현재 비밀번호로 바꿀 수 있어요' : hasPassword ? '현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요' : '계정 이메일로 인증번호를 받아 비밀번호를 설정해요'}
            />
            {/* Google 로그인 — 연결/해제. 해제가 막히는 두 이유(`unlinkBlock`)를 부제가
                **각각** 말한다 — 무엇을 해야 풀리는지가 이유마다 다르다. */}
            <SettingsRow
              attrs={{ 'data-google-link-row': '' }}
              icon={<></>}
              iconNode={<GoogleIcon />}
              // 브랜드 마크는 흰 면 위에 선다(첨부 이미지) — 강조색 틴트 위에 얹으면
              // 구글 로고 색이 그 틴트를 입은 것처럼 보인다.
              chipStyle={{ background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)' }}
              title="Google 로그인"
              sub={
                unknown
                  ? '연결 상태를 확인할 수 없어요'
                  : !googleLinked
                    ? '연결하면 Google 계정으로도 로그인할 수 있어요'
                    : unlinkBlock === 'lastIdentity'
                      ? 'Google이 이 계정의 유일한 로그인 수단이라 해제할 수 없어요'
                      : unlinkBlock === 'noPassword'
                        ? '비밀번호를 먼저 설정해 주세요'
                        : 'Google 계정으로도 로그인할 수 있어요'
              }
              right={
                <button
                  type="button"
                  className="btn mf-ctl"
                  data-google-link-action
                  disabled={unknown || state.signinBusy || unlinkBlock !== null}
                  onClick={googleLinked ? controller.askUnlinkGoogle : controller.linkGoogleAccount}
                  style={{
                    flexShrink: 0,
                    height: 34,
                    padding: '0 15px',
                    border: 0,
                    borderRadius: 999,
                    // 구글과 잇는 버튼이라 **구글 파랑 계열**(첨부 이미지) — 해제는
                    // 되돌리는 일이라 중립 알약이다(색으로 두 동작을 갈라 둔다).
                    background: googleLinked ? 'var(--mf-panel2)' : 'var(--mf-info-soft)',
                    color: googleLinked ? 'var(--mf-text)' : 'var(--mf-info)',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: unknown || state.signinBusy || unlinkBlock !== null ? 'default' : 'pointer',
                    opacity: unknown || state.signinBusy || unlinkBlock !== null ? 0.5 : 1,
                  }}
                >
                  {googleLinked ? '연결 해제' : '연결'}
                </button>
              }
            />
          </SettingsGroup>
          {!!state.signinError && (
            <div data-signin-error style={{ fontSize: 12.5, color: 'var(--mf-danger)', padding: '8px 4px 0' }}>
              {state.signinError}
            </div>
          )}

          {/* 캘린더 연동은 **한 겹 더** 들어간다(요청) — 로그인 수단과 하는 일이 다르고
              (위는 "이 계정에 들어오는 문", 저기는 "무엇을 함께 보여 줄까"), 목록·공휴일·
              캘린더 추가가 한 화면에 다 들어가면 계정 설정이 그것으로 뒤덮인다.
              배포에 클라이언트 ID가 없으면 **행 자체가 없다**(눌러도 빈 화면이 열린다). */}
          {googleApi.available && (
            <>
              <div style={{ margin: '18px 0 9px' }}>
                <SectionLabel>캘린더 연동</SectionLabel>
              </div>
              <SettingsGroup>
                <SettingsRow
                  first
                  attrs={{ 'data-calendar-detail-row': '' }}
                  onActivate={controller.openCalendarDetail}
                  icon={
                    <>
                      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
                      <path d="M8 3v4M16 3v4M3.5 10h17" />
                    </>
                  }
                  title="Google 캘린더 연동"
                  sub={calendarSub(googleApi)}
                />
              </SettingsGroup>
            </>
          )}

          <div style={{ margin: '18px 0 9px' }}>
            <SectionLabel>계정 관리</SectionLabel>
          </div>
          <SettingsGroup>
            {/* 모든 기기에서 로그아웃(세션 정책 ①) — 이 앱의 세션은 기기 수 제한 없이
                오래 유지되므로(backend.md §15), 기기를 잃거나 공용 PC에 남겨 뒀을 때
                **회수할 수단**이 필요하다. 되돌릴 수 있는 동작이라 제목은 잉크색이고
                위험 신호(빨강)는 발치의 회원 탈퇴만 쓴다. */}
            <SettingsRow
              first
              attrs={{ 'data-logout-all-row': '' }}
              onActivate={controller.logoutAllDevices}
              icon={
                <>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </>
              }
              title="모든 기기에서 로그아웃"
              sub="다른 기기·브라우저의 로그인도 모두 해제돼요"
            />
          </SettingsGroup>
          {/* 회원 탈퇴는 **발치 링크**로 내려갔다(첨부 이미지) — 행 목록에 두면 routine
              동작들과 나란히 서고, 파괴적인 일은 눈에 덜 띄는 자리가 맞다. 실제 경고와
              타이핑 게이트는 확인 팝업이 맡는다. */}
          <SettingsFooter onDelete={controller.askDeleteAccount} />
            </div>
          ) : view === 'calendar' ? (
            <div key="calendar" className={viewClass}>
              {/* 화면 이름은 헤더가 말한다 — 여기서는 카드들만 그린다.
                  보여 줄 캘린더·캘린더 추가·공휴일 국가가 전부 이 안에 있다. */}
              <GoogleCalendarSection api={googleApi} focusAdd={state.calendarAddFocus} onNotify={controller.showCalendarToast} />
            </div>
          ) : view === 'version' ? (
            <div key="version" className={viewClass}>
              {/* 화면 이름은 헤더가 말한다 — 여기서는 현재 버전과 업데이트 행만. */}
              <VersionSection />
            </div>
          ) : view === 'profile' ? (
            <div key="profile" className={viewClass}>
          {/* 이 화면의 부 제목 — 헤더는 '설정'을 지킨다(계정 설정과 같은 문법). */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em', marginBottom: 10 }}>프로필 설정</div>
          {/* 아바타를 누르면 곧바로 파일을 고른다 — 아래 행과 같은 입력을 쓴다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: 'var(--mf-accent-soft)', marginBottom: 14 }}>
            <button
              type="button"
              data-avatar-pick
              aria-label="프로필 이미지 변경"
              title="프로필 이미지 변경"
              disabled={state.avatarBusy}
              onClick={() => fileRef.current?.click()}
              style={{ position: 'relative', border: 0, background: 'transparent', padding: 0, cursor: state.avatarBusy ? 'default' : 'pointer', lineHeight: 0, borderRadius: 16, flexShrink: 0 }}
            >
              <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={56} radius={16} fontSize={17} />
              {/* 카메라 배지 — 아바타 자체가 버튼이라는 것을 알려 준다(관례). */}
              <span
                aria-hidden="true"
                style={{ position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 999, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(46,42,38,.18)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8.5A2 2 0 0 1 6 6.5h1.6l1-1.6h4.8l1 1.6H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                  <circle cx="12" cy="12.6" r="3" />
                </svg>
              </span>
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 13, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* 파일 고르기는 숨은 input 하나로 — 아바타 버튼과 아래 행이 같은 것을 쓴다. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            data-avatar-input
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = ''; // 같은 파일을 다시 골라도 change가 오게
              void controller.changeAvatar(f);
            }}
          />

          <div
            className="menu-row"
            data-avatar-row
            role="button"
            tabIndex={0}
            aria-disabled={state.avatarBusy}
            onClick={() => !state.avatarBusy && fileRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !state.avatarBusy) {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: state.avatarBusy ? 'default' : 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="8.5" cy="10" r="1.4" />
              <path d="m5 17 5-4.5 4 3.5 3-2.5 3 3" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>프로필 이미지 변경</div>
              <div data-avatar-hint style={{ fontSize: 12.5, color: state.avatarError ? 'var(--mf-danger)' : 'var(--mf-muted)', marginTop: 2 }}>
                {state.avatarBusy ? '올리는 중이에요…' : (state.avatarError ?? '정사각형으로 잘려 함께 쓰는 화면에도 보여요')}
              </div>
            </div>
            {/* 지우기는 사진이 있을 때만 — 없으면 눌러도 아무 일이 없다. */}
            {state.userAvatar && !state.avatarBusy && (
              <button
                type="button"
                data-avatar-remove
                onClick={(e) => {
                  e.stopPropagation();
                  void controller.removeAvatar();
                }}
                style={{ marginLeft: 'auto', flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                기본으로
              </button>
            )}
          </div>

          <div
            className="menu-row"
            data-profile-name-row
            role="button"
            tabIndex={0}
            onClick={controller.openProfileNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.openProfileNameEdit();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, cursor: 'pointer', marginBottom: 10 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            <div style={{ minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>프로필명 변경</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
            </div>
          ) : (
            <div key="main" className={viewClass}>
          {/* 계정 요약 — 여기서는 **보여 주기만** 한다. 사진·이름을 손보는 일은
              한 겹 안의 '프로필 설정'으로 모았다(요청) — 같은 동작의 진입점이
              한 화면에 둘 있으면 어느 쪽이 진짜인지 흐려진다. 구획 라벨은 두지
              않는다(첨부 이미지: 카드가 곧 첫 줄이다). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: 'var(--mf-accent-soft)' }}>
            <ProfileAvatar initial={initial} avatarUrl={state.userAvatar} size={56} radius={16} fontSize={17} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 13, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{state.userEmail}</div>}
            </div>
            {/* 플랜 배지(첨부 이미지) — 유료 플랜이 없으니 **모든 계정이 무료 플랜**이다.
                사실을 적은 정적 배지이고, 유료가 생기면 이 자리가 그것을 말한다. */}
            <span
              data-plan-badge
              style={{ flexShrink: 0, height: 30, padding: '0 14px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid var(--mf-accent-mute)', background: 'var(--mf-card)', color: 'var(--mf-accent-strong)', fontSize: 12.5, fontWeight: 700 }}
            >
              무료 플랜
            </span>
          </div>

          {/* 손보는 일은 두 줄 뒤에 — 첫 화면은 "무엇이 있는지"만 말한다. 이 묶음에는
              구획 라벨을 두지 않는다: 모달 제목이 이미 '설정'이라 한 번 더 쓰면
              '설정 > 설정'으로 읽힌다. 행 이름이 스스로를 말한다. */}
          <SettingsGroup style={{ marginTop: 14 }}>
            <SettingsRow
              attrs={{ 'data-profile-detail-row': '' }}
              onActivate={controller.openProfileDetail}
              icon={
                <>
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <circle cx="8.5" cy="10" r="1.4" />
                  <path d="m5 17 5-4.5 4 3.5 3-2.5 3 3" />
                </>
              }
              title="프로필 설정"
              /* 커서 색은 아직 고를 수 없다 — 여기 적으면 지키지 못할 약속이 된다(사용자 결정). */
              sub="사진과 표시 이름을 바꿔요"
            />
            <SettingsRow
              attrs={{ 'data-account-detail-row': '' }}
              onActivate={controller.openAccountDetail}
              icon={
                <>
                  <circle cx="12" cy="8" r="3.4" />
                  <path d="M5.5 20.5a6.5 6.5 0 0 1 13 0" />
                </>
              }
              title="계정 설정"
              sub="비밀번호와 연동, 탈퇴"
            />
            {/* 버전 확인(요청) — '계정 설정' **아래**다. 여기 두는 이유: 자동으로
                갈아끼워지는 판을 사용자가 직접 확인하고 앞당길 수 있어야 한다.
                계정에 딸린 일은 아니지만 앱 자신에 관한 일이라 같은 묶음이 맞다. */}
            <SettingsRow
              attrs={{ 'data-version-detail-row': '' }}
              onActivate={controller.openVersionDetail}
              icon={
                <>
                  <path d="M12 3.5v9" />
                  <path d="m8.5 9 3.5 3.5L15.5 9" />
                  <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
                </>
              }
              title="버전 확인"
              sub="현재 버전을 보고 새 버전으로 업데이트해요"
            />
          </SettingsGroup>

          {/* 시작 화면(요청) — 홈에 들어왔을 때 **어느 화면부터 볼까**. 여기 두는 이유:
              색상 테마와 같은 per-user 취향이고(둘 다 워크스페이스 블롭이라 기기 간에
              따라온다) 색보다 **동작**이라 그 위에 선다. LNB에 "시작 화면으로 지정"을
              따로 두지 않는다 — 같은 설정의 진입점을 둘로 두지 않는다(이 프로젝트 규칙).
              **탭이 기억한 화면은 이것보다 우선한다**: 에디터에서 돌아오면 보던 자리로
              돌아간다. 그래서 이 값은 "새로 시작할 때"만 쓰인다.
              `대시보드`를 골랐는데 대시보드가 하나도 없으면 스페이스 그리드로 물러선다
              (없는 화면을 열지 않는다 — 착지 규칙이 그대로 지킨다). */}
          <SettingsGroup style={{ marginTop: 14 }} attrs={{ 'data-landing-group': '' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '14px 15px' }}>
              <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>시작 화면</div>
              </div>
              {/* 공휴일 국가 세그먼트와 **같은 문법**이다(가라앉은 트랙 위에서 고른 칸만
                  카드 면 + 진한 강조 잉크) — 한 팝업 안에서 같은 종류의 컨트롤이
                  달라 보이지 않게. */}
              <Segmented
                value={state.homeLanding}
                onChange={controller.setHomeLanding}
                label="시작 화면"
                trackAttrs={{ 'data-landing-seg': '' }}
                track={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', boxSizing: 'border-box', flexShrink: 0 }}
                items={HOME_LANDING_KEYS.map((k) => ({
                  value: k,
                  label: HOME_LANDING_LABEL[k],
                  style: (on: boolean) => ({
                    minWidth: 54,
                    height: 30,
                    border: 0,
                    borderRadius: 8,
                    padding: '0 10px',
                    background: on ? 'var(--mf-card)' : 'transparent',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
                    boxShadow: on ? '0 2px 5px -3px rgba(46,42,38,.35)' : 'none',
                    cursor: 'pointer',
                  }),
                }))}
              />
            </div>
          </SettingsGroup>

          {/* 일정 알림(요청: 앱에서 일정 알림을 OS 알림으로) — **이 기기**의 설정이라
              워크스페이스 블롭이 아니라 localStorage에 산다(OS 알림 권한 자체가 기기·
              브라우저마다 따로다 — "노트북에서는 받고 회사 PC에서는 안 받는다"가
              자연스럽다). 시작 화면 아래, 색상 테마 위: 둘 다 동작이고 색보다 먼저다.

              **기본이 켜짐**인 이유: 이 스위치는 알림을 만들어 내지 않는다. 일정마다의
              알림은 기본이 `없음`이라, 사용자가 직접 고르지 않으면 아무것도 뜨지 않는다.
              여기서 꺼짐으로 시작하면 방금 고른 알림이 이유 없이 안 온다.

              `Notification`이 아예 없는 환경에서는 **행 자체를 그리지 않는다**(눌러도
              아무 일이 없는 자리를 두지 않는다). */}
          {(nativeNotify || perm !== 'unsupported') && (
            <SettingsGroup style={{ marginTop: 14 }} attrs={{ 'data-remind-group': '' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '14px 15px' }}>
                <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>일정 알림</div>
                  <div data-remind-note style={{ marginTop: 3, fontSize: 12.5, color: 'var(--mf-muted)' }}>
                    {!remindOn
                      ? '켜면 일정에 걸어 둔 알림이 이 기기에 떠요'
                      : perm === 'granted'
                        ? '알림 시각에 앱 알림과 OS 알림이 함께 떠요'
                        : perm === 'denied'
                          ? '브라우저가 알림을 막아 뒀어요 — 앱 안에서만 떠요'
                          : 'OS 알림을 허용하면 다른 창을 보고 있어도 떠요'}
                  </div>
                </div>
                {/* 허용 버튼은 **물어볼 수 있을 때만** 있다(`default`) — 이미 허용했거나
                    차단한 뒤에는 브라우저가 다시 묻지 않으므로 죽은 버튼이 된다.
                    권한 요청은 사용자 제스처에서만 되는데, 이 클릭이 그 제스처다. */}
                {remindOn && perm === 'default' && (
                  <button
                    type="button"
                    data-remind-allow
                    className="mf-ctl"
                    onClick={() => void askNotifyPermission().then(setPerm)}
                    style={{ flexShrink: 0, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    OS 알림 허용
                  </button>
                )}
                <Switch
                  checked={remindOn}
                  onCheckedChange={() => {
                    const next = !remindOn;
                    setRemindersEnabled(next);
                    setRemindOn(next);
                    // 켜는 그 클릭이 곧 제스처다 — 여기서 물으면 사용자는 자기가 누른
                    // 결과로 창을 본다(저절로 뜨는 권한 창을 만들지 않는다).
                    if (next && perm !== 'granted') void askNotifyPermission().then(setPerm);
                  }}
                  label="일정 알림"
                  accent="var(--mf-accent)"
                  track="var(--mf-scroll)"
                  knob="var(--mf-card)"
                />
              </div>
              {/* 구글 일정 알림(2단계) — **기본이 꺼짐**이다: 그 알림은 구글이 이미
                  보내므로(구글 캘린더 앱·브라우저) 켜져 있으면 같은 회의에 알림이 둘
                  뜨는 것이 기본 동작이 된다. "구글 알림을 안 받는 기기에서 그리오만
                  켜 둔다"는 사람이 직접 켜는 값이라 하위 행으로 둔다.

                  **연동했을 때만** 그린다(켤 것이 없으면 자리도 없다). 위 스위치가
                  꺼져 있으면 감춘다 — 꺼진 부모 아래의 하위 설정은 눌러도 아무 일이
                  없으므로 그 자리를 두지 않는다. */}
              {remindOn && googleConnected && (
                <div
                  data-remind-google-row
                  style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '13px 15px', borderTop: '1px solid var(--mf-border-soft)' }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>구글 일정도 알림</div>
                    <div data-remind-google-note style={{ marginTop: 3, fontSize: 12.5, color: 'var(--mf-muted)' }}>
                      {googleRemindOn ? '구글이 보내는 알림과 함께 떠요' : '구글 캘린더가 이미 보내는 알림 말고 여기서도 받을 때 켜요'}
                    </div>
                  </div>
                  <Switch
                    checked={googleRemindOn}
                    onCheckedChange={() => {
                      const next = !googleRemindOn;
                      setGoogleRemindersEnabled(next);
                      setGoogleRemindOn(next);
                      if (next && perm !== 'granted') void askNotifyPermission().then(setPerm);
                    }}
                    label="구글 일정도 알림"
                    accent="var(--mf-accent)"
                    track="var(--mf-scroll)"
                    knob="var(--mf-card)"
                  />
                </div>
              )}
              {/* 설치형 앱: 창을 닫아도 알림(4단계) — 알림을 띄우는 것은 창 안의
                  스케줄러라, 창이 파괴되면 그 순간 알림도 멎는다. 그래서 이 스위치는
                  "앱을 트레이에 남긴다"가 아니라 **"닫아도 알림을 받는다"**로 말한다
                  (사용자가 얻는 것이 그것이다).

                  `bg`가 없으면 그리지 않는다: 브라우저·PWA·옛 설치본·되돌아올 길이
                  없는 환경. 위 스위치가 꺼져 있으면 감춘다(꺼진 부모 아래의 하위
                  설정은 눌러도 아무 일이 없다 — 구글 행과 같은 규칙). */}
              {remindOn && bg?.supported && (
                <div
                  data-remind-bg-row
                  style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '13px 15px', borderTop: '1px solid var(--mf-border-soft)' }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>앱을 닫아도 알림 받기</div>
                    <div data-remind-bg-note style={{ marginTop: 3, fontSize: 12.5, color: 'var(--mf-muted)' }}>
                      {bg.enabled
                        ? '창을 닫아도 앱이 남아 알림을 보내요 — 완전히 끄면 그때는 멎어요'
                        : '창을 닫으면 앱이 종료돼 알림도 함께 멎어요'}
                    </div>
                  </div>
                  <Switch
                    checked={bg.enabled}
                    onCheckedChange={() => {
                      void setDesktopBackground(!bg.enabled).then((next) => {
                        // 셸이 **바뀐 뒤의 상태**를 돌려준다 — 사본을 우리가 만들지
                        // 않으므로 화면과 실제가 갈릴 수 없다.
                        if (next) setBg(next);
                      });
                    }}
                    label="앱을 닫아도 알림 받기"
                    accent="var(--mf-accent)"
                    track="var(--mf-scroll)"
                    knob="var(--mf-card)"
                  />
                </div>
              )}
              {/* 로그인할 때 자동 실행 — 상주와 **나란한** 설정이다(하위가 아니다):
                  상주가 꺼져 있어도 "컴퓨터를 켜면 앱이 열린다"는 그 자체로 뜻이
                  있으므로, 끄는 길을 감추지 않고 문구만 상황에 맞춘다. */}
              {remindOn && bg?.supported && bg.loginSupported && (
                <div
                  data-remind-login-row
                  style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 13, padding: '13px 15px', borderTop: '1px solid var(--mf-border-soft)' }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>로그인할 때 자동 실행</div>
                    <div data-remind-login-note style={{ marginTop: 3, fontSize: 12.5, color: 'var(--mf-muted)' }}>
                      {bg.enabled
                        ? '컴퓨터를 켜면 창 없이 시작해 알림을 받아요'
                        : '컴퓨터를 켜면 앱이 열려요'}
                    </div>
                  </div>
                  <Switch
                    checked={bg.openAtLogin}
                    onCheckedChange={() => {
                      void setDesktopOpenAtLogin(!bg.openAtLogin).then((next) => {
                        // OS에서 **다시 읽은** 값이다 — 받아들이지 않는 환경(MSIX 등)
                        // 에서는 스위치가 제자리로 돌아가 사실을 말한다.
                        if (next) setBg(next);
                      });
                    }}
                    label="로그인할 때 자동 실행"
                    accent="var(--mf-accent)"
                    track="var(--mf-scroll)"
                    knob="var(--mf-card)"
                  />
                </div>
              )}
            </SettingsGroup>
          )}

          {/* 색상 테마 — LNB 최하단에 있다가 사용자 요청으로 이리 왔다(설정에 모으는 게
              자연스럽다). 적용 버튼 없이 **누르는 즉시** 뒤 화면까지 색이 바뀐다 —
              모달이 열린 채로 고르므로 고르는 것이 곧 미리보기다. 라벨 옆에 **지금
              고른 이름**을 적는다(첨부 이미지: `색상 테마  코랄`). */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 18, marginBottom: 10 }}>
            <SectionLabel>색상 테마</SectionLabel>
            <span data-theme-current style={{ fontSize: 12, color: 'var(--mf-muted)' }}>{HOME_THEMES[state.theme].label}</span>
          </div>
          {/* 카드 격자로 고르는 라디오 — 손으로 짠 `role="radio"`까지는 있었지만
              **화살표 이동이 없었다**(Tab이 칸 여섯 개마다 멈췄다). `RadioCards`
              (Radix RadioGroup)가 로빙 tabindex와 ←/→/↑/↓를 준다. */}
          <RadioCards
            value={state.theme}
            onChange={controller.setTheme}
            label="색상 테마 선택"
            grid={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
            items={HOME_THEME_KEYS.map((key) => {
              const t = HOME_THEMES[key];
              const on = state.theme === key;
              return {
                value: key,
                label: t.label,
                ariaLabel: `${t.label} 테마`,
                style: (on: boolean) => ({
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 9,
                  padding: 11,
                  borderRadius: 14,
                  // 선택된 칸만 강조색 테두리 + 옅은 강조 면(첨부 이미지의 코랄 칸).
                  border: `1.5px solid ${on ? t.accent : 'var(--mf-border)'}`,
                  background: on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
                  color: 'var(--mf-text)',
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                }),
                children: (
                  <>
                    {/*
                      미리보기(첨부 이미지) — 그 테마의 **면 위에 강조색 막대**를 그린
                      알약이다. 이름만으로는 "모노"·"다크"가 얼마나 다른지 알 수 없고,
                      면·강조색·경계선 셋이 한 그림에 함께 보여야 테마의 인상이 전달된다.
                    */}
                    <span
                      data-theme-preview
                      aria-hidden="true"
                      style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 10px', borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, boxSizing: 'border-box' }}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accent, flexShrink: 0 }} />
                      <span style={{ flex: 1, height: 5, borderRadius: 999, background: mixHex(t.card, t.accent, 0.55) }} />
                      <span style={{ width: 20, height: 5, borderRadius: 999, background: t.border, flexShrink: 0 }} />
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                      {/* 고른 칸에만 체크 — 테두리·면과 함께 세 겹으로 말한다. */}
                      {on && (
                        <svg data-theme-check width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </>
                ),
              };
            })}
          />
          <SettingsFooter />
            </div>
          )}
        </div>
      </>
    </Modal>
  );
}

// ── 설정 화면의 작은 부품 ────────────────────────────────────────────────────
//
// 값을 행마다 다시 적으면 같은 화면 안에서 행 높이·아이콘 칩·부제 색이 갈린다
// (이 프로젝트에서 여러 번 겪은 드리프트) — 그래서 한곳에 둔다.

/** 구획 라벨(`로그인`·`캘린더 연동`·`계정 관리`·`색상 테마`). */
/**
 * 계정 설정의 진입 행 부제 — **지금 상태**를 말한다(무엇을 하는 곳인지는 제목이 말한다).
 *
 * 판단은 **왕복 없이 되는 것으로만** 한다: 켜 뒀는가(`enabled`)와 몇 개를 고랐는가
 * (`pickedIds`)는 둘 다 워크스페이스 블롭에서 온다. `connected`를 보면 안 된다 —
 * 그 값은 캘린더 목록이 도착해야 참이 되고 목록 조회는 **캘린더 화면에서만** 도는데,
 * 그러면 연동해 둔 사람에게 "연결하면 …"이라 말하는 거짓말이 된다.
 */
function calendarSub(api: { enabled: boolean; needsReauth: boolean; pickedIds: string[] }): string {
  // 연결 전에는 **아무 말도 하지 않는다**(요청) — 늘 같은 안내를 걸어 두면 정작
  // 알려야 할 때(권한 만료 같은 상황) 눈에 띌 자리가 없다.
  if (api.enabled && api.needsReauth) return '구글 권한을 다시 허용해야 이어져요';
  if (!api.enabled) return '';
  return `${api.pickedIds.length}개 캘린더를 함께 보고 있어요`;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span data-section-label style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-faint)', letterSpacing: '.02em' }}>{children}</span>;
}

/** 행 묶음 — 테두리 있는 한 카드 안에 행들이 옅은 선으로 갈린다(첨부 이미지). */
export function SettingsGroup({ children, style, attrs }: { children: ReactNode; style?: CSSProperties; attrs?: Record<string, string> }) {
  return (
    <div
      data-settings-group
      {...attrs}
      style={{ border: '1px solid var(--mf-border-soft)', borderRadius: 16, overflow: 'hidden', background: 'var(--mf-card)', ...style }}
    >
      {children}
    </div>
  );
}

/** 묶음 안의 행 사이 선 — 첫 행 위에는 두지 않는다. */
const rowDivider: CSSProperties = { borderTop: '1px solid var(--mf-hairline)' };

/**
 * 설정 행 — [아이콘 칩][제목/부제][오른쪽]. 오른쪽은 기본이 셰브론이고(한 겹 안으로
 * 들어간다는 뜻), `right`를 주면 그 자리를 버튼·세그먼트가 쓴다.
 *
 * `onActivate`가 있으면 행 전체가 눌리는 대상이다(키보드 Enter/Space 포함).
 */
export function SettingsRow({
  icon,
  iconNode,
  chipStyle,
  title,
  sub,
  right,
  onActivate,
  disabled,
  first,
  attrs,
  iconColor,
}: {
  /** 칩 안에 그릴 선(stroke) 아이콘의 path들. `iconNode`를 주면 무시된다. */
  icon: ReactNode;
  /** 칩 안을 통째로 대신한다 — 브랜드 마크(구글 G)처럼 우리 선 언어가 아닌 것. */
  iconNode?: ReactNode;
  chipStyle?: CSSProperties;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onActivate?: () => void;
  disabled?: boolean;
  first?: boolean;
  attrs?: Record<string, string>;
  iconColor?: string;
}) {
  const press = onActivate && !disabled ? onActivate : undefined;
  return (
    <div
      data-settings-row
      {...attrs}
      className={press ? 'menu-row' : undefined}
      {...(press ? { role: 'button', tabIndex: 0 } : {})}
      onClick={press}
      onKeyDown={
        press
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                press();
              }
            }
          : undefined
      }
      style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 15px', cursor: press ? 'pointer' : 'default', ...(first ? {} : rowDivider) }}
    >
      <span
        aria-hidden="true"
        style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 12, background: 'var(--mf-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...chipStyle }}
      >
        {iconNode ?? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor ?? 'var(--mf-subtext)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        )}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--mf-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      {right ?? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      )}
    </div>
  );
}

/**
 * 발치의 법적 링크 — 로그인한 사용자에게 유일한 진입점이다(다른 하나는 로그인
 * 페이지 발치). 새 탭이라 모달·홈 상태를 잃지 않는다. 계정 설정 화면에서는
 * **회원 탈퇴**가 여기 함께 선다(첨부 이미지) — 파괴적인 일이라 행 목록이 아니라
 * 발치에 두고, 실제 경고는 확인 팝업이 맡는다.
 */
export function SettingsFooter({ onDelete }: { onDelete?: () => void }) {
  return (
    <div data-settings-footer style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--mf-hairline)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
      <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--mf-faint)' }}>
        개인정보처리방침
      </a>
      <FooterDot />
      <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--mf-faint)' }}>
        이용약관
      </a>
      {onDelete && (
        <>
          <FooterDot />
          <button type="button" data-delete-account-link onClick={onDelete} style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--mf-faint)', cursor: 'pointer' }}>
            회원 탈퇴
          </button>
        </>
      )}
    </div>
  );
}

function FooterDot() {
  return <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--mf-border)' }} />;
}
