import { describe, expect, it } from 'vitest';
import { installHintMode, type InstallEnv } from './installHint';

const base: InstallEnv = { isMobile: true, standalone: false, dismissed: false, canPrompt: false, ios: false };

// 안내가 필요한 쪽은 사실상 iOS다 — 안드로이드는 브라우저가 설치 프롬프트를 주고,
// 데스크톱·이미 설치된 창·한 번 닫은 기기에는 띄울 이유가 없다.
describe('installHintMode', () => {
  it('안드로이드(프롬프트 확보)는 버튼 한 번으로 설치', () => {
    expect(installHintMode({ ...base, canPrompt: true })).toBe('prompt');
  });

  it('iOS는 수동 절차 안내', () => {
    expect(installHintMode({ ...base, ios: true })).toBe('ios');
  });

  it('프롬프트가 있으면 iOS 판정보다 우선(둘 다면 버튼이 낫다)', () => {
    expect(installHintMode({ ...base, ios: true, canPrompt: true })).toBe('prompt');
  });

  it('설치 수단도 없고 iOS도 아니면 조용히 넘어간다', () => {
    expect(installHintMode(base)).toBeNull();
  });

  // 데스크톱 크롬·엣지도 `beforeinstallprompt`를 준다 — 한 번에 설치되는 길이
  // 있으면 기기를 가리지 않는다(사용자 요청). 반대로 **손으로 하는 절차 안내**는
  // 그 절차가 있는 iOS 모바일에만.
  it('데스크톱에서도 한 번에 설치되면 띄운다', () => {
    expect(installHintMode({ ...base, isMobile: false, canPrompt: true })).toBe('prompt');
  });

  it('데스크톱에는 수동 절차를 안내하지 않는다 (안내할 절차가 없다)', () => {
    expect(installHintMode({ ...base, ios: true, isMobile: false })).toBeNull();
    expect(installHintMode({ ...base, isMobile: false })).toBeNull();
  });

  it('이미 홈 화면·한 번 닫은 기기에는 띄우지 않는다', () => {
    expect(installHintMode({ ...base, ios: true, standalone: true })).toBeNull();
    expect(installHintMode({ ...base, ios: true, dismissed: true })).toBeNull();
    expect(installHintMode({ ...base, canPrompt: true, dismissed: true })).toBeNull();
    expect(installHintMode({ ...base, isMobile: false, canPrompt: true, standalone: true })).toBeNull();
  });
});
