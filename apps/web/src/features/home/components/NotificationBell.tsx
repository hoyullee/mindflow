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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../adapters/ports';
import { useNotificationStore } from '../../../adapters/BackendContext';
import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../theme';
import { formatLastEdited } from '../timeFormat';

/** 탭 복귀 시 다시 읽는 최소 간격 — 포커스가 들락거려도 요청이 몰리지 않게. */
const REFRESH_THROTTLE_MS = 30_000;

function lineOf(n: AppNotification): string {
  const who = n.actorName || '누군가';
  if (n.kind === 'mention') return `${who}님이 회원님을 멘션했어요`;
  if (n.kind === 'reply') return `${who}님이 답글을 남겼어요`;
  if (n.kind === 'comment') return `${who}님이 댓글을 남겼어요`;
  return `${who}님이 맵을 공유했어요`;
}

function hrefOf(n: AppNotification): string | null {
  if (!n.documentId) return null;
  const base = `/editor?map=${encodeURIComponent(n.documentId)}`;
  // 댓글류는 대상 주제의 댓글 패널을 바로 연다 — 알림을 눌렀는데 맵만 열리면
  // 무엇 때문에 왔는지 다시 찾아야 한다.
  return n.kind === 'share' || !n.nodeId ? base : `${base}&comments=${encodeURIComponent(n.nodeId)}`;
}

export function NotificationBell({ isMobile = false }: { isMobile?: boolean }) {
  const store = useNotificationStore();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  /** 이번에 열었을 때 "안 읽음"이었던 항목 — 읽음 처리 후에도 점 표시용. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const lastLoadRef = useRef(0);

  const reload = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      setItems(await store.list());
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

  // 바깥 클릭/Esc로 닫기.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
    setItems(list);
  };

  const go = (n: AppNotification) => {
    const href = hrefOf(n);
    setOpen(false);
    if (href) navigate(href);
  };

  const size = isMobile ? 44 : 38;
  const panelStyle: CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    width: 340,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'min(480px, 70vh)',
    overflowY: 'auto',
    background: 'var(--mf-panel)',
    border: '1px solid var(--mf-border)',
    borderRadius: 14,
    boxShadow: '0 12px 36px rgba(0,0,0,.14)',
    zIndex: 60,
    padding: '6px 0',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }} data-notification-bell>
      <button
        type="button"
        className="btn"
        onClick={() => (open ? setOpen(false) : void openCenter())}
        aria-label={unread > 0 ? `알림 ${unread}개` : '알림'}
        title="알림"
        aria-expanded={open}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          border: '1px solid var(--mf-border)',
          borderRadius: 10,
          background: open ? 'var(--mf-panel2)' : 'var(--mf-panel)',
          color: 'var(--mf-subtext)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span
            data-notification-count
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
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

      {open && (
        <div style={panelStyle} data-notification-panel role="region" aria-label="알림 센터">
          <div style={{ padding: '8px 14px 6px', fontSize: 12.5, fontWeight: 800, color: 'var(--mf-text)' }}>알림</div>
          {items.length ? (
            items.map((n) => {
              const href = hrefOf(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  className="btn"
                  data-notification-item={n.kind}
                  onClick={() => go(n)}
                  disabled={!href}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    fontFamily: 'inherit',
                    padding: isMobile ? '11px 14px' : '9px 14px',
                    cursor: href ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ color: 'var(--mf-subtext)', display: 'flex', marginTop: 2 }}>
                    <KindGlyph kind={n.kind} />
                  </span>
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--mf-text)', lineHeight: 1.45 }}>{lineOf(n)}</span>
                    {n.preview && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--mf-subtext)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        “{n.preview}”
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--mf-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.docTitle || '이름 없는 맵'} · {formatLastEdited(n.createdAt) || '방금 전'}
                    </span>
                  </span>
                  {fresh.has(n.id) && <span data-notification-fresh aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: UNREAD_BADGE_BG, marginTop: 6, flexShrink: 0 }} />}
                </button>
              );
            })
          ) : (
            <div data-notification-empty style={{ padding: '18px 14px 20px', fontSize: 12.5, color: 'var(--mf-subtext)', lineHeight: 1.6 }}>
              새 알림이 없어요.
              <br />
              멘션·답글·댓글·공유 초대가 여기에 모여요.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KindGlyph({ kind }: { kind: AppNotification['kind'] }) {
  if (kind === 'share') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    );
  }
  if (kind === 'mention') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
      </svg>
    );
  }
  if (kind === 'reply') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 17 4 12 9 7" />
        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1={7.5} y1={8.5} x2={16.5} y2={8.5} />
      <line x1={7.5} y1={12} x2={13} y2={12} />
    </svg>
  );
}
