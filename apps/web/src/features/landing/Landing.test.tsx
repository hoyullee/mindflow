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

  it('기능 격자는 칸이 아니라 격자 전체가 등장 단위다(빈 배경이 먼저 보이지 않게)', () => {
    const { container } = render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    const grid = container.querySelector('.lp-features .grid');
    expect(grid?.classList.contains('lp-rv')).toBe(true);
    // 칸은 개별 등장 대상이 아니다 — 1px gap 위로 컨테이너 배경이 비치는 구조라
    // 칸만 숨기면 내용 없는 베이지 사각형이 먼저 나타난다(제보).
    expect(container.querySelectorAll('.lp-features .cell.lp-rv').length).toBe(0);
    expect(container.querySelectorAll('.lp-features .cell').length).toBe(6);
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

  // 제보: 라이브(정적 쌍둥이)에서는 첫 화면 아래 내용이 **스크롤 전에 이미** 등장을
  // 끝낸 상태였다 — 정적 CSS가 `.lp-rv`에 즉시 재생되는 애니메이션을 걸었기 때문.
  // 프로덕션 "/"가 이 파일이라 실제 방문자 전원이 그 화면을 봤다. 계약을 고정한다:
  // 숨기는 규칙은 `lp-js`(인핸서가 첫 페인트 전에 심는다) 아래에만 있어야 하고,
  // 인핸서는 그 클래스와 공개 장치를 모두 갖춰야 한다.
  it('scroll-reveals the below-the-fold sections, and stays visible with JS off', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    const demoJs = readFileSync(path.join(publicDir, 'landing-demo.js'), 'utf8');

    // 아래 섹션들이 등장 대상으로 표시돼 있다
    expect((html.match(/class="[^"]*lp-rv/g) ?? []).length).toBeGreaterThanOrEqual(8);
    // 숨기는 규칙은 반드시 lp-js 아래 — 무JS에서 내용이 사라지면 안 된다
    for (const m of html.match(/[^\n]*\.lp-rv\s*\{[^}]*\}/g) ?? []) {
      if (/opacity:\s*0/.test(m)) expect(m).toContain('lp-js');
    }
    // 즉시 재생되는 등장(스크롤과 무관하게 끝나 버리는 것)이 남아 있지 않다
    expect(html).not.toMatch(/\.lp-rv\s*\{\s*animation:/);
    // 인핸서: 첫 페인트 전에 클래스를 심고, 접힘선을 넘은 것을 공개한다.
    // 관측(IntersectionObserver)이 아니라 **위치를 직접 재는** 이유는 앵커로
    // 건너뛴 섹션이 영영 투명하게 남는 것을 막기 위해서다(아래 테스트 참고).
    expect(demoJs).toContain("classList.add('lp-js')");
    expect(demoJs).toContain("classList.add('lp-on')");
    expect(demoJs).toContain('getBoundingClientRect');
    expect(demoJs).not.toMatch(/new IntersectionObserver/);
    // head에서 블로킹 로드(defer면 한 번 보였다 숨는 깜빡임이 생긴다)
    expect(html).toContain('<script src="/landing-demo.js"></script>');
  });

  // 제보: 기능 격자("쓰다 보면 알게 되는 것들")가 라이브에서 **배경만 먼저** 보이고
  // 내용이 하나씩 떴다. 이 격자는 1px `gap` 위로 컨테이너 배경이 비쳐 칸 사이 실선을
  // 만드는 구조라, 칸만 등장 대상으로 두면 내용 없는 베이지 사각형이 먼저 나타난다
  // (실측: 컨테이너 opacity 1.00인데 칸 6개가 0.0으로 680ms). 등장 단위는 격자 전체다.
  it('reveals the feature grid as one unit (never a bare background)', () => {
    const html = readFileSync(path.join(publicDir, 'landing.html'), 'utf8');
    expect(html).toContain('<div class="grid lp-rv">');
    expect(html).not.toContain('class="cell lp-rv"');
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
