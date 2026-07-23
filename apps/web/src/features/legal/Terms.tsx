import { LegalPage, LegalSection, legalListStyle } from './LegalPage';

/** 이용약관 — `/terms`. 개인정보처리방침과 함께 Google 브랜드 인증(동의 화면의
 * 서비스 약관 링크)에서 요구되는 공개 문서. */
export function Terms() {
  return (
    <LegalPage title="이용약관" updated="2026년 7월 22일">
      <p>
        본 약관은 Geurio(이하 &ldquo;서비스&rdquo;)의 이용 조건을 정합니다. 서비스에 가입하거나 이를 이용함으로써 본
        약관에 동의하는 것으로 봅니다.
      </p>

      <LegalSection heading="1. 서비스 개요">
        <p>
          Geurio는 마인드맵을 만들고 정리·공유할 수 있는 웹 서비스입니다. 웹 브라우저 및 모바일 환경에서 이용할 수
          있으며, 문서는 계정에 저장되어 기기 간에 동기화됩니다.
        </p>
      </LegalSection>

      <LegalSection heading="2. 계정">
        <ul style={legalListStyle}>
          <li>이메일 또는 Google 계정으로 가입할 수 있습니다.</li>
          <li>계정 및 비밀번호 관리 책임은 이용자에게 있습니다.</li>
          <li>이용자는 언제든지 설정에서 회원 탈퇴할 수 있으며, 탈퇴 시 모든 데이터가 즉시 삭제됩니다.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. 콘텐츠의 권리">
        <p>
          이용자가 서비스에서 작성한 마인드맵 등 모든 콘텐츠의 권리는 <strong>이용자 본인에게</strong> 있습니다. 서비스는
          콘텐츠를 저장·동기화·표시하는 데 필요한 범위에서만 이를 처리하며, 그 외 목적으로 이용하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection heading="4. 금지 행위">
        <ul style={legalListStyle}>
          <li>타인의 계정을 무단으로 사용하는 행위</li>
          <li>서비스의 정상적인 운영을 방해하는 행위(비정상적 자동화 접근, 취약점 악용 등)</li>
          <li>법령에 위반되는 콘텐츠를 저장·공유하는 행위</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. 서비스의 변경 및 중단">
        <p>
          서비스는 기능을 지속적으로 개선하며, 필요한 경우 일부 기능을 변경하거나 중단할 수 있습니다. 서비스 전체를
          종료하는 경우 사전에 공지하고, 이용자가 데이터를 내보낼 수 있는 기간을 제공합니다.
        </p>
      </LegalSection>

      <LegalSection heading="6. 책임의 한계">
        <p>
          서비스는 &ldquo;있는 그대로&rdquo; 제공됩니다. 무료로 제공되는 범위 내에서, 천재지변·클라우드 장애 등 불가항력으로
          인한 데이터 손실이나 서비스 중단에 대해 법령이 허용하는 한도 내에서 책임이 제한됩니다. 중요한 문서는 내보내기
          기능(PNG·Markdown·JSON)으로 별도 보관할 것을 권장합니다.
        </p>
      </LegalSection>

      <LegalSection heading="7. 문의">
        <p>
          약관 관련 문의: <a href="mailto:info@geurio.com" style={{ color: '#f0663f', fontWeight: 600 }}>info@geurio.com</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
