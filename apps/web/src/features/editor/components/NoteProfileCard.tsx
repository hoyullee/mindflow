// 멘션 칩에 마우스를 올리면 뜨는 **프로필 카드**(스펙 4-8).
//
// 여닫는 타이밍은 날짜 칩과 같다(110ms / 180ms) — 그쪽 주석에 이유가 있다. 다른 것은
// 무엇을 말하느냐다: 날짜 칩은 "그날 무엇이 있나"이고, 이 카드는 **"이 사람이 누구이고
// 지금 여기 있나"**다.
//
// 「지금 이 페이지를 보는 중」은 협업 awareness(`presence.peers`)에서 읽는다. 그 신호가
// 드는 것은 **이름**뿐이라(색·사진과 함께 실어 보내는 값이다 — 이메일은 보내지 않는다)
// 참가자 명단의 표시 이름·이메일과 맞춰 본다. 이름이 같은 두 사람이 동시에 붙어 있으면
// 틀릴 수 있는 대조이지만, 틀렸을 때 잃는 것은 초록 점 하나다.

import type { CSSProperties } from 'react';
import type { ShareParticipant } from '../../../adapters/ports';
import { Avatar } from './commentPinShape';
import type { Theme } from '../theme';

/** 우측 열의 페이지 댓글 입력칸에 글자를 밀어 넣는 문서 이벤트(4-8의 「댓글로 부르기」). */
export const NOTE_COMMENT_SEED_EVENT = 'mf-note-comment-seed';

export function seedNoteComment(text: string): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(NOTE_COMMENT_SEED_EVENT, { detail: text }));
}

/** 권한 상자의 한 줄(4-8) — 초대되지 않은 사람에게도 할 말이 있어야 한다. */
export function roleLine(who: ShareParticipant | null, here: boolean): string {
  if (!who) return '이 공책에 초대되지 않았어요';
  const base = who.kind === 'owner' || who.role === 'edit' ? '편집 가능' : '보기만 가능';
  return here ? `${base} · 지금 이 페이지를 보는 중` : base;
}

const BAR: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 34,
  border: 0,
  borderTop: '1px solid var(--mf-border-soft)',
  background: 'var(--mf-note-chip-bg)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

export function NoteProfileCard({
  email,
  label,
  who,
  here,
  rect,
  theme,
  onEnter,
  onLeave,
  onCall,
}: {
  email: string;
  /** 본문에 적힌 이름(`@이름`) — 명단에 없는 사람이어도 부를 이름은 있다. */
  label: string;
  /** 이 공책의 참가자 중 그 사람 — 없으면 초대되지 않았다. */
  who: ShareParticipant | null;
  /** 지금 이 문서를 보고 있는가(awareness). */
  here: boolean;
  rect: { left: number; top: number; bottom: number };
  theme: Theme;
  onEnter: () => void;
  onLeave: () => void;
  /** 「댓글로 부르기」 — 댓글 열을 열고 입력칸에 `@이름 `을 채운다. */
  onCall: () => void;
}) {
  const th = theme;
  const name = who?.displayName?.trim() || label || email.split('@')[0] || email;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const below = vh - rect.bottom - 8;
  const place = below > 220 ? 'below' : 'above';
  const left = Math.max(8, Math.min(rect.left, vw - 264 - 8));

  return (
    <div
      data-note-profile={email}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{
        position: 'fixed',
        left,
        ...(place === 'below' ? { top: rect.bottom + 8 } : { bottom: vh - rect.top + 8 }),
        zIndex: 80,
        width: 264,
        boxSizing: 'border-box',
        borderRadius: 14,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border-soft)',
        boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
        overflow: 'hidden',
        animation: 'mf-note-pop .13s ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 14px 12px' }}>
        <span style={{ position: 'relative', flex: '0 0 auto', display: 'inline-flex' }}>
          <Avatar name={name} size={38} src={who?.avatarUrl ?? null} />
          {here && (
            <span
              data-profile-here
              aria-label="지금 이 페이지를 보는 중"
              style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 99, background: '#5db07f', border: '2px solid var(--mf-card)' }}
            />
          )}
        </span>
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <span data-profile-name style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 800, color: th.text }}>
            {name}
          </span>
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--mf-muted)' }}>{email}</span>
        </span>
      </div>
      <p data-profile-role style={{ margin: '0 14px 12px', padding: '8px 10px', borderRadius: 9, background: 'var(--mf-note-chip-bg)', fontSize: 12, color: th.subtext, wordBreak: 'keep-all' }}>
        {roleLine(who, here)}
      </p>
      <button type="button" data-profile-call onClick={onCall} style={{ ...BAR, color: th.subtext }}>
        💬 댓글로 부르기
      </button>
    </div>
  );
}
