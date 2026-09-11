import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SectionLabel, SettingsGroup, SettingsRow } from './AccountSettingsModal';
import { applyUpdateNow, checkForUpdateNow, currentUpdateStatus, onUpdateStatus, updateControlsReady } from '../../../../pwa/updateControl';
import { desktopBridge, openExternalUrl } from '../../../../platform/desktopBridge';
import { checkShellUpdate, mergedUpdateState, type MergedUpdate, type ShellUpdateState } from '../../../../platform/shellUpdate';

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
  const status = useSyncExternalStore(onUpdateStatus, currentUpdateStatus, currentUpdateStatus);
  const controls = updateControlsReady();
  /** 방금 확인을 마쳤는가 — 눌렀는데 같은 문장만 남으면 아무 일도 안 한 것처럼 보인다. */
  const [checked, setChecked] = useState(false);
  const wasChecking = useRef(false);
  useEffect(() => {
    if (wasChecking.current && !status.checking) setChecked(true);
    wasChecking.current = status.checking;
  }, [status.checking]);

  const bridge = desktopBridge();
  const build = buildLabel();

  // 껍데기(설치 파일)의 새 판 — 화면(웹 번들)과 **따로** 확인한다. 자동 업데이트가
  // 없으므로 이 확인이 사용자가 새 설치본을 알 수 있는 유일한 길이다.
  const [shell, setShell] = useState<ShellUpdateState>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const checkShell = useCallback(() => {
    const b = desktopBridge();
    if (!b) return;
    setShell({ kind: 'checking' });
    // 마운트 플래그로 지킨다(효과별 취소 플래그가 아니라) — 답이 하나뿐이지만
    // 이 프로젝트에서 그 함정을 두 번 밟았다: 첫 답이 상태를 바꾸면 효과가 다시
    // 돌고, 그 사이 남은 조회가 버려진다.
    void checkShellUpdate(b.version).then((next) => { if (alive.current) setShell(next); });
  }, []);
  // 이 화면을 여는 것이 곧 "확인해 달라"는 뜻이다 — 따로 누르게 하지 않는다.
  useEffect(() => { checkShell(); }, [checkShell]);

  return (
    <>
      <div style={{ marginBottom: 9 }}>
        <SectionLabel>현재 버전</SectionLabel>
      </div>
      <SettingsGroup>
        {/* 화면(웹 번들)의 판 — 배포마다 바뀌는 값이고, 콘솔 스탬프와 같은 것이다.
            버전 번호가 아니라 **빌드 시각**인 이유: 우리는 연속 배포라 사용자에게
            뜻이 있는 눈금이 "언제 나간 판인가"다(같은 값이 피드백 meta에도 실린다). */}
        <SettingsRow
          first
          attrs={{ 'data-version-build': '' }}
          icon={
            <>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 8v4l2.5 2" />
            </>
          }
          title="앱 화면"
          sub={build.sub}
          right={<VersionValue>{build.label}</VersionValue>}
        />
        {bridge && (
          // 설치형 앱은 **껍데기**가 따로 있다(화면은 웹과 같은 판이다). 이 값은
          // 스스로 갱신되지 않으므로(자동 업데이트 없음) 새 설치 파일이 필요하다.
          <SettingsRow
            attrs={{ 'data-version-shell': '' }}
            icon={
              <>
                <rect x="3" y="4.5" width="18" height="13" rx="2.5" />
                <path d="M8 20.5h8" />
              </>
            }
            title="설치 앱"
            sub={bridge.platform === 'darwin' ? 'macOS' : bridge.platform === 'win32' ? 'Windows' : bridge.platform}
            right={<VersionValue>{bridge.version}</VersionValue>}
          />
        )}
      </SettingsGroup>

      <div style={{ marginTop: 18, marginBottom: 9 }}>
        <SectionLabel>업데이트</SectionLabel>
      </div>
      <SettingsGroup>
        {/* 행은 **하나**다(요청) — 화면과 껍데기를 함께 보고, 둘이 같이 있으면
            껍데기 쪽을 누르게 한다(설치가 화면까지 해결한다). */}
        <UpdateRow
          merged={mergedUpdateState(status, controls, bridge ? shell : null)}
          checked={checked}
          onCheck={() => {
            setChecked(false);
            checkForUpdateNow();
            // `지금 확인`은 사용자에게 **하나의 동작**이다 — 화면과 껍데기를 함께 본다.
            checkShell();
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
    case 'shell':
      return row({
        state: 'shell',
        iconColor: 'var(--mf-accent-strong)',
        title: `새 설치 버전 ${merged.release?.version ?? ''}이 있어요`,
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

declare const __BUILD_AT__: string;
declare const __BUILD_SHA__: string;

/**
 * 지금 돌고 있는 화면의 판 — 빌드 시각(로컬 시간)과 커밋 일곱 자리.
 * 개발 서버에서는 둘 다 없다(`dev`).
 */
function buildLabel(): { label: string; sub: string } {
  const at = typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : 'dev';
  const sha = typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : '';
  if (at === 'dev') return { label: 'dev', sub: '개발 서버에서 돌고 있어요' };
  const d = new Date(at);
  const label = Number.isNaN(d.getTime())
    ? at
    : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { label, sub: sha ? `빌드 ${sha}` : '빌드 시각' };
}
