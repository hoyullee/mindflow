import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { UNREAD_BADGE_BG } from '../theme';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  isMobile: boolean;
  onOpenNav: () => void;
}

/**
 * 홈 최상단의 검색 줄 — 스페이스 헤더 **위**에 있다.
 *
 * 자리가 뜻을 말한다: 검색은 이제 **전 스페이스**를 뒤지므로, 스페이스 헤더 아래에
 * 있으면 "이 스페이스 안에서 찾는다"는 거짓말이 된다. 데스크톱·모바일이 같은 자리를
 * 쓰고(LNB에 두면 폰에서는 서랍을 열어야 검색할 수 있다), 모바일의 ☰도 여기로 와서
 * 이 줄이 앱 바 노릇을 한다.
 */
export function SearchBar({ state, view, controller, isMobile, onOpenNav }: Props) {
  const searching = !!state.searchInput.trim();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, marginBottom: isMobile ? 14 : 18 }}>
      {isMobile && (
        <button
          type="button"
          className="btn"
          onClick={onOpenNav}
          title={view.sharedUnread > 0 ? `메뉴 열기 (새 공유 ${view.sharedUnread}개)` : '메뉴 열기'}
          aria-label={view.sharedUnread > 0 ? `메뉴 열기, 확인하지 않은 공유 ${view.sharedUnread}개` : '메뉴 열기'}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginLeft: -12, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--mf-text)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
          {/* 폰에서는 LNB가 서랍이라 그 안의 배지가 보이지 않는다 — 문에도 점을 찍는다. */}
          {view.sharedUnread > 0 && (
            <span
              data-unread-dot
              aria-hidden="true"
              style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: UNREAD_BADGE_BG, border: '2px solid var(--mf-bg)' }}
            />
          )}
        </button>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          flex: '1 1 auto',
          // 데스크톱에서도 폭을 제한한다 — 화면 전체를 가로지르는 입력창은
          // 그 아래 카드 그리드보다 무거워 보인다.
          maxWidth: isMobile ? undefined : 520,
          minWidth: 0,
          height: isMobile ? 44 : 42,
          padding: '0 14px',
          background: 'var(--mf-panel)',
          border: '1px solid var(--mf-border)',
          borderRadius: 12,
          color: 'var(--mf-muted)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--mf-muted)', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
        </span>
        <input
          // 보여 주는 값은 즉시값(`searchInput`) — 적용은 잠깐 뒤에 된다
          // (`setSearch`의 디바운스). Enter/포커스 아웃은 기다리지 않는다.
          value={state.searchInput}
          onChange={(e) => controller.setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') controller.flushSearch();
            if (e.key === 'Escape') controller.setSearch('');
          }}
          onBlur={controller.flushSearch}
          placeholder="모든 스페이스에서 검색"
          aria-label="모든 스페이스에서 검색"
          style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13.5, width: '100%', minWidth: 0, color: 'var(--mf-text)' }}
        />
        {searching && (
          <button
            type="button"
            className="btn"
            data-search-clear
            aria-label="검색 지우기"
            title="검색 지우기 (Esc)"
            onClick={() => controller.setSearch('')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', borderRadius: '50%', background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
