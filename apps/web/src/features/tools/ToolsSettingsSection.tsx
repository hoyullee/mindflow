import type { HomeController } from '../home/useHomeController';
import type { HomeState } from '../home/types';
import { Switch } from '../../components/Switch';
import { TOOL_DEFS } from './toolDefs';
import { useTools, type ToolRow, type Tools } from './useTools';
import { ConnectButton, DisconnectButton, LabelEditor, ToolIcon } from './ui';
import { openJiraSetup } from './jira/JiraSetupModal';

/**
 * 설정 › 계정 설정 › **도구**(도구 스펙 §6) — 예전 「캘린더 연동」 구획의 자리.
 *
 * LNB 도구 관리 팝오버와 같은 데이터(`useTools`)라 어디서 바꿔도 곧바로 서로 반영된다.
 * 구글 캘린더 행은 연결돼 있으면 **캘린더 · 공휴일 설정**(예전 「Google 캘린더 연동」 화면)으로
 * 들어가는 줄을 단다 — 보여 줄 캘린더와 공휴일 국가는 거기서 고른다(공휴일 국가는 구글
 * 공휴일 캘린더 구독과 한 몸이라 이 화면으로 옮기지 않았다 — changelog 2026-09-30).
 */
export function ToolsSettingsSection({ state, controller }: { state: HomeState; controller: HomeController }) {
  const tools = useTools(state, controller);
  const rows = [...tools.connected, ...tools.available];
  return (
    <div data-tools-settings>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '18px 0 9px' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mf-faint)' }}>도구</span>
        <span style={{ fontSize: 11, color: 'var(--mf-faint2)' }}>연결하면 왼쪽 도구 목록에 화면이 생겨요</span>
      </div>
      <div style={{ borderRadius: 16, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)', overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <SettingsToolRow key={r.key} row={r} tools={tools} first={i === 0} onCalendar={controller.openCalendarDetail} />
        ))}
      </div>
    </div>
  );
}

function SettingsToolRow({ row, tools, first, onCalendar }: { row: ToolRow; tools: Tools; first: boolean; onCalendar: () => void }) {
  const jira = tools.jira;
  return (
    <div data-settings-tool={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: first ? 0 : '1px solid var(--mf-hairline)', background: row.connected ? 'var(--mf-card)' : 'var(--mf-panel)' }}>
      <ToolIcon tool={row.key} size={30} radius={10} font={13} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--mf-text)' }}>
          {TOOL_DEFS[row.key].name}
          {row.connected && <span style={{ height: 18, padding: '0 7px', borderRadius: 999, background: '#EBF5EE', color: '#2F7D57', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>연결됨</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mf-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.sub}
          {row.syncError && <span style={{ color: '#C0563A' }}> · 동기화 실패</span>}
        </div>
        {row.connected && row.hasScreen && (
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px' }}>
            <LabelEditor
              label={row.label}
              onSave={(v) => tools.setLabel(row.key, v)}
              font={11.5}
              inputStyle={{ height: 26, width: 180, padding: '0 8px', fontSize: 12.5, borderRadius: 8 }}
              extra={
                row.labelCustom ? (
                  <button type="button" className="btn" onClick={() => tools.setLabel(row.key, null)} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 10.5, color: 'var(--mf-faint)', textDecoration: 'underline', cursor: 'pointer' }}>
                    기본값
                  </button>
                ) : undefined
              }
            />
            {row.key === 'jira' && jira.site && (
              <button type="button" className="btn mf-tool-label" data-jira-projects-edit onClick={() => openJiraSetup()} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 11.5, color: 'var(--mf-muted)', cursor: 'pointer' }}>
                프로젝트 <b style={{ fontWeight: 800 }}>{jira.projects.length ? `${jira.projects.length}개` : '고르기'}</b> ›
              </button>
            )}
          </div>
        )}
        {row.connected && row.key === 'gcal' && (
          <button type="button" className="btn mf-tool-label" data-calendar-detail-row onClick={onCalendar} style={{ marginTop: 4, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 11.5, color: 'var(--mf-muted)', cursor: 'pointer' }}>
            보여 줄 캘린더 · <b style={{ fontWeight: 800 }}>공휴일 국가</b> ›
          </button>
        )}
      </div>
      {row.connected && row.hasScreen && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--mf-muted)' }}>왼쪽 목록</span>
          <Switch checked={row.show} onCheckedChange={() => tools.setShow(row.key, !row.show)} label="왼쪽 목록에 표시" accent="#E85E33" track="#DDD3C8" knob="#FFFFFF" />
        </span>
      )}
      {row.connected ? (
        <DisconnectButton onConfirm={() => tools.disconnect(row.key)} height={30} pad={14} font={12} weight={700} />
      ) : row.key === 'gcal' ? (
        // 구글은 **세부 화면에서** 잇는다 — 설치형 앱의 "브라우저에서 동의를 기다리는 중 · 그만두기"와
        // 캘린더 목록이 그 화면에 있다(예전 「Google 캘린더 연동」 화면 그대로).
        <ConnectButton busy={row.busy} onClick={onCalendar} height={30} pad={14} font={12} attrs={{ 'data-calendar-detail-row': '' }} />
      ) : (
        <ConnectButton busy={row.busy} onClick={() => tools.connect(row.key)} height={30} pad={14} font={12} />
      )}
    </div>
  );
}
