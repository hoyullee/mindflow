// 피드백 보내기 모달 — 홈(프로필 메뉴)과 에디터(보기/☰ 메뉴)가 함께 쓴다.
//
// 수집처는 Supabase `feedback` 테이블(0014, insert 전용 우편함 — 운영자가
// Studio에서 조회). 로컬/데모 모드는 localStorage에 쌓이고 실제 전송이 아님을
// 안내한다(ShareModal의 데모 안내와 같은 태도). 화면 맥락(page)·빌드 스탬프·
// userAgent를 함께 실어 재현 조사를 돕는다.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useBackend, useFeedbackStore } from '../adapters/BackendContext';
import type { FeedbackCategory } from '../adapters/ports';

declare const __BUILD_AT__: string;
declare const __BUILD_SHA__: string;

/** 에디터의 `uiTheme`(라이트/다크)와 홈(항상 라이트)이 같은 모달을 쓰도록
 * 필요한 색만 구조적으로 받는다 — 기본값은 홈 계열 라이트. */
export interface FeedbackTheme {
  panel: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  accentInk: string;
  canvasBg: string;
}

const LIGHT: FeedbackTheme = {
  panel: '#ffffff',
  text: '#33281f',
  subtext: '#9c8b7e',
  border: '#eee2d9',
  accent: '#f0663f',
  accentInk: '#ffffff',
  canvasBg: '#faf6f1',
};

/** 6자리 hex → rgba — 완료 배지의 은은한 배경(테마 accent 파생). */
function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 디자인 원본의 네 갈래 — 아이콘까지 원본 도형 그대로(찡그린 얼굴·경고 삼각형·
 * 전구·말풍선). 안내 문구도 고른 갈래에 따라 바뀐다(무엇을 적어야 할지 알려 준다). */
const CATEGORIES: { key: FeedbackCategory; label: string; ph: string; icon: JSX.Element }[] = [
  {
    key: 'ux',
    label: '불편해요',
    ph: '예) 메모를 접었을 때 스크롤 위치가 초기화돼요',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 15.5c1-1 5-1 6 0M9 9.5h.01M15 9.5h.01" />
      </>
    ),
  },
  {
    key: 'bug',
    label: '오류 제보',
    ph: '어떤 동작에서 문제가 생겼는지 알려 주세요',
    icon: (
      <>
        <path d="M12 4.5 20 19H4z" />
        <path d="M12 10v4M12 16.5h.01" />
      </>
    ),
  },
  {
    key: 'idea',
    label: '아이디어',
    ph: '있었으면 하는 기능을 자유롭게 적어 주세요',
    icon: (
      <>
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1h6c0-.4.1-.8.5-1.1A6 6 0 0 0 12 3z" />
      </>
    ),
  },
  {
    key: 'other',
    label: '기타',
    ph: '무엇이든 편하게 남겨 주세요',
    icon: <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6a8 8 0 0 1 8-8h1a8 8 0 0 1 8 3z" />,
  },
];

export function FeedbackModal({ open, onClose, page, theme }: { open: boolean; onClose: () => void; page: 'home' | 'editor'; theme?: FeedbackTheme }) {
  const th = theme ?? LIGHT;
  const store = useFeedbackStore();
  const { mode } = useBackend();
  const [category, setCategory] = useState<FeedbackCategory>('ux');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // 열 때마다 새 제출 — 직전 내용/완료 화면이 남아 있지 않게.
  useEffect(() => {
    if (!open) return;
    setCategory('ux');
    setMessage('');
    setError('');
    setDone(false);
    setBusy(false);
    areaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    const body = message.trim();
    if (!body) {
      setError('내용을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await store.submit({
      category,
      message: body,
      page,
      meta: {
        build: typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : 'dev',
        // 어느 커밋인지 — 제보를 받은 뒤 "그 화면이 어느 빌드였나"를 되짚는 유일한 단서다.
        sha: typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : 'dev',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      },
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDone(true);
  };

  const chip = (c: (typeof CATEGORIES)[number]): JSX.Element => {
    const active = category === c.key;
    return (
      <button
        key={c.key}
        type="button"
        onClick={() => setCategory(c.key)}
        aria-pressed={active}
        style={{
          height: 56,
          borderRadius: 14,
          border: `1.5px solid ${active ? th.accent : th.border}`,
          background: active ? tint(th.accent, 0.09) : th.panel,
          color: active ? th.accent : th.subtext,
          fontFamily: 'inherit',
          fontSize: 11.5,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {c.icon}
        </svg>
        {c.label}
      </button>
    );
  };


  const cardStyle: CSSProperties = {
    width: 452,
    maxWidth: 'calc(100vw - 32px)',
    background: th.panel,
    borderRadius: 22,
    boxShadow: '0 22px 60px rgba(0,0,0,.28)',
    padding: '22px 22px 18px',
    boxSizing: 'border-box',
    color: th.text,
  };

  return (
    <div
      data-feedback-modal
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 260, animation: 'mf-dim-in .18s ease-out' }}
      onClick={onClose}
    >
      <div role="dialog" aria-label="피드백 보내기" onClick={(e) => e.stopPropagation()} style={cardStyle}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '18px 0 10px' }}>
            {/* SVG 배지(요청 — 이모지는 플랫폼마다 다르게 그려진다): 테마 accent를
                따르는 원형 칩 + 종이비행기(보냄) 스트로크 아이콘. */}
            <div
              aria-hidden="true"
              data-done-icon
              style={{ width: 54, height: 54, margin: '0 auto 12px', borderRadius: '50%', background: tint(th.accent, 0.12), color: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: -2, marginTop: 2 }}>
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22 11 13 2 9z" />
              </svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>전달됐어요, 고마워요!</div>
            <div style={{ fontSize: 12.5, color: th.subtext, lineHeight: 1.6, marginBottom: 18 }}>보내 주신 의견은 그리오를 다듬는 데 큰 도움이 됩니다.</div>
            <button
              type="button"
              onClick={onClose}
              style={{ height: 40, padding: '0 22px', border: 'none', borderRadius: 10, ...accentFill(th.accent), color: th.accentInk, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            {/* 디자인 원본의 머리: 강조색 틴트 칩에 담은 말풍선 + 제목/설명. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 15 }}>
              <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 11, background: tint(th.accent, 0.12), color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6a8 8 0 0 1 8-8h1a8 8 0 0 1 8 3z" />
                </svg>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.02em' }}>피드백 보내기</span>
                <span style={{ fontSize: 12, lineHeight: 1.6, color: th.subtext }}>불편했던 점, 이상하게 동작하는 부분, 있었으면 하는 기능. 무엇이든 편하게 남겨 주세요.</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, marginBottom: 13 }}>{CATEGORIES.map(chip)}</div>
            <textarea
              ref={areaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError('');
              }}
              placeholder={(CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0]!).ph}
              aria-label="피드백 내용"
              rows={5}
              maxLength={4000}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                border: `1px solid ${th.border}`,
                borderRadius: 14,
                background: th.canvasBg,
                color: th.text,
                fontFamily: 'inherit',
                fontSize: 13.5,
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                minHeight: 110,
              }}
            />
            {/* 남은 글자수 — 디자인 원본의 `0/500` 자리(우리 상한은 4000자). */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
              <span data-fb-count style={{ fontFamily: "'JetBrains Mono',ui-monospace,monospace", fontSize: 11, color: th.subtext }}>
                {message.length}/4000
              </span>
            </div>
            {mode === 'local' && (
              <div style={{ fontSize: 12, color: th.subtext, background: th.canvasBg, border: `1px solid ${th.border}`, borderRadius: 9, padding: '8px 10px', marginTop: 10, lineHeight: 1.5 }}>
                데모 모드예요. 피드백은 이 브라우저에만 저장되고 실제로 전송되지는 않습니다.
              </div>
            )}
            {error && (
              <div role="alert" style={{ fontSize: 12.5, color: '#d2503c', marginTop: 10, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ flex: '1 1 auto', height: 42, border: `1px solid ${th.border}`, borderRadius: 999, background: 'transparent', color: th.text, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                style={{ flex: '1.6 1 auto', height: 42, border: 'none', borderRadius: 999, ...accentFill(th.accent), color: th.accentInk, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 강조(주 동작) 버튼의 면 — 디자인 원본의 세로 그라디언트 + 색 그림자.
 * 에디터 `chrome.ts`와 같은 규칙이지만, 이 모달은 홈과 함께 쓰므로 테마 프롭의
 * 강조색에서 직접 만든다(에디터 팔레트에 묶이지 않게). */
function accentFill(accent: string): { background: string; boxShadow: string } {
  const c = accent.replace('#', '');
  const n = (i: number) => parseInt(c.substring(i, i + 2), 16);
  const mix = (v: number, to: number, t: number) => Math.round(v + (to - v) * t);
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  const top = hex(mix(n(0), 255, 0.08), mix(n(2), 255, 0.08), mix(n(4), 255, 0.08));
  const bottom = hex(mix(n(0), 0, 0.06), mix(n(2), 0, 0.06), mix(n(4), 0, 0.06));
  return { background: `linear-gradient(180deg,${top},${bottom})`, boxShadow: `0 10px 20px -12px rgba(${n(0)},${n(2)},${n(4)},.9)` };
}
