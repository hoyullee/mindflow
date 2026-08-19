import type { HomeController } from '../useHomeController';
import type { HomeViewModel } from '../viewModel';
import { FolderCard } from './FolderCard';
import { ParentFolderCard } from './ParentFolderCard';
import { MapCard } from './MapCard';
import { META_MONO, primaryPillStyle } from '../chrome';

interface Props {
  view: HomeViewModel;
  controller: HomeController;
}

// Grid columns are driven entirely by the `.mf-map-grid` media queries in
// `home.css` (not inline) so the 768px mobile breakpoint (1 column) and a
// 480-768px 2-column step can override the desktop `minmax(300px,1fr)`
// auto-fill — inline styles would otherwise always win over a stylesheet rule.
// 간격은 이제 `.mf-map-grid`/`.mf-folder-grid`(home.css)가 정한다 — 디자인 원본의
// 밀도 값을 미디어 쿼리와 함께 한곳에서 관리한다.
const GRID_STYLE = {} as const;

/** 구획 머리 — 이름 + 등폭 개수(디자인 원본). */
function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-subtext)' }}>{label}</span>
      <span style={META_MONO}>{count}</span>
    </div>
  );
}

/** A single placeholder card matching `MapCard`'s footprint (preview block +
 * two title lines), shown while the map list loads. */
function SkeletonCard() {
  return (
    <div style={{ border: '1px solid var(--mf-border-soft)', borderRadius: 16, background: 'var(--mf-panel)', overflow: 'hidden' }}>
      <div className="mf-skel" style={{ height: 132, borderRadius: 0 }} />
      <div style={{ padding: '13px 15px 16px' }}>
        <div className="mf-skel" style={{ height: 13, width: '62%', borderRadius: 6, marginBottom: 9 }} />
        <div className="mf-skel" style={{ height: 10, width: '34%', borderRadius: 6 }} />
      </div>
    </div>
  );
}

/** Home.dc.html:209-329 — recent / folders / maps sections plus the three empty states. */
export function MapGrid({ view, controller }: Props) {
  if (view.loading) {
    return (
      <div className="mf-map-grid" style={GRID_STYLE} aria-busy="true" aria-label="맵을 불러오는 중">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }
  return (
    <>
      {/* The "최근 항목" strip is cross-space and now lives at the top of Home
          (see `RecentStrip` in Home.tsx), not inside a space's map list. */}
      {view.foldersSectionVisible && (
        <div style={{ marginBottom: 30 }}>
          <SectionHead label="폴더" count={view.folderCards.length} />
          <div className="mf-folder-grid">
            {/* 첫 칸 = 상위 폴더(`..`) — 뒤로 가는 길이자 "위로 옮기기" 드롭 대상. */}
            {view.parentTile && <ParentFolderCard tile={view.parentTile} controller={controller} />}
            {view.folderCards.map((f) => (
              <FolderCard key={f.id} folder={f} controller={controller} />
            ))}
          </div>
          {/* 구획 사이의 선은 없앴다(디자인 원본) — 카드가 그늘로 떠 있어 여백만으로
              층이 갈리고, 선까지 있으면 화면이 칸으로 잘려 보인다. */}
        </div>
      )}

      {view.mapsSectionVisible && (
        <div>
          <SectionHead label="파일" count={view.allCards.length} />
          <div className="mf-map-grid" style={GRID_STYLE}>
            {/* Key by card identity (docId; title fallback) — duplicate TITLES are
                fully allowed, and a duplicate React key makes reconciliation reuse
                one card's subtree for the other (wrong preview/menu state). */}
            {view.allCards.map((c) => (
              <MapCard key={c.key} card={c} controller={controller} draggableEnabled={!view.isDriveSpace} />
            ))}
          </div>
        </div>
      )}

      {view.folderEmpty && (
        <div style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: 20 }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>이 폴더는 비어 있어요</div>
          <div style={{ fontSize: 13.5, color: 'var(--mf-muted)', lineHeight: 1.6, textAlign: 'center' }}>
            맵 카드의 ☰ 메뉴에서 &apos;폴더로 이동&apos;을 선택해
            <br /> 이 폴더로 맵을 옮길 수 있어요.
          </div>
        </div>
      )}

      {view.isEmpty && (
        <div style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: 20 }}>
          {/* Mindmap glyph (SVG) instead of the 🗺️ emoji — matches the line-icon
              style of the sibling empty states (folder / Drive) so the empty
              screen reads as one design instead of an out-of-place emoji. */}
          <div style={{ width: 88, height: 88, borderRadius: 24, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7.3 11.2C10 9.8 12.4 8.2 15.4 7" />
              <path d="M7.3 12.8C10 14.2 12.4 15.8 15.4 17" />
              <circle cx="5" cy="12" r="2.7" fill="currentColor" stroke="none" />
              <circle cx="17.6" cy="6.4" r="2.4" />
              <circle cx="17.6" cy="17.6" r="2.4" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>아직 만든 맵이 없어요</div>
          <div style={{ fontSize: 13.5, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 24, textAlign: 'center' }}>
            첫 마인드맵을 만들어 생각을 정리해 보세요.
            <br /> 중심 주제에서 아이디어를 자유롭게 펼칠 수 있어요.
          </div>
          <button
            type="button"
            onClick={controller.openTemplates}
            className="btn"
            // 툴바의 1차 버튼과 같은 꼴을 크게 쓴다(그라디언트 알약 + 선 아이콘).
            style={{ ...primaryPillStyle(false), height: 52, padding: '0 30px', borderRadius: 999, fontSize: 16, gap: 9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            새로 만들기
          </button>
        </div>
      )}

      {view.showDriveConnect && (
        <div style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: 20 }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: 'var(--mf-success-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
            <svg width="44" height="44" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Google Drive 연동이 필요해요</div>
          <div style={{ fontSize: 13.5, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 24, textAlign: 'center' }}>
            Google Drive를 연결하면 저장된 마인드맵과 문서를
            <br /> 이곳에서 바로 확인할 수 있어요.
          </div>
          <button
            className="btn"
            onClick={controller.openDriveAuth}
            style={{ height: 50, padding: '0 24px', border: '1px solid var(--mf-border)', borderRadius: 13, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 14px rgba(0,0,0,.06)', whiteSpace: 'nowrap' }}
          >
            <svg width="19" height="19" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Google 계정으로 연결
          </button>
        </div>
      )}
    </>
  );
}
