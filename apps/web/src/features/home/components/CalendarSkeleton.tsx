/**
 * 일정 로딩 스켈레톤 — 첫 화면이 **일정**일 때의 껍데기.
 *
 * 시작 화면을 고를 수 있게 되면서(설정 › 시작 화면) 일정으로 착지하는 진입이 흔해졌다.
 * 그때 스페이스 스켈레톤(최근 항목 띠 + 카드 격자)이 떴다가 통째로 갈아 끼워지는
 * 것은 대시보드에서 이미 제보로 고친 그 문제다 — 그래서 같은 처방을 여기에도 둔다.
 *
 * 모양은 `CalendarView`의 그것과 같다(스펙: 일정 페이지 1): 점 격자 헤더 띠(월 제목 +
 * 요약 줄 / 새 일정·토글) → 좌우 끝까지 가는 월 격자 + 오른쪽 300px 패널. 칸 높이·격자선
 * 토큰도 `MonthGrid`와 같은 값이라 로딩이 끝나며 격자가 자리를 옮기지 않는다.
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
      {/* 헤더 띠 — 실제 헤더와 같은 면·패딩·점 격자(아래 경계선 없음) */}
      <div
        style={{
          flex: '0 0 auto',
          padding: isMobile ? '12px 14px 12px 16px' : '20px 20px 16px 32px',
          backgroundColor: 'var(--mf-cal-head)',
          backgroundImage: 'radial-gradient(var(--mf-cal-head-dot) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
          backgroundPosition: '-9px -9px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
          <Bar w={isMobile ? 150 : 190} h={isMobile ? 26 : 32} />
          <Bar w={isMobile ? 120 : 220} h={12} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Bar w={isMobile ? 84 : 92} h={32} />
          {!isMobile && <Bar w={32} h={32} />}
        </div>
      </div>

      {/* 본문 행 — 격자(카드 없이 끝까지) + 오른쪽 패널 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-cal-frame)', overflow: 'hidden' }}>
          {/* 요일 머리 */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, borderTop: '1px solid var(--mf-cal-grid)', background: 'var(--mf-card)', marginRight: -1 }}>
            {Array.from({ length: COLS }, (_, i) => (
              <span key={i} style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--mf-cal-grid)' }}>
                <Bar w={14} h={9} />
              </span>
            ))}
          </div>
          {/* 날짜 칸 */}
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, minmax(${isMobile ? 48 : 64}px, 1fr))`, borderTop: '1px solid var(--mf-cal-grid)', marginRight: -1 }}>
            {Array.from({ length: ROWS * COLS }, (_, i) => (
              <span key={i} data-skel-day style={{ background: 'var(--mf-card)', borderRight: '1px solid var(--mf-cal-grid)', borderBottom: '1px solid var(--mf-cal-grid)', padding: isMobile ? '3px 3px' : '6px 6px' }}>
                <Bar w={13} h={11} />
              </span>
            ))}
          </div>
        </div>
        {!isMobile && (
          <div style={{ flex: '0 0 300px', boxSizing: 'border-box', borderLeft: '1px solid var(--mf-border-soft)', borderTop: '1px solid var(--mf-cal-grid)', background: 'var(--mf-card)', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Bar w={96} h={13} />
            <Bar w={272} h={150} />
            <Bar w={120} h={13} />
          </div>
        )}
      </div>
    </div>
  );
}
