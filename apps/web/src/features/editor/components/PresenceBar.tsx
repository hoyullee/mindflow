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
 */
export function PresenceBar({ controller }: PresenceBarProps) {
  const th = controller.theme;
  const { peers } = controller.presence;
  if (!peers.length) return null;
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
        border: `1px solid ${th.border}`,
        borderRadius: 999,
        boxShadow: '0 6px 22px rgba(0,0,0,.10)',
        padding: '6px 10px 6px 6px',
      }}
      title={`${peers.length}명 접속 중`}
    >
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
      <span style={{ fontSize: 11.5, fontWeight: 600, color: th.subtext, whiteSpace: 'nowrap' }}>{peers.length}명 접속 중</span>
    </div>
  );
}
