// SVG 내보내기 — 장면 순회가 SVG 문자열로 온전히 내려오는지. 측정은 jsdom이라
// `CanvasTextMeasurer`의 근사 폴백을 타지만, 문자열 생성 자체는 브라우저와 같은
// 코드 경로다(좌표 값만 다르고 구조는 동일).
import { describe, expect, it } from 'vitest';
import type { Doc } from '@mindflow/mindmap-core';
import { themeOf } from './theme';
import { layoutDocGeom } from './png';
import { buildSvgString } from './svg';
import { roundRectD, shapePathD, SvgPainter } from './exportScene';
import { linkInk } from './richSpans';

const PNG_URL = 'data:image/png;base64,' + btoa('fakepng');

function fixtureDoc(): Doc {
  return {
    v: 1,
    nodes: {
      root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1', 'c2', 'p1'], collapsed: false, color: null, x: 0, y: 0 },
      c1: {
        id: 'c1',
        text: '데이터 & <검증>',
        emoji: '',
        parent: 'root',
        children: [],
        collapsed: false,
        color: null,
        x: 0,
        y: 0,
        rich: [
          { t: '데이터', b: true },
          { t: ' & <검증>', s: true, href: 'https://ex.am/p' },
        ],
      },
      c2: { id: 'c2', text: '1. 첫 항목\n2. 둘째 항목', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, align: 'left' },
      p1: { id: 'p1', text: '사진 노드', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, img: PNG_URL, imgW: 90, imgH: 60 },
    },
    floats: [
      { id: 'f1', x: -400, y: 40, w: 180, text: '주간 회고 메모' },
      { id: 'f2', x: -400, y: 160, w: 120, h: 90, text: '', img: PNG_URL },
    ],
    lines: [{ id: 'l1', x1: -380, y1: 60, x2: -60, y2: 10, startArrow: false, endArrow: true, dashed: true, c1: 0, c2: 0, label: '참고' }],
    zones: [{ id: 'z1', x: -450, y: -80, w: 260, h: 300, label: '검증 & 확인 영역' }],
    layoutMode: 'right',
    themeKey: 'coral',
  } as unknown as Doc;
}

describe('buildSvgString', () => {
  const theme = themeOf('coral');
  const laid = layoutDocGeom(fixtureDoc());
  const built = buildSvgString(laid.doc, laid.geom, theme)!;

  it('완성된 SVG 문서를 만든다 — 루트 속성·배경·폰트 폴백', () => {
    expect(built).toBeTruthy();
    expect(built.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(built.svg).toContain('viewBox=');
    // 배경은 테마 캔버스색으로 경계 전체를 덮는다
    expect(built.svg).toContain(`fill="${theme.canvasBg}"`);
    // 파일은 앱 밖에서 열린다 — 한국어 폴백 스택
    expect(built.svg).toContain('Apple SD Gothic Neo');
    // 세그 경계의 앞뒤 공백이 접히지 않게 — 크롬(CSS)과 옛 뷰어(xml:space) 두 겹
    // (실브라우저 픽셀 비교에서 잡은 회귀)
    expect(built.svg).toContain('xml:space="preserve"');
    expect(built.svg).toContain('<style>text{white-space:pre}</style>');
    expect(built.missingImages).toBe(0);
  });

  it('노드 텍스트가 XML 이스케이프로 들어간다', () => {
    expect(built.svg).toContain('제품 로드맵');
    expect(built.svg).toContain('&amp; &lt;검증&gt;');
    expect(built.svg).not.toContain('< <검증>');
  });

  it('rich 서식 — 굵게 세그·링크 파랑·장식(취소선/밑줄) rect', () => {
    expect(built.svg).toContain('font-weight="800"');
    // 링크 세그는 노드 글자색 밝기에서 파생한 링크색으로
    expect(built.svg).toContain(`fill="${linkInk(theme.text)}"`);
  });

  it('리스트 마커가 표시 텍스트로 들어간다(마커는 별도 세그)', () => {
    expect(built.svg).toContain('>1. </text>');
    expect(built.svg).toContain('>첫 항목</text>');
  });

  it('영역 — 점선 외곽과 라벨(이스케이프)', () => {
    expect(built.svg).toContain('stroke-dasharray="7 5"');
    expect(built.svg).toContain('검증 &amp; 확인 영역');
  });

  it('자유 선 — 점선·화살표·라벨', () => {
    expect(built.svg).toContain('stroke-dasharray="7 7"');
    expect(built.svg).toContain('참고');
  });

  it('이미지(노드·플로트)가 데이터 URL로 임베드되고 라운드 클립을 받는다', () => {
    const images = built.svg.match(/<image /g) || [];
    expect(images.length).toBe(2);
    expect(built.svg).toContain(`href="${PNG_URL}"`);
    expect(built.svg).toContain('<clipPath id="mfclip0">');
  });

  it('인라인되지 못한 참조(mfimg:)는 세어 알리고 이미지 태그를 만들지 않는다', () => {
    const doc = fixtureDoc();
    doc.floats[1]!.img = 'mfimg:doc-1/abc.webp';
    const laid2 = layoutDocGeom(doc);
    const b2 = buildSvgString(laid2.doc, laid2.geom, theme)!;
    expect(b2.missingImages).toBe(1);
    expect((b2.svg.match(/<image /g) || []).length).toBe(1);
  });
});

describe('shapePathD / SvgPainter', () => {
  it('타원은 호(A) 둘, 마름모는 꼭짓점 4개 폴리곤', () => {
    const ell = shapePathD({ shape: 'ellipse' }, 0, 0, 100, 40);
    expect((ell.match(/A/g) || []).length).toBe(2);
    const dia = shapePathD({ shape: 'diamond' }, 0, 0, 100, 40);
    expect((dia.match(/L/g) || []).length).toBe(3);
    expect(dia.endsWith('Z')).toBe(true);
  });

  it('라운드 사각형 반경은 변의 절반으로 클램프된다(pill)', () => {
    // h/2보다 큰 r을 요청해도 h/2로 접힌다 — 캔버스 arcTo와 같은 규칙
    const d = roundRectD(0, 0, 100, 20, 999);
    expect(d).toContain('A10,10');
  });

  it('텍스트 속성값을 이스케이프한다(색·본문)', () => {
    const p = new SvgPainter(new Map());
    p.text('a<b>&"c', 0, 0, { px: 10, weight: 400, fill: '#111' });
    const svg = p.svg(0, 0, 10, 10);
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
  });
});
