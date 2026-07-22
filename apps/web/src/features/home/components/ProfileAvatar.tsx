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
}

/**
 * The profile avatar used across the LNB popover and the account-settings
 * modal: the brand-coral initial circle, with the provider photo (Google)
 * layered on top when one exists. The initial stays rendered UNDER the image,
 * so a broken/blocked photo URL degrades to the initial without a flash —
 * `onError` just hides the img. `referrerPolicy="no-referrer"` matters:
 * googleusercontent photo URLs reject requests carrying a cross-site referrer.
 */
export function ProfileAvatar({ initial, avatarUrl, size, radius, fontSize, boxShadow }: Props) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        background: '#f0663f',
        color: '#fff',
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

