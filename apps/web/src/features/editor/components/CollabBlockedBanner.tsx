import type { EditorController } from '../useEditorState';

/**
 * 끊긴 **즉시** 뜨는 얇은 배너 — "편집이 잠시 멈췄고, 다시 연결 중이다".
 *
 * 왜 즉시 멈추나: 끊긴 동안의 편집은 재연결 시 CRDT로 병합되지만, 상대가 **같은
 * 대상**을 건드렸다면 한쪽이 조용히 사라진다(같은 필드는 한쪽 값만, 부모의
 * `children`도 한쪽 목록만, 삭제가 편집을 이긴다 — core `crdt/divergence.test.ts`).
 * 유실 가능성이 있는 시간대에는 편집을 아예 만들지 않는 것이 안전하다.
 *
 * 화면 전체를 덮지 않는 이유: 짧은 끊김(수 초)이면 곧 저절로 풀린다. 읽기·이동·줌은
 * 그대로 되고, 오래 끊기면 `CollabPaused`가 전체 안내로 승격한다.
 */
interface CollabBlockedBannerProps {
  controller: EditorController;
}

export function CollabBlockedBanner({ controller }: CollabBlockedBannerProps) {
  const th = controller.uiTheme;
  // 오래 끊긴 상태는 전용 화면이 대신 말한다 — 두 겹으로 알리지 않는다.
  if (!controller.collabBlocked || controller.collabPaused) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 14,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'calc(100% - 32px)',
        padding: '8px 14px',
        borderRadius: 999,
        background: th.panel,
        border: '1px solid #e6c9c0',
        boxShadow: '0 6px 22px rgba(0,0,0,.12)',
        color: th.text,
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title="함께 쓰는 맵이라, 연결이 끊긴 동안의 편집은 상대의 편집과 충돌해 한쪽이 사라질 수 있어요. 그래서 편집을 잠시 멈춥니다 — 다시 연결되면 자동으로 풀려요. 저장은 정상입니다."
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c2603f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M1 1l22 22" />
        <path d="M16.7 11.3A6 6 0 0 0 12 9" />
        <path d="M20.5 7.5A11 11 0 0 0 8.4 5.4" />
        <path d="M4.9 8.1a11 11 0 0 0-1.4 1.2" />
        <path d="M8.5 14.5a4 4 0 0 1 1.6-1" />
        <line x1="12" y1="19" x2="12" y2="19.01" />
      </svg>
      연결이 끊겨 편집을 잠시 멈췄어요 · 다시 연결 중…
    </div>
  );
}
