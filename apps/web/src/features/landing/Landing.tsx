import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBackend } from '../../adapters/BackendContext';
import { useUpdateGuard } from '../../pwa/updateGate';
import {
  COLLAB_POINTS,
  FAQS,
  FEATURES,
  HERO_FACTS,
  HERO_SCENES,
  HERO_TABS,
  MODE_CARDS,
  THREADS,
  type HeroSceneKey,
} from './landingData';
import './landing.css';

/**
 * 공개 랜딩 페이지 — 루트(`/`). 2026-08 v2 리뉴얼: 디자인 원본은 저장소 루트의
 * `Geurio 랜딩 리뉴얼 v2.dc.html`(Claude Design). 존재 이유가 둘이다:
 *
 * 1. Google 브랜드 인증 요건: 심사자가 홈페이지(geurio.com)를 열었을 때
 *    (a) 앱의 목적 설명과 (b) 동의 화면과 일치하는 앱 이름("Geurio")이
 *    보여야 하고, 개인정보처리방침이 그 페이지에서 도달 가능해야 한다.
 * 2. 서비스 소개: 비로그인 방문자에게 로그인 폼 대신 제품을 먼저 보여준다.
 *
 * 로그인 여부에 따라 CTA가 /login ↔ /home 으로 바뀐다(표시용일 뿐 가드가
 * 아니다 — /home은 여전히 RequireAuth가 지킨다).
 *
 * ⚠️ 정적 쌍둥이: 프로덕션(Vercel)에서 "/"의 최초 로드는 `public/landing.html`
 * (vercel.json 리라이트)이 서빙한다 — 인증 크롤러가 JS를 실행하지 않아 SPA
 * 루트를 "빈 페이지"로 판정했기 때문. 이 컴포넌트는 dev 서버와 클라이언트 사이드
 * 내비게이션용이다. **내용을 고치면 landing.html도 반드시 함께 고칠 것**(정적
 * 쪽은 히어로 창이 마인드맵 장면 한 장으로 고정되고 FAQ가 `<details>`다.
 * `landing-demo.js` 인핸서가 실브라우저에서 그 창을 회전시킨다).
 */

/** 히어로 창의 보기 회전 주기(ms). */
const ROTATE_MS = 6200;
/** 탭을 눌러 고정한 뒤 자동 회전이 다시 도는 데 걸리는 시간(ms). */
const HOLD_MS = 14000;

/**
 * 스크롤하며 하나씩 올라오는 등장 효과 — 접힘선을 넘은 요소에 `lp-on`을 붙인다.
 *
 * 관측(IntersectionObserver)을 쓰지 않는 이유: 관측은 **교차 상태가 바뀔 때만** 알려
 * 주는데, 앵커를 눌러 훌쩍 건너뛴 섹션은 "아래에 있어 안 보임 → 위로 지나가
 * 안 보임"으로 0 → 0이라 콜백이 오지 않는다. 그러면 되돌아와도 영영 투명한
 * 채로 남는다(정적 쌍둥이에서 헤더 #faq 앵커로 재현). 그래서 위치를 직접 재고
 * 이미 지나간 것도 함께 공개한다 — 정적 쪽 인핸서와 같은 규칙이다.
 */
function useScrollReveal() {
  useEffect(() => {
    let pending = Array.from(document.querySelectorAll<HTMLElement>('.lp-rv'));
    if (!pending.length) return;
    pending.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 6) * 55}ms`;
    });

    let queued = false;
    const pass = () => {
      queued = false;
      const line = window.innerHeight * 0.88;
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top >= line) return true;
        el.classList.add('lp-on');
        return false;
      });
      if (!pending.length) detach();
    };
    const onMove = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(pass);
    };
    const detach = () => {
      window.removeEventListener('scroll', onMove);
      window.removeEventListener('resize', onMove);
    };

    window.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    pass();
    return detach;
  }, []);
}

/** 히어로 오른쪽의 제품 창 — 세 보기를 번갈아 보여 준다. */
function HeroWindow() {
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<HeroSceneKey | null>(null);
  const [flip, setFlip] = useState(0);
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mode: HeroSceneKey = pinned ?? HERO_TABS[tick % HERO_TABS.length]!.key;
  const scene = HERO_SCENES[mode];

  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setFlip((f) => 1 - f);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [pinned]);

  useEffect(() => () => clearTimeout(holdRef.current), []);

  const pick = (key: HeroSceneKey) => {
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => setPinned(null), HOLD_MS);
    if (key !== mode) setFlip((f) => 1 - f);
    setPinned(key);
  };

  const pop = flip ? 'lp-in-a' : 'lp-in-b';

  return (
    <div className="lp-hero-demo">
      <div className="lp-tabs">
        {HERO_TABS.map((t) => {
          const on = mode === t.key;
          return (
            <button key={t.key} type="button" className={`lp-tab${on ? ' is-on' : ''}`} onClick={() => pick(t.key)}>
              <span className="dot" style={{ background: t.dot }} />
              {t.name}
            </button>
          );
        })}
      </div>

      <div className="lp-window">
        <div className="lp-window-bar">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mono file">geurio.com — {scene.file}</span>
          <span className="faces">
            <i style={{ background: '#EE6B45' }}>지</i>
            <i style={{ background: '#4A8FE0' }}>민</i>
            <i style={{ background: '#69B08A' }}>수</i>
          </span>
        </div>

        <div className="lp-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {scene.edges.map((e, i) => (
              <path
                key={`${mode}-${i}`}
                d={e.d}
                fill="none"
                stroke={e.stroke}
                strokeWidth={0.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ strokeDasharray: 220, animation: `lp-draw .7s cubic-bezier(.3,.8,.3,1) ${e.delay} both` }}
              />
            ))}
          </svg>

          {scene.items.map((s, i) => (
            <div
              key={`${mode}-${i}`}
              className="lp-shape"
              style={{
                left: s.l,
                top: s.t,
                width: s.w,
                height: s.h,
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
                animation: `${pop} .5s cubic-bezier(.2,.8,.3,1) ${(0.04 * i).toFixed(2)}s both`,
              }}
            >
              {s.text}
            </div>
          ))}

          <div className="lp-pin" style={{ left: scene.pin[0], top: scene.pin[1] }}>
            <span className="who">지수</span>
            <span className="say">{scene.pinText}</span>
          </div>

          <div className="lp-cursor">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="#4A8FE0" stroke="#FFFDFB" strokeWidth={1.4} aria-hidden="true">
              <path d="M5 3l14 8-6.5 1.6L9.5 19z" />
            </svg>
            <span>민준</span>
          </div>
        </div>

        <div className="lp-window-foot">
          <span className="cap">{scene.caption}</span>
          <span className="mono hint">{scene.hint}</span>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const { auth } = useBackend();
  const [authed, setAuthed] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  // 소개 페이지에는 사용자가 만들어 둔 상태가 없다 — 새 배포는 물어보지 말고 바로 적용.
  useUpdateGuard('safe');
  useScrollReveal();

  useEffect(() => {
    let cancelled = false;
    void auth.getSession().then((s) => {
      if (!cancelled) setAuthed(!!s);
    });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const ctaHref = authed ? '/home' : '/login';
  const ctaLabel = authed ? '내 문서로' : '무료로 시작하기';

  return (
    <div className="lp-root">
      <header className="lp-header">
        <a className="lp-brand" href="#top">
          <img src="/brand/geurio-logo-120.png" alt="" width={25} height={25} />
          <span>Geurio</span>
        </a>
        <nav className="lp-nav">
          <a href="#modes">세 가지 보기</a>
          <a href="#collab">협업</a>
          <a href="#faq">FAQ</a>
          {/* 돌아온 사람이 곧장 들어갈 자리 — CTA와 같은 곳이지만 문구가 다르다. */}
          {!authed && (
            <Link className="lp-nav-login" to="/login">
              로그인
            </Link>
          )}
          <Link className="lp-pill" to={ctaHref}>
            {ctaLabel}
          </Link>
        </nav>
      </header>

      <section id="top" className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-badge">
            <span className="pulse" />
            설치 없이 웹에서 · 지금은 전부 무료
          </span>
          <h1>
            정리하는 방법은
            <br />
            하나가 아니에요.
          </h1>
          <p>가지를 뻗는 마인드맵, 자유롭게 붙이는 화이트보드, 흐름을 옮기는 칸반 보드. 지금 하는 일에 맞는 방식을 골라 쓰세요.</p>
          <div className="lp-hero-ctas">
            <Link className="lp-cta" to={ctaHref}>
              {ctaLabel}
            </Link>
            <a className="lp-cta-ghost" href="#modes">
              어떻게 쓰는지 보기
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M6 13l6 6 6-6" />
              </svg>
            </a>
          </div>
          <div className="lp-facts">
            {HERO_FACTS.map((f) => (
              <span key={f}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7CA84A" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 13 4.5 4.5L19 7" />
                </svg>
                {f}
              </span>
            ))}
          </div>
        </div>

        <HeroWindow />
      </section>

      <section id="modes" className="lp-modes">
        <div className="lp-sec-head lp-rv">
          <h2>
            일에 맞는 방식으로
            <br />
            바꿔 쓰세요.
          </h2>
          <p>아이디어를 모을 때와 실행을 챙길 때는 필요한 화면이 달라요. 세 가지 보기를 오가며 같은 재료를 다르게 놓아 보세요.</p>
        </div>

        <div className="lp-mode-grid">
          {MODE_CARDS.map((m) => (
            <article key={m.name} className="lp-mode lp-rv">
              <div className="thumb" style={{ background: m.wash }}>
                <span className="grid" />
                {m.shapes.map((s, i) => (
                  <span key={i} style={{ left: s.l, top: s.t, width: s.w, height: s.h, background: s.bg, border: `1px solid ${s.bd}`, borderRadius: s.r }} />
                ))}
              </div>
              <div className="name">
                <span className="dot" style={{ background: m.dot }} />
                <h3>{m.name}</h3>
              </div>
              <p>{m.desc}</p>
              <ul>
                {m.points.map((p) => (
                  <li key={p}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={m.dot} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 13 4.5 4.5L19 7" />
                    </svg>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="collab" className="lp-collab">
        <div className="inner">
          <div className="lp-rv copy">
            <span className="mono eyebrow">Collaboration</span>
            <h2>
              떨어져 있어도
              <br />
              같은 화면을 봐요.
            </h2>
            <p>서로의 커서가 실시간으로 보이고, 묻고 싶은 자리에 핀을 꽂아 이야기해요. 정리된 이야기는 접혀서 화면이 다시 깔끔해져요.</p>
            <div className="points">
              {COLLAB_POINTS.map((c) => (
                <div key={c.title} className="point">
                  <span className="ico" style={{ background: c.iconBg, color: c.iconFg }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={c.icon} />
                    </svg>
                  </span>
                  <span className="txt">
                    <b>{c.title}</b>
                    <span>{c.body}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lp-rv lp-threads">
            <div className="head">
              <span className="dot" />
              <b>스레드 2</b>
              <span className="mono meta">해결 1 · 진행 1</span>
            </div>
            <div className="body">
              {THREADS.map((t) => (
                <div key={t.who} className="thread" style={{ opacity: t.opacity }}>
                  <span className="face" style={{ background: t.bg }}>
                    {t.who}
                  </span>
                  <span className="msg">
                    <span className="meta">
                      <b>{t.who}</b>
                      <span className="when">{t.when}</span>
                      {t.resolved && <span className="solved">해결됨</span>}
                    </span>
                    <span className="text">{t.text}</span>
                  </span>
                </div>
              ))}
              <div className="composer">
                <span className="typing">
                  <span>이 부분은 다음 스프린트로 넘길게요</span>
                </span>
                <span className="send">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12h14M12 6l6 6-6 6" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="lp-features">
        <h2 className="lp-rv">쓰다 보면 알게 되는 것들</h2>
        {/* 등장 단위는 **격자 전체**다(칸 하나하나가 아니다). 이 격자는 1px `gap` 위로
            컨테이너 배경(`#EFE5DB`)이 비쳐 칸 사이 실선을 만드는 구조라, 칸만 숨기면
            내용 없는 베이지 사각형이 먼저 나타난다(제보: "배경이 먼저 보이고 컨텐츠가
            하나씩"). 배경과 칸이 함께 떠오르게 두면 빈 배경이 보이는 순간이 없다. */}
        <div className="grid lp-rv">
          {FEATURES.map((f) => (
            <div key={f.title} className="cell">
              <span className="ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: f.icon }} />
              </span>
              <b>{f.title}</b>
              <span className="body">{f.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="lp-faq">
        <h2 className="lp-rv">자주 묻는 질문</h2>
        <div className="list lp-rv">
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q} className={`item${open ? ' is-open' : ''}`}>
                <button type="button" onClick={() => setOpenFaq(open ? -1 : i)} aria-expanded={open}>
                  <span>{f.q}</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B7ACA1" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                {open && <p>{f.a}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="lp-final">
        <div className="banner lp-rv">
          <span className="glow" />
          <div className="copy">
            <h2>첫 보드는 30초면 만들어요.</h2>
            <p>가입하고 빈 보드를 열면 준비가 끝나요. 카드 등록이나 팀 초대는 나중에 해도 괜찮아요.</p>
          </div>
          <div className="acts">
            <Link className="lp-cta" to={ctaHref}>
              {ctaLabel}
            </Link>
            <a className="ghost" href="#top">
              처음으로
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="inner">
          <span className="brand">
            <img src="/brand/geurio-logo-120.png" alt="" width={20} height={20} />
            <b>Geurio</b>
          </span>
          {/* 앱의 목적 설명 — Google 브랜드 인증이 홈페이지에서 확인하는 3요소 중 하나. */}
          <span className="tag">마인드맵 · 화이트보드 · 칸반 보드를 한곳에서</span>
          <span className="links">
            <a href="/terms">이용약관</a>
            <a href="/privacy">개인정보처리방침</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
