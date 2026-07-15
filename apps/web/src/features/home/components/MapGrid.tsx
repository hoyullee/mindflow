import type { HomeController } from '../useHomeController';
import type { HomeViewModel } from '../viewModel';
import { FolderCard } from './FolderCard';
import { MapCard } from './MapCard';

interface Props {
  view: HomeViewModel;
  controller: HomeController;
}

const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 20 } as const;

/** Home.dc.html:209-329 — recent / folders / maps sections plus the three empty states. */
export function MapGrid({ view, controller }: Props) {
  return (
    <>
      {view.recentSectionVisible && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 14 }}>최근 항목</div>
          <div style={{ ...GRID_STYLE, marginBottom: 26 }}>
            {view.recentCards.map((c) => (
              <MapCard key={c.title} card={c} controller={controller} draggableEnabled={false} />
            ))}
          </div>
          <div style={{ height: 1, background: '#ecdfd5', margin: '0 0 26px' }} />
        </div>
      )}

      {view.foldersSectionVisible && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 14 }}>폴더</div>
          <div style={{ ...GRID_STYLE, marginBottom: 26 }}>
            {view.folderCards.map((f) => (
              <FolderCard key={f.id} folder={f} controller={controller} />
            ))}
          </div>
          <div style={{ height: 1, background: '#ecdfd5', margin: '0 0 26px' }} />
        </div>
      )}

      {view.mapsSectionVisible && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 14 }}>맵</div>
          <div style={GRID_STYLE}>
            {view.allCards.map((c) => (
              <MapCard key={c.title} card={c} controller={controller} draggableEnabled={!view.isDriveSpace} />
            ))}
          </div>
        </div>
      )}

      {view.folderEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 190px)', padding: 20 }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: '#fdeee7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f0663f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>이 폴더는 비어 있어요</div>
          <div style={{ fontSize: 13.5, color: '#9c8b7e', lineHeight: 1.6, textAlign: 'center' }}>
            맵 카드의 ☰ 메뉴에서 &apos;폴더로 이동&apos;을 선택해
            <br /> 이 폴더로 맵을 옮길 수 있어요.
          </div>
        </div>
      )}

      {view.isEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 190px)', padding: 20 }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: '#fdeee7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, marginBottom: 20 }}>🗺️</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>아직 만든 맵이 없어요</div>
          <div style={{ fontSize: 13.5, color: '#9c8b7e', lineHeight: 1.6, marginBottom: 24, textAlign: 'center' }}>
            첫 마인드맵을 만들어 생각을 정리해 보세요.
            <br /> 중심 주제에서 아이디어를 자유롭게 펼칠 수 있어요.
          </div>
          <a
            href={controller.newMapHref()}
            onClick={(e) => {
              e.preventDefault();
              controller.onNewMapClick(e.currentTarget.getAttribute('href') || controller.newMapHref());
            }}
            className="btn"
            style={{ height: 52, padding: '0 30px', borderRadius: 14, background: '#f0663f', color: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 22px rgba(240,102,63,.32)' }}
          >
            ＋ 새로 만들기
          </a>
        </div>
      )}

      {view.showDriveConnect && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 190px)', padding: 20 }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: '#eaf5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
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
          <div style={{ fontSize: 13.5, color: '#9c8b7e', lineHeight: 1.6, marginBottom: 24, textAlign: 'center' }}>
            Google Drive를 연결하면 저장된 마인드맵과 문서를
            <br /> 이곳에서 바로 확인할 수 있어요.
          </div>
          <button
            className="btn"
            onClick={controller.openDriveAuth}
            style={{ height: 50, padding: '0 24px', border: '1px solid #ecdfd5', borderRadius: 13, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 14px rgba(0,0,0,.06)', whiteSpace: 'nowrap' }}
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
