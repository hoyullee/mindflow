import { LegalPage, LegalSection, legalListStyle } from './LegalPage';

/**
 * 개인정보처리방침 — 실제 서비스 동작(어댑터 구조, Supabase 저장, Google
 * OAuth, 회원 탈퇴 cascade 삭제)을 그대로 기술한다. 여기 적힌 내용이 코드와
 * 어긋나게 되는 변경(수집 항목 추가 등)을 할 때는 이 문서도 함께 갱신할 것.
 * Google 브랜드 인증 심사가 이 URL(`/privacy`)을 직접 열어 확인한다.
 */
export function PrivacyPolicy() {
  return (
    <LegalPage title="개인정보처리방침" updated="2026년 7월 22일">
      <p>
        Geurio(이하 &ldquo;서비스&rdquo;)는 이용자의 개인정보를 소중하게 생각하며, 아래와 같이 최소한의 정보만을
        수집·이용합니다. 본 방침은 서비스가 어떤 정보를 왜 수집하고, 어디에 보관하며, 언제 삭제하는지를 설명합니다.
      </p>

      <LegalSection heading="1. 수집하는 개인정보">
        <ul style={legalListStyle}>
          <li>
            <strong>계정 정보</strong> — 이메일 주소, 비밀번호(이메일 가입 시 — 해시 형태로만 저장되며 원문은 저장되지
            않습니다). Google 계정으로 로그인하는 경우 Google이 제공하는 이름과 프로필 사진 URL을 추가로 받습니다.
          </li>
          <li>
            <strong>서비스 콘텐츠</strong> — 이용자가 작성한 마인드맵 문서, 폴더/스페이스 구성 등 서비스 이용 과정에서
            직접 생성한 데이터.
          </li>
          <li>
            <strong>브라우저 저장 정보</strong> — 로그인 세션 토큰, 화면 설정, 최근 문서 목록 등이 이용자의 브라우저
            저장소(localStorage)에 보관됩니다. 이는 이용자의 기기에만 저장되는 정보입니다.
          </li>
        </ul>
        <p>서비스는 광고·추적 목적의 쿠키나 제3자 분석 스크립트를 사용하지 않습니다.</p>
      </LegalSection>

      <LegalSection heading="2. 수집 목적">
        <ul style={legalListStyle}>
          <li>회원 식별 및 로그인 처리</li>
          <li>작성한 문서의 저장, 기기 간 동기화, 실시간 협업 제공</li>
          <li>계정 관련 필수 안내(이메일 인증, 비밀번호 재설정) 발송</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. 보관 장소 및 처리 위탁">
        <p>수집된 정보는 서비스 운영을 위해 아래 클라우드 사업자의 인프라에 보관·처리됩니다. 서버는 해외 리전에 위치할 수 있습니다.</p>
        <ul style={legalListStyle}>
          <li>
            <strong>Supabase</strong> — 데이터베이스 및 인증(계정 정보, 문서 데이터 저장)
          </li>
          <li>
            <strong>Vercel</strong> — 웹 애플리케이션 호스팅
          </li>
          <li>
            <strong>Google</strong> — Google 계정 로그인(OAuth) 처리. 서비스는 이 과정에서 이용자의 Google 비밀번호에
            접근할 수 없습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. 보유 기간 및 파기">
        <p>
          개인정보는 회원 자격이 유지되는 동안 보관됩니다. <strong>회원 탈퇴 시 계정 정보와 작성한 모든 문서·워크스페이스
          데이터가 즉시, 복구 불가능하게 삭제됩니다.</strong> 별도의 백업 보존 기간을 두지 않습니다.
        </p>
      </LegalSection>

      <LegalSection heading="5. 이용자의 권리">
        <ul style={legalListStyle}>
          <li>계정 설정에서 언제든지 프로필 정보를 확인·수정할 수 있습니다.</li>
          <li>작성한 문서는 언제든지 직접 삭제(휴지통 → 영구 삭제)할 수 있습니다.</li>
          <li>설정 → 위험 구역의 &ldquo;회원 탈퇴&rdquo;로 계정과 모든 데이터를 즉시 삭제할 수 있습니다.</li>
          <li>기타 개인정보 관련 요청은 아래 문의처로 연락해 주세요.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. 문의처">
        <p>
          개인정보 관련 문의: <a href="mailto:info@geurio.com" style={{ color: '#f0663f', fontWeight: 600 }}>info@geurio.com</a>
        </p>
      </LegalSection>

      <LegalSection heading="7. 방침의 변경">
        <p>
          본 방침이 변경되는 경우 이 페이지를 통해 변경 사항과 시행일을 공지합니다. 중요한 변경(수집 항목 추가 등)이 있는
          경우 서비스 내에서 별도로 안내합니다.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
