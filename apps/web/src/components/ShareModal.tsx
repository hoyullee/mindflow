import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DocumentShare, ShareParticipant, ShareRole } from '../adapters/ports';
import { useAuthUser } from '../adapters/useAuthUser';
import { useBackend, useShareStore } from '../adapters/BackendContext';
import { colorForSeed } from '../collab/identity';

/**
 * 에디터의 `uiTheme`(라이트/다크)와 홈(테마 6종)이 **같은 모달**을 쓰도록 필요한
 * 색만 구조적으로 받는다(`FeedbackTheme`과 같은 방식). 기본값은 홈 계열 라이트.
 */
export interface ShareTheme {
  panel: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  accentInk: string;
  canvasBg: string;
}

const LIGHT: ShareTheme = {
  panel: '#ffffff',
  text: '#33281f',
  subtext: '#9c8b7e',
  border: '#eee2d9',
  accent: '#f0663f',
  accentInk: '#ffffff',
  canvasBg: '#faf6f1',
};

interface ShareModalProps {
  open: boolean;
  /** 공유할 문서 id. */
  docId: string;
  onClose: () => void;
  /**
   * 보기 전용으로 들어온 사람인가 — 초대·링크·권한 변경을 전부 잠근다.
   * 홈의 맵 카드는 언제나 내 맵이라 false다(공유받은 맵은 LNB에만 있다).
   */
  readOnly?: boolean;
  /** 공유에서 나간 뒤 — 에디터는 홈으로 보내고, 홈은 그냥 닫는다. */
  onLeft?: () => void;
  theme?: ShareTheme;
}

/** 아주 느슨한 형식 검사 — 진짜 판정은 서버(초대받은 사람이 그 이메일로 로그인하는지)가
 *  한다. 여기서는 오타를 바로 잡아 주는 정도만 본다. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * 문서 공유 — 이메일로 초대하고, 초대 목록을 보고 취소한다.
 *
 * 권한은 `edit`만 제공한다. `view`는 스키마·RLS에 준비돼 있지만 뷰어를 제대로
 * 만들려면 CRDT로 자기 편집이 상대에게 전파되는 것부터 막아야 해서 별도 작업이다
 * (`supabase/migrations/0009_document_shares.sql` 참고).
 *
 * 실제 접근 제어는 전부 DB의 RLS다 — 이 모달은 초대 목록을 읽고 쓰는 창구일 뿐이고,
 * 여기서 무엇을 하든 서버가 다시 판단한다.
 */
/** 참가자 원형 아바타 — 협업 커서와 같은 시드(이메일)로 색을 정해, 팝업의 색과
 * 캔버스에서 보이는 그 사람의 커서 색이 일치한다. */
function PersonDot({ email, name, dimmed = false }: { email: string; name: string | null; dimmed?: boolean }) {
  const initial = (name || email).slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 800,
        color: '#fff',
        background: colorForSeed(email),
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {initial}
    </span>
  );
}

/**
 * 제목 옆 "?" — 눌러야 뜨는 권한 안내(요청). 호버가 아니라 **클릭 토글**인 이유는
 * 터치다: 손가락에는 호버가 없어서 호버 전용 툴팁은 폰에서 아예 못 본다.
 */
function HelpTip({ theme: th, open, onToggle, onClose }: { theme: ShareTheme; open: boolean; onToggle: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open, onClose]);

  return (
    // 일부러 `position: static` — 툴팁을 이 작은 래퍼가 아니라 **제목 행**(부모가
    // 이미 relative)에 걸어 모달 본문 왼쪽 끝에서 시작하게 한다. "?" 버튼에 걸면
    // 제목 폭만큼 오른쪽에서 시작해 한 줄에 들어갈 폭이 그만큼 모자란다.
    <div ref={ref} style={{ display: 'flex' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="권한 안내"
        aria-expanded={open}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1px solid ${th.border}`,
          background: open ? th.accent : 'transparent',
          color: open ? th.accentInk : th.subtext,
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 26,
            left: 0,
            // 세 문장을 **한 줄씩** 보여 준다(요청) — 문장 중간에서 접히면 굵게
            // 강조한 권한 이름과 설명이 갈라져 읽기 힘들다. 폭은 가장 긴 문장에
            // 맞추고(`max-content`), 아주 좁은 화면에서만 접히도록 상한을 둔다.
            width: 'max-content',
            maxWidth: 'calc(100vw - 48px)',
            zIndex: 5,
            background: th.panel,
            border: `1px solid ${th.border}`,
            borderRadius: 10,
            boxShadow: '0 10px 28px rgba(0,0,0,.18)',
            padding: '10px 12px',
            fontSize: 12.5,
            fontWeight: 400,
            color: th.subtext,
            lineHeight: 1.6,
          }}
        >
          <div>
            <strong style={{ color: th.text }}>편집 가능</strong> 권한은 서로의 커서와 편집이 실시간으로 보여요.
          </div>
          <div style={{ marginTop: 4 }}>
            <strong style={{ color: th.text }}>보기 전용</strong> 권한은 저장된 최신 맵을 열람만 할 수 있습니다.
          </div>
          <div style={{ marginTop: 4 }}>
            <strong style={{ color: th.text }}>링크 공유</strong>는 링크를 아는 사람이 <strong style={{ color: th.text }}>로그인 후 열람</strong>만 할 수 있어요.
          </div>
        </div>
      )}
    </div>
  );
}

/** 권한 셀렉트 공통 모양 — 초대 행(40px)과 참가자 행(28px)이 함께 쓴다. */
function roleSelectStyle(th: ShareTheme): CSSProperties {
  return {
    flexShrink: 0,
    height: 28,
    padding: '0 6px',
    border: `1px solid ${th.border}`,
    borderRadius: 8,
    background: th.panel,
    color: th.text,
    fontFamily: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  };
}

export function ShareModal({ open: shareOpen, docId, onClose: closeShare, readOnly = false, onLeft, theme }: ShareModalProps) {
  const th = theme ?? LIGHT;
  const shareStore = useShareStore();
  const backendMode = useBackend().mode;
  const [shares, setShares] = useState<DocumentShare[]>([]);
  // 참가자 정보(소유자·프로필명·가입 여부·권한) — 없어도(null) 공유는 동작한다.
  // 이메일만 보여주는 기존 렌더로 폴백할 뿐이다(0011 RPC 미적용/일시 오류).
  const [participants, setParticipants] = useState<ShareParticipant[] | null>(null);
  const [email, setEmail] = useState('');
  // 초대할 권한(#22). '편집 가능'이 기본 — 공유의 첫 용례(실시간 공동 편집)를 지킨다.
  const [inviteRole, setInviteRole] = useState<ShareRole>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // 어느 문서의 목록을 이미 들고 있는가 — 팝업을 다시 열 때 "불러오는 중…"으로
  // 비웠다가 다시 채우면 화면이 깜빡인다(제보). 같은 문서면 들고 있던 목록을 그대로
  // 보여주고 뒤에서 조용히 갱신한다(stale-while-revalidate).
  const loadedForRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const authUser = useAuthUser();
  /** 링크 공유(0017) — `'view'`면 켜짐, `null`이면 꺼짐. */
  const [linkRole, setLinkRole] = useState<ShareRole | null>(null);
  const [copied, setCopied] = useState(false);
  /** 권한 안내 툴팁("?" 아이콘) — 문구를 상시 띄우는 대신 물어볼 때만 보여 준다. */
  const [helpOpen, setHelpOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!docId) return;
    if (loadedForRef.current !== docId) setLoading(true);
    try {
      const [list, people] = await Promise.all([shareStore.list(docId), shareStore.listParticipants(docId)]);
      setShares(list);
      setParticipants(people);
      setError('');
      loadedForRef.current = docId;
      // 링크 상태는 **따로** 묻는다 — 실패해도 공유 목록까지 막지 않는다
      // (`listParticipants`와 같은 태도: 부가 정보가 본 기능을 넘어뜨리면 안 된다).
      try {
        setLinkRole(await shareStore.getLink(docId));
      } catch {
        setLinkRole(null);
      }
    } catch {
      setError('공유 목록을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [docId, shareStore]);

  useEffect(() => {
    if (!shareOpen) return;
    void refresh();
    inputRef.current?.focus();
  }, [shareOpen, refresh]);

  // Esc로 닫기 — 다른 모달들과 같은 규칙.
  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeShare();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shareOpen, closeShare]);

  if (!shareOpen) return null;

  const owner = participants?.find((p) => p.kind === 'owner') ?? null;
  const inviteeInfo = new Map((participants ?? []).filter((p) => p.kind === 'invitee').map((p) => [p.email, p]));
  const myEmail = (authUser?.email ?? '').trim().toLowerCase();
  /** 초대·취소 UI를 소유자에게만. 참가자 정보를 못 얻는 환경(폴백)에서는 판단할 수
   * 없으므로 보여 준다 — 진짜 권한은 어차피 서버 RLS가 판단한다(0009: insert는
   * 소유자만). 이 플래그는 어포던스 정리일 뿐이다. */
  const isOwner = owner ? owner.email === myEmail : true;
  /**
   * 보기 전용으로 들어온 사람(초대 'view' 또는 링크)은 **아무것도 바꿀 수 없다**.
   *
   * `isOwner`만으로는 부족했다(제보): 링크 뷰어에게는 참가자 목록이 비어 와서
   * `owner`가 없고, 그러면 위 폴백이 나를 소유자로 간주해 링크 토글과 초대 입력이
   * 그대로 열렸다. 서버 RLS가 실제 쓰기는 막고 있었으니 권한이 샌 것은 아니지만,
   * **할 수 없는 일을 할 수 있는 것처럼 보여 주는** 화면이었다. 목록이 비어 오는
   * 서버 쪽 원인은 0018이 고쳤고, 여기서는 그것과 무관하게 성립하는 신호
   * (`readOnly`)로 한 번 더 잠근다.
   */
  const viewerOnly = readOnly;
  /** 초대·링크·권한 변경을 실제로 할 수 있는가. */
  const canManage = isOwner && !viewerOnly;
  /** 행 목록. 참가자 정보가 있으면 그것이 정본이다 — 초대받은 사람은 테이블
   * select(RLS)로는 자기 행만 보이지만, 참가자 명단(0011)은 전원에게 전체를 준다
   * ("소유자가 초대한 다른 사람이 안 보인다" 제보). */
  const rows: { email: string; role: 'edit' | 'view' }[] = participants
    ? participants.filter((p) => p.kind === 'invitee').map((p) => ({ email: p.email, role: p.role }))
    : shares.map((s) => ({ email: s.email, role: s.role }));

  /** 링크로 이 맵을 여는 주소 — 지금 보고 있는 그 주소다(비밀은 랜덤 문서 id 자체). */
  const shareUrl = `${window.location.origin}/editor?map=${encodeURIComponent(docId)}`;

  const toggleLink = async (): Promise<void> => {
    const next: ShareRole | null = linkRole ? null : 'view';
    setBusy(true);
    const res = await shareStore.setLink(docId, next);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setLinkRole(next);
    setCopied(false);
  };

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드가 막힌 환경(권한 거부·비보안 컨텍스트) — 주소를 직접 고를 수 있게 알린다.
      setError('링크를 복사하지 못했어요. 주소창의 주소를 그대로 공유해 주세요.');
    }
  };

  const invite = async (): Promise<void> => {
    const target = email.trim();
    if (!looksLikeEmail(target)) {
      setError('이메일 형식을 확인해 주세요.');
      return;
    }
    // 자기 자신 초대 방지 — 소유자는 이미 전권이고, 자기 행이 생기면 에디터의
    // "내 행이 view면 보기 전용" 판별(useEditorState)이 소유자를 잠글 수 있다.
    if (target.toLowerCase() === myEmail) {
      setError('자기 자신은 초대할 수 없어요.');
      return;
    }
    setBusy(true);
    const res = await shareStore.add(docId, target, inviteRole);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEmail('');
    setError('');
    await refresh();
  };

  /** 이미 초대된 사람의 권한 변경(소유자 전용) — `add`는 upsert라 권한만 갱신된다. */
  const changeRole = async (target: string, role: ShareRole): Promise<void> => {
    setBusy(true);
    const res = await shareStore.add(docId, target, role);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    await refresh();
  };

  const revoke = async (target: string): Promise<void> => {
    setBusy(true);
    const res = await shareStore.remove(docId, target);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    await refresh();
  };

  /** 공유 나가기(비소유자가 자기 행을 지움) — 성공하면 이 맵에 더 접근할 수 없으므로
   * 열려 있는 에디터에 남겨 두지 않고 홈으로 보낸다(`onLeft`). */
  const leave = async (target: string): Promise<void> => {
    setBusy(true);
    const res = await shareStore.remove(docId, target);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    (onLeft ?? closeShare)();
  };

  return (
    <div
      // dim 배경은 제자리 페이드만(mf-dim-in) — translateY가 있는 mf-fade를 쓰면
      // 배경 레이어가 통째로 슬라이드해 화면 상단에 빈 띠가 차오르는 게 보인다(제보).
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 240, animation: 'mf-dim-in .18s ease-out' }}
      onClick={closeShare}
    >
      <div
        role="dialog"
        aria-label="공유"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: th.panel, borderRadius: 16, boxShadow: '0 22px 60px rgba(0,0,0,.28)', padding: '22px 22px 18px', boxSizing: 'border-box', color: th.text }}
      >
        {/* 권한 설명은 상시 문단이 아니라 "?"에 넣는다(요청) — 팝업을 여는 사람 대부분은
            이미 알고 있고, 두 줄이 매번 자리를 차지했다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, position: 'relative' }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>공유</div>
          <HelpTip theme={th} open={helpOpen} onToggle={() => setHelpOpen((v) => !v)} onClose={() => setHelpOpen(false)} />
        </div>

        {/* 소유자 — 공유받은 사람 입장에서 "누가 초대했는지"가 보여야 한다(제보).
            참가자 정보를 못 얻는 환경(0010 RPC 미적용)에서는 구획째 생략. */}
        {owner && (
          <div aria-label="소유자" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: `1px solid ${th.border}`, borderRadius: 11, background: th.canvasBg, marginBottom: 12 }}>
            <PersonDot email={owner.email} name={owner.displayName} />
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{owner.displayName || owner.email.split('@')[0]}</span>
                {owner.email === myEmail && (
                  <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(226,96,60,.12)', color: th.accent }}>나</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: th.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{owner.email}</div>
            </div>
            <span style={{ flexShrink: 0, fontSize: 11.5, color: th.subtext }}>소유자</span>
          </div>
        )}

        {/* 링크 공유(0017) — 이메일을 모르는 상대에게 "이거 봐 줘" 하는 가장 짧은 길.
            보기 전용만 연다: 링크는 유출되면 회수할 수 없고(끄기 전까지), 열람은
            유출돼도 피해가 "봤다"에서 멈추지만 편집은 내용을 되돌릴 수 없게 만든다. */}
        {(canManage || (viewerOnly && !!linkRole)) && (
          <div aria-label="링크 공유" style={{ border: `1px solid ${th.border}`, borderRadius: 11, background: th.canvasBg, padding: '10px 11px', marginBottom: 12, opacity: canManage ? 1 : 0.6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: canManage && !busy ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={!!linkRole} disabled={busy || !canManage} onChange={() => void toggleLink()} aria-label="링크가 있는 사람은 열람" style={{ width: 15, height: 15, accentColor: th.accent, cursor: 'inherit' }} />
              <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: 700 }}>링크가 있는 사람은 열람</span>
              <span style={{ flexShrink: 0, fontSize: 11.5, color: th.subtext }}>보기 전용</span>
            </label>
            {linkRole && (
              <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="공유 링크"
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: '1 1 auto', minWidth: 0, height: 34, padding: '0 10px', border: `1px solid ${th.border}`, borderRadius: 9, background: th.panel, color: th.subtext, fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  disabled={!canManage}
                  style={{ flexShrink: 0, height: 34, padding: '0 12px', border: 'none', borderRadius: 9, background: canManage ? th.accent : th.border, color: canManage ? th.accentInk : th.subtext, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: canManage ? 'pointer' : 'not-allowed' }}
                >
                  {copied ? '복사됨' : '링크 복사'}
                </button>
              </div>
            )}
          </div>
        )}

        {!canManage && (
          <div style={{ fontSize: 12, color: th.subtext, background: th.canvasBg, border: `1px solid ${th.border}`, borderRadius: 9, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
            {viewerOnly ? '보기 전용으로 공유받은 맵이에요. 공유 설정은 소유자만 바꿀 수 있어요.' : '초대와 초대 취소는 맵의 소유자만 할 수 있어요.'}
          </div>
        )}
        {canManage && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            ref={inputRef}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void invite();
            }}
            placeholder="초대할 이메일"
            aria-label="초대할 이메일"
            style={{ flex: '1 1 auto', minWidth: 0, height: 40, padding: '0 12px', border: `1px solid ${th.border}`, borderRadius: 10, background: th.panel, color: th.text, fontFamily: 'inherit', fontSize: 13.5, outline: 'none' }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value === 'view' ? 'view' : 'edit')}
            aria-label="초대 권한"
            style={{ ...roleSelectStyle(th), height: 40, borderRadius: 10 }}
          >
            <option value="edit">편집 가능</option>
            <option value="view">보기 전용</option>
          </select>
          <button
            type="button"
            onClick={() => void invite()}
            disabled={busy}
            style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 10, background: th.accent, color: th.accentInk, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, flexShrink: 0 }}
          >
            초대
          </button>
        </div>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: '#d2503c', marginBottom: 10, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {/* 데모 모드에는 서버도 다른 사용자도 없다 — 목록은 동작하지만 실제로 열리지는
            않으므로 그걸 숨기지 않고 말해 준다. */}
        {backendMode === 'local' && (
          <div style={{ fontSize: 12, color: th.subtext, background: th.canvasBg, border: `1px solid ${th.border}`, borderRadius: 9, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
            데모 모드예요. 초대 목록은 이 브라우저에만 저장되고 실제로 공유되지는 않습니다.
          </div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: th.subtext, margin: '4px 0 6px' }}>초대된 사람</div>
        {loading ? (
          <div style={{ fontSize: 12.5, color: th.subtext, padding: '10px 0' }}>불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: th.subtext, padding: '10px 0' }}>아직 아무도 초대하지 않았어요.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }}>
            {rows.map((s) => {
              const info = inviteeInfo.get(s.email);
              const name = info?.displayName ?? null;
              // 참가자 정보를 얻었고(joined 판단 가능) 아직 가입 전인 이메일 — 초대는
              // 걸려 있고, 그 이메일로 가입하는 순간 권한과 프로필명이 함께 생긴다.
              const pending = !!info && !info.joined;
              const isMe = s.email === myEmail;
              return (
              <li key={s.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${th.border}` }}>
                <PersonDot email={s.email} name={name} dimmed={pending} />
                <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: name ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || s.email}</span>
                  {name && <span style={{ fontSize: 11, color: th.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</span>}
                </span>
                {pending && (
                  <span title="아직 이 이메일로 가입한 계정이 없어요. 가입하는 순간 편집 권한이 생깁니다." style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: th.canvasBg, border: `1px solid ${th.border}`, color: th.subtext }}>
                    가입 대기
                  </span>
                )}
                {/* 권한(#22): 소유자는 여기서 바로 바꾼다(upsert). 나머지에겐 표시만. */}
                {canManage ? (
                  <select
                    value={s.role}
                    onChange={(e) => void changeRole(s.email, e.target.value === 'view' ? 'view' : 'edit')}
                    disabled={busy}
                    aria-label={`${s.email} 권한`}
                    style={roleSelectStyle(th)}
                  >
                    <option value="edit">편집 가능</option>
                    <option value="view">보기 전용</option>
                  </select>
                ) : (
                  <span style={{ fontSize: 11.5, color: th.subtext, flexShrink: 0 }}>{s.role === 'view' ? '보기 전용' : '편집 가능'}</span>
                )}
                {/* 취소는 소유자만. 예외 하나: 나 자신은 공유에서 나갈 수 있다(서버
                    delete 정책도 정확히 이 둘만 허용한다 — 0009). 보기 전용에게도
                    **나가기는 남긴다** — 공유 설정을 바꾸는 게 아니라 자기 자신을
                    빼는 것이고, 이걸 없애면 나갈 길이 사라진다. */}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void revoke(s.email)}
                    disabled={busy}
                    aria-label={`${s.email} 초대 취소`}
                    style={{ flexShrink: 0, height: 28, padding: '0 10px', border: `1px solid ${th.border}`, borderRadius: 8, background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 12, cursor: busy ? 'default' : 'pointer' }}
                  >
                    취소
                  </button>
                ) : isMe ? (
                  <button
                    type="button"
                    onClick={() => void leave(s.email)}
                    disabled={busy}
                    aria-label="공유 나가기"
                    title="이 맵의 공유에서 나갑니다. 다시 보려면 소유자가 다시 초대해야 해요."
                    style={{ flexShrink: 0, height: 28, padding: '0 10px', border: `1px solid ${th.border}`, borderRadius: 8, background: 'transparent', color: '#c0532e', fontFamily: 'inherit', fontSize: 12, cursor: busy ? 'default' : 'pointer' }}
                  >
                    나가기
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={closeShare}
          style={{ width: '100%', height: 42, marginTop: 16, border: `1px solid ${th.border}`, borderRadius: 11, background: 'transparent', color: th.text, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
