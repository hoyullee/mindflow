/**
 * 대시보드 로딩 스켈레톤 — 첫 화면이 대시보드일 때의 껍데기(제보: 대시보드로 착지하는데
 * **스페이스 스켈레톤**(최근 항목 띠 + 카드 격자)이 떴다가 갈아 끼워졌다).
 *
 * 모양은 `DashboardView`의 그것과 같다: 다크 히어로 띠 + 점 격자 바닥 위의 위젯 격자.
 * 히어로는 실제로도 고정 다크(#332E29)라 스켈레톤에서도 **진짜 색**을 쓴다 — 로딩이
 * 끝나며 띠가 색을 바꾸지 않으니 화면이 튀지 않는다.
 */
import { DASH_COLS, DASH_ROW_PX } from '../dashboard/model';

/** 히어로 안의 밝은 자리표시자 — 어두운 면 위라 흰색 알파로 그린다(공용 `mf-skel`은
 *  밝은 면 전용이다). */
function HeroBar({ w, h = 12 }: { w: number; h?: number }) {
  // maxWidth — 좁은 폰에서 고정 폭 바가 넘쳐 오른쪽 버튼 자리와 겹치는 것을 막는다
  return <span aria-hidden style={{ width: w, maxWidth: '100%', height: h, borderRadius: 6, background: 'rgba(247,239,232,.14)', display: 'block' }} />;
}

export function DashboardSkeleton({ isMobile = false }: { isMobile?: boolean }) {
  const cols = isMobile ? 2 : DASH_COLS;
  // 첫 화면에 흔한 배치(넓은 위젯 + 작은 것 둘)만큼만 자리를 잡는다 — 실제 개수를
  // 모르므로 너무 많이 그리면 로딩이 끝날 때 크게 줄어든다.
  const cells = isMobile ? [2, 2] : [2, 1, 1];
  return (
    <div data-dashboard-skeleton aria-busy="true" style={{ display: 'flex', flexDirection: 'column', animation: 'mf-fade .3s ease both', margin: isMobile ? '-16px -14px -32px' : '-24px -32px -44px' }}>
      {/* 다크 히어로 — 실제 화면과 같은 면·패딩·점 격자 */}
      <div style={{ position: 'relative', background: '#332E29', padding: isMobile ? '20px 16px 18px' : '26px 32px 24px', display: 'flex', alignItems: 'flex-end', gap: 14, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(247,239,232,.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minWidth: 0 }}>
          <HeroBar w={isMobile ? 118 : 168} h={11} />
          <HeroBar w={isMobile ? 148 : 214} h={22} />
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
          {isMobile ? <HeroBar w={34} h={32} /> : <HeroBar w={78} h={32} />}
          <HeroBar w={isMobile ? 88 : 104} h={32} />
        </div>
      </div>

      {/* 위젯 격자 — 실제 화면과 같은 행 높이·간격·점 격자 바닥 */}
      <div style={{ padding: isMobile ? '14px 14px 32px' : '18px 32px 44px', backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '17px 17px', minHeight: 420, flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gap: 14 }}>
          {cells.map((c, i) => (
            <div key={i} data-skel-cell style={{ gridColumn: `span ${Math.min(c, cols)}`, gridRow: 'span 2', display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', overflow: 'hidden', boxShadow: '0 2px 5px -3px rgba(46,42,38,.14), 0 20px 36px -30px rgba(46,42,38,.5)' }}>
              {/* 머리(아이콘·제목·부제) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px 9px', borderBottom: '1px solid var(--mf-hairline)' }}>
                <span className="mf-skel" style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
                  <span className="mf-skel" style={{ width: '46%', height: 11, borderRadius: 6 }} />
                  <span className="mf-skel" style={{ width: '28%', height: 9, borderRadius: 6 }} />
                </span>
              </div>
              {/* 몸통 */}
              <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
                <span className="mf-skel" style={{ display: 'block', width: '100%', height: '100%', borderRadius: 10 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
