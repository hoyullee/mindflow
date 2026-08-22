import { useId, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AUTH } from './tokens';
import { calloutStyle, codeInputStyle, errorMsgStyle, fieldLabelStyle, fieldStyle, noticeMsgStyle, textInputStyle } from './styles';

/**
 * 네 단계(로그인·가입·비밀번호 찾기·인증)가 함께 쓰는 필드·안내 조각들.
 * 디자인 원본은 한 템플릿 안에서 `sc-if`로 갈랐지만, 여기서는 단계별 컴포넌트가
 * 같은 조각을 가져다 쓴다 — 값을 두 벌로 두면 한쪽만 고쳐지는 일이 생긴다.
 */

/**
 * [라벨][입력] 묶음. `aside`는 라벨 오른쪽에 붙는 것(비밀번호 찾기 링크).
 *
 * 감싸는 요소가 `<label>`이 **아닌** 이유(실브라우저에서 잡은 함정): 라벨 안의
 * 클릭은 그 라벨이 가리키는 컨트롤로 전달되는데, `<button>`도 그 대상이 될 수
 * 있어서 비밀번호 보기(눈) 버튼을 눌렀더니 같은 라벨 안의 '비밀번호 찾기'가
 * 실행되며 화면이 넘어갔다. 그래서 묶음은 `<div>`로 두고, 글자만 `htmlFor`로
 * 입력과 잇는다(스크린리더에서 라벨 관계는 그대로 성립한다).
 */
export function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div style={fieldStyle}>
      {aside ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor={id} style={{ ...fieldLabelStyle, flex: 1, minWidth: 0 }}>
            {label}
          </label>
          {aside}
        </span>
      ) : (
        <label htmlFor={id} style={fieldLabelStyle}>
          {label}
        </label>
      )}
      {children(id)}
    </div>
  );
}

export function EmailInput({
  id,
  value,
  onChange,
  onKeyDown,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
}) {
  return (
    <input
      id={id}
      className="lg-input"
      type="email"
      autoComplete="email"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="name@example.com"
      style={textInputStyle(invalid)}
    />
  );
}

/** 비밀번호 칸 — 오른쪽에 보기/가리기 토글. 사람이 방금 친 것을 확인할 수
 * 있으면 오타로 막히는 일이 줄어든다(디자인 원본에도 있다). */
export function PasswordInput({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoComplete,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        id={id}
        className="lg-input"
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...textInputStyle(invalid), flex: 1, minWidth: 0, padding: '0 44px 0 14px' }}
      />
      <button
        type="button"
        className="lg-eye"
        onClick={() => setShow((v) => !v)}
        title={show ? '비밀번호 가리기' : '비밀번호 보기'}
        aria-label={show ? '비밀번호 가리기' : '비밀번호 보기'}
        style={{
          position: 'absolute',
          right: 6,
          width: 34,
          height: 34,
          border: 0,
          borderRadius: 9,
          background: 'transparent',
          color: AUTH.faint,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}

export function CodeInput({
  id,
  value,
  onChange,
  onKeyDown,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      id={id}
      className="lg-input lg-code"
      inputMode="numeric"
      // OTP 필드임을 브라우저에 명시 — 엉뚱한 값이 자동완성돼 코드칸에 미리
      // 채워지던 문제 방지. Supabase 이메일 OTP는 6~10자리라 길이를 6으로 고정하지 않는다.
      autoComplete="one-time-code"
      maxLength={10}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="메일로 받은 코드"
      style={codeInputStyle}
    />
  );
}

const MAIL_PATH = (
  <>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3.4 6.3 7.5 5.6a2 2 0 0 0 2.2 0l7.5-5.6" />
    <path d="M3.2 17.8 9 12.4M20.8 17.8 15 12.4" />
  </>
);

const KEY_PATH = (
  <>
    <circle cx="8.5" cy="15.5" r="4.2" />
    <path d="m11.6 12.4 8.2-8.2" />
    <path d="m15.8 8.2 2.6 2.6" />
    <path d="m18.4 5.6 2.6 2.6" />
  </>
);

/** 단계 안내 — 아이콘 + 설명문. 비밀번호 찾기는 열쇠, 코드 입력은 메일. */
export function IntroBlock({ kind, children }: { kind: 'mail' | 'key'; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={AUTH.accentIcon} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
        {kind === 'key' ? KEY_PATH : MAIL_PATH}
      </svg>
      <span style={{ fontSize: 13.5, lineHeight: 1.7, color: AUTH.label }}>{children}</span>
    </div>
  );
}

/** 초록 체크 + 안내(코드를 보냈다는 알림 등). */
export function NoticeLine({ children }: { children: ReactNode }) {
  return (
    <span style={noticeMsgStyle}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={AUTH.ok} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', marginTop: 3 }} aria-hidden="true">
        <path d="m5 13 4.5 4.5L19 7" />
      </svg>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </span>
  );
}

/** 아이콘 없는 안내 한 줄 — 성공이 아닌 알림(세션 만료·가입 미완료 등)에 쓴다.
 * 초록 체크는 "잘 됐다"는 뜻이라 이런 문구에 붙이면 어긋난다. */
export function InfoLine({ children }: { children: ReactNode }) {
  return (
    <span style={{ ...noticeMsgStyle, color: AUTH.label }} role="status">
      {children}
    </span>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <span role="alert" style={errorMsgStyle}>
      {children}
    </span>
  );
}

/** 눈에 띄는 안내 상자(이미 가입된 이메일 · 미가입 이메일). */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div role="alert" style={calloutStyle}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={AUTH.accentIcon} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11.5v5" strokeLinecap="round" />
        <circle cx="12" cy="7.6" r="0.6" fill={AUTH.accentIcon} />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** 아래쪽 [← 뒤로] … [코드 다시 보내기] 줄. */
export function BackRow({
  backLabel,
  onBack,
  resend,
}: {
  backLabel: string;
  onBack: () => void;
  resend?: { cooldown: number; onResend: () => void };
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button type="button" className="link-tab" onClick={onBack} style={{ flex: '0 0 auto', border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 12.5, fontWeight: 600, color: AUTH.sub, cursor: 'pointer' }}>
        ← {backLabel}
      </button>
      <span style={{ flex: 1 }} />
      {resend && (
        <button
          type="button"
          className="link-tab"
          onClick={resend.onResend}
          disabled={resend.cooldown > 0}
          style={{
            border: 0,
            background: 'transparent',
            padding: '2px 0',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: resend.cooldown > 0 ? AUTH.faint2 : AUTH.accentDeep,
            cursor: resend.cooldown > 0 ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {resend.cooldown > 0 ? `코드가 안 왔나요? ${resend.cooldown}초 후 다시 보내기` : '코드 다시 보내기'}
        </button>
      )}
    </div>
  );
}
