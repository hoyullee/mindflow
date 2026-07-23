import { useEffect, useState } from 'react';
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
            style={{ width: 34, height: 34, borderRadius: 10, background: '#f0663f', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
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
          <p style={{ fontSize: 'clamp(14.5px, 2vw, 17px)', color: '#8a7365', lineHeight: 1.75, maxWidth: 560, margin: '0 auto 30px' }}>
            Geurio(그리오)는 중심 주제에서 가지를 뻗어 아이디어를 정리하는 <strong style={{ color: '#33281f' }}>마인드맵 서비스</strong>입니다.
            떠오르는 생각을 자유롭게 그리고 이어, 복잡한 생각을 한눈에 정리하세요.
          </p>
          <Link
            to={ctaHref}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: '#f0663f',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 16,
              padding: '14px 28px',
              borderRadius: 13,
              boxShadow: '0 8px 22px rgba(240,102,63,.32)',
            }}
          >
            무료로 시작하기
          </Link>

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
                <rect x="252" y="88" width="116" height="44" rx="13" fill="#f0663f" />
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

        {/* features */}
        <section style={{ padding: '28px 0 56px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {[
              {
                title: '자유로운 마인드맵',
                body: '노드·도형·메모·연결선·영역으로 생각을 자유롭게 배치하고, 색과 스타일로 구조를 드러내세요.',
              },
              {
                title: '어디서나 이어서',
                body: '웹과 모바일(PWA) 어디서든 열립니다. 자동 저장과 기기 간 동기화로 흐름이 끊기지 않아요.',
              },
              {
                title: '함께, 그리고 내보내기',
                body: '실시간 공동 편집으로 함께 그리고, 완성한 맵은 PNG·Markdown·JSON으로 내보내세요.',
              },
            ].map((f) => (
              <div key={f.title} style={{ background: '#fff', border: '1px solid #f2e9e1', borderRadius: 16, padding: '22px 20px' }}>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: '#8a7365', lineHeight: 1.7 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* footer — legal docs must be reachable from the homepage (Google
            brand-verification requirement) */}
        <footer style={{ borderTop: '1px solid #ecdfd5', padding: '22px 0 34px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#9c8b7e' }}>
          <span>© 2026 Geurio</span>
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
