// 구글 캘린더 **연동 진입 아이콘**(요청) — 일정 화면 머리와 캘린더 위젯 머리에 함께 쓴다.
//
// 규칙 셋:
//  ① 배포에 클라이언트 ID가 없으면 **그리지 않는다**(눌러도 아무 일 없는 버튼을
//     두지 않는다 — 이 프로젝트의 정직한 어포던스 규칙).
//  ② **연동하지 않았을 때만** 뜬다. 켜고 나면 할 일이 끝났으므로 사라지고, 세부
//     조정(어느 캘린더를 볼지)은 설정의 `연동` 구획이 맡는다.
//  ③ 누르면 곧바로 동의 창이다 — 사용자가 **직접 누른** 것이라 브라우저가 막지
//     않고, 켜는 순간 기본 캘린더 + 공휴일이 잡혀 바로 화면에 뜬다.

import type { GoogleCalendarApi } from './useGoogleCalendar';

export function GoogleConnectButton({ api, size = 34 }: { api: GoogleCalendarApi; size?: number }) {
  if (!api.available || api.enabled) return null;
  return (
    <button
      type="button"
      data-google-connect-cal
      className="mf-ctl"
      title="Google 캘린더 연동"
      aria-label="Google 캘린더 연동"
      onClick={(e) => {
        e.stopPropagation();
        void api.connect();
      }}
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        padding: 0,
        borderRadius: size >= 30 ? 10 : 8,
        border: '1px solid var(--mf-border)',
        background: 'var(--mf-card)',
        color: 'var(--mf-muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <svg width={size >= 30 ? 16 : 13} height={size >= 30 ? 16 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </svg>
      {/* 연동되지 않았다는 표식 — 달력 위의 작은 `+`. 아이콘만으로는 "달력 보기"로
          읽힐 수 있어 **더할 수 있다**는 것을 한 글자로 말한다. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: size >= 30 ? 4 : 2,
          bottom: size >= 30 ? 4 : 2,
          width: 11,
          height: 11,
          borderRadius: 999,
          background: 'var(--mf-accent)',
          color: 'var(--mf-accent-ink)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 0 1.5px var(--mf-card)',
        }}
      >
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </button>
  );
}
