import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { Landing } from './Landing';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('Landing', () => {
  // Google 브랜드 인증이 홈페이지에서 확인하는 3요소: 앱 이름 · 목적 설명 ·
  // 개인정보처리방침 도달 가능성. 이 테스트가 그 계약을 지킨다.
  it('shows the app name, a purpose description, and reachable legal links', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 앱 이름은 헤더·푸터 두 곳에 있다(둘 다 브랜드 표기).
    expect(screen.getAllByText('Geurio').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('마인드맵 · 화이트보드 · 칸반 보드를 한곳에서')).toBeTruthy();
    expect(screen.getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: '이용약관' }).getAttribute('href')).toBe('/terms');
  });

  it('routes anonymous visitors to /login from the CTA', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 헤더 · 히어로 · 마무리 배너 세 곳의 CTA — 모두 같은 곳을 가리켜야 한다
    const ctas = screen.getAllByRole('link', { name: '무료로 시작하기' });
    expect(ctas.length).toBeGreaterThanOrEqual(3);
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/login');
    // 돌아온 사람이 곧장 들어갈 자리도 남긴다
    expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login');
  });

  it('routes a signed-in visitor to /home instead', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }));
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole('link', { name: '내 문서로' }).length).toBeGreaterThanOrEqual(3));
    for (const cta of screen.getAllByRole('link', { name: '내 문서로' })) expect(cta.getAttribute('href')).toBe('/home');
    // 이미 로그인했으면 '로그인' 링크는 뜻이 없다
    expect(screen.queryByRole('link', { name: '로그인' })).toBeNull();
  });

  it('serves the landing (not a redirect to /login) at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getAllByRole('link', { name: '무료로 시작하기' }).length).toBeGreaterThan(0);
  });

  it('carries the v2 content: three modes, collaboration, features, and FAQ', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 세 보기 소개 카드(제목은 h3) — 히어로 탭과 문구가 겹치므로 역할로 좁힌다
    for (const name of ['마인드맵', '화이트보드', '칸반 보드']) {
      expect(screen.getByRole('heading', { name, level: 3 })).toBeTruthy();
    }
    expect(screen.getByText('스레드 2')).toBeTruthy();
    expect(screen.getByText('쓰다 보면 알게 되는 것들')).toBeTruthy();
    expect(screen.getByText('정말 무료인가요?')).toBeTruthy();
    expect(screen.getByText('빈 화면 대신 템플릿')).toBeTruthy();
    // 히어로 창의 첫 장면(마인드맵) — 정적 쌍둥이와 같은 예시 문서
    expect(screen.getByText(/신제품 런치 플랜/)).toBeTruthy();
  });

  it('히어로 창의 보기 탭을 누르면 그 장면으로 고정된다', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 처음은 마인드맵 장면
    expect(screen.getByText(/신제품 런치 플랜/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /화이트보드/ }));
    expect(screen.getByText(/문제 정의 워크숍/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /칸반 보드/ }));
    expect(screen.getByText(/8월 스프린트/)).toBeTruthy();
  });

  it('히어로 창은 6.2초마다 다음 보기로 넘어간다', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(screen.getByText(/신제품 런치 플랜/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6200);
    });
    expect(screen.getByText(/문제 정의 워크숍/)).toBeTruthy();
  });

  it('FAQ는 하나만 열린다 — 첫 항목이 열린 채 시작하고 다른 항목을 누르면 바뀐다', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    const first = screen.getByRole('button', { name: /세 가지 보기를 한 보드에서/ });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /정말 무료인가요/ }));
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText(/지금은 모든 기능을 무료로/)).toBeTruthy();
  });
});

describe('static landing.html (the crawler-visible twin)', () => {
  // Google의 브랜드 인증 크롤러는 JS를 실행하지 않는다 — 프로덕션 "/"는
  // vercel.json 리라이트로 이 정적 파일이 서빙된다. React Landing과 같은
  // 심사 3요소(앱 이름·목적 설명·법적 문서 링크)가 RAW HTML에 있어야 한다.
  const publicDir = path.resolve(__dirname, '../../../public');

  it('contains the app name, purpose, and legal links as plain HTML', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    expect(html).toContain('Geurio');
    expect(html).toContain('마인드맵 · 화이트보드 · 칸반 보드를 한곳에서');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/login"');
    // 계약은 "모든 내용이 JS 없이 원문 HTML에 보인다"다(크롤러는 JS를 실행하지
    // 않으므로). 허용되는 스크립트는 둘뿐: JSON-LD 데이터 블록과, 히어로 창을
    // 세 보기로 번갈아 보여 주는 프로그레시브 인핸서(landing-demo.js — 같은
    // 출처, 없어도 페이지는 온전). 그 외 스크립트가 생기면 실패시켜
    // "SPA처럼 JS에 기대는 랜딩"으로의 회귀를 막는다.
    const scripts = html.match(/<script[^>]*/g) ?? [];
    for (const tag of scripts) {
      expect(tag.includes('application/ld+json') || tag.includes('src="/landing-demo.js"')).toBe(true);
    }
    // 히어로 창의 첫 장면(마인드맵)이 **원문에 그대로** 있어야 무JS에서도 보인다.
    expect(html).toContain('마인드맵 예시');
    expect(html).toContain('신제품 런치');
    // 인핸서: 같은 장면 데이터를 들고(쌍둥이 동기화) 세 보기를 회전시킨다.
    // 예전 버전의 가림막(veil)은 필요하지 않다 — 첫 화면이 폴백과 동일하므로
    // "완성 맵 → 걷어냄" 깜빡임이 애초에 없다.
    const demoJs = readFileSync(path.join(publicDir, 'landing-demo.js'), 'utf8');
    for (const s of ['신제품 런치 플랜', '문제 정의 워크숍', '8월 스프린트', 'data-hero-demo']) {
      expect(demoJs).toContain(s);
    }
  });

  it('mirrors the v2 content of the React twin (modes, collaboration, features, FAQ)', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    for (const s of [
      '정리하는 방법은',
      '세 가지 보기',
      '마인드맵',
      '화이트보드',
      '칸반 보드',
      '떨어져 있어도',
      '스레드 2',
      '쓰다 보면 알게 되는 것들',
      '빈 화면 대신 템플릿',
      '자주 묻는 질문',
      '정말 무료인가요?',
      '첫 보드는 30초면 만들어요.',
    ]) {
      expect(html).toContain(s);
    }
    // FAQ는 JS 없는 <details>로 — 크롤러 가시성 유지
    expect(html).toContain('<details');
  });

  it('carries the share/SEO contract: canonical + OG card + JSON-LD', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://geurio.com/"');
    expect(html).toContain('property="og:title"');
    // 한글 브랜드 신호 — "그리오" 검색이 이 사이트와 연결되려면 제목과
    // 구조화 데이터(alternateName)에 한글 표기가 있어야 한다
    expect(html).toContain('<title>그리오 Geurio — 마인드맵 서비스</title>');
    expect(html).toContain('"alternateName"');
    // og:image는 절대 URL이어야 카톡/슬랙 미리보기가 뜬다
    expect(html).toContain('content="https://geurio.com/og/og-image.png"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('application/ld+json');
  });

  it('ships robots.txt (app routes disallowed) and a sitemap of the public routes', () => {
    const robots = readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Disallow: /home');
    expect(robots).toContain('Disallow: /editor');
    expect(robots).toContain('Sitemap: https://geurio.com/sitemap.xml');
    const sitemap = readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
    for (const loc of ['https://geurio.com/', 'https://geurio.com/login', 'https://geurio.com/privacy', 'https://geurio.com/terms']) {
      expect(sitemap).toContain(`<loc>${loc}</loc>`);
    }
  });
});
