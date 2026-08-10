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
    <>
      {/* 배경 dim(요청) — 다시 연결될 때까지 캔버스를 가라앉혀 "편집이 멈췄다"를
          화면 전체로 말한다. pointer-events는 끈다: 조작 차단은 chokepoint
          (commitDoc)가 이미 하고 있고, 읽기·이동·줌은 그대로 두는 것이 이 배너의
          설계다(짧은 끊김이면 곧 저절로 풀린다). 색은 모달 dim(rgba(30,20,14,.42))
          과 같은 잉크의 옅은 판 — 내용이 계속 읽혀야 한다. */}
      <div data-collab-dim aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 29, background: 'rgba(30,20,14,.26)', pointerEvents: 'none', animation: 'mf-dim-in .25s ease-out' }} />
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
          // dim과 같은 제자리 페이드 — translateX(-50%) 센터링이 있어 transform을
          // 건드리는 키프레임(mf-ctx-pop 등)을 쓰면 자리가 튄다(#331의 교훈).
          animation: 'mf-dim-in .25s ease-out',
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
        <span>연결이 끊겨 편집을 잠시 멈췄어요</span>
        {/* 회전 스피너(요청) — "다시 연결 중"이 멈춘 안내문이 아니라 지금 진행
            중인 일임을 움직임으로 알린다. */}
        <svg className="mf-collab-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c2603f" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M21 12a9 9 0 1 1-6.2-8.56" />
        </svg>
        <span>다시 연결 중…</span>
      </div>
    </>
  );
}
