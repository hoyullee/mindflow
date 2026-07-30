import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useBackend } from '../../adapters/BackendContext';
import { useUpdateGuard } from '../../pwa/updateGate';
import './landing.css';

/**
 * 공개 랜딩 페이지 — 루트(`/`). 2026-07 리뉴얼: 디자인 원본은 저장소 루트의
 * `Geurio 랜딩 리뉴얼.dc.html`(Claude Design). 존재 이유가 둘이다:
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
 * landing.html도 반드시 함께 고칠 것. (정적 쪽은 JS가 없어 히어로 데모가
 * 완성 상태의 SVG 한 장, FAQ가 <details>다 — 여기는 원본대로 인터랙티브.)
 */

const CASES: { no: string; title: string; body: string }[] = [
  { no: '01', title: '브레인스토밍', body: '회의에서든 혼자서든, 떠오르는 생각을 막힘없이 빠르게 펼쳐요.' },
  { no: '02', title: '학습 노트', body: '강의와 책의 핵심을 구조로 묶어 오래 기억에 남게 정리해요.' },
  { no: '03', title: '프로젝트 기획', body: '목표에서 할 일로 가지를 뻗어 큰 그림과 세부 계획을 함께 세워요.' },
  { no: '04', title: '회의록', body: '논의의 흐름을 실시간으로 정리하고 참석자와 바로 공유해요.' },
  { no: '05', title: '글쓰기 개요', body: '글의 뼈대를 먼저 짜고 살을 붙여, 논리의 흐름을 놓치지 않아요.' },
  { no: '06', title: '의사결정', body: '선택지와 근거를 한눈에 늘어놓고 비교해 더 나은 결정을 내려요.' },
];

const STEPS: { no: string; title: string; body: string }[] = [
  { no: '1', title: '중심 주제를 적어요', body: '정리하고 싶은 하나의 주제를 화면 가운데에 놓는 것으로 시작해요.' },
  { no: '2', title: '가지를 뻗어 이어요', body: '떠오르는 생각을 자식·형제 노드로 이어 붙이며 자연스럽게 구조를 만들어요.' },
  { no: '3', title: '저장하고 공유해요', body: '자동으로 저장되고, 완성한 맵은 이미지나 파일로 내보내 함께 나눠요.' },
];

const FAQS: { q: string; a: string }[] = [
  { q: '정말 무료인가요?', a: '네. 별도의 설치나 결제 없이 지금 바로 시작할 수 있어요.' },
  { q: '설치해야 하나요?', a: '아니요. 웹 브라우저만 있으면 됩니다. 모바일에서는 홈 화면에 추가하면 앱처럼 전체 화면으로 쓸 수 있어요.' },
  { q: '만든 맵은 안전하게 보관되나요?', a: '편집하는 동안 자동으로 저장되고, 로그인하면 여러 기기에서 같은 맵을 이어서 볼 수 있어요.' },
  { q: '다른 곳으로 내보낼 수 있나요?', a: '완성한 맵을 PNG 이미지, Markdown, JSON으로 내보내 다른 문서나 도구로 바로 옮길 수 있어요.' },
];

/* ─── 히어로 데모: 스스로 자라나는 미니 마인드맵 (dc 원본 buildMap 이식) ─── */

type DemoBranch = { id: string; side: 1 | -1; y: number; color: string; label: string; children: [string, string] };

const DEMO_ROOT_LABEL = '신제품 런치 플랜';
const DEMO_BRANCHES: DemoBranch[] = [
  { id: 'a1', side: -1, y: 66, color: '#EF8F30', label: '메시지', children: ['핵심 한 줄', '타깃별 문구'] },
  { id: 'a2', side: -1, y: 210, color: '#7CA84A', label: '채널', children: ['블로그', '뉴스레터'] },
  { id: 'a3', side: -1, y: 354, color: '#E0447E', label: '리스크', children: ['재고', '문의 대응'] },
  { id: 'a4', side: 1, y: 66, color: '#EE6146', label: '일정', children: ['프리뷰 주간', 'D-Day'] },
  { id: 'a5', side: 1, y: 210, color: '#E3B93C', label: '채널별 예산', children: ['광고', '콘텐츠'] },
  { id: 'a6', side: 1, y: 354, color: '#2FAF9A', label: '성과 지표', children: ['가입 수', '유지율'] },
];

const RX = 320;
const RY = 210;

/** 노드 공통 스타일 — 숨김 상태는 살짝 작게(0.72) + 투명, 나타날 때 통통 튀는 이징. */
function demoBase(x: number, y: number, visible: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    transform: `translate(-50%,-50%) scale(${visible ? 1 : 0.72})`,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity .45s ease, transform .45s cubic-bezier(.2,.9,.3,1.3)',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    letterSpacing: '-.01em',
    cursor: 'default',
  };
}

type DemoNode = { id: string; label: string; visible: boolean; onClick?: () => void; style: CSSProperties };
type DemoLine = { d: string; style: CSSProperties };

function buildDemoMap(rev: number, exp: Record<string, boolean>, toggle: (id: string) => void): { nodes: DemoNode[]; lines: DemoLine[] } {
  const nodes: DemoNode[] = [];
  const lines: DemoLine[] = [];

  nodes.push({
    id: 'root',
    label: DEMO_ROOT_LABEL,
    visible: rev >= 1,
    style: {
      ...demoBase(RX, RY, rev >= 1),
      padding: '14px 26px',
      fontSize: 17,
      fontWeight: 700,
      color: '#fff',
      borderRadius: 14,
      border: '1px solid #E85E33',
      background: 'linear-gradient(180deg,#F2764C,#E85E33)',
      boxShadow: '0 12px 26px -12px rgba(232,94,51,.65)',
    },
  });

  DEMO_BRANCHES.forEach((b, i) => {
    const bx = RX + b.side * 158;
    const by = b.y;
    const vis = rev >= i + 2;
    const open = !!exp[b.id];
    const onClick = () => toggle(b.id);

    nodes.push({
      id: b.id,
      label: b.label,
      visible: vis,
      onClick,
      style: {
        ...demoBase(bx, by, vis),
        padding: '9px 16px',
        fontSize: 14,
        fontWeight: 600,
        color: '#3A352F',
        minWidth: 104,
        textAlign: 'center',
        boxSizing: 'border-box',
        borderRadius: 10,
        background: '#FFFDFB',
        border: `1.5px solid ${b.color}`,
        boxShadow: '0 4px 12px -8px rgba(46,42,38,.45)',
        cursor: 'pointer',
      },
    });

    nodes.push({
      id: `${b.id}-t`,
      label: open ? '−' : '+',
      visible: vis,
      onClick,
      style: {
        ...demoBase(bx + b.side * 52, by, vis),
        width: 19,
        height: 19,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        fontSize: 12,
        fontWeight: 700,
        color: b.color,
        borderRadius: 999,
        background: '#FFFDFB',
        border: `1.5px solid ${b.color}`,
        cursor: 'pointer',
      },
    });

    const sx = RX + b.side * 62;
    lines.push({
      d: `M${sx} ${RY} C ${sx + b.side * 60} ${RY}, ${bx - b.side * 70} ${by}, ${bx} ${by}`,
      style: { stroke: b.color, strokeWidth: 3, strokeLinecap: 'round', opacity: vis ? 1 : 0, transition: 'opacity .5s ease' },
    });

    b.children.forEach((label, j) => {
      const cx = bx + b.side * 128;
      const cy = by + (j === 0 ? -38 : 38);
      const cvis = vis && open;
      nodes.push({
        id: `${b.id}${j}`,
        label,
        visible: cvis,
        style: {
          ...demoBase(cx, cy, cvis),
          padding: '7px 13px',
          fontSize: 12.5,
          fontWeight: 500,
          color: '#5C564E',
          borderRadius: 8,
          background: '#FFFDFB',
          border: `1.5px solid ${b.color}66`,
        },
      });
      const cs = bx + b.side * 62;
      lines.push({
        d: `M${cs} ${by} C ${cs + b.side * 46} ${by}, ${cx - b.side * 58} ${cy}, ${cx} ${cy}`,
        style: { stroke: b.color, strokeWidth: 2.2, strokeLinecap: 'round', opacity: cvis ? 0.9 : 0, transition: 'opacity .4s ease' },
      });
    });
  });

  return { nodes, lines };
}

function DemoMap() {
  // rev: 등장 애니메이션 단계(1=중심만 → 7=가지 6개 전부). 480ms 간격으로 자란다.
  const [rev, setRev] = useState(1);
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const [scale, setScale] = useState(1);
  const [run, setRun] = useState(0); // "처음부터" 클릭마다 증가 → 타이머 재시작
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setRev((r) => {
        if (r >= 7) {
          clearInterval(t);
          return r;
        }
        return r + 1;
      });
    }, 480);
    return () => clearInterval(t);
  }, [run]);

  // 좌표계는 640×420 고정 — 캔버스가 그보다 좁으면 통째로 축소(여백 12px 포함 664×436 기준).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const s = Math.min(1, el.clientWidth / 664, el.clientHeight / 436);
      setScale((prev) => (Math.abs(s - prev) > 0.005 ? s : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggle = (id: string) => setExp((prev) => ({ ...prev, [id]: !prev[id] }));
  const resetMap = () => {
    setRev(1);
    setExp({});
    setRun((n) => n + 1);
  };

  const { nodes, lines } = buildDemoMap(rev, exp, toggle);

  return (
    <div className="demo">
      <div className="demo-bar">
        <div className="demo-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="demo-url mono">geurio.com — 신제품 런치 플랜</span>
        <button type="button" className="demo-reset" onClick={resetMap}>
          처음부터
        </button>
      </div>
      <div ref={canvasRef} className="demo-canvas">
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 640,
            height: 420,
            transform: `translate(-50%,-50%) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <svg viewBox="0 0 640 420" style={{ position: 'absolute', inset: 0, width: 640, height: 420 }} aria-hidden="true">
            {lines.map((l, i) => (
              <path key={i} d={l.d} fill="none" style={l.style} />
            ))}
          </svg>
          {nodes.map((n) => (
            <button key={n.id} type="button" onClick={n.onClick} style={n.style} tabIndex={n.visible && n.onClick ? 0 : -1} aria-hidden={!n.visible}>
              {n.label}
            </button>
          ))}
        </div>
        <div className="demo-hint">노드를 눌러 가지를 펼쳐 보세요</div>
      </div>
    </div>
  );
}

/* ─── FAQ 아코디언 (dc 원본: 한 번에 하나만 열림, grid-rows 트랜지션) ─── */

function FaqList() {
  const [open, setOpen] = useState(0);
  return (
    <div className="faq-list">
      {FAQS.map((f, i) => (
        <div key={f.q} className="faq-item" data-open={open === i ? '1' : '0'}>
          <button type="button" className="faq-q" aria-expanded={open === i} onClick={() => setOpen((cur) => (cur === i ? -1 : i))}>
            {f.q}
            <span className="faq-icon" aria-hidden="true">
              +
            </span>
          </button>
          <div className="faq-body">
            <div>
              <p>{f.a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Landing() {
  const { auth } = useBackend();
  const [authed, setAuthed] = useState(false);
  // 소개 페이지에는 사용자가 만들어 둔 상태가 없다 — 새 배포는 물어보지 말고 바로 적용.
  useUpdateGuard('safe');

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
    <div className="lp-root">
      <header className="lp">
        <a className="brand" href="#top">
          <img src="/brand/geurio-logo-120.png" alt="" width={26} height={26} />
          <b>Geurio</b>
        </a>
        <nav className="lp">
          <a href="#usecases">사용 사례</a>
          <a href="#features">기능</a>
          <a href="#faq">자주 묻는 질문</a>
          <Link className="login-chip" to={ctaHref}>
            {authed ? '내 문서로' : '로그인'}
          </Link>
          <Link className="pill-cta" to={ctaHref}>
            무료로 시작하기
          </Link>
        </nav>
      </header>

      <section id="top" className="hero">
        <span className="hero-badge">설치 없이 웹에서 바로 · 지금은 전부 무료</span>
        <h1>
          흩어진 생각을,
          <br />
          하나의 그림으로.
        </h1>
        <p className="hero-sub">중심 주제 하나에서 가지를 뻗으면 복잡한 생각이 한눈에 정리돼요. 그리오는 떠올리는 속도를 그대로 따라오는 마인드맵 서비스예요.</p>
        <div className="hero-ctas">
          <Link className="cta" to={ctaHref}>
            무료로 시작하기 <span aria-hidden="true">→</span>
          </Link>
          <a className="cta-ghost" href="#demo">
            데모 둘러보기
          </a>
        </div>
        <p className="hero-note">가입 30초 · 카드 등록 없이 · 만든 맵은 언제든 내보내기</p>
      </section>

      <section id="demo" className="demo-wrap">
        <DemoMap />
      </section>

      <section id="usecases" className="band">
        <div className="container">
          <div className="sec-head">
            <span className="eyebrow mono">USE CASES</span>
            <h2>생각을 정리해야 하는 모든 순간에</h2>
            <p>떠오르는 아이디어부터 복잡한 계획까지, 그리오 하나로 펼치고 이어보세요.</p>
          </div>
          <div className="case-grid">
            {CASES.map((c) => (
              <div key={c.no} className="case">
                <span className="case-no">{c.no}</span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="how">
        <div className="container">
          <div className="sec-head" style={{ marginBottom: 32 }}>
            <span className="eyebrow mono">HOW IT WORKS</span>
            <h2>3단계면 충분해요</h2>
            <p>복잡한 사용법은 없어요. 중심 주제 하나에서 시작하면 됩니다.</p>
          </div>
          <div className="step-grid">
            {STEPS.map((s) => (
              <div key={s.no} className="step">
                <span className="step-no">{s.no}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="features">
        <div className="container">
          <div className="sec-head">
            <span className="eyebrow mono">FEATURES</span>
            <h2>생각의 속도를 따라오는 도구</h2>
          </div>

          <div className="feature">
            <div className="body">
              <h3>자유로운 마인드맵</h3>
              <p>노드·도형·메모·연결선·영역으로 생각을 원하는 자리에 놓고, 색과 스타일로 구조를 드러내세요.</p>
              <div className="chips">
                <span className="chip">6가지 테마</span>
                <span className="chip">방사형·조직도 레이아웃</span>
                <span className="chip">이미지 첨부</span>
              </div>
            </div>
            <div className="shot" style={{ height: 'clamp(200px, 23vw, 236px)' }}>
              <svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
                <path d="M180 110 C 220 110, 250 62, 300 62" fill="none" stroke="#EF8F30" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M180 110 C 220 110, 250 160, 300 160" fill="none" stroke="#2FAF9A" strokeWidth="2.6" strokeLinecap="round" />
                <rect x="96" y="88" width="120" height="44" rx="11" fill="#EE6B45" />
                <text x="156" y="110" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="#fff">
                  새 마인드맵
                </text>
                <rect x="300" y="44" width="86" height="36" rx="9" fill="#FFFDFB" stroke="#EF8F30" strokeWidth="1.5" />
                <text x="343" y="62" textAnchor="middle" dominantBaseline="central" fontSize="12.5" fill="#3A352F">
                  아이디어
                </text>
                <rect x="300" y="142" width="86" height="36" rx="9" fill="#FFFDFB" stroke="#2FAF9A" strokeWidth="1.5" />
                <text x="343" y="160" textAnchor="middle" dominantBaseline="central" fontSize="12.5" fill="#3A352F">
                  할 일
                </text>
                <rect x="14" y="14" width="118" height="52" rx="10" fill="#FFFDFB" stroke="#F3E4DA" />
                <text x="26" y="32" fontSize="10" fill="#A89C92">
                  선택한 주제
                </text>
                <text x="26" y="50" fontSize="11.5" fontWeight="700" fill="#2E2A26">
                  새 마인드맵
                </text>
              </svg>
            </div>
          </div>

          <div className="feature">
            <div className="body">
              <h3>어디서나 이어서</h3>
              <p>웹과 모바일(PWA) 어디서든 열립니다. 자동 저장과 기기 간 동기화로 생각의 흐름이 끊기지 않아요.</p>
              <div className="chips">
                <span className="chip">자동 저장</span>
                <span className="chip">오프라인 지원</span>
                <span className="chip">미니맵</span>
              </div>
            </div>
            <div
              className="shot"
              style={{ height: 'clamp(190px, 22vw, 224px)', backgroundImage: 'none', background: '#FBF0E8', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 18, padding: '0 16px' }}
            >
              <svg viewBox="0 0 220 150" preserveAspectRatio="xMidYMax meet" style={{ width: 'min(46%, 220px)', height: '82%' }} aria-hidden="true">
                <rect x="1" y="1" width="218" height="160" rx="12" fill="#FFFDFB" stroke="#F1E2D8" />
                <line x1="1" y1="26" x2="219" y2="26" stroke="#F3E4DA" />
                <circle cx="16" cy="13" r="3" fill="#EFE0D6" />
                <circle cx="28" cy="13" r="3" fill="#EFE0D6" />
                <rect x="76" y="58" width="64" height="28" rx="8" fill="#EE6B45" />
                <text x="108" y="72" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="#fff">
                  주제
                </text>
                <rect x="18" y="108" width="58" height="24" rx="7" fill="#FFFDFB" stroke="#EF8F30" strokeWidth="1.4" />
                <text x="47" y="120" textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#3A352F">
                  가지 1
                </text>
                <rect x="146" y="34" width="58" height="24" rx="7" fill="#FFFDFB" stroke="#2FAF9A" strokeWidth="1.4" />
                <text x="175" y="46" textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#3A352F">
                  가지 2
                </text>
              </svg>
              <svg viewBox="0 0 106 160" preserveAspectRatio="xMidYMax meet" style={{ width: 'min(26%, 106px)', height: '94%' }} aria-hidden="true">
                <rect x="1" y="1" width="104" height="170" rx="15" fill="#FFFDFB" stroke="#E7D2C4" strokeWidth="1.5" />
                <rect x="40" y="8" width="26" height="4" rx="2" fill="#EFE0D6" />
                <rect x="26" y="56" width="54" height="22" rx="7" fill="#EE6B45" />
                <text x="53" y="67" textAnchor="middle" dominantBaseline="central" fontSize="9.5" fontWeight="700" fill="#fff">
                  주제
                </text>
                <rect x="12" y="104" width="48" height="19" rx="6" fill="#FFFDFB" stroke="#EF8F30" strokeWidth="1.2" />
                <text x="36" y="113.5" textAnchor="middle" dominantBaseline="central" fontSize="9" fill="#3A352F">
                  가지 1
                </text>
                <line x1="14" y1="146" x2="34" y2="146" stroke="#EFE0D6" strokeWidth="3" strokeLinecap="round" />
                <line x1="44" y1="146" x2="64" y2="146" stroke="#EE6B45" strokeWidth="3" strokeLinecap="round" />
                <line x1="74" y1="146" x2="94" y2="146" stroke="#EFE0D6" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          <div className="feature">
            <div className="body">
              <h3>함께, 그리고 내보내기</h3>
              <p>실시간 공동 편집으로 같이 그리고, 완성한 맵은 PNG·Markdown·JSON으로 바로 내보내세요.</p>
              <div className="chips">
                <span className="chip">공동 편집</span>
                <span className="chip">PNG · MD · JSON</span>
                <span className="chip">아웃라인 보기</span>
              </div>
            </div>
            <div className="shot" style={{ height: 'clamp(200px, 23vw, 236px)' }}>
              <svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
                <rect x="0" y="0" width="420" height="30" fill="#FFFDFB" />
                <line x1="0" y1="30" x2="420" y2="30" stroke="#F3E4DA" />
                <rect x="10" y="6" width="86" height="18" rx="9" fill="#E6F4EF" />
                <circle cx="21" cy="15" r="7" fill="#2FAF9A" />
                <text x="21" y="15.5" textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="700" fill="#fff">
                  S
                </text>
                <text x="34" y="15.5" dominantBaseline="central" fontSize="8.5" fontWeight="600" fill="#2E5E52">
                  1명 접속 중
                </text>
                <rect x="330" y="6" width="80" height="19" rx="7" fill="none" stroke="#EE6B45" strokeWidth="1.2" />
                <text x="370" y="16" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill="#DE5A2E">
                  내보내기 ⌃
                </text>
                <rect x="252" y="40" width="158" height="88" rx="9" fill="#FFFDFB" />
                <text x="270" y="60" fontSize="10.5" fill="#2E2A26">
                  🖼 PNG 이미지
                </text>
                <text x="270" y="86" fontSize="10.5" fill="#2E2A26">
                  📄 JSON 파일 (.json)
                </text>
                <text x="270" y="112" fontSize="10.5" fill="#2E2A26">
                  📝 Markdown 개요 (.md)
                </text>
                <rect x="56" y="102" width="86" height="34" rx="9" fill="#EE6B45" />
                <text x="99" y="119" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="#fff">
                  회의록
                </text>
                <rect x="26" y="164" width="84" height="28" rx="7" fill="#FFFDFB" stroke="#7CA84A" strokeWidth="1.5" />
                <text x="68" y="178" textAnchor="middle" dominantBaseline="central" fontSize="10.5" fill="#3A352F">
                  결정 사항
                </text>
                <path d="M172 92 l 8 3 -5 6 z" fill="#2FAF9A" />
                <rect x="184" y="88" width="34" height="16" rx="5" fill="#2FAF9A" />
                <text x="201" y="96.5" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="600" fill="#fff">
                  지연
                </text>
                <rect x="10" y="196" width="104" height="18" rx="6" fill="#FFFDFB" />
                <circle cx="21" cy="205" r="2.6" fill="#7CA84A" />
                <text x="29" y="205.5" dominantBaseline="central" fontSize="8" fill="#8A8078">
                  저장됨 · 방금 전
                </text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="faq-band">
        <div className="faq-grid">
          <div className="sec-head" style={{ marginBottom: 0 }}>
            <span className="eyebrow mono">FAQ</span>
            <h2>
              궁금한 점이
              <br />
              있으신가요?
            </h2>
            <p style={{ fontSize: 14.5, marginTop: 6 }}>
              자주 묻는 질문을 모았어요.
              <br />
              더 궁금하시면{' '}
              <a href="mailto:info@geurio.com" style={{ textDecoration: 'underline' }}>
                info@geurio.com
              </a>
              으로 알려주세요.
            </p>
          </div>
          <FaqList />
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-card">
          <h2>
            생각이 떠오른 지금이,
            <br />
            시작하기 좋은 때예요
          </h2>
          <p>
            첫 마인드맵을 만들고 흩어진 생각을 하나로 이어 보세요.
            <br />
            3분이면 충분해요.
          </p>
          <Link className="cta-invert" to={ctaHref}>
            무료로 시작하기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {/* footer — legal docs must be reachable from the homepage (Google
          brand-verification requirement) */}
      <footer className="lp">
        <span>
          © 2026 Geurio(그리오) — <span>마인드맵 서비스</span>
        </span>
        <div className="links">
          <Link to="/privacy">개인정보처리방침</Link>
          <Link to="/terms">이용약관</Link>
          <a href="mailto:info@geurio.com">info@geurio.com</a>
        </div>
      </footer>
    </div>
  );
}
