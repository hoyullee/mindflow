// 도구 고르기 시트(모바일 홈 디자인 M4b) — 하단 탭 「도구」를 누르면 바닥에서 올라온다.
//
// 연결한 도구 중 **화면이 있는 것**(지금은 Jira의 작업 현황)을 한 줄씩 — 누르면 그 화면으로 간다. 맨 아래
// 「도구 연결 · 관리」는 설정 › 계정 설정 › 도구(LNB 도구 관리 팝오버와 같은 데이터)를 연다. 오른쪽 끝에는
// 화면 없이 붙어 있는 도구(구글 캘린더 — 일정 안에서 보인다)의 연결 상태를 적는다.
//
// **도구가 하나여도 늘 시트를 띄운다**(사용자 결정). 디자인 캡션은 "화면 있는 도구가 1개면 시트 없이 바로
// 진입"이었지만, 그러면 지금은 시트가 거의 보이지 않고 「오늘 N」·연결 관리로 가는 길도 함께 사라진다.
//
// 디자인의 두 번째 줄 「회의실 예약 · Google Workspace · 예시(추후 추가)」는 **예시**라 그리지 않는다 —
// 갈 화면이 없는 줄은 누르는 척하는 줄이다.

import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { useTools } from '../../tools/useTools';
import { ToolIcon } from '../../tools/ui';
import { useJiraTodayCount } from '../../tools/workstatus/useJiraTodayCount';
import { MONO_FONT } from '../chrome';
import { Chevron, MobileSheet, SheetClose } from './parts';

interface Props {
  open: boolean;
  onClose: () => void;
  state: HomeState;
  controller: HomeController;
}

export function MobileToolsSheet({ open, onClose, state, controller }: Props) {
  return (
    <MobileSheet open={open} onClose={onClose} label="도구" attrs={{ 'data-m-tools-sheet': '' }}>
      {/* 몸통은 시트가 열려 있을 때만 선다 — 도구 상태·오늘 티켓 조회는 열 때 한 번이면 된다. */}
      <Body onClose={onClose} state={state} controller={controller} />
    </MobileSheet>
  );
}

function Body({ onClose, state, controller }: Omit<Props, 'open'>) {
  const tools = useTools(state, controller);
  const jiraScreen = tools.screens.some((r) => r.key === 'jira');
  const today = useJiraTodayCount(jiraScreen);
  /** 화면 없이 붙어 있는 도구 — 연결 관리 줄 끝의 한마디(「Google 캘린더 연결됨」). */
  const plain = tools.connected.filter((r) => !r.hasScreen).map((r) => r.name);
  const jiraHidden = tools.rows.some((r) => r.key === 'jira' && r.connected && !r.show);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 20px 10px 24px', flex: '0 0 auto' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)' }}>도구</span>
          <span style={{ fontSize: 13.5, color: 'var(--mf-m-mut)' }}>연결한 도구의 화면으로 바로 가요</span>
        </span>
        <span style={{ paddingTop: 4 }}>
          <SheetClose onClick={onClose} />
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 8px 0', flex: '0 0 auto' }}>
        {tools.screens.map((r) => (
          <button
            key={r.key}
            type="button"
            className="btn mf-m-press"
            data-m-tool={r.key}
            onClick={() => {
              onClose();
              // 화면이 있는 도구는 지금 Jira 하나다 — 둘째가 생기면 `openTool`이 그 열쇠를 받게 넓힌다.
              if (r.key === 'jira') controller.openTool('jira');
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', border: 0, borderRadius: 16, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          >
            <ToolIcon tool={r.key} size={48} radius={14} font={20} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                {r.key === 'jira' && today !== null && today > 0 && (
                  <span
                    data-m-tool-today
                    style={{ flex: '0 0 auto', height: 22, padding: '0 9px', borderRadius: 99, background: 'color-mix(in srgb, var(--mf-accent) 13%, var(--mf-m-card))', color: 'var(--mf-accent-strong)', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    오늘 <span style={{ fontFamily: MONO_FONT, fontWeight: 700 }}>{today}</span>
                  </span>
                )}
              </span>
              <span style={{ fontSize: 13.5, color: r.syncError ? 'var(--mf-m-danger)' : 'var(--mf-m-mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.syncError ? `${r.name} · ${r.syncError}` : `${r.name}${r.account ? ` · ${r.account}` : ''}`}
              </span>
            </span>
            <Chevron />
          </button>
        ))}
        {tools.screens.length === 0 && (
          <span data-m-tools-empty style={{ display: 'block', padding: '10px 16px 6px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>
            {jiraHidden ? '작업 현황을 목록에서 숨겨 두었어요. 아래 도구 관리에서 다시 켤 수 있어요.' : '아직 화면이 있는 도구가 없어요. Jira를 연결하면 작업 현황이 여기 생겨요.'}
          </span>
        )}
      </div>

      <span aria-hidden="true" style={{ display: 'block', height: 1, margin: '12px 24px 8px', background: 'var(--mf-m-line)', flex: '0 0 auto' }} />

      <div style={{ padding: '0 8px 6px', flex: '0 0 auto' }}>
        <button
          type="button"
          className="btn mf-m-press"
          data-m-tools-manage
          onClick={() => {
            onClose();
            controller.openToolsSettings();
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '10px 16px', border: 0, borderRadius: 16, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          <span aria-hidden="true" style={{ width: 42, height: 42, margin: '0 3px', flex: '0 0 auto', boxSizing: 'border-box', borderRadius: 12, border: '1.5px dashed var(--mf-m-btn-line)', color: 'var(--mf-m-mut)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span style={{ flex: '0 0 auto', fontSize: 15.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)' }}>도구 연결 · 관리</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 12.5, color: 'var(--mf-m-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plain.length ? `${plain.join(' · ')} 연결됨` : ''}</span>
        </button>
      </div>
    </>
  );
}
