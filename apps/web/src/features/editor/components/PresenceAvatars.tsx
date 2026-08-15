// 접속자 아바타 — **상단 바 안**의 겹친 원들(디자인 원본).
//
// 예전에는 캔버스 우상단에 뜬 알약("● ● N명 접속 중")이었다. 디자인 원본은 이걸
// GNB 오른쪽 묶음(검색·공유·내보내기) 앞에 놓고 **아바타만** 남긴다 — 사람이 몇
// 명인지는 얼굴 수가 이미 말하고, 떠 있는 알약 하나가 캔버스를 덜 가린다.
//
// 색은 피어 색(정체성 시드) 하나에서 **파스텔 면 + 진한 잉크** 한 쌍을 만든다:
// 원본이 손으로 고른 색쌍(`#F5C9A8` 면 / `#8A4A22` 글자)과 같은 관계이면서,
// 커서·원격 선택 하이라이트가 쓰는 그 사람의 색과도 이어진다.

import type { EditorController } from '../useEditorState';
import { mixHex } from '../theme';

/** 한 줄에 세우는 최대 얼굴 수 — 그보다 많으면 마지막 칸이 `+N`이 된다. */
const MAX_FACES = 3;

export function PresenceAvatars({ controller, isMobile = false }: { controller: EditorController; isMobile?: boolean }) {
  const th = controller.uiTheme;
  const { peers } = controller.presence;
  // 끊긴 동안의 얼굴은 낡은 정보다 — 그 상태는 배너/배지가 말한다(PresenceBar).
  if (!peers.length || controller.collabBlocked) return null;

  const size = isMobile ? 22 : 26;
  const faces = peers.slice(0, MAX_FACES);
  const rest = peers.length - faces.length;

  const circle = (key: string, bg: string, ink: string, label: string, title: string, i: number) => (
    <span
      key={key}
      title={title}
      aria-hidden={undefined}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: ink,
        border: `2px solid ${th.panel}`,
        marginLeft: i === 0 ? 0 : -7,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: isMobile ? 9.5 : 10.5,
        fontWeight: 700,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      data-presence-avatars
      aria-label={`${peers.length}명 접속 중`}
      title={peers.map((p) => p.user.name).join(', ')}
      style={{ display: 'flex', alignItems: 'center', marginRight: 2, flexShrink: 0 }}
    >
      {faces.map((p, i) => circle(String(p.clientId), mixHex(p.user.color, '#ffffff', 0.55), mixHex(p.user.color, '#000000', 0.45), p.user.name.slice(0, 1), p.user.name, i))}
      {rest > 0 && circle('rest', th.panel2, th.subtext, `+${rest}`, `외 ${rest}명`, faces.length)}
    </div>
  );
}
