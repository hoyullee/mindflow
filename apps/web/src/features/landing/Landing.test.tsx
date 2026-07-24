import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { Landing } from './Landing';

afterEach(() => {
  cleanup();
  localStorage.clear();
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
    expect(screen.getByText('Geurio')).toBeTruthy();
    expect(screen.getByText('마인드맵 서비스')).toBeTruthy();
    expect(screen.getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: '이용약관' }).getAttribute('href')).toBe('/terms');
  });

  it('routes anonymous visitors to /login from the CTA', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 히어로 + 마무리 배너 두 곳의 CTA — 둘 다 같은 곳을 가리켜야 한다
    const ctas = screen.getAllByRole('link', { name: '무료로 시작하기' });
    expect(ctas.length).toBeGreaterThanOrEqual(2);
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login');
  });

  it('routes a signed-in visitor to /home instead', async () => {
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }));
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '내 문서로' })).toBeTruthy());
    for (const cta of screen.getAllByRole('link', { name: '무료로 시작하기' })) expect(cta.getAttribute('href')).toBe('/home');
  });

  it('serves the landing (not a redirect to /login) at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getAllByRole('link', { name: '무료로 시작하기' }).length).toBeGreaterThan(0);
  });

  it('carries the expanded content: use cases, steps, FAQ, and the feature chips', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    // 새로 추가한 섹션들이 렌더된다(landing.html 쌍둥이와 동기화 확인은 아래 정적 테스트에서)
    expect(screen.getByText('브레인스토밍')).toBeTruthy();
    expect(screen.getByText('3단계면 충분해요')).toBeTruthy();
    expect(screen.getByText('정말 무료인가요?')).toBeTruthy();
    expect(screen.getByText('이미지 첨부')).toBeTruthy();
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
    expect(html).toContain('마인드맵 서비스');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/login"');
    // JS 의존이 없어야 크롤러에 보인다 — 실행되는 스크립트 금지. 단
    // JSON-LD(type="application/ld+json")는 렌더와 무관한 데이터 블록이라 허용.
    const scripts = html.match(/<script[^>]*/g) ?? [];
    for (const tag of scripts) expect(tag).toContain('application/ld+json');
  });

  it('mirrors the expanded content of the React twin (use cases, steps, FAQ, chips)', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    // 사용 사례 · 3단계 · FAQ · 기능 칩 — Landing.tsx와 동기화되어야 크롤러도 본다
    for (const s of ['브레인스토밍', '학습 노트', '의사결정', '3단계면 충분해요', '정말 무료인가요?', '이미지 첨부', '자주 묻는 질문']) {
      expect(html).toContain(s);
    }
    // FAQ는 JS 없는 <details>로 — 크롤러 가시성 유지
    expect(html).toContain('<details>');
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
