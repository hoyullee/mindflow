import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { BrandMark } from './BrandMark';

/**
 * 브랜드 마크의 지오메트리는 **네 곳**에 적혀 있다 — 이 컴포넌트(앱 안)와 아이콘
 * 스크립트 셋(PWA·파비콘·OG / 모바일 네이티브 / 데스크톱 설치 파일). 값이 하나만
 * 갈리면 같은 로고가 자리마다 다르게 보이는데, 그 어긋남은 빌드도 테스트도
 * 통과하고 **화면을 나란히 놓아 봐야** 드러난다(실제로 그래서 앱 아이콘의
 * 글리프가 인앱 마크보다 크다는 제보를 받았다). 그래서 여기서 고정한다.
 */
const scriptText = (p: string) => readFileSync(resolve(p), 'utf8');
const ICONS = 'scripts/generate-icons.mjs';
const SCRIPTS = [ICONS, '../desktop/scripts/generate-desktop-icon.mjs', '../mobile/scripts/generate-native-assets.mjs'];

function literal(src: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(.+?);`).exec(src);
  expect(m, `${name}을 찾지 못했다`).not.toBeNull();
  return m![1]!.trim();
}

describe('BrandMark', () => {
  it('아이콘 스크립트와 같은 지오메트리를 그린다', () => {
    const src = scriptText(ICONS);
    const path = literal(src, 'GLYPH_PATH').replace(/^'|'$/g, '');
    const stroke = literal(src, 'GLYPH_STROKE');
    const dot = literal(src, 'GLYPH_DOT'); // { cx: 47, cy: 52, r: 6 }
    const num = (k: string) => new RegExp(`${k}:\\s*([\\d.]+)`).exec(dot)![1]!;

    const { container } = render(<BrandMark size={40} />);
    const svg = container.querySelector('svg')!;
    // `size`가 곧 박스 크기라는 계약 — viewBox가 0..100이고 글리프는 그 안에서
    // 자기 자연 크기(63%)를 차지한다. 이게 아이콘 PNG와 같은 그림의 근거다.
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('width')).toBe('40');

    const p = container.querySelector('path')!;
    expect(p.getAttribute('d')).toBe(path);
    expect(p.getAttribute('stroke-width')).toBe(stroke);
    const c = container.querySelector('circle')!;
    expect(c.getAttribute('cx')).toBe(num('cx'));
    expect(c.getAttribute('cy')).toBe(num('cy'));
    expect(c.getAttribute('r')).toBe(num('r'));
    cleanup();
  });

  it('세 아이콘 스크립트가 같은 글리프 경로를 쓴다', () => {
    const paths = SCRIPTS.map((p) => literal(scriptText(p), 'GLYPH_PATH'));
    expect(new Set(paths).size).toBe(1);
  });

  it('코랄 박스를 두는 호출부는 박스 크기를 그대로 넘긴다', () => {
    // 글리프 크기(더 작은 값)를 넘기면 63%가 한 번 더 줄어 앱 아이콘과 달라진다.
    for (const [file, box] of [
      ['src/features/editor/components/Toolbar.tsx', 26],
      ['src/features/editor/components/MapUnavailable.tsx', 30],
      ['src/features/auth/DesktopHandoff.tsx', 46],
      ['src/features/legal/LegalPage.tsx', 34],
    ] as const) {
      const src = readFileSync(resolve(file), 'utf8');
      expect(src, file).toContain(`<BrandMark size={${box}}`);
      expect(src, file).toContain(`width: ${box}`);
    }
  });
});
