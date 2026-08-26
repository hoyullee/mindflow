import type { ReactNode } from 'react';
import { Modal, MODAL_DIM } from '../../../../components/Modal';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import type { HomeViewModel } from '../../viewModel';
import { cardSketch } from '../../viewModel';
import { DASH_CAP, DASH_SIZE_NOTE, sizesFor } from '../../dashboard/model';
import { KIND_META } from '../DashboardView';
import { META_MONO } from '../../chrome';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  isMobile?: boolean;
}

/**
 * "보드 올리기" 피커 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 pickerOpen 화면.
 *
 * 왼쪽 레일이 출처(전체 · 스페이스들 · 공유받은 문서)를 거르고, 오른쪽 격자에서
 * 보드를 골라 크기를 정해 올린다. **올린 뒤에도 피커는 열려 있다** — 대시보드는
 * 보통 여러 개를 이어서 올리며 채우고, 이미 올라간 카드는 "올림" 배지를 달고
 * 누르면 내려간다(피커가 올리기·내리기 양쪽을 맡는다).
 *
 * 썸네일은 홈 카드와 같은 `cardSketch`(실렌더 or 종류별 폴백) — 피커에서 본
 * 그대로가 대시보드 위젯의 문서다.
 */
export function DashboardPicker({ state, view, controller, isMobile = false }: Props) {
  const pk = state.dashPicker;
  const dash = state.activeDash ? state.dashboards.find((d) => d.id === state.activeDash) : null;
  const open = !!pk && !!dash;
  const items = dash?.items ?? [];
  const atCap = items.length >= DASH_CAP;
  const usedDocIds = new Set(items.map((it) => it.docId));

  const q = (pk?.query ?? '').trim().toLowerCase();
  const scope = pk?.space ?? 'all';
  const filtered = view.dashPickCatalog.filter((b) => {
    if (scope === 'shared' && !b.shared) return false;
    if (scope !== 'all' && scope !== 'shared' && (b.shared || b.spaceId !== scope)) return false;
    return !q || `${b.title} ${b.spaceName}`.toLowerCase().includes(q);
  });

  const sel = pk?.sel ?? null;
  const selEntry = sel ? view.dashPickCatalog.find((b) => b.docId === sel.docId) ?? null : null;
  const selSizes = selEntry ? sizesFor(selEntry.kind) : [];

  const rail: { key: string; label: string; icon: ReactNode; count: number; divider?: boolean }[] = [
    { key: 'all', label: '전체', count: view.dashPickCatalog.length, icon: <GridGlyph /> },
    ...state.spaces.map((sp) => ({
      key: sp.id,
      label: sp.name,
      count: view.dashPickCatalog.filter((b) => !b.shared && b.spaceId === sp.id).length,
      icon: <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: sp.color || 'var(--mf-accent)', display: 'inline-block', flexShrink: 0 }} />,
    })),
    { key: 'shared', label: '공유받은 문서', count: view.dashPickCatalog.filter((b) => b.shared).length, icon: <SharedGlyph />, divider: true },
  ];

  return (
    <Modal
      open={open}
      onClose={controller.closeDashPicker}
      label="보드 올리기"
      dim={{ ...MODAL_DIM, zIndex: 130, padding: isMobile ? 12 : 36 }}
      cardAttrs={{ 'data-dash-picker': '' }}
      card={{
        width: 760,
        maxWidth: '100%',
        height: isMobile ? 'min(560px, calc(100dvh - 24px))' : 520,
        maxHeight: '100%',
        display: 'flex',
        borderRadius: 18,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: '0 48px 90px -36px rgba(46,42,38,.55)',
        overflow: 'hidden',
        padding: 0,
        boxSizing: 'border-box',
        animation: 'mf-fade .2s ease',
      }}
    >
      {/* 왼쪽 레일 — 출처 필터. 폰에서는 폭이 없어 접는다(전체 목록 + 검색이 그 몫). */}
      {!isMobile && (
        <div style={{ width: 196, flex: '0 0 auto', display: 'flex', flexDirection: 'column', background: 'var(--mf-bg)', borderRight: '1px solid var(--mf-hairline)' }}>
          <div style={{ padding: '18px 16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-.02em' }}>보드 올리기</span>
            <span style={{ fontSize: 11, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dash?.name}</span>
          </div>
          <div style={{ padding: '2px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rail.map((r) => {
              const on = scope === r.key;
              return (
                <span key={r.key} style={{ display: 'contents' }}>
                  {r.divider && <span aria-hidden style={{ height: 1, background: 'var(--mf-hairline)', margin: '7px 8px', display: 'block' }} />}
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={on}
                    onClick={() => controller.setDashPickSpace(r.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '7px 9px',
                      border: 0,
                      borderRadius: 9,
                      background: on ? 'var(--mf-panel2)' : 'transparent',
                      color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12.5,
                      fontWeight: on ? 700 : 500,
                      textAlign: 'left',
                    }}
                  >
                    {r.icon}
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                    <span style={{ ...META_MONO, fontSize: 9.5, color: 'var(--mf-faint2)' }}>{r.count}</span>
                  </button>
                </span>
              );
            })}
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--mf-hairline)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span data-dash-cap style={{ ...META_MONO, fontSize: 10, color: atCap ? 'var(--mf-danger)' : 'var(--mf-faint2)' }}>
              {items.length}/{DASH_CAP}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>한 대시보드에 {DASH_CAP}개까지</span>
          </div>
        </div>
      )}

      {/* 오른쪽 — 검색 + 카드 격자 + 크기 발치 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px 12px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={pk?.query ?? ''}
            onInput={(e) => controller.setDashPickQuery((e.target as HTMLInputElement).value)}
            placeholder="보드 이름으로 찾기"
            aria-label="보드 이름으로 찾기"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--mf-text)' }}
          />
          <button type="button" className="btn" aria-label="닫기" onClick={controller.closeDashPicker} style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 9, border: 0, background: 'transparent', color: 'var(--mf-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="notif-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gridAutoRows: 132, gap: 10, alignContent: 'start' }}>
          {filtered.map((b) => {
            const on = usedDocIds.has(b.docId);
            const selected = sel?.docId === b.docId;
            const blocked = !on && !selected && atCap;
            const meta = KIND_META[b.kind];
            return (
              <button
                key={b.docId}
                type="button"
                className="btn"
                data-dash-pick-card={b.docId}
                aria-pressed={selected}
                onClick={() => !blocked && controller.pickDashBoard(b.docId, b.kind)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 0,
                  borderRadius: 13,
                  border: `1.5px solid ${selected ? 'var(--mf-accent)' : on ? 'var(--mf-success)' : 'var(--mf-border)'}`,
                  background: 'var(--mf-card)',
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  overflow: 'hidden',
                  opacity: blocked ? 0.45 : 1,
                  boxShadow: selected ? '0 12px 26px -16px rgba(var(--mf-accent-rgb),.55)' : '0 10px 22px -20px rgba(46,42,38,.4)',
                }}
              >
                <span style={{ position: 'relative', display: 'block', width: '100%', flex: '0 0 82px', background: 'var(--mf-wash, var(--mf-bg))', borderBottom: '1px solid var(--mf-hairline)', overflow: 'hidden' }}>
                  <span aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cardSketch(b.title, b.hue, b.docId, state.previewDocs, state.previewResolved)}</span>
                  {on && (
                    <span data-dash-pick-on style={{ position: 'absolute', right: 6, top: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 8px', borderRadius: 999, background: 'var(--mf-success)', color: '#fff', fontSize: 9, fontWeight: 800 }}>
                      <CheckGlyph size={9} />
                      올림
                    </span>
                  )}
                  {selected && (
                    <span style={{ position: 'absolute', right: 6, top: 6, width: 19, height: 19, borderRadius: 999, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CheckGlyph size={10} />
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 11px 10px', minWidth: 0, width: '100%', boxSizing: 'border-box', flex: 1, minHeight: 0 }}>
                  <span style={{ color: meta.color, display: 'inline-flex', flexShrink: 0 }}>{meta.icon}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--mf-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</span>
                    <span style={{ fontSize: 10, color: 'var(--mf-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.spaceName} · {meta.name} · 보기 전용
                    </span>
                  </span>
                  {b.shared && <SharedGlyph />}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && <span style={{ gridColumn: '1/-1', padding: '38px 0', textAlign: 'center', fontSize: 12, color: 'var(--mf-faint)' }}>찾는 보드가 없어요</span>}
        </div>

        {/* 발치는 **명시적 2행**이다(제보: 크기 선택지가 늘며 한 줄이 팝업을 넘어
            "올리기" 버튼이 잘렸다). 한 줄에 몰면 칩 묶음이 줄지 않아(`flexShrink: 0`)
            버튼을 밀어낸다 — 위는 크기 칩(넘치면 접힌다), 아래는 요약 + 올리기.
            어떤 폭에서도 버튼이 제자리에 있고 줄바꿈 지점이 예측된다(에디터 서식
            툴바에서 같은 이유로 이미 한 번 겪었다). */}
        <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--mf-hairline)', background: 'var(--mf-bg)', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 34 }}>
          {selEntry && sel ? (
            <>
              {/* 크기 칩 — 넘치면 접힌다(선택지가 더 늘어도 팝업을 넘지 않는다). */}
              <span data-pick-sizes style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', width: '100%' }}>
                {selSizes.map((s) => {
                  const chosen = s === sel.size;
                  return (
                    <button
                      key={s}
                      type="button"
                      className="btn"
                      aria-pressed={chosen}
                      onClick={() => controller.setDashPickSize(s)}
                      style={{
                        height: 26,
                        minWidth: 40,
                        padding: '0 9px',
                        borderRadius: 8,
                        border: `1px solid ${chosen ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
                        background: chosen ? 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))' : 'var(--mf-card)',
                        color: chosen ? 'var(--mf-accent-ink)' : 'var(--mf-subtext)',
                        ...META_MONO,
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {s.replace('x', '×')}
                    </button>
                  );
                })}
              </span>
              {/* 아래 행 — 무엇을 고른 상태인지 + 올리기. 버튼은 언제나 오른쪽 끝. */}
              <span data-pick-confirm-row style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selEntry.title}</span>
                  <span style={{ fontSize: 10, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {KIND_META[selEntry.kind].name} · {DASH_SIZE_NOTE[sel.size] ?? ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={controller.confirmDashPick}
                  style={{ height: 30, padding: '0 14px', flexShrink: 0, borderRadius: 999, border: '1px solid var(--mf-accent)', background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 9px 20px -12px rgba(var(--mf-accent-rgb),.9)' }}
                >
                  올리기
                </button>
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--mf-faint)' }}>보드를 고르면 여기서 크기를 정해요 · 올린 뒤에도 우클릭으로 크기를 바꿀 수 있어요</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GridGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" />
    </svg>
  );
}

function SharedGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-info)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
    </svg>
  );
}

function CheckGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}
