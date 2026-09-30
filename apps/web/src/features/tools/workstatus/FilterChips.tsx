import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { MONO, popPanel, useDismiss } from './wsUi';

export interface ChipItem {
  key: string;
  name: string;
  c: string;
  /** 담당자는 원형 점, 에픽·티켓은 네모 점. */
  round: boolean;
}

const GAP = 6;
/** `+N` 알약과 `모두 지우기`가 차지할 자리(실측 근사). */
const MORE_W = 40;
const CLEAR_W = 58;

/**
 * 검색창 아래의 필터 칩 줄(스펙 §4.2).
 *
 * **검색창 폭을 넘을 때만 접는다**(요청 2026-09-30 — 스펙의 "3개까지"를 바꿨다). 칩마다 이름
 * 길이가 달라 개수로 자르면 넓은 화면에서도 둘만 보이거나, 좁은 화면에서 셋이 줄을 넘는다.
 * 그래서 보이지 않는 층에 모든 칩을 한 번 그려 **실제 폭**을 재고, 들어가는 만큼만 보여 준 뒤
 * 나머지는 `+N`(누르면 `적용 중인 필터` 목록)으로 접는다.
 */
export function FilterChips({ chips, onRemove, onClear }: { chips: ChipItem[]; onRemove: (key: string) => void; onClear: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(chips.length);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(popRef, open, close);

  const sig = chips.map((c) => c.key + c.name).join('|');
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const layer = measureRef.current;
    if (!wrap || !layer) return;
    const measure = () => {
      const W = wrap.clientWidth;
      const widths = [...layer.children].map((el) => (el as HTMLElement).offsetWidth);
      const total = widths.reduce((a, w, i) => a + w + (i ? GAP : 0), 0);
      // 다 들어가면(모두 지우기까지) 접지 않는다. 폭을 모르는 환경(jsdom)도 다 보여 준다.
      if (!W || total + GAP + CLEAR_W <= W) {
        setFit(widths.length);
        return;
      }
      let used = 0;
      let n = 0;
      for (const w of widths) {
        const next = used + (n ? GAP : 0) + w;
        if (next + GAP + MORE_W + GAP + CLEAR_W > W) break;
        used = next;
        n++;
      }
      setFit(Math.max(1, n));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [sig]);

  if (!chips.length) return null;
  const shown = chips.slice(0, fit);
  const more = chips.length - shown.length;
  return (
    <div ref={wrapRef} data-filter-chips style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: GAP, height: 26, marginTop: 6, minWidth: 0 }}>
      <div ref={measureRef} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: GAP, whiteSpace: 'nowrap', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden' }}>
        {chips.map((c) => (
          <Chip key={c.key} chip={c} />
        ))}
      </div>
      {shown.map((c) => (
        <Chip key={c.key} chip={c} onRemove={() => onRemove(c.key)} />
      ))}
      {more > 0 && (
        <div ref={popRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            className="btn"
            data-filter-more
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ height: 22, padding: '0 8px', borderRadius: 999, border: '1px solid #E7C7B4', background: '#FBEDE6', color: '#C0563A', fontFamily: MONO, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
          >
            +{more}
          </button>
          {open && (
            <div data-filter-pop style={popPanel({ top: 28, left: 0, width: 300, maxWidth: 'calc(100vw - 24px)', padding: 6 })}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px 4px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--mf-ws-faint)' }}>적용 중인 필터</span>
                <button type="button" className="btn" onClick={() => { onClear(); setOpen(false); }} style={{ marginLeft: 'auto', border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: 'var(--mf-ws-faint)', cursor: 'pointer' }}>
                  모두 지우기
                </button>
              </div>
              {chips.map((c) => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 8px', borderRadius: 9 }}>
                  <Dot chip={c} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mf-ws-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <X label={`${c.name} 필터 빼기`} onClick={() => onRemove(c.key)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="btn" data-filter-clear onClick={onClear} style={{ flexShrink: 0, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: 'var(--mf-ws-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        모두 지우기
      </button>
    </div>
  );
}

function Dot({ chip }: { chip: ChipItem }) {
  return <span style={{ width: 7, height: 7, borderRadius: chip.round ? '50%' : 2, background: chip.c, flexShrink: 0 }} />;
}

function X({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn" aria-label={label} onClick={onClick} style={{ marginLeft: 'auto', width: 20, height: 20, flexShrink: 0, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--mf-ws-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

function Chip({ chip, onRemove }: { chip: ChipItem; onRemove?: () => void }) {
  return (
    <span data-filter-chip={onRemove ? chip.key : undefined} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, maxWidth: 150, padding: '0 2px 0 8px', borderRadius: 999, border: '1px solid var(--mf-ws-chip-line)', background: 'var(--mf-ws-card)', boxSizing: 'border-box' }}>
      <Dot chip={chip} />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-ws-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{chip.name}</span>
      {onRemove ? <X label={`${chip.name} 필터 빼기`} onClick={onRemove} /> : <span style={{ width: 20, flexShrink: 0 }} />}
    </span>
  );
}
