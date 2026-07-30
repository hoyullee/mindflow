import type { EditorController } from '../useEditorState';

interface PresenceBarProps {
  controller: EditorController;
}

/**
 * Top-right "who's here" strip — small color/initial avatars for every
 * currently-connected peer (self excluded, `usePresence`'s own filtering).
 * Renders nothing when solo (peers.length === 0) — single-user, no-op, so a
 * plain local/demo session (or a Supabase session nobody else has joined)
 * looks exactly like it did before this feature.
 *
 * 예외 하나: **실시간 전송이 끊겼을 때는 혼자여도 알린다.** 예전엔 채널이 죽어도
 * 화면이 "혼자 있는 것"과 똑같아서, 공유 맵을 함께 열어도 상대가 안 보이는 이유를
 * 알 수 없었다(제보로 배운 것 — `collab/ports.ts`의 `CollabStatus` 참고). 붙을
 * 대상이 아예 없는 데모/로컬 모드에서는 띄우지 않는다 — 그건 고장이 아니다.
 * 접속 과정('connecting', 수 초)도 고장이 아니므로 띄우지 않는다 — 진입할 때마다
 * "연결 끊김"이 잠깐 떠 보이던 거짓 경보의 원인이었다(제보). 문구도 목적(상대
 * 편집이 안 들어옴 → 새로고침)이 드러나게 "동기화 끊김 · 새로고침"으로.
 */
export function PresenceBar({ controller }: PresenceBarProps) {
  const th = controller.uiTheme;
  const { peers } = controller.presence;
  const down = controller.backendMode === 'supabase' && controller.collabStatus === 'offline';
  const insecure = controller.collabStatus === 'connected-insecure';
  if (!peers.length && !down) return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        zIndex: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: th.panel,
        border: `1px solid ${down ? '#e6c9c0' : th.border}`,
        borderRadius: 999,
        boxShadow: '0 6px 22px rgba(0,0,0,.10)',
        padding: peers.length ? '6px 10px 6px 6px' : '6px 12px',
      }}
      title={down ? '실시간 연결이 끊겨 다른 사람의 편집이 오지 않습니다. 편집 내용은 저장은 되지만, 함께 편집하려면 새로고침해 주세요.' : `${peers.length}명 접속 중`}
    >
      {down ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c2603f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M1 1l22 22" />
          <path d="M16.7 11.3A6 6 0 0 0 12 9" />
          <path d="M20.5 7.5A11 11 0 0 0 8.4 5.4" />
          <path d="M4.9 8.1a11 11 0 0 0-1.4 1.2" />
          <path d="M8.5 14.5a4 4 0 0 1 1.6-1" />
          <line x1="12" y1="19" x2="12" y2="19.01" />
        </svg>
      ) : (
        <div style={{ display: 'flex' }}>
          {peers.map((p, i) => (
            <div
              key={p.clientId}
              title={p.user.name}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: p.user.color,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 800,
                border: `2px solid ${th.panel}`,
                marginLeft: i === 0 ? 0 : -8,
                boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                flexShrink: 0,
              }}
            >
              {p.user.name.slice(0, 1)}
            </div>
          ))}
        </div>
      )}
      <span style={{ fontSize: 11.5, fontWeight: 600, color: down ? '#c2603f' : th.subtext, whiteSpace: 'nowrap' }}>{down ? '동기화 끊김 · 새로고침' : `${peers.length}명 접속 중`}</span>
      {/* 인증되지 않은 공개 채널로 폴백한 상태(서버에 Realtime Authorization 정책이
          없다). 협업은 되므로 막지 않고, 사실만 조용히 표시한다 — 조치 방법은
          콘솔 경고와 backend.md §6에 있다. */}
      {insecure && !!peers.length && (
        <span
          aria-label="보안 경고"
          title="실시간 채널이 인증되지 않은 공개 채널로 연결됐습니다. 협업은 되지만, 문서 ID를 아는 사람이 끼어들 수 있어요. (서버 설정 필요 — backend.md §6)"
          style={{ display: 'flex', flexShrink: 0, color: '#c9922f' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12" y2="17.01" />
          </svg>
        </span>
      )}
    </div>
  );
}
