import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEEP_LINK_SCHEME } from './shell';

const root = path.join(__dirname, '..');
const config = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

/**
 * 패키징 **계약**을 고정한다 — 여기 적힌 것들은 틀려도 빌드가 성공하고, 설치본을
 * 실제로 눌러 봐야 드러나는 종류다(그래서 테스트로 잡는다).
 */
describe('설치 파일 계약', () => {
  it('커스텀 프로토콜을 설정에 선언한다 — MSIX는 런타임 등록을 받지 않는다', () => {
    // `app.setAsDefaultProtocolClient`는 MSIX 컨테이너에서 무효다(main.ts 주석).
    // 이 선언이 빠지면 Store 설치본에서 **Google 로그인이 완주하지 못한다** —
    // 시스템 브라우저가 돌려보내는 `geurio://`를 아무도 받지 못한다.
    expect(config).toMatch(/^protocols:/m);
    expect(config).toContain(`schemes: [${DEEP_LINK_SCHEME}]`);
  });

  it('macOS 쪽 프로토콜을 손으로 또 적지 않는다(두 곳이 갈린다)', () => {
    // 위 `protocols`가 CFBundleURLTypes를 만든다 — 실제 빌드된 Info.plist로 확인했다.
    // 설명하는 **주석**은 남아 있어도 좋다 — 없어야 하는 것은 선언(키)이다.
    expect(config).not.toMatch(/^\s*CFBundleURLTypes:/m);
  });

  it('MSIX 타일 4종이 정확한 이름·크기로 있다', () => {
    // 이름이 하나라도 틀리면 electron-builder가 그 자리에 **자기 샘플 아트**를
    // 넣는다(AppxTarget의 vendorAssetsForDefaultAssets) — 남의 로고가 설치본에
    // 실리는 셈이라 조용한 실패 중에 가장 나쁘다.
    const dir = path.join(root, 'build', 'appx');
    const expected: Array<[string, number, number]> = [
      ['StoreLogo.png', 50, 50],
      ['Square44x44Logo.png', 44, 44],
      ['Square150x150Logo.png', 150, 150],
      ['Wide310x150Logo.png', 310, 150],
    ];
    expect(readdirSync(dir).sort()).toEqual(expected.map(([n]) => n).sort());
    for (const [name, w, h] of expected) {
      expect(pngSize(path.join(dir, name)), name).toEqual({ width: w, height: h });
    }
  });

  it('개발 인증서 스크립트는 UTF-8 BOM으로 저장돼 있다', () => {
    // Windows PowerShell 5.1은 **BOM이 없으면** 스크립트를 ANSI(한국어 Windows는
    // CP949)로 읽는다. CP949는 2바이트 인코딩이라 한글의 선행 바이트가 뒤따르는
    // ASCII 한 글자를 삼키는데, 그렇게 닫는 따옴표가 사라져 파싱이 실패한 제보가
    // 있었다("문자열에 ' 종결자가 없습니다"). 편집기·포매터가 BOM을 떼면 같은 일이
    // 되풀이되고, **한국어 Windows에서만** 드러나므로 여기서 고정한다.
    const head = readFileSync(path.join(root, 'scripts', 'dev-cert.ps1')).subarray(0, 3);
    expect([...head]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('개발 인증서 스크립트가 PowerShell 5.1에 없는 API를 쓰지 않는다', () => {
    // `RandomNumberGenerator::GetBytes(int)`(정적)는 .NET 5+ API다 — 5.1은
    // .NET Framework라 그 자리에서 던진다. 양쪽에 다 있는 `Create()`를 쓴다.
    const ps1 = readFileSync(path.join(root, 'scripts', 'dev-cert.ps1'), 'utf8');
    expect(ps1).not.toMatch(/RandomNumberGenerator\]::GetBytes/);
    expect(ps1).toContain('RandomNumberGenerator]::Create()');
  });

  it('발행자와 정체성이 설정에 있다 — 개발 인증서 스크립트가 여기서 읽는다', () => {
    // scripts/dev-cert.ps1이 `publisher`를 이 파일에서 읽어 그 값으로 인증서를
    // 만든다. 둘이 어긋나면 `Add-AppxPackage`가 서명/발행자 불일치로 거절한다.
    expect(config).toMatch(/^\s{2}publisher:\s*CN=/m);
    expect(config).toMatch(/^\s{2}identityName:\s*\S+/m);
  });
});

/** PNG IHDR에서 크기만 읽는다(디코더를 끌어오지 않는다). */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
