// macOS **애드혹 서명**(afterPack). 서명 인증서가 없는 빌드에서
// `mac.identity: null`이면 electron-builder가 서명 단계를 통째로 건너뛰는데,
// Apple Silicon은 서명이 전혀 없는 앱을 실행조차 못 하게 막는다("손상되었기
// 때문에 열 수 없습니다"). `codesign --sign -`는 인증서 없이 붙일 수 있는
// 서명이라, 최소한 앱이 **실행은 되는** 상태를 만든다.
//
// Gatekeeper 경고 자체는 그대로다(공증이 없으므로) — 사용자는 우클릭 → 열기를
// 한 번 거쳐야 한다. 인증서를 CI 시크릿에 넣으면 이 스크립트는 아무 일도 하지
// 않게 된다(그때는 electron-builder가 진짜 서명을 한다).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.log(`[geurio] ad-hoc signed ${appPath}`);
  } catch (err) {
    // 서명에 실패해도 패키징 자체는 끝낸다 — 산출물이 없는 것보다 낫다.
    console.warn('[geurio] ad-hoc signing failed (앱이 Apple Silicon에서 실행되지 않을 수 있어요)', err);
  }
};
