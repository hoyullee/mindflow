import { useEffect, useRef, useState } from 'react';
import { SectionLabel, SettingsGroup, SettingsRow } from './AccountSettingsModal';
import { applyUpdateNow, checkForUpdateNow, checkShellUpdateNow, useMergedUpdate, useUpdateStatus } from '../../../../pwa/updateControl';
import { desktopBridge, openExternalUrl } from '../../../../platform/desktopBridge';
import { type MergedUpdate } from '../../../../platform/shellUpdate';

/**
 * 설정 › 「버전 확인」 — **지금 무엇을 돌고 있는지**와 새 버전을 직접 적용하는 손잡이.
 *
 * 왜 필요한가: 새 버전은 원래 조용히 적용된다(`updateGate`의 safe/defer 규칙). 그런데
 * 그 판단이 화면 상태를 보므로 편집·입력 중인 탭은 계속 미뤄지고, 사용자에게는 "언제
 * 최신이 되는지 알 수 없다"가 된다(요청: 수동으로 업데이트할 수 있게). 그래서 이
 * 화면은 자동 적용을 대신하는 것이 아니라 **확인하고 앞당기는** 자리다.
 *
 * 값은 `UpdatePrompt`가 모듈에 올려 둔 것을 읽는다 — `virtual:pwa-register/react`에
 * 닿을 수 있는 곳은 그 컴포넌트 하나뿐이다.
 */
export function VersionSection() {
  const status = useUpdateStatus();
  // 화면·껍데기를 합친 판단은 **모듈이 한 번** 한다 — LNB 알림도 같은 값을 읽는다.
  const merged = useMergedUpdate();
  /** 방금 확인을 마쳤는가 — 눌렀는데 같은 문장만 남으면 아무 일도 안 한 것처럼 보인다. */
  const [checked, setChecked] = useState(false);
  const wasChecking = useRef(false);
  useEffect(() => {
    if (wasChecking.current && !status.checking) setChecked(true);
    wasChecking.current = status.checking;
  }, [status.checking]);

  const build = buildLabel();

  // 껍데기(설치 파일)의 판은 **`UpdatePrompt`가 한 번 물어** 모듈에 올려 둔 것을
  // 읽는다(`status.shell`). 이 화면이 직접 확인하면 같은 값을 두 곳이 따로 들게
  // 되고, 홈 LNB 알림과 여기가 서로 다른 답을 말할 수 있다.
  // 이 화면을 여는 것이 곧 "확인해 달라"는 뜻이라 열릴 때 한 번 다시 묻는데,
  // **껍데기만** 묻는다 — 웹 번들은 스스로 신선하고(등록·5분 주기·탭 복귀),
  // 여기서 같이 물으면 열 때마다 1.5초 스피너가 돈다.
  useEffect(() => { checkShellUpdateNow(); }, []);

  return (
    <>
      <div style={{ marginBottom: 9 }}>
        <SectionLabel>현재 버전</SectionLabel>
      </div>
      <SettingsGroup>
        {/**
         * **버전은 한 줄이다**(요청 — 「앱 버전을 하나로 통일하고 싶다」).
         *
         * 예전에는 두 줄이었다: `앱 화면`(빌드 시각)과 `설치 앱`(셸 `package.json`).
         * 둘은 **다른 것을 재고** 있었다 — 화면은 배포마다(하루에도 여러 번), 셸은
         * 새 설치 파일을 낼 때만(몇 달에 한 번) 바뀐다. 설치형 앱은 `geurio.com`을
         * 띄우는 창이라 **보이는 것은 100% 웹 배포**이므로, 사용자가 말할 번호는
         * 화면 쪽 하나면 된다(CalVer — `vite.config.ts`의 `calver()`).
         *
         * 셸 번호를 버린 것은 아니다: **필요할 때만** 아래 「업데이트」 행이
         * "지금 0.3.0 → 새 설치 버전 0.4.0"으로 말한다. 늘 보여 주면 웹이 매일
         * 바뀌는 동안 몇 달째 멈춘 숫자가 나란히 있어 "최신인데 옛 번호"로 읽힌다.
         */}
        <SettingsRow
          first
          attrs={{ 'data-version-build': '' }}
          icon={
            <>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 8v4l2.5 2" />
            </>
          }
          title="버전"
          sub={build.sub}
          right={<VersionValue>{build.label}</VersionValue>}
        />
      </SettingsGroup>

      <div style={{ marginTop: 18, marginBottom: 9 }}>
        <SectionLabel>업데이트</SectionLabel>
      </div>
      <SettingsGroup>
        {/* 행은 **하나**다(요청) — 화면과 껍데기를 함께 보고, 둘이 같이 있으면
            껍데기 쪽을 누르게 한다(설치가 화면까지 해결한다). */}
        <UpdateRow
          merged={merged}
          checked={checked}
          onCheck={() => {
            setChecked(false);
            // `지금 확인`은 사용자에게 **하나의 동작**이다 — 화면과 껍데기를 함께 본다
            // (`checkForUpdateNow`가 둘을 같이 태운다).
            checkForUpdateNow();
          }}
        />
      </SettingsGroup>
    </>
  );
}

function VersionValue({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-version-value
      style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--mf-subtext)', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" }}
    >
      {children}
    </span>
  );
}

/**
 * 새 버전 한 행 — **화면(웹 번들)과 껍데기(설치 파일)를 합쳐** 하나로 말한다.
 *
 * 상태마다 **하는 말과 누를 것이 함께** 바뀐다. 눌러도 아무 일이 없는 버튼은 두지
 * 않는다: 확인할 수단이 없는 환경에서는 버튼 자체가 없다.
 *
 * 버튼 이름은 세 경우 모두 `업데이트`다(요청) — 사용자의 뜻이 그것이기 때문이다.
 * 대신 **부제가 무슨 일이 일어나는지 말한다**: 껍데기 쪽은 설치 파일을 받아야
 * 하므로 "받는 페이지가 열려요"라 적는다(자동 설치는 서명이 전제다 —
 * `shellUpdate.ts` 머리글).
 */
function UpdateRow({
  merged,
  checked,
  onCheck,
}: {
  merged: MergedUpdate;
  checked: boolean;
  onCheck: () => void;
}) {
  const icon = (
    <>
      <path d="M12 3.5v9" />
      <path d="m8.5 9 3.5 3.5L15.5 9" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  );
  const row = (props: {
    state: string;
    title: string;
    sub?: string;
    right: React.ReactNode;
    iconColor?: string;
  }) => (
    <SettingsRow
      first
      attrs={{ 'data-update-row': '', 'data-update-state': props.state }}
      icon={icon}
      iconColor={props.iconColor}
      title={props.title}
      sub={props.sub}
      right={props.right}
    />
  );

  switch (merged.kind) {
    case 'unavailable':
      return row({
        state: 'unavailable',
        title: '이 환경에서는 확인할 수 없어요',
        sub: '브라우저를 새로고침하면 최신 화면으로 열려요',
        right: <span />,
      });
    case 'save-blocked':
      return row({
        state: 'save-blocked',
        iconColor: 'var(--mf-danger)',
        title: '저장하지 못해 멈췄어요',
        sub: '저장되지 않은 편집이 있어요 — 저장한 뒤 다시 눌러 주세요',
        right: <UpdateButton onClick={() => void applyUpdateNow()}>다시 시도</UpdateButton>,
      });
    case 'applying':
      return row({
        state: 'applying',
        title: '업데이트하고 있어요',
        sub: '저장을 마치면 화면이 새로 열려요',
        right: <Spinner />,
      });
    case 'shell': {
      // **지금 깔린 설치본 번호는 여기서만 말한다**(요청: 버전은 한 줄) — 「현재
      // 버전」에 늘 세워 두면 웹이 매일 바뀌는 동안 몇 달째 멈춘 숫자가 나란히
      // 있어 "최신인데 옛 번호"로 읽힌다. 새 설치본이 있을 때는 반대로, 무엇에서
      // 무엇으로 가는지가 그 자리의 정보다.
      const now = desktopBridge()?.version;
      return row({
        state: 'shell',
        iconColor: 'var(--mf-accent-strong)',
        title: now ? `설치 버전 ${now} → ${merged.release?.version ?? ''}` : `새 설치 버전 ${merged.release?.version ?? ''}이 있어요`,
        // 웹 새 판이 함께 대기 중이면 **설치가 그것까지 해결한다** — 앱이 다시
        // 실행되면서 대기 중인 서비스 워커가 활성화된다.
        sub: merged.alsoWeb
          ? '받는 페이지가 열려요 — 설치하면 화면까지 함께 최신이 돼요'
          : '받는 페이지가 열려요 — 설치하면 적용돼요',
        right: (
          <UpdateButton primary onClick={() => void openExternalUrl(merged.release?.url ?? '')}>
            업데이트
          </UpdateButton>
        ),
      });
    }
    case 'ready':
      return row({
        state: 'ready',
        iconColor: 'var(--mf-accent-strong)',
        title: '새 버전이 준비됐어요',
        sub: '지금 적용하면 화면이 새로 열려요',
        right: (
          <UpdateButton primary onClick={() => void applyUpdateNow()}>
            업데이트
          </UpdateButton>
        ),
      });
    case 'checking':
      return row({ state: 'checking', title: '새 버전을 확인하고 있어요', right: <Spinner /> });
    default:
      return row({
        state: 'latest',
        title: '최신 버전이에요',
        // 껍데기를 **확인하지 못한** 것은 최신인 것과 다르다 — 뭉개지 않고 말한다.
        // 확인을 누른 뒤에는 **그 사실**을 말한다(같은 문장만 남으면 눌린 줄 모른다).
        sub: merged.shellUnknown
          ? '설치 버전은 확인하지 못했어요 — 연결을 확인한 뒤 다시 눌러 주세요'
          : checked
            ? '방금 확인했어요'
            : '새 버전이 나오면 자동으로 적용해요',
        right: <UpdateButton onClick={onCheck}>지금 확인</UpdateButton>,
      });
  }
}

function UpdateButton({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      data-update-action
      className={primary ? 'btn mf-ctl-primary' : 'btn mf-ctl'}
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 32,
        padding: '0 14px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: 'pointer',
        ...(primary
          ? { border: 0, background: 'linear-gradient(180deg, var(--mf-accent) 0%, var(--mf-accent-strong) 100%)', color: 'var(--mf-accent-ink)' }
          : { border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-subtext)' }),
      }}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      data-update-spin
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: 16,
        height: 16,
        borderRadius: 999,
        border: '2px solid var(--mf-border)',
        borderTopColor: 'var(--mf-accent)',
        animation: 'mf-spin .7s linear infinite',
      }}
    />
  );
}

declare const __BUILD_SHA__: string;
declare const __APP_VERSION__: string;

/**
 * 지금 돌고 있는 화면의 판 — 빌드 시각(로컬 시간)과 커밋 일곱 자리.
 * 개발 서버에서는 둘 다 없다(`dev`).
 */
/**
 * 화면에 적을 **버전 한 줄**. 값은 빌드가 굳혀 준다(`__APP_VERSION__`) — 여기서
 * 시각을 다시 포매팅하면 보는 사람의 시계를 타므로 같은 빌드가 지역마다 다른
 * 번호가 된다(`vite.config.ts`의 `calver()` 머리글).
 *
 * 부제는 **커밋 7자**다. 번호만으로는 "정확히 어느 커밋이 떠 있나"를 못 짚는데,
 * 프리뷰는 커밋마다 주소가 따로라 옛 주소를 열어 둔 탭이 실제로 있었다.
 */
function buildLabel(): { label: string; sub: string } {
  const version = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '';
  const sha = typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : '';
  if (!version) return { label: 'dev', sub: '개발 서버에서 돌고 있어요' };
  return { label: version, sub: sha ? `빌드 ${sha}` : '최신 판으로 열려 있어요' };
}
