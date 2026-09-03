import type { GoogleCalendarApi } from './useGoogleCalendar';
import { GoogleIcon } from '../../auth/GoogleIcon';

/**
 * 구글 캘린더 연동 진입 버튼 — 일정 화면 머리와 대시보드 캘린더 위젯이 쓴다.
 *
 * **아직 켜지 않았을 때만** 뜬다(이미 켜져 있는 것을 켜라고 권하는 버튼은 소음이고,
 * 끄는 일은 설정의 연동 구획이 맡는다).
 *
 * 두 가지가 제보로 바뀌었다:
 *  ① **무엇인지 한눈에** — 예전에는 우리 선 아이콘(달력)이라 "달력 보기"로도 읽혔다.
 *     이제 **구글 G 마크 + `Google 캘린더 연동`** 글자다(폭이 좁은 위젯에서는 G만,
 *     툴팁·접근 이름이 같은 말을 한다).
 *  ② **누르면 설정으로** — 곧바로 구글 동의 창을 띄우지 않고, 연동을 켜고 끌 수 있는
 *     **설정 › 계정 설정 › 연동**을 연다. 팝업이 예고 없이 뜨는 것보다 어디서 켜는지
 *     알게 되는 편이 낫고, 그 화면에서 어떤 캘린더를 보여 줄지도 함께 고른다.
 */
export function GoogleConnectButton({ api, onOpen, compact = false }: { api: GoogleCalendarApi; onOpen: () => void; compact?: boolean }) {
  if (!api.available || (api.enabled && !api.needsReauth)) return null;
  // 다시 연결일 때는 **왜**인지 툴팁이 말한다 — 연동이 해제된 것이 아니라 구글
  // 권한을 다시 허용해야 하는 것이고, 고른 캘린더는 그대로 남아 있다(평소에는
  // 서버가 갱신 토큰으로 조용히 이어 주므로 이 버튼이 뜨지 않는다).
  const label = api.needsReauth ? 'Google 캘린더 다시 연결' : 'Google 캘린더 연동';
  const tip = api.needsReauth ? '구글 권한을 다시 허용해야 이어져요 — 고른 캘린더는 그대로예요' : label;
  return (
    <button
      type="button"
      data-google-connect-cal
      className="mf-ctl"
      title={tip}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 34,
        width: compact ? 34 : undefined,
        padding: compact ? 0 : '0 13px 0 11px',
        borderRadius: 999,
        border: '1px solid var(--mf-border)',
        background: 'var(--mf-card)',
        color: 'var(--mf-subtext)',
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: '-.015em',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        justifyContent: 'center',
      }}
    >
      <GoogleIcon size={compact ? 16 : 15} />
      {!compact && (api.needsReauth ? '다시 연결' : 'Google 캘린더')}
    </button>
  );
}
