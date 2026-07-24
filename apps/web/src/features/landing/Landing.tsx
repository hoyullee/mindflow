import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBackend } from '../../adapters/BackendContext';
import { BrandMark } from '../../components/BrandMark';

/**
 * 공개 랜딩 페이지 — 루트(`/`). 존재 이유가 둘이다:
 *
 * 1. Google 브랜드 인증 요건: 심사자가 홈페이지 URL(geurio.com)을 열었을 때
 *    (a) 앱의 목적 설명과 (b) 동의 화면과 일치하는 앱 이름("Geurio")이
 *    보여야 한다 — 이전에는 루트가 곧장 /login으로 리다이렉트되어 둘 다
 *    "없음"으로 반려됐다. 개인정보처리방침 링크도 홈페이지에서 도달 가능해야
 *    하므로 푸터에 건다.
 * 2. 서비스 소개: 비로그인 방문자에게 로그인 폼 대신 제품을 먼저 보여준다.
 *
 * 로그인 여부에 따라 CTA가 /login ↔ /home 으로 바뀐다(세션 확인은 표시용일
 * 뿐 가드가 아니다 — /home은 여전히 RequireAuth가 지킨다).
 *
 * ⚠️ 정적 쌍둥이: 프로덕션(Vercel)에서 "/"의 최초 로드는 `public/landing.html`
 * (vercel.json 리라이트)이 서빙한다 — Google의 인증 크롤러가 JS를 실행하지
 * 않아 SPA 루트를 "빈 페이지"로 판정했기 때문. 이 컴포넌트는 dev 서버와
 * 클라이언트 사이드 내비게이션("/"로의 Link 이동)용이다. 내용을 고치면
 * landing.html도 반드시 함께 고칠 것.
 */

const ACCENT = '#f0663f';
const MUTED = '#8a7365';
const CARD_BORDER = '#f2e9e1';

/** 아이콘 SVG 래퍼 — landing.html의 것과 동일한 24×24 라인 아이콘. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const USE_CASES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: '브레인스토밍',
    body: '회의에서든 혼자서든, 떠오르는 생각을 막힘없이 빠르게 펼쳐요.',
    icon: (
      <>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
      </>
    ),
  },
  {
    title: '학습 노트',
    body: '강의와 책의 핵심을 구조로 묶어 오래 기억에 남게 정리해요.',
    icon: (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
        <path d="M4 19a2 2 0 0 0 2 2h13" />
      </>
    ),
  },
  {
    title: '프로젝트 기획',
    body: '목표에서 할 일로 가지를 뻗어 큰 그림과 세부 계획을 함께 세워요.',
    icon: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h11l-2 4 2 4H5" />
      </>
    ),
  },
  {
    title: '회의록',
    body: '논의의 흐름을 실시간으로 정리하고 참석자와 바로 공유해요.',
    icon: <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />,
  },
  {
    title: '글쓰기 개요',
    body: '글의 뼈대를 먼저 짜고 살을 붙여, 논리의 흐름을 놓치지 않아요.',
    icon: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </>
    ),
  },
  {
    title: '의사결정',
    body: '선택지와 근거를 한눈에 늘어놓고 비교해 더 나은 결정을 내려요.',
    icon: (
      <>
        <path d="M6 3v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9v3a6 6 0 0 1-6 6h-3" />
      </>
    ),
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: '중심 주제를 적어요', body: '정리하고 싶은 하나의 주제를 화면 가운데에 놓는 것으로 시작해요.' },
  { title: '가지를 뻗어 이어요', body: '떠오르는 생각을 자식·형제 노드로 이어 붙이며 자연스럽게 구조를 만들어요.' },
  { title: '저장하고 공유해요', body: '자동으로 저장되고, 완성한 맵은 이미지나 파일로 내보내 함께 나눠요.' },
];

const FEATURES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: '자유로운 마인드맵',
    body: '노드·도형·메모·연결선·영역으로 생각을 자유롭게 배치하고, 색과 스타일로 구조를 드러내세요.',
    icon: (
      <>
        <circle cx="5" cy="12" r="2.6" />
        <circle cx="18" cy="6" r="2.6" />
        <circle cx="18" cy="18" r="2.6" />
        <path d="M7.4 11 15.6 6.8" />
        <path d="M7.4 13l8.2 4.2" />
      </>
    ),
  },
  {
    title: '어디서나 이어서',
    body: '웹과 모바일(PWA) 어디서든 열립니다. 자동 저장과 기기 간 동기화로 흐름이 끊기지 않아요.',
    icon: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </>
    ),
  },
  {
    title: '함께, 그리고 내보내기',
    body: '실시간 공동 편집으로 함께 그리고, 완성한 맵은 PNG·Markdown·JSON으로 내보내세요.',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
        <path d="M16 3.1a4 4 0 0 1 0 7.8" />
      </>
    ),
  },
];

const CHIPS = ['6가지 테마', '굵게·색상 서식', '이미지 첨부', '미니맵', '아웃라인 보기', '방사형·조직도 레이아웃', '실시간 협업 커서', '자동 저장', '오프라인 지원'];

const FAQS: { q: string; a: string }[] = [
  { q: '정말 무료인가요?', a: '네. 별도의 설치나 결제 없이 지금 바로 시작할 수 있어요.' },
  { q: '설치해야 하나요?', a: '아니요. 웹 브라우저만 있으면 됩니다. 모바일에서는 홈 화면에 추가하면 앱처럼 전체 화면으로 사용할 수 있어요.' },
  { q: '만든 맵은 안전하게 보관되나요?', a: '편집하는 동안 자동으로 저장되고, 로그인하면 여러 기기에서 같은 맵을 이어서 볼 수 있어요.' },
  { q: '다른 곳으로 내보낼 수 있나요?', a: '완성한 맵을 PNG 이미지, Markdown, JSON 파일로 내보낼 수 있어 다른 문서나 도구로 바로 옮길 수 있어요.' },
];

const sectionHead: CSSProperties = { textAlign: 'center', maxWidth: 620, margin: '0 auto 30px' };
const eyebrow: CSSProperties = { display: 'inline-block', fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: ACCENT, marginBottom: 12 };
const headH2: CSSProperties = { fontSize: 'clamp(22px, 3.6vw, 30px)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.3, marginBottom: 10 };
const headP: CSSProperties = { fontSize: 15, color: MUTED, lineHeight: 1.7 };
const iconBadge = (size: number): CSSProperties => ({ width: size, height: size, borderRadius: size >= 38 ? 11 : 10, background: '#fdeee7', color: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 });
const ctaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: ACCENT,
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: 16,
  padding: '14px 28px',
  borderRadius: 13,
  boxShadow: '0 8px 22px rgba(240,102,63,.32)',
};

function SectionHead({ eyebrow: e, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div style={sectionHead}>
      <span style={eyebrow}>{e}</span>
      <h2 style={headH2}>{title}</h2>
      {desc && <p style={headP}>{desc}</p>}
    </div>
  );
}

export function Landing() {
  const { auth } = useBackend();
  const [authed, setAuthed] = useState(false);

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

  return (
    <div style={{ minHeight: '100vh', background: '#fbf6f2', color: '#33281f', fontFamily: 'Pretendard, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px' }}>
        {/* header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '22px 0' }}>
          <span
            aria-hidden="true"
            style={{ width: 34, height: 34, borderRadius: 10, background: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <BrandMark size={20} />
          </span>
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.01em' }}>Geurio</span>
          <Link
            to={ctaHref}
            style={{
              marginLeft: 'auto',
              textDecoration: 'none',
              color: '#33281f',
              fontWeight: 700,
              fontSize: 14,
              padding: '9px 16px',
              borderRadius: 10,
              border: '1px solid #ecdfd5',
              background: '#fff',
            }}
          >
            {authed ? '내 문서로' : '로그인'}
          </Link>
        </header>

        {/* hero */}
        <section style={{ textAlign: 'center', padding: '56px 0 40px' }}>
          <h1 style={{ fontSize: 'clamp(30px, 5.4vw, 46px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.25, margin: '0 0 18px' }}>
            흩어진 생각 조각을,
            <br />
            하나의 그림으로.
          </h1>
          <p style={{ fontSize: 'clamp(14.5px, 2vw, 17px)', color: MUTED, lineHeight: 1.75, maxWidth: 560, margin: '0 auto 30px' }}>
            Geurio(그리오)는 중심 주제에서 가지를 뻗어 아이디어를 정리하는 <strong style={{ color: '#33281f' }}>마인드맵 서비스</strong>입니다.
            떠오르는 생각을 자유롭게 그리고 이어, 복잡한 생각을 한눈에 정리하세요.
          </p>
          <Link to={ctaHref} style={ctaStyle}>
            무료로 시작하기
          </Link>
          <div style={{ fontSize: 13, color: '#9c8b7e', marginTop: 14 }}>설치 없이 웹에서 바로 · 무료로 시작</div>

          {/* deterministic mini-mindmap illustration (no external asset) */}
          <div aria-hidden="true" style={{ maxWidth: 620, margin: '52px auto 0' }}>
            <svg viewBox="0 0 620 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <g stroke="#e8c9b8" strokeWidth="2.5" fill="none">
                <path d="M 310 110 C 250 110 230 60 178 56" />
                <path d="M 310 110 C 250 110 230 160 178 164" />
                <path d="M 310 110 C 370 110 390 52 444 48" />
                <path d="M 310 110 C 370 110 390 168 444 172" />
              </g>
              <g fontFamily="inherit" fontSize="14" fontWeight="700">
                <rect x="252" y="88" width="116" height="44" rx="13" fill={ACCENT} />
                <text x="310" y="115" textAnchor="middle" fill="#fff">중심 주제</text>
                <rect x="70" y="36" width="108" height="40" rx="11" fill="#fff" stroke="#ecdfd5" strokeWidth="2" />
                <text x="124" y="61" textAnchor="middle" fill="#33281f">아이디어</text>
                <rect x="70" y="144" width="108" height="40" rx="11" fill="#fff" stroke="#ecdfd5" strokeWidth="2" />
                <text x="124" y="169" textAnchor="middle" fill="#33281f">할 일 정리</text>
                <rect x="444" y="28" width="108" height="40" rx="11" fill="#fff" stroke="#ecdfd5" strokeWidth="2" />
                <text x="498" y="53" textAnchor="middle" fill="#33281f">학습 노트</text>
                <rect x="444" y="152" width="108" height="40" rx="11" fill="#fff" stroke="#ecdfd5" strokeWidth="2" />
                <text x="498" y="177" textAnchor="middle" fill="#33281f">프로젝트</text>
              </g>
            </svg>
          </div>
        </section>

        {/* use cases */}
        <section style={{ padding: '46px 0' }}>
          <SectionHead eyebrow="이럴 때 좋아요" title="생각을 정리해야 하는 모든 순간에" desc="떠오르는 아이디어부터 복잡한 계획까지, 그리오 하나로 펼치고 이어보세요." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
            {USE_CASES.map((u) => (
              <div key={u.title} style={{ background: '#fff', border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: 18, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={iconBadge(36)}>
                  <Icon>{u.icon}</Icon>
                </span>
                <div>
                  <h3 style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>{u.title}</h3>
                  <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>{u.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section style={{ padding: '46px 0', borderTop: `1px solid ${CARD_BORDER}`, borderBottom: `1px solid ${CARD_BORDER}` }}>
          <SectionHead eyebrow="이렇게 시작해요" title="3단계면 충분해요" desc="복잡한 사용법은 없어요. 중심 주제 하나에서 시작하면 됩니다." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {STEPS.map((s, i) => (
              <div key={s.title} style={{ textAlign: 'center', padding: '4px 8px' }}>
                <span
                  aria-hidden="true"
                  style={{ width: 46, height: 46, borderRadius: '50%', background: ACCENT, color: '#fff', fontWeight: 800, fontSize: 19, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 15, boxShadow: '0 6px 16px rgba(240,102,63,.28)' }}
                >
                  {i + 1}
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{s.title}</h3>
                <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.65 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* features */}
        <section style={{ padding: '46px 0' }}>
          <SectionHead eyebrow="핵심 기능" title="생각의 속도를 따라오는 도구" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ background: '#fff', border: `1px solid ${CARD_BORDER}`, borderRadius: 16, padding: '22px 20px' }}>
                <span aria-hidden="true" style={{ ...iconBadge(38), marginBottom: 14 }}>
                  <Icon>{f.icon}</Icon>
                </span>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.7 }}>{f.body}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 22 }}>
            {CHIPS.map((c) => (
              <span key={c} style={{ background: '#fff', border: `1px solid ${CARD_BORDER}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, color: '#5c4a3d' }}>
                {c}
              </span>
            ))}
          </div>
        </section>

        {/* faq */}
        <section style={{ padding: '46px 0', borderTop: `1px solid ${CARD_BORDER}`, borderBottom: `1px solid ${CARD_BORDER}` }}>
          <SectionHead eyebrow="자주 묻는 질문" title="궁금한 점이 있으신가요?" />
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {FAQS.map((f) => (
              <details key={f.q} style={{ background: '#fff', border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: '2px 20px', marginBottom: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, padding: '15px 0', listStyle: 'none' }}>{f.q}</summary>
                <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.7, padding: '0 0 16px' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* closing CTA */}
        <section style={{ padding: '46px 0' }}>
          <div style={{ background: 'linear-gradient(135deg,#fdeee7,#fff)', border: `1px solid ${CARD_BORDER}`, borderRadius: 22, padding: '46px 28px', textAlign: 'center' }}>
            <h2 style={{ fontSize: 'clamp(22px, 3.6vw, 30px)', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 12 }}>생각이 떠오른 지금이 시작하기 좋은 때예요</h2>
            <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.7, maxWidth: 480, margin: '0 auto 26px' }}>첫 마인드맵을 만들고, 흩어진 생각을 하나의 그림으로 이어 보세요.</p>
            <Link to={ctaHref} style={ctaStyle}>
              무료로 시작하기
            </Link>
          </div>
        </section>

        {/* footer — legal docs must be reachable from the homepage (Google
            brand-verification requirement) */}
        <footer style={{ borderTop: '1px solid #ecdfd5', padding: '22px 0 34px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#9c8b7e' }}>
          <span>© 2026 Geurio(그리오)</span>
          <Link to="/privacy" style={{ color: '#9c8b7e' }}>
            개인정보처리방침
          </Link>
          <Link to="/terms" style={{ color: '#9c8b7e' }}>
            이용약관
          </Link>
          <a href="mailto:info@geurio.com" style={{ color: '#9c8b7e', marginLeft: 'auto' }}>
            문의: info@geurio.com
          </a>
        </footer>
      </div>
    </div>
  );
}
