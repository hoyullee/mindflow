import { describe, expect, it } from 'vitest';
import {
  clampBounds,
  deepLinkFromArgv,
  isInternalUrl,
  isSafeExternalUrl,
  MIN_HEIGHT,
  MIN_WIDTH,
  isDeepLink,
  isHexColor,
  originOf,
  TITLEBAR_HEIGHT,
  titleBarHeightFor,
  usesCustomTitleBar,
} from './shell';

const APP = 'https://geurio.com';

describe('isInternalUrl — 앱 창은 우리 출처만 띄운다', () => {
  it('같은 출처의 다른 경로는 내부다', () => {
    expect(isInternalUrl('https://geurio.com/editor?map=m1', APP)).toBe(true);
  });

  it('남의 출처는 내부가 아니다(피싱 방지 — 브라우저로 보낸다)', () => {
    expect(isInternalUrl('https://accounts.google.com/o/oauth2/auth', APP)).toBe(false);
    expect(isInternalUrl('https://geurio.com.evil.example/home', APP)).toBe(false);
    // 서브도메인도 다른 출처다 — 필요해지면 그때 명시적으로 허용한다.
    expect(isInternalUrl('https://www.geurio.com/home', APP)).toBe(false);
  });

  it('http(s)가 아닌 스킴은 내부가 아니다', () => {
    expect(isInternalUrl('file:///etc/passwd', APP)).toBe(false);
    expect(isInternalUrl('javascript:alert(1)', APP)).toBe(false);
    expect(isInternalUrl('geurio://auth?refresh_token=x', APP)).toBe(false);
  });

  it('출처를 모르면 아무것도 내부로 보지 않는다', () => {
    expect(isInternalUrl('https://geurio.com/home', null)).toBe(false);
    expect(originOf('not a url')).toBe(null);
  });
});

describe('isSafeExternalUrl — 브라우저로 넘길 수 있는 주소', () => {
  it('http(s)만 넘긴다', () => {
    expect(isSafeExternalUrl('https://accounts.google.com/x')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:5173/home')).toBe(true);
    // OS 핸들러를 깨우는 스킴은 넘기지 않는다.
    expect(isSafeExternalUrl('file:///Users/me/secret.txt')).toBe(false);
    expect(isSafeExternalUrl('ms-msdt:/id')).toBe(false);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(false);
  });
});

describe('isDeepLink — OS가 넘긴 문자열은 아무나 만들 수 있다', () => {
  it('우리 스킴이면 통과(무엇을 뜻하는지는 웹이 읽는다)', () => {
    expect(isDeepLink('geurio://auth?refresh_token=rt')).toBe(true);
    expect(isDeepLink('geurio://무엇이든')).toBe(true);
  });

  it('다른 스킴·쓰레기는 넘기지 않는다', () => {
    expect(isDeepLink('https://geurio.com/auth?refresh_token=rt')).toBe(false);
    expect(isDeepLink('geurioo://auth')).toBe(false);
    expect(isDeepLink('쓰레기')).toBe(false);
  });
});

describe('deepLinkFromArgv — Windows·Linux는 명령줄로 넘어온다', () => {
  it('argv 어디에 있어도 찾는다', () => {
    expect(deepLinkFromArgv(['geurio.exe', '--flag', 'geurio://auth?refresh_token=rt'])).toBe(
      'geurio://auth?refresh_token=rt',
    );
  });

  it('없으면 null', () => {
    expect(deepLinkFromArgv(['geurio.exe', '--flag'])).toBe(null);
  });
});

describe('clampBounds — 저장된 자리가 화면 밖이면 창이 안 보인다', () => {
  const work = { x: 0, y: 0, width: 1440, height: 900 };

  it('자리를 모르면 화면 가운데', () => {
    const b = clampBounds(null, work);
    expect(b.x + b.width / 2).toBe(720);
    expect(b.y + b.height / 2).toBe(450);
  });

  it('화면 밖 좌표는 안으로 당긴다', () => {
    const b = clampBounds({ x: 5000, y: -400, width: 1000, height: 700 }, work);
    expect(b.x).toBe(440); // 1440 - 1000
    expect(b.y).toBe(0);
  });

  it('최소 크기를 지키고 화면보다 크게 열지 않는다', () => {
    expect(clampBounds({ x: 0, y: 0, width: 200, height: 100 }, work)).toMatchObject({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
    expect(clampBounds({ x: 0, y: 0, width: 5000, height: 5000 }, work)).toMatchObject({
      width: 1440,
      height: 900,
    });
  });

  it('보조 모니터(음수 좌표)의 작업 영역도 그대로 쓴다', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const b = clampBounds({ x: -1900, y: 40, width: 1200, height: 800 }, left);
    expect(b).toEqual({ x: -1900, y: 40, width: 1200, height: 800 });
  });
});

describe('타이틀 바', () => {
  it('Windows·macOS만 프레임을 숨긴다', () => {
    expect(usesCustomTitleBar('win32')).toBe(true);
    expect(usesCustomTitleBar('darwin')).toBe(true);
    // Linux는 OS 프레임 그대로 — 숨겼다가 창을 옮기거나 닫을 길이 사라지는 쪽이 나쁘다.
    expect(usesCustomTitleBar('linux')).toBe(false);
  });

  it('높이 0이 "그리지 않는다"를 뜻한다', () => {
    expect(titleBarHeightFor('win32')).toBe(TITLEBAR_HEIGHT);
    expect(titleBarHeightFor('linux')).toBe(0);
  });

  it('창 컨트롤 색은 hex만 받는다', () => {
    expect(isHexColor('#fffdfb')).toBe(true);
    expect(isHexColor('#FFF')).toBe(true);
    // 원격 페이지가 넘길 수 있는 값이므로 모양을 본다.
    expect(isHexColor('white')).toBe(false);
    expect(isHexColor('var(--mf-card)')).toBe(false);
    expect(isHexColor('rgb(255,253,251)')).toBe(false);
    expect(isHexColor('#fffdfb; drop table')).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});
