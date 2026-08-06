import type { EditorController } from '../useEditorState';

/**
 * **편집 일시 중지** — 공유된 맵인데 실시간 연결이 오래 끊겼을 때.
 *
 * 왜 멈추는가: 끊긴 채 양쪽이 편집하면 두 문서가 갈라지는데, 서버에는 CRDT 로그가
 * 아니라 **최종 본문**만 저장된다. 즉 나중에 저장한 쪽이 상대의 작업을 통째로 덮는다.
 * 짧은 끊김은 자동 재접속이 메우고 그 사이 편집도 합류 시 병합되므로 멈추지 않지만
 * (`COLLAB_PAUSE_AFTER_MS` 유예), 그 시간을 넘기면 계속 편집하게 두는 편이 더 위험하다.
 *
 * 멈추기 직전 이 기기의 **버전 기록**에 현재 문서를 강제로 남기므로(useEditorState),
 * 새로고침해서 최신 상태로 돌아간 뒤에도 끊긴 동안 쓴 내용을 되찾을 수 있다.
 */
interface CollabPausedProps {
  controller: EditorController;
}

export function CollabPaused({ controller }: CollabPausedProps) {
  const th = controller.uiTheme;
  if (!controller.collabPaused) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="공동 편집 연결 끊김"
      className="mf-dim-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000, // 모든 모달(≤400)보다 위 — 지금은 편집을 계속하면 안 된다
        background: 'rgba(30,22,16,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: th.panel,
          color: th.text,
          border: `1px solid ${th.border}`,
          borderRadius: 16,
          boxShadow: '0 18px 50px rgba(0,0,0,.28)',
          padding: '22px 22px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c2603f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 1l22 22" />
            <path d="M16.7 11.3A6 6 0 0 0 12 9" />
            <path d="M20.5 7.5A11 11 0 0 0 8.4 5.4" />
            <path d="M4.9 8.1a11 11 0 0 0-1.4 1.2" />
            <path d="M8.5 14.5a4 4 0 0 1 1.6-1" />
            <line x1="12" y1="19" x2="12" y2="19.01" />
          </svg>
          <div style={{ fontSize: 16, fontWeight: 800 }}>편집을 잠시 멈췄어요</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: th.subtext }}>
          이 맵은 다른 사람과 함께 쓰는 맵인데, 실시간 연결이 끊겨 지금 하는 편집이 상대에게 전달되지 않아요. 이대로 양쪽이 편집하면 나중에 저장한 쪽이 상대의 작업을 덮게 되어, 편집을
          잠시 멈췄습니다.
          <br />
          <br />
          <b style={{ color: th.text }}>지금까지의 편집은 저장돼 있어요.</b> 새로고침하면 최신 상태로 이어서 편집할 수 있고, 연결이 저절로 돌아오면 이 안내는 사라집니다. 혹시 방금 쓴
          내용이 최신 상태에 없다면 <b style={{ color: th.text }}>보기 → 버전 기록</b>에서 되살릴 수 있어요.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 40,
              padding: '0 20px',
              border: 'none',
              borderRadius: 11,
              background: th.accent,
              color: th.accentInk,
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
