import type { MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel, DocKindName } from '../viewModel';
import { docKindOf } from '../viewModel';
import { DASH_CAP, DASH_COLS, DASH_ROW_PX, parseSize } from '../dashboard/model';
import { widgetDataOf, type WidgetData } from '../dashboard/widgetData';
import { mapHref, readDocRaw } from '../storage';
import { formatLastEdited } from '../timeFormat';
import { META_MONO } from '../chrome';

/**
 * 대시보드 보기 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 isDash 화면.
 *
 * 위젯은 전부 **보기 전용**이다(1단계): 내용은 썸네일 프리페치와 같은 본문
 * (`previewDocs`)에서 실제 문서를 읽어 디자인의 위젯 틀에 붓고, 편집은 hover의
 * "열기"가 에디터로 보낸다. 배치 편집(드래그·리사이즈)은 다음 단계 — 지금은
 * 우클릭 메뉴의 크기·내리기·맨 앞으로가 그 몫을 맡는다.
 */

// 디자인 원본의 위젯 톤(가지·메모 색). 문서의 실제 색이 있으면 그쪽이 이긴다.
const TONES: [string, string, string][] = [
  ['#FBEFB6', '#EEDD8F', '#7A6A35'],
  ['#DDEEDA', '#C2DCBE', '#43714F'],
  ['#E7EEFA', '#CFDDF2', '#3E6193'],
  ['#FBDCD5', '#F0BEB1', '#8A5442'],
];
const KIND_META: Record<DocKindName, { name: string; color: string; icon: JSX.Element }> = {
  map: {
    name: '마인드맵',
    color: 'var(--mf-doc-map)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="5" cy="12" r="2.4" />
        <path d="M7.4 12h5M12.4 12c2.6 0 3.6-5 6.1-5M12.4 12c2.6 0 3.6 5 6.1 5" />
        <circle cx="20" cy="7" r="1.7" />
        <circle cx="20" cy="17" r="1.7" />
      </svg>
    ),
  },
  board: {
    name: '화이트보드',
    color: 'var(--mf-doc-board)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="14" rx="2.5" />
        <path d="m8 14 3-4 2.4 3 2-2.4L18 14" />
      </svg>
    ),
  },
  kanban: {
    name: '칸반보드',
    color: 'var(--mf-doc-kanban)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
        <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
        <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
      </svg>
    ),
  },
};

// 칸반 열 점·진행 바 색 — 에디터 칸반의 기본 팔레트 순서와 같은 인상(디자인 KCOLS).
const KCOL_DOTS = ['#C3B8AC', '#EE6B45', '#E8A93C', '#69B08A'];

function greetingNow(): { greeting: string; dateLine: string } {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  const dateLine = `${now.getMonth() + 1}월 ${now.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][now.getDay()]}요일`;
  return { greeting, dateLine };
}

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  isMobile?: boolean;
}

export function DashboardView({ state, view, controller, isMobile = false }: Props) {
  const dash = state.dashboards.find((d) => d.id === state.activeDash);
  if (!dash) return null;
  const { greeting, dateLine } = greetingNow();
  const others = state.dashboards.filter((d) => d.id !== dash.id);
  const cols = isMobile ? 2 : DASH_COLS;

  return (
    <div data-dashboard-view style={{ display: 'flex', flexDirection: 'column', animation: 'mf-fade .3s ease both', margin: isMobile ? '-16px -14px -32px' : '-24px -32px -44px' }}>
      {/* 다크 히어로 — 대시보드 화면임을 한눈에 가르는 띠(디자인 원본 #332E29 고정:
          어두운 면이라 다크 테마에서도 그대로 성립한다). */}
      <div style={{ position: 'relative', background: '#332E29', padding: isMobile ? '20px 16px 18px' : '26px 32px 24px', display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(247,239,232,.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#B7A995', whiteSpace: 'nowrap' }}>
              {greeting}, {state.userName} 님
            </span>
            <span style={{ ...META_MONO, color: '#8C7E6B', whiteSpace: 'nowrap' }}>{dateLine}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', color: '#F7EFE8', whiteSpace: 'nowrap' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3.5, background: 'var(--mf-accent)', display: 'block', flexShrink: 0 }} />
              {dash.name}
            </h2>
            <span style={{ ...META_MONO, color: dash.items.length >= DASH_CAP ? '#E8A08A' : '#8C7E6B', whiteSpace: 'nowrap', paddingTop: 6 }}>
              {dash.items.length}/{DASH_CAP}
            </span>
            {others.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 3 }}>
                {others.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="btn"
                    onClick={() => controller.selectDash(d.id)}
                    style={{ height: 24, padding: '0 11px', borderRadius: 999, border: '1px solid rgba(247,239,232,.16)', background: 'transparent', color: '#8C7E6B', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {d.name}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
          {/* 배치 편집 모드(드래그·리사이즈)는 다음 단계 — 죽은 버튼을 두지 않는다.
              크기·내리기·맨 앞으로는 위젯 우클릭 메뉴가 맡는다. */}
          <button
            type="button"
            className="btn"
            onClick={controller.openDashPicker}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 32,
              padding: '0 15px',
              borderRadius: 999,
              border: '1px solid var(--mf-accent)',
              background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))',
              color: 'var(--mf-accent-ink)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 9px 20px -12px rgba(var(--mf-accent-rgb), .9)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            보드 추가
          </button>
        </div>
      </div>

      {/* 격자 바닥 — 캔버스 같은 점 격자(디자인). */}
      <div style={{ padding: isMobile ? '14px 14px 32px' : '18px 32px 44px', display: 'flex', flexDirection: 'column', gap: 14, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '17px 17px', minHeight: 420, flex: 1 }}>
        {dash.items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '70px 24px', borderRadius: 20, border: '1.5px dashed var(--mf-border)', background: 'var(--mf-card)' }}>
            <span style={{ width: 46, height: 46, borderRadius: 15, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.6" />
                <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.6" />
                <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.6" />
                <rect x="13" y="11" width="7.5" height="9.5" rx="1.6" />
              </svg>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em' }}>아직 올려둔 보드가 없어요</span>
            <span style={{ fontSize: 12, color: 'var(--mf-muted)', textAlign: 'center', maxWidth: 300 }}>스페이스나 공유받은 문서에서 보드를 골라 올리면, 여기서 한눈에 볼 수 있어요.</span>
            <button
              type="button"
              className="btn"
              onClick={controller.openDashPicker}
              style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-accent)', background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              보드 추가
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gridAutoFlow: 'row dense', gap: 14 }}>
            {dash.items.map((it) => (
              <DashWidget key={it.id} itemId={it.id} docId={it.docId} size={it.size} maxCols={cols} state={state} view={view} controller={controller} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 위젯 ─────────────────────────────────────────────────────────────────

function DashWidget({ itemId, docId, size, maxCols, state, view, controller }: { itemId: string; docId: string; size: string; maxCols: number; state: HomeState; view: HomeViewModel; controller: HomeController }) {
  const raw = state.previewDocs[docId] || readDocRaw(docId) || null;
  const resolved = !!raw || !!state.previewResolved[docId];
  const kind = docKindOf('', docId, state.previewDocs);
  const meta = KIND_META[kind];
  const [c0, rows] = parseSize(size);
  const c = Math.min(c0, maxCols); // 모바일(2열)에서는 넓은 위젯을 접는다
  const title = view.dashDocTitles[docId];
  const space = view.dashDocSpaces[docId];
  const when = formatLastEdited(state.docTimes[docId]);
  const missing = resolved && !raw && !title;
  const data: WidgetData | null = raw ? widgetDataOf(raw, { maxCards: rows >= 3 ? 4 : 2, maxBranches: rows >= 3 ? 6 : 4, maxNotes: rows >= 3 ? 9 : 6 }) : null;
  const shared = space === '공유받음';

  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (!title) return;
    controller.openWithLoader(mapHref(title, docId), title, docId);
  };
  const onCtx = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'widget', id: itemId });
  };

  return (
    <div
      data-dash-widget={itemId}
      onContextMenu={onCtx}
      onClick={open}
      className="mf-dash-widget"
      style={{
        gridColumn: `span ${c}`,
        gridRow: `span ${rows}`,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        position: 'relative',
        borderRadius: 16,
        border: '1px solid var(--mf-border)',
        background: 'var(--mf-card)',
        overflow: 'hidden',
        boxShadow: '0 2px 5px -3px rgba(46,42,38,.14), 0 20px 36px -30px rgba(46,42,38,.5)',
        cursor: title ? 'pointer' : 'default',
      }}
    >
      {/* hover 열기 알약(디자인) — 클릭 전체가 열기이지만, 무엇이 일어날지 미리 말해 준다. */}
      {title && (
        <button
          type="button"
          className="btn mf-dash-open"
          title="에디터에서 열기"
          onClick={open}
          style={{
            position: 'absolute',
            right: 9,
            bottom: 9,
            zIndex: 5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 11px',
            borderRadius: 999,
            border: '1px solid var(--mf-border)',
            background: 'rgba(255,253,251,.94)',
            color: 'var(--mf-subtext)',
            font: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 10px 20px -14px rgba(46,42,38,.7)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
          열기
        </button>
      )}

      {/* 머리 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px 9px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
        <span style={{ color: meta.color, display: 'inline-flex', flexShrink: 0 }}>{meta.icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 44, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.015em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title ?? (missing ? '문서를 찾을 수 없어요' : '불러오는 중…')}</span>
            {shared && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[space, when].filter(Boolean).join(' · ')}</span>
        </span>
        {/* 1단계는 전부 보기 전용 — 대시보드에서 고치는 것은 다음 단계(칸반 열 이동)에서 열린다. */}
        {c >= 2 && (
          <span title="대시보드에서는 볼 수만 있어요. 편집은 열어서 하세요" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-bg)', color: 'var(--mf-muted)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
            보기 전용
          </span>
        )}
      </div>

      {/* 몸통 */}
      {missing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontSize: 11.5, color: 'var(--mf-faint)', textAlign: 'center' }}>휴지통에 있거나 삭제된 문서예요. 우클릭으로 내릴 수 있어요.</div>
      ) : !data ? (
        <div aria-busy={!resolved} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!resolved ? <span className="mf-skel" style={{ width: '60%', height: 10, borderRadius: 6 }} /> : <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</div>
      ) : data.kind === 'kanban' ? (
        <KanbanBody data={data} cols={c} />
      ) : data.kind === 'mind' ? (
        <MindBody data={data} />
      ) : (
        <BoardBody data={data} />
      )}

      {/* 발치 — 지표 한 줄(디자인). 1행 크기에서는 접는다. */}
      {rows >= 2 && data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px 9px', borderTop: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
          <span style={{ flex: 1 }} />
          <span style={{ ...META_MONO, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' }}>
            {data.kind === 'kanban' && data.done ? `${data.done.done}/${data.done.total} done` : data.kind === 'mind' ? `노드 ${data.nodeCount}개` : data.kind === 'board' ? `메모 ${data.noteTotal}개` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function KanbanBody({ data, cols }: { data: Extract<WidgetData, { kind: 'kanban' }>; cols: number }) {
  const shown = data.columns.slice(0, 4);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-bg)' }}>
      <div style={{ display: 'flex', height: 3, flexShrink: 0, overflow: 'hidden' }} aria-hidden>
        {data.bar.map((s, i) => (
          <span key={i} style={{ width: `${s.pct}%`, background: KCOL_DOTS[s.colIndex % KCOL_DOTS.length], display: 'block' }} />
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 7, padding: '9px 10px' }}>
        {shown.map((col, ci) => (
          <div key={col.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, minHeight: 0, borderRadius: 10, background: 'var(--mf-card)', border: '1px solid var(--mf-hairline)', padding: '6px 5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 3px', flexShrink: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: KCOL_DOTS[ci % KCOL_DOTS.length], display: 'block', flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--mf-subtext)', letterSpacing: '-.01em', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
              <span style={{ ...META_MONO, fontSize: 8.5, color: 'var(--mf-muted)', background: 'var(--mf-bg)', borderRadius: 999, padding: '1px 5px', flexShrink: 0 }}>{col.count}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0, overflow: 'hidden' }}>
              {col.cards.map((k) => (
                <div key={k.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 7px', borderRadius: 9, background: 'var(--mf-panel)', border: '1px solid var(--mf-border-soft)', boxShadow: '0 5px 12px -9px rgba(46,42,38,.55)' }}>
                  {k.tag && (
                    <span style={{ alignSelf: 'flex-start', maxWidth: '100%', height: 14, padding: '0 5px', borderRadius: 5, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{k.tag}</span>
                  )}
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--mf-text)', letterSpacing: '-.015em', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{k.title || '(빈 카드)'}</span>
                  {(k.due || k.who) && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {k.due && cols >= 4 && <span style={{ fontSize: 8, color: 'var(--mf-muted)', whiteSpace: 'nowrap', minWidth: 0 }}>{k.due.slice(5).replace('-', '/')}</span>}
                      <span style={{ flex: 1 }} />
                      {k.who && <span style={{ width: 15, height: 15, flexShrink: 0, borderRadius: 99, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', fontSize: 7.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{k.who}</span>}
                    </span>
                  )}
                </div>
              ))}
              {col.more > 0 && <span style={{ fontSize: 8.5, color: 'var(--mf-faint2)', padding: '0 3px' }}>+{col.more}개 더</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MindBody({ data }: { data: Extract<WidgetData, { kind: 'mind' }> }) {
  const n = data.branches.length;
  // 가지 세로 위치(%): n개를 위아래로 고르게. 디자인의 미니 트리 배치.
  const tops = Array.from({ length: n }, (_, i) => (n === 1 ? 50 : 14 + (i * 72) / (n - 1)));
  const rootL = 4;
  const rootW = 30;
  const brL = 56;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--mf-bg)', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
      <svg viewBox="0 0 200 120" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden>
        {tops.map((t, i) => {
          const x1 = (rootL + rootW) * 2;
          const x2 = brL * 2;
          const y = t * 1.2;
          const mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1} 60 C ${mx} 60, ${mx} ${y}, ${x2} ${y}`} fill="none" stroke="var(--mf-border)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <span
        style={{
          position: 'absolute',
          left: `${rootL}%`,
          top: '50%',
          width: `${rootW}%`,
          transform: 'translateY(-50%)',
          boxSizing: 'border-box',
          padding: '4px 7px',
          borderRadius: 999,
          background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))',
          color: 'var(--mf-accent-ink)',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '-.02em',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          boxShadow: '0 6px 14px -8px rgba(var(--mf-accent-rgb), .9)',
        }}
      >
        {data.root}
      </span>
      {data.branches.map((b, i) => {
        const tone = TONES[i % TONES.length]!;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${brL}%`,
              top: `${tops[i]}%`,
              width: '38%',
              transform: 'translateY(-50%)',
              boxSizing: 'border-box',
              padding: '4px 7px',
              borderRadius: 8,
              background: tone[0],
              border: `1px solid ${tone[1]}`,
              color: tone[2],
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '-.02em',
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {b || '…'}
          </span>
        );
      })}
    </div>
  );
}

function BoardBody({ data }: { data: Extract<WidgetData, { kind: 'board' }> }) {
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--mf-bg)', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
      {data.notes.map((note, i) => {
        const tone = TONES[i % TONES.length]!;
        // 문서 좌표를 위젯 안(여백 4~92%)으로 편다 — 실제 배치의 인상이 남는다.
        const l = 4 + note.l * 60;
        const t = 6 + note.t * 62;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${l}%`,
              top: `${t}%`,
              width: `${Math.round(note.w * 68)}%`,
              boxSizing: 'border-box',
              padding: '4px 6px',
              borderRadius: 5,
              background: note.bg || tone[0],
              border: `1px solid ${note.bg ? 'rgba(46,42,38,.12)' : tone[1]}`,
              color: note.bg ? 'var(--mf-text)' : tone[2],
              fontSize: 8.5,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: '-.02em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              boxShadow: '0 4px 9px -7px rgba(46,42,38,.55)',
            }}
          >
            {note.text || '메모'}
          </span>
        );
      })}
    </div>
  );
}

export { KIND_META };
