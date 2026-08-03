import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { EditorController } from '../useEditorState';
import { listVersions, versionBody } from '../versionHistory';
import { realPreview } from '../../home/mapPreview';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/**
 * 버전 기록 모달 — 편집 메뉴(또는 모바일 ☰)의 "버전 기록"으로 연다.
 * 이 기기(브라우저)에 저장 시점마다 남긴 로컬 스냅샷(`versionHistory.ts`)을
 * 목록으로 보여 주고, 항목을 고르면 홈 카드와 같은 실제 렌더(`realPreview`)로
 * 미리 보여 준 뒤 "이 버전으로 복원"한다. 복원은 undo 가능하고, 복원 직전의
 * 현재 상태도 기록에 남는다(돌아올 길 보장 — `restoreVersion` 참고).
 */
export function VersionHistory({ controller }: { controller: EditorController }) {
  const isMobile = useIsMobile();
  const th = controller.uiTheme;
  const open = controller.historyOpen;
  const [selectedAt, setSelectedAt] = useState<number | null>(null);

  const versions = useMemo(() => (open ? listVersions(controller.historyDocId) : []), [open, controller.historyDocId]);

  useEffect(() => {
    if (!open) {
      setSelectedAt(null);
      return;
    }
    setSelectedAt(versions[0]?.at ?? null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        controller.setHistoryOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // versions는 open에서 파생 — open 전환 시 한 번이면 충분하다.
  }, [open]);

  if (!open) return null;

  const fmt = (at: number): string => {
    const d = new Date(at);
    const diff = Date.now() - at;
    const rel = diff < 60_000 ? '방금' : diff < 3_600_000 ? `${Math.floor(diff / 60_000)}분 전` : diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}시간 전` : `${Math.floor(diff / 86_400_000)}일 전`;
    const hh = `${d.getHours()}`.padStart(2, '0');
    const mm = `${d.getMinutes()}`.padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm} · ${rel}`;
  };

  const selectedBody = selectedAt != null ? versionBody(controller.historyDocId, selectedAt) : null;
  const preview = selectedBody ? realPreview(selectedBody, th.accent) : null;

  const panel: CSSProperties = {
    position: 'relative',
    width: isMobile ? '100%' : 760,
    maxWidth: '100%',
    height: isMobile ? '88vh' : 540,
    maxHeight: '88vh',
    background: th.panel,
    borderRadius: isMobile ? '16px 16px 0 0' : 16,
    border: `1px solid ${th.border}`,
    boxShadow: '0 18px 60px rgba(0,0,0,.22)',
    padding: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="버전 기록"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) controller.setHistoryOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,.34)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '16px 16px 10px' : '18px 22px 12px' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: th.text }}>버전 기록</div>
            <div style={{ fontSize: 12, color: th.subtext, marginTop: 2 }}>이 기기에서 저장된 시점들이에요. 복원해도 실행 취소(Ctrl+Z)로 되돌릴 수 있어요.</div>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => controller.setHistoryOpen(false)}
            style={{ width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, border: 'none', borderRadius: 8, background: 'transparent', color: th.subtext, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {versions.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: th.subtext, fontSize: 13, padding: 24, textAlign: 'center' }}>
            아직 기록이 없어요 — 문서를 편집·저장하면 이곳에 시점이 쌓여요.
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0 }}>
            {/* 목록 */}
            <div style={{ width: isMobile ? '100%' : 264, flexShrink: 0, overflowY: 'auto', borderRight: isMobile ? 'none' : `1px solid ${th.border}`, borderBottom: isMobile ? `1px solid ${th.border}` : 'none', maxHeight: isMobile ? '38%' : undefined, padding: '4px 0' }}>
              {versions.map((v) => {
                const active = v.at === selectedAt;
                return (
                  <button
                    key={v.at}
                    type="button"
                    onClick={() => setSelectedAt(v.at)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: isMobile ? '12px 16px' : '9px 16px',
                      border: 'none',
                      borderLeft: `3px solid ${active ? th.accent : 'transparent'}`,
                      background: active ? th.panel2 : 'transparent',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: th.text }}>{fmt(v.at)}</div>
                    <div style={{ fontSize: 11.5, color: th.subtext, marginTop: 1 }}>노드 {v.nodes}개</div>
                  </button>
                );
              })}
            </div>

            {/* 미리보기 + 복원 */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: th.panel2, margin: isMobile ? '10px 16px' : 14, borderRadius: 12, overflow: 'hidden' }}>
                {preview ?? <span style={{ color: th.subtext, fontSize: 13 }}>미리보기를 열 수 없어요</span>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: isMobile ? '0 16px 22px' : '0 14px 14px' }}>
                <button
                  type="button"
                  disabled={selectedAt == null}
                  onClick={() => {
                    if (selectedAt != null) controller.restoreVersion(selectedAt);
                  }}
                  style={{
                    height: isMobile ? 44 : 34,
                    padding: '0 18px',
                    border: 'none',
                    borderRadius: 9,
                    background: th.accent,
                    color: th.accentInk,
                    fontWeight: 700,
                    fontSize: 13.5,
                    cursor: 'pointer',
                  }}
                >
                  이 버전으로 복원
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
