/**
 * 콘솔 계약 — **문제가 있을 때만 말한다.**
 *
 * 요청으로 정보성 로그 둘을 지웠다: 매 로드마다 찍던 빌드 스탬프와, 팔레트를 받을
 * 때마다 찍던 색 개수. 둘 다 "잘 되고 있다"를 말하는 줄이라, 정작 알려야 할 때
 * (아래 `console.warn`들 — 팔레트 실패·RPC 미배포·구글 400 등) 눈에 띌 자리를
 * 빼앗고 있었다. 화면 쪽 진단은 사라지지 않았다: 빌드 값은 **설정 › 버전 확인**과
 * 피드백 `meta`에 있다.
 *
 * 이 테스트가 지키는 것은 그 규칙이다 — `console.info`/`console.log`는 앱 소스에
 * 두지 않는다(경고·오류는 그대로 둔다). 한 줄 되돌리기가 아주 쉬운 종류라 못박는다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    // 테스트·프로브는 자기 결과를 찍는 것이 일이다.
    if (/\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

describe('콘솔 계약', () => {
  it('앱 소스에 정보성 로그(console.info / console.log)가 없다', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/\bconsole\.(info|log)\s*\(/.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('문제를 알리는 경고는 그대로 있다 — 콘솔을 비우자는 규칙이 아니다', () => {
    const warns = sourceFiles(SRC).filter((f) => /console\.warn\s*\(/.test(readFileSync(f, 'utf8')));
    expect(warns.length).toBeGreaterThan(5);
  });
});
