// 홈 알림 센터 — **LNB의 `알림` 행** + 드롭다운.
//
// 알림의 종류가 셋을 넘었다(공유 초대·멘션·답글·새 댓글) — 종류마다 배지를 하나씩
// 늘리는 대신 우편함 하나(0022 `notifications`)로 모은다. 여는 순간 전부 읽음
// 처리한다(0019 공유 배지와 같은 규칙: "훑어봄"과 "봄"을 가르지 않는다 — 목록이
// 한 화면이라 열었으면 본 것이다). 방금 읽은 항목은 패널이 열려 있는 동안만
// 점으로 남아 "새로 온 것"을 알려 준다.
//
// 항목을 누르면 그 맵으로 간다 — 댓글류는 `?comments=<nodeId>`를 실어 에디터가
// 그 주제의 댓글 패널을 바로 연다(딥링크).
//
// **자리는 LNB다**(요청): 예전에는 스페이스 툴바에만 있어서 대시보드·일정 화면에는
// 알림이 아예 없었다. LNB는 세 화면이 함께 쓰는 유일한 크롬이라, 어디에 있든 같은
// 자리에서 확인한다. 목록·안 읽음 수는 `NotificationsContext`가 들고 있고(폰의 ☰
// 점이 같은 수를 본다) 여기서는 **보여 주는 일**만 한다.
//
// **새 버전도 여기서 알린다**(요청). 예전에는 화면 하단 토스트가 "새로고침할까요?"를
// 물었는데, 편집 중에 끼어드는 자리였고 알림 창구가 생긴 뒤로는 같은 소식이 두 곳에서
// 말해졌다. 지금은 목록 맨 위에 **고정 한 줄**로 서고 누르면 설정 › 「버전 확인」이
// 열린다. 우편함 항목과 다른 점 둘: ① 시간순이 아니라 **맨 위 고정**이다(사건이 아니라
// 상태다) ② 열어도 사라지지 않는다 — 적용하거나 설치할 때까지 남는다.

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Popover } from '../../../components/Popover';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../adapters/ports';
import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../theme';
import { formatLastEdited } from '../timeFormat';
import { MONO_FONT } from '../chrome';
import { useNotifications } from './NotificationsContext';
import { avatarLabel } from './ProfileAvatar';
import { NavCard } from './NavCard';
import { useMergedUpdate } from '../../../pwa/updateControl';
import { updateNoticeOf } from '../../../platform/shellUpdate';
import { focusCalendar } from '../calendarFocus';

function lineOf(n: AppNotification): string {
  // 일정 알림에는 "누가"가 없다 — 그 자리에서 궁금한 것은 **언제 시작하는가**다
  // (토스트·OS 알림과 같은 문장). 어느 일정인지는 아래 칩이 말한다.
  if (n.kind === 'reminder') return n.calendar?.body || '곧 시작하는 일정이에요';
  const who = n.actorName || '누군가';
  if (n.kind === 'mention') return `${who}님이 회원님을 멘션했어요`;
  if (n.kind === 'reply') return `${who}님이 답글을 남겼어요`;
  if (n.kind === 'comment') return `${who}님이 댓글을 남겼어요`;
  if (n.kind === 'doc_mention') return `${who}님이 맵에서 회원님을 멘션했어요`;
  return `${who}님이 맵을 공유했어요`;
}

/** LNB 행의 한 줄 요약 — `종류 · 내용 · 시간`(요청).
 * 목록의 `lineOf`("…님이 …했어요")를 그대로 쓰지 않는 이유는 자리가 한 줄뿐이라
 * 사람 이름·동사까지 담으면 정작 **무슨 내용인지**가 잘리기 때문이다. */
const KIND_LABEL: Record<AppNotification['kind'], string> = {
  mention: '멘션',
  doc_mention: '멘션',
  reply: '답글',
  comment: '댓글',
  share: '공유',
  reminder: '일정',
};

/** `종류 · 내용`과 `시간`을 **따로** 돌려준다 — 한 문자열로 이으면 내용이 길 때
 * 말줄임이 꼬리를 먹어 시간이 통째로 사라진다(실브라우저에서 확인). 시간은 짧고
 * 언제나 읽혀야 하므로 줄지 않는 자리에 둔다. */
function summaryOf(n: AppNotification): { head: string; time: string } {
  // 공유 초대는 preview가 비어 있다 — 그때는 맵 제목이 곧 내용이다.
  const what = (n.preview || n.docTitle || '').replace(/\s+/g, ' ').trim();
  return { head: [KIND_LABEL[n.kind], what].filter(Boolean).join(' · '), time: formatLastEdited(n.createdAt) };
}

/** 이름을 정해진 팔레트의 한 색으로 — 같은 사람은 늘 같은 색(접속자 아바타와 같은 생각).
 * 디자인 원본은 목업이라 색을 손으로 골랐지만, 우리는 이름에서 결정적으로 뽑는다. */
const SEED_PALETTE = ['#E45DA0', '#5B8DEF', '#63A8E8', '#E8833A', '#7CA84A', '#8a63d2'];
function seedColor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return SEED_PALETTE[h % SEED_PALETTE.length]!;
}

/** 종류 미니 배지(아바타 오른쪽 아래) — [면, 잉크, 아이콘 패스]. 디자인 원본의 KIND. */
function kindBadge(kind: AppNotification['kind']): [string, string, ReactNode] {
  // 일정 알림 — 시계(강조색). 사람이 아니라 시각이 부른 알림이다.
  if (kind === 'reminder')
    return [
      'var(--mf-accent-soft)',
      'var(--mf-accent-strong)',
      <g key="i">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 1.8" />
      </g>,
    ];
  if (kind === 'mention' || kind === 'doc_mention')
    return ['#FBEDE6', '#E0602F', <path key="i" d="M4 8h16M4 16h11" />];
  if (kind === 'share')
    return [
      '#E9F0FC',
      '#4A78D0',
      <g key="i">
        <circle cx="10" cy="8" r="3" />
        <path d="M4 19a6 6 0 0 1 12 0M19 8v6M16 11h6" />
      </g>,
    ];
  // comment · reply — 말풍선(초록).
  return ['#EAF3EC', '#4E8C67', <path key="i" d="M20 12a7 7 0 0 1-7 7H9l-5 3 1.3-4.4A7 7 0 1 1 20 12z" />];
}

/** 오늘 / 이번 주 / 이전 — 목록의 묶음 머리(첨부 디자인). 일주일이 넘으면
 * 상대 시간이 무의미해지므로 `이전` 하나로 접는다(카드 시각 표기와 같은 생각). */
function groupOf(iso: string, now: Date = new Date()): '오늘' | '이번 주' | '이전' {
  const d = new Date(iso);
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return '오늘';
  return now.getTime() - d.getTime() < 7 * 24 * 3600_000 ? '이번 주' : '이전';
}

function hrefOf(n: AppNotification): string | null {
  if (!n.documentId) return null;
  const base = `/editor?map=${encodeURIComponent(n.documentId)}`;
  // 댓글류는 대상 주제의 댓글 패널을 바로 연다 — 알림을 눌렀는데 맵만 열리면
  // 무엇 때문에 왔는지 다시 찾아야 한다.
  return n.kind === 'share' || !n.nodeId ? base : `${base}&comments=${encodeURIComponent(n.nodeId)}`;
}

// `onOpenVersion`은 **필수**다 — 새 버전 줄을 그려 놓고 누를 곳이 없으면 이 프로젝트가
// 금하는 "눌러도 아무 일 없는 항목"이 된다. 타입이 호출부를 강제한다.
export function NotificationBell({ isMobile = false, onOpenVersion }: { isMobile?: boolean; onOpenVersion: () => void }) {
  const navigate = useNavigate();
  const { items, unread, setPaused, refresh, markAllRead } = useNotifications();
  /** 새 버전 — 사용자가 손을 쓸 수 있는 상태만 한 줄로 온다(`updateNoticeOf`). */
  const notice = updateNoticeOf(useMergedUpdate());
  const [open, setOpen] = useState(false);
  /** 이번에 열었을 때 "안 읽음"이었던 항목 — 읽음 처리 후에도 점 표시용. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // 바깥 클릭·Escape로 닫기, 자리, 닫힘 애니메이션은 `Popover`(Radix)가 맡는다 —
  // 예전에는 document 리스너 둘과 `usePopAnim`을 여기서 손으로 관리했다.

  const openCenter = async () => {
    setOpen(true);
    setPaused(true);
    const list = await refresh();
    setFresh(new Set(list.filter((i) => !i.read).map((i) => i.id)));
    // 열었으면 본 것 — 배지를 지운다.
    if (list.some((i) => !i.read)) markAllRead();
  };

  const go = (n: AppNotification) => {
    setOpen(false);
    // 일정 알림은 맵이 아니라 **그 일정**으로 간다 — 토스트의 `일정 보기`와 같은 길
    // (달을 옮기고 그 날을 골라 상세까지 연다).
    if (n.kind === 'reminder') {
      const c = n.calendar;
      focusCalendar(c ? { date: c.date, eventId: c.eventId, source: c.source } : undefined);
      navigate('/home');
      return;
    }
    const href = hrefOf(n);
    if (href) navigate(href);
  };

  // 디자인 원본의 알림 팝업 — 352 폭·라운드 18·긴 그늘, 위 테두리에 **꼬리**(벨을
  // 가리키는 회전 사각)가 박힌다. 패널 자체는 overflow hidden이고 **목록만** 스크롤.
  const panelStyle: CSSProperties = {
    width: 352,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--mf-card)',
    border: '1px solid var(--mf-border)',
    borderRadius: 18,
    boxShadow: '0 28px 60px -28px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.05)',
    zIndex: 60,
    overflow: 'hidden',
  };

  // LNB의 **두 줄 카드**(요청, 첨부 디자인) — 위: 코랄 타일에 담긴 흰 벨 + `알림`,
  // 오른쪽 끝에 개수 배지, 아래: 가장 최근 알림 한 줄(`종류 · 내용 · 시간`).
  // 셰브론은 두지 않는다 — 이 카드는 하위 메뉴를 펼치는 것이 아니라 **패널을
  // 띄운다**(그 자리를 개수 배지가 쓴다). 상태가 셋이다:
  //   ① 안 읽음 → 강조색 틴트 면 + 코랄 배지 + 요약이 **본문 톤**(따뜻한 갈색)
  //   ② 다 읽음 → 배지가 사라지고 면도 없이 요약만 **흐린 회색**으로 남는다
  //   ③ 아무것도 없음 → `아직 받은 알림이 없어요`
  // 요약을 늘 보여 주는 이유: 이 줄이 있으면 패널을 열지 않고도 "무엇이 왔는지"를
  // 알 수 있다(배지 숫자만으로는 열어 봐야 안다).
  //
  // 최근 것은 **안 읽은 것 중 최신**을 먼저 고른다 — 배지가 가리키는 것과 문구가
  // 어긋나면 안 된다(새 알림이 있는데 이미 읽은 옛 알림을 요약하는 꼴).
  //
  // 새 버전은 그다음이다. 안 읽은 우편함 항목이 있으면 **그쪽이 먼저**인 이유:
  // 멘션·답글은 지나가는 사건이고 새 버전은 적용할 때까지 남는 상태라, 상태가 이
  // 자리를 차지하면 그동안 도착한 소식이 요약에서 통째로 가려진다.
  const firstUnread = items.find((i) => !i.read) ?? null;
  const { head, time } = firstUnread
    ? summaryOf(firstUnread)
    : notice
      ? { head: `업데이트 · ${notice.title}`, time: '' }
      : items[0]
        ? summaryOf(items[0])
        : { head: '아직 받은 알림이 없어요', time: '' };
  const summary = time ? `${head} · ${time}` : head;
  // 새 버전도 **하나로 센다**(요청: 하나의 창구) — 열어도 사라지지 않으므로 적용·설치
  // 전까지 배지가 남는다. 그게 맞다: 눌러야 끝나는 일이다.
  const count = unread + (notice ? 1 : 0);
  const hot = count > 0;

  const bell = (
    // 껍데기는 **일정 카드와 같은 것**(`NavCard`)이다 — 나란히 선 두 카드가
    // 서로 달라 보이지 않게 값을 한 곳에 둔다. 진짜 `<button>`이라 Enter·Space
    // 활성화가 공짜이고, Radix `asChild`가 이 요소를 그대로 트리거로 쓴다.
    <NavCard
      data-notification-nav
      isMobile={isMobile}
      tone={hot ? 'hot' : 'quiet'}
      // 채운 코랄 타일 + 흰 벨(첨부 디자인) — 일정 카드의 **테두리 타일**과 갈린다.
      tile="accent"
      // 안 읽음이 있으면 타일 모서리에 점 — 개수를 읽기 전에 먼저 눈에 든다.
      tileDot={hot}
      chevron={false}
      // 요약까지 접근 이름에 담는다 — 보이는 글자와 읽히는 글자가 같아야 한다.
      aria-label={`${hot ? `알림 ${count}개` : '알림'} · ${summary}`}
      title={summary}
      label="알림"
      glyph={
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      }
      trailing={
        hot ? (
          <span
            data-notification-count
            aria-hidden="true"
            style={{
              minWidth: 20,
              height: 20,
              padding: '0 6px',
              borderRadius: 999,
              background: UNREAD_BADGE_BG,
              color: UNREAD_BADGE_INK,
              fontSize: 10.5,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : undefined
      }
      summary={
        <span data-notification-summary style={{ display: 'contents' }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{head}</span>
          {time && <span style={{ flexShrink: 0 }}>{` · ${time}`}</span>}
        </span>
      }
    />
  );

  return (
    <div style={{ flexShrink: 0 }} data-notification-bell>
      <Popover
        open={open}
        // 열 때 목록을 다시 읽는다(열었으면 본 것 — 배지를 지운다). 닫기는 상태만.
        onOpenChange={(next) => {
          if (next) void openCenter();
          else setOpen(false);
        }}
        trigger={bell}
        // LNB는 화면 **왼쪽 기둥**이라 패널은 그 옆으로 뻗는다(아래로 열면 사이드바
        // 목록을 통째로 덮는다). 폰(서랍)에서는 아래로 — 옆에 뻗을 폭이 없다.
        side={isMobile ? 'bottom' : 'right'}
        align="start"
        sideOffset={10}
        panelClass="mf-pop-anim"
        panelAttrs={{ 'data-notification-panel': '', role: 'region' }}
        label="알림 센터"
        panel={{ ...panelStyle, transformOrigin: isMobile ? 'top left' : 'left top' }}
      >
        <>
          {/* 꼬리 — 패널의 overflow:hidden이 회전 사각의 절반을 잘라 테두리에 박힌
              캐럿이 된다(디자인 원본과 같은 마크업). LNB 행을 가리키므로 데스크톱은
              **왼쪽 변**, 폰(아래로 열림)은 위 변에 둔다. */}
          <span
            aria-hidden="true"
            style={
              isMobile
                ? { position: 'absolute', top: -6, left: 16, width: 11, height: 11, background: 'var(--mf-card)', borderLeft: '1px solid var(--mf-border)', borderTop: '1px solid var(--mf-border)', transform: 'rotate(45deg)', display: 'block' }
                : { position: 'absolute', left: -6, top: 16, width: 11, height: 11, background: 'var(--mf-card)', borderLeft: '1px solid var(--mf-border)', borderBottom: '1px solid var(--mf-border)', transform: 'rotate(45deg)', display: 'block' }
            }
          />
          {/* 머리 — 제목 · "N new" 알약(등폭) · 모두 읽음. 우리 규칙(열면 읽음)은
              그대로라 알약과 점은 **이번에 새로 온 것**(fresh)을 센다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 11px' }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-text)' }}>알림</span>
            {fresh.size > 0 && (
              <span data-notification-new style={{ fontFamily: MONO_FONT, fontSize: 10, fontWeight: 500, color: 'var(--mf-accent-strong)', background: 'var(--mf-accent-soft)', borderRadius: 999, padding: '2px 6px', lineHeight: 1.2 }}>
                {fresh.size} new
              </span>
            )}
            <span style={{ flex: 1 }} />
            {fresh.size > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => setFresh(new Set())}
                style={{ flexShrink: 0, whiteSpace: 'nowrap', border: 'none', background: 'transparent', padding: '2px 0', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: 'var(--mf-faint)', cursor: 'pointer' }}
              >
                모두 읽음
              </button>
            )}
          </div>
          <div className="notif-scroll" style={{ maxHeight: 'min(420px, 62vh)', overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* 새 버전 — **맨 위 고정**. 시간순 묶음(오늘·이번 주·이전) 밖에 두는 이유는
                사건이 아니라 상태이기 때문이다. 우편함 항목과 같은 행 모양이되 얼굴
                자리에 **둥근 사각 타일**이 온다(사람이 아니라 앱이 하는 말 — LNB 카드가
                쓰는 것과 같은 신호). 누르면 설정 › 「버전 확인」에서 적용·설치한다. */}
            {notice && (
              <button
                type="button"
                className="btn mf-notif-row"
                data-notification-update={notice.blocked ? 'blocked' : 'ready'}
                onClick={() => {
                  setOpen(false);
                  onOpenVersion();
                }}
                title={`${notice.title} · ${notice.sub}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 11,
                  width: '100%',
                  padding: '11px 12px',
                  marginTop: 4,
                  border: 'none',
                  borderRadius: 14,
                  background: notice.blocked ? 'var(--mf-danger-bg)' : 'var(--mf-accent-soft)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    borderRadius: 11,
                    background: notice.blocked ? 'var(--mf-danger)' : 'var(--mf-accent)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {notice.blocked ? (
                      <>
                        <path d="M12 8.5v4.5" />
                        <path d="M12 16.5h.01" />
                        <circle cx="12" cy="12" r="8.5" />
                      </>
                    ) : (
                      <>
                        <path d="M12 3.5v9" />
                        <path d="m8.5 9 3.5 3.5L15.5 9" />
                        <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
                      </>
                    )}
                  </svg>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.45, color: 'var(--mf-text)' }}>{notice.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mf-subtext)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {notice.sub}
                  </span>
                </span>
              </button>
            )}
            {items.length ? (
              items.map((n, i) => {
                const href = hrefOf(n);
                // 일정 알림에는 주소가 없다(맵이 아니라 화면 안의 일정으로 간다).
                const canGo = !!href || n.kind === 'reminder';
                const isFresh = fresh.has(n.id);
                const group = groupOf(n.createdAt);
                const head = i === 0 || groupOf(items[i - 1]!.createdAt) !== group;
                const [kindBg, kindFg, kindIcon] = kindBadge(n.kind);
                const who = n.actorName || '누군가';
                return (
                  <span key={n.id} style={{ display: 'contents' }}>
                    {head && (
                      <span style={{ padding: '9px 8px 5px', fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mf-faint2)' }}>{group}</span>
                    )}
                    <button
                      type="button"
                      className="btn mf-notif-row"
                      data-notification-item={n.kind}
                      data-unread={isFresh ? '1' : undefined}
                      onClick={() => go(n)}
                      disabled={!canGo}
                      // 툴팁은 **화면에 없거나 잘린 것**을 메운다 — 칩이 본문을
                      // 보여 줄 때 감춰지는 것은 맵 이름이고, 둘 다 말줄임될 수 있다.
                      title={[n.docTitle || '이름 없는 맵', n.preview].filter(Boolean).join(' · ')}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 11,
                        width: '100%',
                        padding: '11px 12px',
                        border: 'none',
                        borderRadius: 14,
                        // 안 읽은 줄만 **강조색 틴트 카드**(첨부 디자인) — 읽은 줄은
                        // 면 없이 남는다. LNB 행과 같은 언어다.
                        background: isFresh ? 'var(--mf-accent-soft)' : 'transparent',
                        cursor: canGo ? 'pointer' : 'default',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      {/* 얼굴 + 종류 미니 배지 — 누가, 무슨 일로. 색은 이름 시드라
                          같은 사람은 늘 같은 색이다. */}
                      <span style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
                        {n.kind === 'reminder' ? (
                          // 일정 알림에는 사람이 없다 — 얼굴 자리에 달력 한 장(LNB 일정
                          // 카드의 그 타일과 같은 신호).
                          <span data-notification-cal style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
                              <path d="M8 3v4M16 3v4M3.5 10h17" />
                            </svg>
                          </span>
                        ) : (
                        <span style={{ width: 34, height: 34, borderRadius: 999, background: seedColor(who), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '-.02em' }}>
                          {/* 글자 규칙은 프로필 아바타와 **같은 함수**를 쓴다 —
                              같은 사람이 화면마다 다른 글자로 보이면 안 된다. */}
                          {avatarLabel(who)}
                        </span>
                        )}
                        <span style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 999, background: kindBg, border: '1.5px solid var(--mf-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={kindFg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {kindIcon}
                          </svg>
                        </span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 12.5, fontWeight: isFresh ? 700 : 500, lineHeight: 1.45, color: 'var(--mf-text)' }}>{lineOf(n)}</span>
                        {/* 둘째 줄은 **무슨 말을 했는가 + 언제**다(첨부 디자인, 사용자 선정).
                            첫 줄이 이미 "누가 무엇을 했는지"를 말하므로 여기서 더 궁금한 건
                            본문이고, 어느 맵인지는 눌러서 가는 곳이 곧 답이다(툴팁에도 남는다).
                            공유 초대처럼 본문이 없는 알림은 맵 이름이 그 자리를 쓴다.
                            시간은 줄지 않는 자리에 둔다 — 칩이 길어도 사라지면 안 된다. */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          {/* 점 색은 **맵 제목** 시드다 — 칩 글자가 본문이어도 같은 맵의
                              알림은 늘 같은 색으로 묶여 보인다. */}
                          <span data-notification-chip style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11, fontWeight: 600, color: 'var(--mf-subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: seedColor(n.docTitle || ''), display: 'block', flexShrink: 0 }} />
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.preview || n.docTitle || '이름 없는 맵'}</span>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--mf-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatLastEdited(n.createdAt) || '방금 전'}</span>
                        </span>
                      </span>
                      {isFresh && <span data-notification-fresh aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: UNREAD_BADGE_BG, marginTop: 5, flexShrink: 0 }} />}
                    </button>
                  </span>
                );
              })
            ) : (
              // 새 버전 줄이 이미 있으면 "없어요"를 덧붙이지 않는다 — 우편함이 빈 것은
              // 맞지만, 바로 위에 볼 것이 있는데 빈 화면이라 말하면 어긋난다.
              !notice && (
                <div data-notification-empty style={{ padding: '14px 10px 16px', fontSize: 12.5, color: 'var(--mf-subtext)', lineHeight: 1.6 }}>
                  새 알림이 없어요.
                  <br />
                  멘션·답글·댓글·공유 초대가 여기에 모여요.
                </div>
              )
            )}
          </div>
          {/* 디자인 원본의 "모든 알림 보기" 푸터는 두지 않는다 — 그 목록으로 가는
              화면이 없다(눌러도 아무 일 없는 버튼은 없느니만 못하다). */}
        </>
      </Popover>
    </div>
  );
}
