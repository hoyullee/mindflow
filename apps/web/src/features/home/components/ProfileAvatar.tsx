interface Props {
  /** Fallback glyph shown when there is no (or a broken) avatar image. */
  initial: string;
  /** Identity-provider photo URL (Google), or null for email/demo accounts. */
  avatarUrl: string | null;
  size: number;
  radius: number;
  fontSize: number;
  /** Extra styles for the outer box (shadows etc. from the call sites). */
  boxShadow?: string;
  /**
   * 위가 조금 밝은 **세로 그라디언트**(스펙: LNB 프로필 카드·설정 머리의 아바타).
   * 색을 따로 적지 않고 잉크 토큰에서 섞는다 — 다크에서도 뒤집힌 잉크 그대로 선다.
   */
  gradient?: boolean;
}

/**
 * The profile avatar used across the LNB popover and the account-settings
 * modal: the brand-coral initial circle, with the provider photo (Google)
 * layered on top when one exists. The initial stays rendered UNDER the image,
 * so a broken/blocked photo URL degrades to the initial without a flash —
 * `onError` just hides the img. `referrerPolicy="no-referrer"` matters:
 * googleusercontent photo URLs reject requests carrying a cross-site referrer.
 */
export function ProfileAvatar({ initial, avatarUrl, size, radius, fontSize, boxShadow, gradient = false }: Props) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        // 디자인 개정(첨부 이미지): 강조색 그라디언트 → **잉크색 사각**에 밝은 글자.
        // 다크에서는 토큰이 뒤집혀 밝은 면에 어두운 글자가 된다(대비 유지).
        backgroundColor: 'var(--mf-text)',
        // 섞기(`color-mix`)를 모르는 엔진은 이 한 줄만 버리고 위의 단색으로 선다 —
        // 배경을 한 속성(`background`)으로 적으면 통째로 버려져 투명해진다.
        ...(gradient ? { backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, var(--mf-text) 76%, var(--mf-card)), var(--mf-text))' } : {}),
        color: 'var(--mf-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize,
        flexShrink: 0,
        overflow: 'hidden',
        boxShadow,
      }}
    >
      {initial}
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

/**
 * 아바타에 적을 글자(디자인 개정: "이호율" → "호율"). 한글 이름은 성을 뗀
 * **뒤 두 글자**가 이름으로 읽히고, 그 밖(영문·이메일 로컬파트)은 첫 글자
 * 대문자 하나만 쓴다(두 글자를 욱여넣으면 좁은 사각에서 겹친다).
 */
export function avatarLabel(name: string): string {
  const n = (name || '').trim();
  if (/^[가-힣]{2,}$/.test(n)) return n.slice(-2);
  return (n.charAt(0) || 'M').toUpperCase();
}
