// 홈 알림 센터 — 툴바의 종(벨) 버튼 + 드롭다운.
//
// 알림의 종류가 셋을 넘었다(공유 초대·멘션·답글·새 댓글) — 종류마다 배지를 하나씩
// 늘리는 대신 우편함 하나(0022 `notifications`)로 모은다. 여는 순간 전부 읽음
// 처리한다(0019 공유 배지와 같은 규칙: "훑어봄"과 "봄"을 가르지 않는다 — 목록이
// 한 화면이라 열었으면 본 것이다). 방금 읽은 항목은 패널이 열려 있는 동안만
// 점으로 남아 "새로 온 것"을 알려 준다.
//
// 항목을 누르면 그 맵으로 간다 — 댓글류는 `?comments=<nodeId>`를 실어 에디터가
// 그 주제의 댓글 패널을 바로 연다(딥링크).

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Popover } from '../../../components/Popover';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../adapters/ports';
import { useNotificationStore } from '../../../adapters/BackendContext';
import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../theme';
import { formatLastEdited } from '../timeFormat';
import { MONO_FONT } from '../chrome';

/** 탭 복귀 시 다시 읽는 최소 간격 — 포커스가 들락거려도 요청이 몰리지 않게. */
const REFRESH_THROTTLE_MS = 30_000;

/** 홈을 켜 둔 채로도 배지가 서게 하는 주기 확인(제보: 새 알림이 와도 빨간 점이
 * 안 뜨고, 벨을 눌러야 그때서야 보인다). 마운트·탭 복귀만으로는 화면을 떠나지
 * 않는 사용자에게 갱신 계기가 없다 — 작은 select 하나라 60초면 비용은 미미하고,
 * 탭이 가려져 있는 동안은 쉬었다가 복귀 시 기존 wake 경로가 즉시 확인한다. */
const POLL_MS = 60_000;

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

/** 최신이 위 — 어댑터 순서에 기대지 않는다(로컬 저장은 추가순이라 오래된 것이
 * 먼저 오고, 그러면 '이전' 묶음이 '오늘' 위에 선다 — 실브라우저에서 잡음). */
function byNewest(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function NotificationBell({ isMobile = false }: { isMobile?: boolean }) {
  const store = useNotificationStore();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  // 닫힘 애니메이션 — 닫힌 뒤 잠깐 마운트를 유지한다(프로필 메뉴와 같은 규칙).
  /** 이번에 열었을 때 "안 읽음"이었던 항목 — 읽음 처리 후에도 점 표시용. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const lastLoadRef = useRef(0);

  const reload = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      setItems(byNewest(await store.list()));
    } catch {
      /* 알림은 부가 기능 — 홈을 방해하지 않는다 */
    }
  }, [store]);

  // 마운트 시 + 탭 복귀 시(30초 스로틀) — 새 배포 감지(#302)와 같은 생각:
  // 확인하러 돌아오는 바로 그 순간이 자연스러운 확인 타이밍이다.
  useEffect(() => {
    void reload();
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadRef.current < REFRESH_THROTTLE_MS) return;
      void reload();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [reload]);

  // 즉시 신호 — 새 알림이 생기면(0027 트리거·로컬 ping) 바로 다시 읽어 배지를
  // 세운다. 신호는 유실될 수 있으므로 아래 주기 확인이 안전망으로 남는다.
  useEffect(
    () =>
      store.subscribe(() => {
        lastLoadRef.current = Date.now();
        void reload();
      }),
    [store, reload],
  );

  // 주기 확인 — 화면이 보이는 동안만. 패널이 열려 있으면 쉰다(이미 보고 있고,
  // 목록을 갈아 끼우면 읽는 중에 항목이 움직인다).
  useEffect(() => {
    if (open) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void reload();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [reload, open]);

  // 바깥 클릭·Escape로 닫기, 자리, 닫힘 애니메이션은 `Popover`(Radix)가 맡는다 —
  // 예전에는 document 리스너 둘과 `usePopAnim`을 여기서 손으로 관리했다.

  const unread = items.filter((i) => !i.read).length;

  const openCenter = async () => {
    setOpen(true);
    lastLoadRef.current = Date.now();
    let list: AppNotification[];
    try {
      list = await store.list();
    } catch {
      list = items;
    }
    setFresh(new Set(list.filter((i) => !i.read).map((i) => i.id)));
    if (list.some((i) => !i.read)) {
      // 열었으면 본 것 — 배지를 지운다. 실패해도 다음 열기에 다시 시도된다.
      void store.markAllRead();
      list = list.map((i) => ({ ...i, read: true }));
    }
    setItems(byNewest(list));
  };

  const go = (n: AppNotification) => {
    const href = hrefOf(n);
    setOpen(false);
    if (href) navigate(href);
  };

  // 데스크톱은 툴바의 다른 컨트롤과 같은 32px 원형(디자인 원본), 모바일은 고스트 44px.
  const size = isMobile ? 44 : 32;
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

  const bell = (
    <button
      type="button"
      className={isMobile ? 'btn' : 'btn mf-ctl'}
      aria-label={unread > 0 ? `알림 ${unread}개` : '알림'}
      title="알림"
      style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          // 모바일은 제목 줄의 ☰과 같은 **고스트 버튼**(테두리·면 없음) — 좁은
          // 앱 바에서 박스형 버튼은 디자인이 깨져 보인다(제보). 44px 터치
          // 타깃은 유지되고, 데스크톱은 기존 박스형 그대로다.
          border: isMobile ? 'none' : '1px solid var(--mf-border)',
          borderRadius: isMobile ? 10 : 999,
          background: isMobile ? (open ? 'var(--mf-panel2)' : 'transparent') : open ? 'var(--mf-panel2)' : 'var(--mf-panel)',
          color: isMobile ? 'var(--mf-text)' : 'var(--mf-subtext)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width={isMobile ? 20 : 15} height={isMobile ? 20 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isMobile ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span
            data-notification-count
            aria-hidden="true"
            style={{
              position: 'absolute',
              // 고스트 버튼(모바일)은 44px 안에 20px 글리프가 떠 있어, 배지를
              // 버튼 모서리가 아니라 **글리프 모서리**에 붙인다. 데스크톱은 32px
              // 원형이라 배지가 밖으로 나가면 옆 컨트롤과 부딪힌다 — 디자인 원본처럼
              // 버튼 **안쪽** 위 모서리에 붙인다(개수는 접근 이름·툴팁에 남는다).
              top: isMobile ? 2 : -3,
              right: isMobile ? 2 : -3,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: UNREAD_BADGE_BG,
              color: UNREAD_BADGE_INK,
              fontSize: 10,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              border: '2px solid var(--mf-bg)',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
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
        align="end"
        sideOffset={12}
        panelClass="mf-pop-anim"
        panelAttrs={{ 'data-notification-panel': '', role: 'region' }}
        label="알림 센터"
        panel={{ ...panelStyle, transformOrigin: 'top right' }}
      >
        <>
          {/* 꼬리 — 패널의 overflow:hidden이 회전 사각의 위 절반을 잘라 위 테두리에
              박힌 캐럿이 된다(디자인 원본과 같은 마크업). 벨이 패널 오른쪽 끝에
              정렬되므로 꼬리는 오른쪽 근처에 둔다. */}
          <span
            aria-hidden="true"
            style={{ position: 'absolute', top: -6, right: 12, width: 11, height: 11, background: 'var(--mf-card)', borderLeft: '1px solid var(--mf-border)', borderTop: '1px solid var(--mf-border)', transform: 'rotate(45deg)', display: 'block' }}
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
