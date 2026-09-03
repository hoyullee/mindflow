import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { PrivacyPolicy } from './PrivacyPolicy';
import { Terms } from './Terms';

afterEach(() => {
  cleanup();
});

describe('legal pages', () => {
  it('privacy policy renders its required sections (수집 항목·보유 기간·문의처)', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toBeTruthy();
    expect(screen.getByText('1. 수집하는 개인정보')).toBeTruthy();
    // 구글 민감 스코프(`calendar.events`) 검수가 이 페이지에서 찾는 것 — 무엇을 받고
    // 어디에 보관하며 어떻게 쓰는지, 그리고 **Limited Use** 준수 진술.
    expect(screen.getByText('4. Google 캘린더 연동 (선택)')).toBeTruthy();
    expect(screen.getByText(/제한적 사용\(Limited Use\)/)).toBeTruthy();
    expect(screen.getAllByText(/보관하지 않습니다/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /타사 앱 권한/ }).getAttribute('href')).toBe('https://myaccount.google.com/permissions');
    // 2026-09-01 검수 반려가 요구한 것 — Google 사용자 데이터를 **누구에게**
    // 공유·전송·공개하는지, 세 낱말을 제목으로 단 눈에 띄는 구획과 예외 열거.
    expect(screen.getByText('5. Google 사용자 데이터의 공유·전송·공개')).toBeTruthy();
    expect(screen.getByText(/공유·전송·공개하지 않습니다/)).toBeTruthy();
    expect(screen.getByText('서비스 운영을 위한 처리 위탁')).toBeTruthy();
    expect(screen.getByText('법령상 의무')).toBeTruthy();
    // 2026-09-03 검수 반려가 요구한 것 — 민감 데이터의 **보호 수단**(§5의 "누구에게"와
    // 다른 항목이다: 여기는 "어떻게 지키는가"). 검수가 찾는 낱말을 계약으로 고정한다.
    expect(screen.getByText('6. 데이터 보호 조치')).toBeTruthy();
    for (const t of ['전송 중 암호화', '저장 중 암호화', '계정 단위 접근 통제', '비밀 키 관리', '안전한 삭제', '사고 대응']) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getByText(/HTTPS\(TLS\)/)).toBeTruthy();
    // 방침이 실제 구현과 어긋나면 그 자체가 반려 사유다 — 토큰은 이 기기에 남는다
    // (예전 문장은 `sessionStorage`·"탭을 닫으면 사라집니다"였고 코드만 바뀌었다).
    expect(screen.getByText(/이용자 브라우저의 로컬 저장소에만/)).toBeTruthy();
    expect(screen.queryByText(/sessionStorage/)).toBeNull();
    expect(screen.getByText('7. 보유 기간 및 파기')).toBeTruthy();
    expect(screen.getAllByText('info@geurio.com').length).toBeGreaterThan(0);
  });

  it('terms renders with the content-ownership clause', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '이용약관' })).toBeTruthy();
    expect(screen.getByText('3. 콘텐츠의 권리')).toBeTruthy();
  });
});

describe('legal routes (public, outside RequireAuth)', () => {
  // App owns its own BrowserRouter, so route testing goes through the real
  // history API instead of MemoryRouter initialEntries.
  function renderAppAt(path: string) {
    window.history.pushState({}, '', path);
    return render(<App />);
  }

  it('/privacy is reachable logged-out', () => {
    renderAppAt('/privacy');
    expect(screen.getByRole('heading', { name: '개인정보처리방침' })).toBeTruthy();
  });

  it('/terms is reachable logged-out', () => {
    renderAppAt('/terms');
    expect(screen.getByRole('heading', { name: '이용약관' })).toBeTruthy();
  });
});
