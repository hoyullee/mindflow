import { createPortal } from 'react-dom';

/** 문서를 여는 전환의 재료 — 누른 그 자리(원점)의 화면 사각형 + 무엇을 여는지. */
export interface LaunchState {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 문서 이름 */
  name: string;
  /** 종류 이름("마인드맵"·"화이트보드"·"칸반보드") */
  kindName: string;
  /** 스페이스 이름 */
  space: string;
}

/**
 * 문서 열기 전환(디자인 원본 `ghLaunch`) — **누른 자리에서 화면 전체로 펼쳐진다.**
 *
 * 규칙(사용자와 합의): 누른 원점이 있으면 그 자리에서 펼치고, 원점이 없거나 배경
 * 자체가 바뀌는 동작(새로 만들기·로그아웃·탈퇴)은 전체 화면 로더(`LoadingOverlay`).
 * 그래서 대시보드 위젯의 "열기"와 스페이스·최근·검색 결과의 카드가 **같은 전환**을
 * 쓴다 — 같은 동작(문서를 연다)이 같은 모양이다.
 *
 * 카드의 인라인 기본 스타일이 곧 **도착 상태**라, 움직임을 줄인 사용자에게는
 * (`prefers-reduced-motion`이 애니메이션을 끄면) 전체 화면 로딩 카드로 조용히
 * 축퇴한다. 이동(900ms)과 함께 홈째 언마운트되므로 뒷정리가 필요 없다.
 *
 * **배경을 덮지 않는다**(제보): 예전에는 불투명 베일이 함께 페이드되고 홈의 전체
 * 화면 로더까지 떠서, 누른 순간 배경 내용이 통째로 사라지고 로딩만 남았다 — 지금은
 * 배경이 그대로 보이는 위로 카드가 자라고, 로딩은 그 카드 **안**의 스피너가 말한다
 * (카드가 다 자라면 어차피 화면을 덮는다).
 *
 * **body 포털인 이유**: 부모 쪽에 transform·filter·fill-mode 애니메이션이 있으면
 * 스태킹 컨텍스트가 생겨, 그 안의 fixed는 z 260이어도 컨텍스트째 깔린다(실브라우저
 * 확인 — LoadingOverlay(z 200)가 위에 그려졌다, #488 확인창과 같은 계열). 위젯·카드의
 * hover 떠오름(transform)이 정확히 그런 컨텍스트를 만든다.
 */
export function LaunchOverlay({ launch }: { launch: LaunchState | null }) {
  if (!launch) return null;
  return createPortal(
    <div data-dash-launch style={{ position: 'fixed', inset: 0, zIndex: 260, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100vw',
          height: '100vh',
          borderRadius: 0,
          background: 'var(--mf-card)',
          border: '1px solid var(--mf-border)',
          boxShadow: '0 40px 90px -40px rgba(46,42,38,.6)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'mf-dash-launch .56s cubic-bezier(.32,.72,0,1) both',
          ['--lx' as never]: `${launch.x}px`,
          ['--ly' as never]: `${launch.y}px`,
          ['--lw' as never]: `${launch.w}px`,
          ['--lh' as never]: `${launch.h}px`,
        }}
      >
        <div data-launch-copy style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'mf-dim-in .3s ease .26s both' }}>
          <span aria-hidden style={{ width: 34, height: 34, borderRadius: 999, border: '2.5px solid var(--mf-accent-soft)', borderTopColor: 'var(--mf-accent)', animation: 'mf-spin .7s linear infinite', display: 'block' }} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{launch.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>
            {launch.kindName} · {launch.space} 여는 중
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
