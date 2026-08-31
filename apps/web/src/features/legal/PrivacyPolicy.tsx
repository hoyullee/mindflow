import { LegalPage, LegalSection, legalListStyle } from './LegalPage';

/**
 * 개인정보처리방침 — 실제 서비스 동작(어댑터 구조, Supabase 저장, Google
 * OAuth·캘린더 연동, 회원 탈퇴 cascade 삭제)을 그대로 기술한다. 여기 적힌 내용이
 * 코드와 어긋나게 되는 변경(수집 항목 추가 등)을 할 때는 이 문서도 함께 갱신할 것.
 *
 * **구글 심사가 이 URL(`/privacy`)을 직접 열어 확인한다.** 브랜드 인증(이름·목적
 * 설명·이 링크)뿐 아니라, 민감 스코프(`calendar.events`) 검수는 아래 §4가 요구
 * 사항이다 — 구글 사용자 데이터를 **무엇을·왜·어디에 보관하고 누구에게 주는지**와
 * **Limited Use** 준수가 적혀 있어야 한다. **스코프를 늘리면 §4도 같이 늘릴 것**
 * (2026-08-31에 이름 검색·회의실 선택 스코프를 더하며 실제로 함께 고쳤다).
 */
export function PrivacyPolicy() {
  return (
    <LegalPage title="개인정보처리방침" updated="2026년 8월 31일">
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
          <li>이용자가 연동을 켠 경우, 일정 화면에 Google 캘린더 일정 표시 및 이용자가 만든 일정의 반영(아래 4항)</li>
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
            <strong>Google</strong> — Google 계정 로그인(OAuth) 처리 및 이용자가 직접 켠 경우의 Google 캘린더 연동
            (아래 4항). 서비스는 이 과정에서 이용자의 Google 비밀번호에 접근할 수 없습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Google 캘린더 연동 (선택)">
        <p>
          이용자가 설정에서 <strong>직접 연결한 경우에만</strong> 서비스가 이용자의 Google 데이터에 접근합니다. 연결하지
          않으면 아래 어떤 정보도 요청하지 않습니다.
        </p>
        <ul style={legalListStyle}>
          <li>
            <strong>받는 권한(필수)</strong> — 일정 읽기·쓰기(<code>calendar.events</code>)와 캘린더 목록 조회
            (<code>calendar.calendarlist.readonly</code>). 캘린더 자체를 만들거나 삭제하거나 다른 사람에게 공유하는
            권한은 요청하지 않습니다.
          </li>
          <li>
            <strong>받는 권한(선택)</strong> — 참석자를 <strong>이름으로 찾기</strong> 위한 조직 디렉터리·연락처 조회
            (<code>directory.readonly</code>, <code>contacts.other.readonly</code>)와 <strong>회의실 목록</strong> 조회
            (<code>admin.directory.resource.calendar.readonly</code>). 이 셋은 허용하지 않아도 연동이 동작하며, 그때는
            참석자를 이메일로 직접 적고 회의실 선택은 화면에 나타나지 않습니다.
          </li>
          <li>
            <strong>받는 정보</strong> — 이용자가 보기로 고른 캘린더의 일정(제목·날짜·시각·위치·설명·참석자)과 캘린더
            목록(이름·색). 화면에 보이는 기간(6주)의 일정만 그때그때 조회합니다. 선택 권한을 허용한 경우 참석자를
            검색할 때 <strong>입력한 검색어에 해당하는</strong> 이름·이메일과 조직의 회의실 이름·정원을 함께 조회합니다.
          </li>
          <li>
            <strong>사용 목적</strong> — 일정 화면과 대시보드 위젯에 이용자의 일정을 표시하고, 이용자가 서비스 안에서
            만들거나 수정·삭제한 일정을 Google 캘린더에 반영하며, 일정에 참석자와 회의실을 넣기 위해서입니다.
            참석자에게 보내는 초대 메일과 알림은 <strong>Google이</strong> 발송합니다.
          </li>
          <li>
            <strong>보관하지 않습니다</strong> — 조회한 일정과 검색한 이름·회의실 목록은 브라우저에서 화면에 그리는 데만
            쓰이며 서비스 서버나 데이터베이스에 <strong>저장하지 않습니다</strong>. 서버에 남는 것은 &ldquo;어떤 캘린더를 보기로 골랐는지&rdquo;
            (캘린더 식별자 목록)뿐이고, 이는 기기 간에 같은 설정을 유지하기 위한 값입니다.
          </li>
          <li>
            <strong>접근 토큰</strong> — 브라우저의 탭 저장소(sessionStorage)에만 보관되며 <strong>탭을 닫으면
            사라집니다</strong>. 서버로 전송하거나 저장하지 않습니다.
          </li>
          <li>
            <strong>제3자 제공·광고·학습에 사용하지 않습니다</strong> — Google에서 받은 정보를 판매하거나 제3자에게
            제공하지 않으며, 광고나 인공지능 모델 학습에 사용하지 않습니다. 서비스는 Google API 서비스 이용자 데이터
            정책의 <strong>제한적 사용(Limited Use)</strong> 요건을 준수합니다.
          </li>
          <li>
            <strong>연결 해제</strong> — 설정 → 연동에서 &ldquo;연결 해제&rdquo;를 누르면 이 기기의 토큰이 폐기되고
            Google 쪽 승인도 함께 취소됩니다. Google 계정의{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: '#f0663f', fontWeight: 600 }}>
              타사 앱 권한 페이지
            </a>
            에서도 언제든 회수할 수 있습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. 보유 기간 및 파기">
        <p>
          개인정보는 회원 자격이 유지되는 동안 보관됩니다. <strong>회원 탈퇴 시 계정 정보와 작성한 모든 문서·워크스페이스
          데이터가 즉시, 복구 불가능하게 삭제됩니다.</strong> 별도의 백업 보존 기간을 두지 않습니다.
        </p>
      </LegalSection>

      <LegalSection heading="6. 이용자의 권리">
        <ul style={legalListStyle}>
          <li>계정 설정에서 언제든지 프로필 정보를 확인·수정할 수 있습니다.</li>
          <li>작성한 문서는 언제든지 직접 삭제(휴지통 → 영구 삭제)할 수 있습니다.</li>
          <li>설정 → 위험 구역의 &ldquo;회원 탈퇴&rdquo;로 계정과 모든 데이터를 즉시 삭제할 수 있습니다.</li>
          <li>기타 개인정보 관련 요청은 아래 문의처로 연락해 주세요.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. 문의처">
        <p>
          개인정보 관련 문의: <a href="mailto:info@geurio.com" style={{ color: '#f0663f', fontWeight: 600 }}>info@geurio.com</a>
        </p>
      </LegalSection>

      <LegalSection heading="8. 방침의 변경">
        <p>
          본 방침이 변경되는 경우 이 페이지를 통해 변경 사항과 시행일을 공지합니다. 중요한 변경(수집 항목 추가 등)이 있는
          경우 서비스 내에서 별도로 안내합니다.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
