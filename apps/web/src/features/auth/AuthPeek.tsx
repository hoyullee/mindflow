import { useEffect, useRef, useState } from 'react';
import { AUTH } from './tokens';
import { AUTH_SCENES, AUTH_SCENE_CHIPS, type AuthSceneKey } from './authScenes';

/** 장면 회전 주기(ms) — 디자인 원본과 같다. */
const ROTATE_MS = 4200;
/** 칩을 눌러 고정한 뒤 자동 회전이 다시 도는 데 걸리는 시간(ms). */
const HOLD_MS = 15000;

/**
 * 로그인 화면 오른쪽의 미리보기 — 마인드맵·화이트보드·칸반 보드를 번갈아
 * 보여 준다(칩을 누르면 그 보기로 고정, 15초 뒤 자동 회전 복귀).
 *
 * 장식이라 문서를 만들지도 저장하지도 않는다. 좁은 화면에서는 아예 그리지 않는다
 * (`Login.tsx`에서 판단) — 폼이 이 화면의 일이고 미리보기는 곁다리다.
 */
export function AuthPeek() {
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<AuthSceneKey | null>(null);
  /** 장면이 바뀔 때마다 등장 애니메이션을 다시 트리거하려면 키프레임 이름을
   * 번갈아 써야 한다(같은 이름으로는 재생이 다시 시작되지 않는다). */
  const [flip, setFlip] = useState(0);
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mode: AuthSceneKey = pinned ?? AUTH_SCENE_CHIPS[tick % AUTH_SCENE_CHIPS.length]!.key;
  const scene = AUTH_SCENES[mode];

  useEffect(() => {
    if (pinned) return; // 고정 중에는 회전하지 않는다.
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setFlip((f) => 1 - f);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [pinned]);

  useEffect(() => () => clearTimeout(holdRef.current), []);

  const pick = (key: AuthSceneKey) => {
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => setPinned(null), HOLD_MS);
    if (key !== mode) {
      setPinned(key);
      setFlip((f) => 1 - f);
    } else {
      setPinned(key);
    }
  };

  const pop = flip ? 'mf-lg-pop' : 'mf-lg-pop2';

  return (
    <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 560, animation: 'mf-lg-rise .8s cubic-bezier(.2,.8,.3,1) .18s both' }} aria-hidden="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px 10px', flexWrap: 'wrap' }}>
        {AUTH_SCENE_CHIPS.map((c) => {
          const on = mode === c.key;
          return (
            <button
              key={c.key}
              type="button"
              className="lg-chip"
              onClick={() => pick(c.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                height: 31,
                padding: '0 12px',
                borderRadius: 999,
                border: `1px solid ${on ? AUTH.accentBorder : AUTH.borderSoft}`,
                background: on ? AUTH.accentSoft : 'transparent',
                color: on ? AUTH.accentDeep : AUTH.faint,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background .18s ease, color .18s ease, border-color .18s ease',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 2.5, background: on ? c.dot : '#D8CBBD', display: 'block', transition: 'background .18s ease' }} />
              {c.name}
            </button>
          );
        })}
      </div>

      <div style={{ borderRadius: 18, border: `1px solid #EBE1D7`, background: AUTH.field, overflow: 'hidden', boxShadow: '0 30px 60px -38px rgba(46,42,38,.4)' }}>
        {/* 창 제목 줄 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderBottom: `1px solid ${AUTH.line}`, background: AUTH.pageBg }}>
          <span style={{ display: 'flex', gap: 5, flex: '0 0 auto' }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 8, height: 8, borderRadius: 99, background: '#E7DCCF', display: 'block' }} />
            ))}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: AUTH.mono, fontSize: 10.5, color: '#A79C90', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.title}</span>
          <span style={{ display: 'flex', flex: '0 0 auto' }}>
            <span style={{ width: 20, height: 20, borderRadius: 99, background: '#EE6B45', border: `1.5px solid ${AUTH.pageBg}`, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>지</span>
            <span style={{ width: 20, height: 20, marginLeft: -6, borderRadius: 99, background: '#4A8FE0', border: `1.5px solid ${AUTH.pageBg}`, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>민</span>
          </span>
        </div>

        {/* 캔버스 */}
        <div
          style={{
            position: 'relative',
            height: 'clamp(300px, 32vw, 364px)',
            background: '#FCF8F3',
            backgroundImage: 'radial-gradient(rgba(199,186,172,.5) 1.1px, transparent 1.1px)',
            backgroundSize: '19px 19px',
            overflow: 'hidden',
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {scene.edges.map((e, i) => (
              <path
                key={`${mode}-${i}`}
                d={e.d}
                fill="none"
                stroke="#E9A98F"
                strokeWidth={1.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ strokeDasharray: 200, animation: `mf-lg-draw .7s cubic-bezier(.3,.8,.3,1) ${e.delay} both` }}
              />
            ))}
          </svg>

          {scene.items.map((s, i) => (
            <div
              key={`${mode}-${i}`}
              style={{
                position: 'absolute',
                left: s.l,
                top: s.t,
                width: s.w,
                height: s.h,
                display: 'flex',
                alignItems: s.align,
                justifyContent: s.justify,
                padding: s.pad,
                borderRadius: s.r,
                background: s.bg,
                border: s.border,
                boxShadow: s.shadow,
                color: s.color,
                fontSize: s.fs,
                fontWeight: s.fw,
                lineHeight: 1.45,
                letterSpacing: '-.012em',
                whiteSpace: s.wrap,
                overflow: 'hidden',
                animation: `${pop} .34s cubic-bezier(.2,.8,.3,1) ${(0.022 * i).toFixed(3)}s both`,
              }}
            >
              {s.text}
            </div>
          ))}

          {/* 자리를 가리키는 스레드 핀 */}
          <div style={{ position: 'absolute', left: scene.pin[0], top: scene.pin[1], display: 'flex', alignItems: 'center', gap: 7, maxWidth: '44%', animation: 'mf-lg-pin 5.6s ease-in-out infinite' }}>
            <span
              style={{
                width: 25,
                height: 25,
                flex: '0 0 auto',
                borderRadius: '99px 99px 99px 5px',
                background: '#EE6B45',
                color: '#fff',
                fontSize: 9,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 9px 16px -9px rgba(238,107,69,.9)',
              }}
            >
              지수
            </span>
            <span
              style={{
                minWidth: 0,
                height: 24,
                padding: '0 10px',
                borderRadius: 99,
                background: AUTH.field,
                border: '1px solid #F0E6DC',
                fontSize: 11,
                fontWeight: 600,
                color: '#6E675F',
                display: 'inline-flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                boxShadow: '0 9px 18px -13px rgba(46,42,38,.5)',
              }}
            >
              {scene.pinText}
            </span>
          </div>

          {/* 함께 보는 사람의 커서 */}
          <div style={{ position: 'absolute', left: scene.cursor[0], top: scene.cursor[1], animation: 'mf-lg-cursor 8s ease-in-out infinite' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="#4A8FE0" stroke={AUTH.pageBg} strokeWidth={1.4} style={{ display: 'block', filter: 'drop-shadow(0 3px 6px rgba(46,42,38,.35))' }}>
              <path d="M5 3l14 8-6.5 1.6L9.5 19z" />
            </svg>
            <span style={{ position: 'absolute', left: 15, top: 15, height: 18, padding: '0 7px', borderRadius: 5, background: '#4A8FE0', color: '#fff', fontSize: 9.5, fontWeight: 700, lineHeight: '18px', whiteSpace: 'nowrap' }}>민준</span>
          </div>
        </div>

        {/* 아래 설명 줄 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderTop: `1px solid ${AUTH.line}`, background: AUTH.pageBg }}>
          <span style={{ fontSize: 11.5, color: AUTH.sub, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.caption}</span>
          <span style={{ fontFamily: AUTH.mono, fontSize: 10, color: AUTH.faint2, whiteSpace: 'nowrap', flex: '0 0 auto' }}>자동 저장됨</span>
        </div>
      </div>
    </div>
  );
}
