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

export function PresenceAvatars({ controller, isMobile = false, withSelf = false }: { controller: EditorController; isMobile?: boolean; withSelf?: boolean }) {
  const th = controller.uiTheme;
  const { peers, localUser } = controller.presence;
  // 끊긴 동안의 얼굴은 낡은 정보다 — 그 상태는 배너/배지가 말한다(PresenceBar).
  if (controller.collabBlocked) return null;
  // **나를 포함할 것인가.** 캔버스 GNB에서는 아니다(내 얼굴은 프로필 자리에 이미
  // 있고, 여기서 묻는 것은 "또 누가 있나"다). 공책 상단의 `공유` 옆에서는 **맞다**
  // (요청) — 그 자리는 "지금 이 문서를 누가 보나"의 답이고, 혼자일 때 아무것도
  // 없으면 빈자리가 "아무도 없다"로 읽히며 남이 들어온 순간에만 자리가 출렁인다.
  const all = withSelf ? [{ key: 'me', user: localUser }, ...peers.map((p) => ({ key: String(p.clientId), user: p.user }))] : peers.map((p) => ({ key: String(p.clientId), user: p.user }));
  if (!all.length) return null;

  const size = isMobile ? 22 : 26;
  const faces = all.slice(0, MAX_FACES);
  const rest = all.length - faces.length;

  const circle = (key: string, bg: string, ink: string, label: string, title: string, i: number, src?: string | null) => (
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
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {label}
      {/* 프로필 이미지(0031) — 글자를 **아래에 남겨 둔다**: 주소가 죽었거나 막혔을 때
          깜빡임 없이 첫 글자로 되돌아간다(홈 `ProfileAvatar`와 같은 처방). */}
      {src && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </span>
  );

  return (
    <div
      data-presence-avatars
      aria-label={`${all.length}명 접속 중`}
      title={all.map((p) => p.user.name).join(', ')}
      style={{ display: 'flex', alignItems: 'center', marginRight: 2, flexShrink: 0 }}
    >
      {faces.map((p, i) => circle(p.key, mixHex(p.user.color, '#ffffff', 0.55), mixHex(p.user.color, '#000000', 0.45), p.user.name.slice(0, 1), p.key === 'me' ? `${p.user.name} (나)` : p.user.name, i, p.user.avatar))}
      {rest > 0 && circle('rest', th.panel2, th.subtext, `+${rest}`, `외 ${rest}명`, faces.length)}
    </div>
  );
}
