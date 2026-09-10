/**
 * 일정 로딩 스켈레톤 — 첫 화면이 **일정**일 때의 껍데기.
 *
 * 시작 화면을 고를 수 있게 되면서(설정 › 시작 화면) 일정으로 착지하는 진입이 흔해졌다.
 * 그때 스페이스 스켈레톤(최근 항목 띠 + 카드 격자)이 떴다가 통째로 갈아 끼워지는
 * 것은 대시보드에서 이미 제보로 고친 그 문제다 — 그래서 같은 처방을 여기에도 둔다.
 *
 * 모양은 `CalendarView`의 그것과 같다: 타이틀 띠(같은 면·패딩·점 격자) + 점 격자
 * 바닥 위의 월 격자. 칸 높이·격자선 토큰도 `MonthGrid`와 같은 값이라 로딩이 끝나며
 * 격자가 자리를 옮기지 않는다.
 */

/** 6주 격자 — 실제 화면도 언제나 6주다(달마다 높이가 바뀌지 않게). */
const ROWS = 6;
const COLS = 7;

/** 띠 안의 자리표시자 — 공용 반짝임(`mf-skel`). */
function Bar({ w, h = 12 }: { w: number; h?: number }) {
  return <span aria-hidden className="mf-skel" style={{ width: w, maxWidth: '100%', height: h, borderRadius: 6, display: 'block' }} />;
}

export function CalendarSkeleton({ isMobile = false }: { isMobile?: boolean }) {
  return (
    <div data-calendar-skeleton aria-busy="true" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 타이틀 띠 — 실제 헤더와 같은 면·패딩·점 격자 */}
      <div style={{ flex: '0 0 auto', position: 'relative', background: 'var(--mf-panel2)', borderBottom: '1px solid var(--mf-border)', padding: isMobile ? '14px 16px' : '18px 28px', display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 auto', minWidth: 0 }}>
          <Bar w={isMobile ? 96 : 116} h={isMobile ? 24 : 28} />
          <Bar w={132} h={32} />
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 8, flexShrink: 0 }}>
          <Bar w={isMobile ? 88 : 104} h={34} />
          {!isMobile && <Bar w={34} h={34} />}
        </div>
      </div>

      {/* 본문 — 점 격자 바닥 위의 월 격자(실제 화면과 같은 패딩·격자선·칸 높이) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: isMobile ? '12px 14px 18px' : '16px 24px 24px',
          background: 'var(--mf-page)',
          backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)',
          backgroundSize: '17px 17px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 14, border: '1px solid var(--mf-cal-grid)', background: 'var(--mf-card)', overflow: 'hidden' }}>
          {/* 요일 머리 */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, borderBottom: '1px solid var(--mf-cal-grid)' }}>
            {Array.from({ length: COLS }, (_, i) => (
              <span key={i} style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bar w={14} h={9} />
              </span>
            ))}
          </div>
          {/* 날짜 칸 */}
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, minmax(${isMobile ? 48 : 86}px, 1fr))` }}>
            {Array.from({ length: ROWS * COLS }, (_, i) => (
              <span key={i} data-skel-day style={{ borderRight: '1px solid var(--mf-cal-grid)', borderBottom: '1px solid var(--mf-cal-grid)', padding: isMobile ? '4px 5px' : '6px 7px' }}>
                <Bar w={13} h={11} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
