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

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Popover } from '../../../components/Popover';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../adapters/ports';
import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../theme';
import { formatLastEdited } from '../timeFormat';
import { MONO_FONT } from '../chrome';
import { useNotifications } from './NotificationsContext';

function lineOf(n: AppNotification): string {
  const who = n.actorName || '누군가';
  if (n.kind === 'mention') return `${who}님이 회원님을 멘션했어요`;
  if (n.kind === 'reply') return `${who}님이 답글을 남겼어요`;
  if (n.kind === 'comment') return `${who}님이 댓글을 남겼어요`;
  if (n.kind === 'doc_mention') return `${who}님이 맵에서 회원님을 멘션했어요`;
  return `${who}님이 맵을 공유했어요`;
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

/** 오늘/이전 — 목록을 두 묶음으로 가른다(디자인 원본의 group header). */
function groupOf(iso: string): '오늘' | '이전' {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate() ? '오늘' : '이전';
}

function hrefOf(n: AppNotification): string | null {
  if (!n.documentId) return null;
  const base = `/editor?map=${encodeURIComponent(n.documentId)}`;
  // 댓글류는 대상 주제의 댓글 패널을 바로 연다 — 알림을 눌렀는데 맵만 열리면
  // 무엇 때문에 왔는지 다시 찾아야 한다.
  return n.kind === 'share' || !n.nodeId ? base : `${base}&comments=${encodeURIComponent(n.nodeId)}`;
}

export function NotificationBell({ isMobile = false }: { isMobile?: boolean }) {
  const navigate = useNavigate();
  const { items, unread, setPaused, refresh, markAllRead } = useNotifications();
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
    const href = hrefOf(n);
    setOpen(false);
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

  // LNB의 다른 행(`일정`·대시보드)과 **같은 문법**이다 — 34px(폰 44px)·radius 10·
  // 글리프 + 이름 + 오른쪽 끝 표시. 다른 점은 표시가 개수 글자가 아니라 **알림 배지**
  // 라는 것뿐이다(색은 테마를 따르지 않는 고정 알림색 — #376).
  const bell = (
    // 진짜 `<button>`이다 — Enter·Space 활성화가 공짜다(`div role="button"`은
    // 클릭만 받는다). Radix `asChild`가 이 요소를 그대로 트리거로 쓴다.
    <button
      type="button"
      className="nav-item"
      data-notification-nav
      aria-label={unread > 0 ? `알림 ${unread}개` : '알림'}
      title="알림"
      style={{
        width: '100%',
        border: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 9px',
        minHeight: isMobile ? 44 : 34,
        borderRadius: 10,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: open || unread > 0 ? 700 : 500,
        letterSpacing: '-.01em',
        background: open ? 'var(--mf-accent-soft)' : 'transparent',
        color: open || unread > 0 ? 'var(--mf-text)' : 'var(--mf-subtext)',
        transition: 'background .14s ease',
      }}
    >
      <span style={{ display: 'inline-flex', color: open ? 'var(--mf-accent)' : 'currentColor', flexShrink: 0 }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>알림</span>
      <span style={{ flexShrink: 0, minWidth: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {unread > 0 && (
          <span
            data-notification-count
            aria-hidden="true"
            style={{
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 999,
              background: UNREAD_BADGE_BG,
              color: UNREAD_BADGE_INK,
              fontSize: 10.5,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </span>
    </button>
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
          <div className="notif-scroll" style={{ maxHeight: 'min(420px, 62vh)', overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {items.length ? (
              items.map((n, i) => {
                const href = hrefOf(n);
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
                      className="btn mf-ctl"
                      data-notification-item={n.kind}
                      onClick={() => go(n)}
                      disabled={!href}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        width: '100%',
                        padding: 10,
                        border: 'none',
                        borderRadius: 12,
                        background: isFresh ? 'var(--mf-panel2)' : 'transparent',
                        cursor: href ? 'pointer' : 'default',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      {/* 얼굴 + 종류 미니 배지 — 누가, 무슨 일로. 색은 이름 시드라
                          같은 사람은 늘 같은 색이다. */}
                      <span style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}>
                        <span style={{ width: 30, height: 30, borderRadius: 999, background: seedColor(who), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '-.02em' }}>
                          {who.slice(0, 2)}
                        </span>
                        <span style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 999, background: kindBg, border: '1.5px solid var(--mf-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={kindFg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {kindIcon}
                          </svg>
                        </span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 12.5, fontWeight: isFresh ? 700 : 500, lineHeight: 1.45, color: 'var(--mf-text)' }}>{lineOf(n)}</span>
                        {n.preview && (
                          <span style={{ fontSize: 11.5, color: 'var(--mf-subtext)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{n.preview}”</span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          {/* 어느 문서의 일인가 — 칩. 점 색은 제목 시드라 같은 문서는 늘 같다. */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 6px', borderRadius: 6, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', fontSize: 10.5, fontWeight: 600, color: 'var(--mf-subtext)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 2, background: seedColor(n.docTitle || ''), display: 'block', flexShrink: 0 }} />
                            {n.docTitle || '이름 없는 맵'}
                          </span>
                          <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{formatLastEdited(n.createdAt) || '방금 전'}</span>
                        </span>
                      </span>
                      {isFresh && <span data-notification-fresh aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: UNREAD_BADGE_BG, marginTop: 11, flexShrink: 0 }} />}
                    </button>
                  </span>
                );
              })
            ) : (
              <div data-notification-empty style={{ padding: '14px 10px 16px', fontSize: 12.5, color: 'var(--mf-subtext)', lineHeight: 1.6 }}>
                새 알림이 없어요.
                <br />
                멘션·답글·댓글·공유 초대가 여기에 모여요.
              </div>
            )}
          </div>
          {/* 디자인 원본의 "모든 알림 보기" 푸터는 두지 않는다 — 그 목록으로 가는
              화면이 없다(눌러도 아무 일 없는 버튼은 없느니만 못하다). */}
        </>
      </Popover>
    </div>
  );
}
