import { useState } from 'react';
import { Popover } from '../../components/Popover';
import type { HomeController } from '../home/useHomeController';
import type { HomeState } from '../home/types';
import { SECTION_LABEL } from '../home/chrome';
import { TOOL_DEFS, TOOLS_SETTINGS_PATH } from './toolDefs';
import { useTools, type ToolRow, type Tools } from './useTools';
import { ConnectButton, DisconnectButton, LabelEditor, ToolIcon } from './ui';
import { Switch } from '../../components/Switch';

/**
 * LNB의 **도구** 구획(도구 스펙 §3) — 모아보기 아래, 프로필 카드 위.
 *
 * - 표시할 도구 화면이 있으면: 머리줄(`도구` + 관리 버튼) + 화면 행.
 * - 없으면: `도구 연결` 한 줄(마켓플레이스 같은 단일 메뉴). 누르면 같은 팝오버.
 */
export function ToolsNavSection({ state, controller, isMobile }: { state: HomeState; controller: HomeController; isMobile: boolean }) {
  const tools = useTools(state, controller);
  const [open, setOpen] = useState(false);
  const hasScreens = tools.screens.length > 0;

  const trigger = hasScreens ? (
    <button
      type="button"
      className="btn mf-tool-manage"
      data-tools-manage
      data-open={open ? '1' : '0'}
      aria-label="도구 관리"
      title="도구 관리"
      style={{ width: 24, height: 24, flexShrink: 0, border: 0, borderRadius: 7, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', transition: 'background .13s ease' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
        <circle cx="15" cy="8" r="2" />
        <circle cx="9" cy="16" r="2" />
      </svg>
    </button>
  ) : (
    <button
      type="button"
      className="btn nav-item"
      data-tools-connect-row
      data-open={open ? '1' : '0'}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: isMobile ? 44 : 34, padding: '0 6px 0 9px', border: 0, borderRadius: 10, background: open ? 'var(--mf-accent-soft)' : 'transparent', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M9 3h3a2 2 0 0 1 2 2v1a1.5 1.5 0 0 0 3 0V5h2a2 2 0 0 1 2 2v3h-1a1.5 1.5 0 0 0 0 3h1v4a2 2 0 0 1-2 2h-4v-1a1.5 1.5 0 0 0-3 0v1H7a2 2 0 0 1-2-2v-4h1a1.5 1.5 0 0 0 0-3H5V7a2 2 0 0 1 2-2h2z" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-text)' }}>도구 연결</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{tools.rows.map((r) => r.name).join(' · ')}</span>
    </button>
  );

  const popover = (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      side={isMobile ? 'top' : 'right'}
      align="end"
      sideOffset={10}
      collisionPadding={12}
      label="도구 관리"
      panelAttrs={{ 'data-tools-popover': '' }}
      panel={{ width: 320, maxWidth: 'calc(100vw - 24px)', zIndex: 70, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', borderRadius: 16, boxShadow: '0 26px 52px -26px rgba(46,42,38,.5)', animation: 'mf-tool-pop .14s ease', transformOrigin: 'var(--radix-popover-content-transform-origin)', overflow: 'hidden' }}
    >
      <ToolsPanel
        tools={tools}
        onOpenSettings={() => {
          setOpen(false);
          controller.openToolsSettings();
        }}
      />
    </Popover>
  );

  return (
    <div data-lnb-tools style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12, paddingTop: 18, borderTop: '1px solid var(--mf-border-soft)', animation: 'mf-fade .2s ease' }}>
      {hasScreens ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px 8px 9px' }}>
            <span style={SECTION_LABEL}>도구</span>
            <span style={{ marginLeft: 'auto' }}>{popover}</span>
          </div>
          {tools.screens.map((r) => (
            <ToolNavRow key={r.key} row={r} active={state.activeTool === r.key} isMobile={isMobile} onOpen={() => controller.openTool('jira')} />
          ))}
        </>
      ) : (
        popover
      )}
    </div>
  );
}

function ToolNavRow({ row, active, isMobile, onOpen }: { row: ToolRow; active: boolean; isMobile: boolean; onOpen: () => void }) {
  const warn = !!row.syncError;
  return (
    <a
      href="#"
      role="button"
      className="mf-tool-nav"
      data-tool-nav={row.key}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 9, height: isMobile ? 44 : 36, padding: '0 8px 0 9px', borderRadius: 10, textDecoration: 'none', color: 'inherit', transition: 'background .14s ease' }}
    >
      <ToolIcon tool={row.key} size={18} radius={5} font={9.5} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
        <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
          {row.account ? ` · ${row.account}` : ''}
        </span>
      </span>
      <span data-tool-dot={warn ? 'warn' : 'ok'} title={row.syncTitle} aria-label={row.syncTitle} style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: warn ? '#E8845C' : '#69B08A' }} />
    </a>
  );
}

/** 팝오버의 내용 — 머리 · `연결됨`/`연결할 수 있는 도구` · 바닥 링크(§4). */
export function ToolsPanel({ tools, onOpenSettings }: { tools: Tools; onOpenSettings: () => void }) {
  const [a, b, c] = TOOLS_SETTINGS_PATH;
  return (
    <>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--mf-hairline)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>도구 관리</div>
        <div style={{ fontSize: 11.5, color: 'var(--mf-muted)', marginTop: 2 }}>연결하면 왼쪽 도구 목록에 화면이 생겨요</div>
      </div>
      <div className="lnb-scroll" style={{ maxHeight: 'min(60vh, 420px)', overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 1, scrollbarWidth: 'none' }}>
        {[
          ['연결됨', tools.connected],
          ['연결할 수 있는 도구', tools.available],
        ].map(([title, rows]) =>
          (rows as ToolRow[]).length ? (
            <div key={title as string}>
              <div style={{ padding: '8px 8px 4px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-faint)' }}>{title as string}</div>
              {(rows as ToolRow[]).map((r) => (
                <PanelRow key={r.key} row={r} tools={tools} />
              ))}
            </div>
          ) : null,
        )}
      </div>
      <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--mf-hairline)', fontSize: 11, color: 'var(--mf-faint)' }}>
        같은 목록을{' '}
        <button type="button" className="btn" data-tools-settings-link onClick={onOpenSettings} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, color: '#C0563A', cursor: 'pointer' }}>
          {a} → {b} → {c}
        </button>
        에서도 관리할 수 있어요
      </div>
    </>
  );
}

function PanelRow({ row, tools }: { row: ToolRow; tools: Tools }) {
  return (
    <div className="mf-tool-row" data-tool-row={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10 }}>
      <ToolIcon tool={row.key} size={26} radius={7} font={11} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--mf-text)' }}>
          {TOOL_DEFS[row.key].name}
          {row.connected && <span aria-label="연결됨" style={{ width: 6, height: 6, borderRadius: '50%', background: row.syncError ? '#E8845C' : '#69B08A' }} />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mf-muted)', marginTop: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.connected && row.hasScreen ? (
            <LabelEditor label={row.label} onSave={(v) => tools.setLabel(row.key, v)} font={11} inputStyle={{ height: 24, padding: '0 8px', fontSize: 12, width: '100%' }} />
          ) : (
            <>
              {row.sub}
              {row.syncError && <span style={{ color: '#C0563A' }}> · 동기화 실패</span>}
            </>
          )}
        </div>
      </div>
      {row.connected && row.hasScreen && <Switch checked={row.show} onCheckedChange={() => tools.setShow(row.key, !row.show)} label="왼쪽 목록에 표시" accent="#E85E33" track="#DDD3C8" knob="#FFFFFF" />}
      {row.connected ? <DisconnectButton onConfirm={() => tools.disconnect(row.key)} height={26} pad={9} font={11} weight={800} /> : <ConnectButton busy={row.busy} onClick={() => tools.connect(row.key)} height={26} pad={11} font={11} />}
    </div>
  );
}
