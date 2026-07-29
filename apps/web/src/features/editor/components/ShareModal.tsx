import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentShare } from '../../../adapters/ports';
import type { EditorController } from '../useEditorState';

interface ShareModalProps {
  controller: EditorController;
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
export function ShareModal({ controller }: ShareModalProps) {
  const th = controller.uiTheme;
  const { shareOpen, closeShare, docId, shareStore, backendMode } = controller;
  const [shares, setShares] = useState<DocumentShare[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      setShares(await shareStore.list(docId));
      setError('');
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

  const invite = async (): Promise<void> => {
    const target = email.trim();
    if (!looksLikeEmail(target)) {
      setError('이메일 형식을 확인해 주세요.');
      return;
    }
    setBusy(true);
    const res = await shareStore.add(docId, target, 'edit');
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEmail('');
    setError('');
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 240, animation: 'mf-fade .18s ease-out' }}
      onClick={closeShare}
    >
      <div
        role="dialog"
        aria-label="공유"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: th.panel, borderRadius: 16, boxShadow: '0 22px 60px rgba(0,0,0,.28)', padding: '22px 22px 18px', boxSizing: 'border-box', color: th.text }}
      >
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>공유</div>
        <div style={{ fontSize: 12.5, color: th.subtext, lineHeight: 1.6, marginBottom: 14 }}>
          초대한 사람은 이 맵을 <strong style={{ color: th.text }}>함께 편집</strong>할 수 있어요. 같은 맵을 열면 서로의 커서와 편집이 실시간으로 보입니다.
        </div>

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
          <button
            type="button"
            onClick={() => void invite()}
            disabled={busy}
            style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 10, background: th.accent, color: th.accentInk, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, flexShrink: 0 }}
          >
            초대
          </button>
        </div>

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
        ) : shares.length === 0 ? (
          <div style={{ fontSize: 12.5, color: th.subtext, padding: '10px 0' }}>아직 아무도 초대하지 않았어요.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }}>
            {shares.map((s) => (
              <li key={s.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${th.border}` }}>
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</span>
                <span style={{ fontSize: 11.5, color: th.subtext, flexShrink: 0 }}>{s.role === 'view' ? '보기' : '편집 가능'}</span>
                <button
                  type="button"
                  onClick={() => void revoke(s.email)}
                  disabled={busy}
                  aria-label={`${s.email} 초대 취소`}
                  style={{ flexShrink: 0, height: 28, padding: '0 10px', border: `1px solid ${th.border}`, borderRadius: 8, background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 12, cursor: busy ? 'default' : 'pointer' }}
                >
                  취소
                </button>
              </li>
            ))}
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
