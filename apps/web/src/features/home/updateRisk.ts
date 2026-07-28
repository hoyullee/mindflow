import type { UpdateRisk } from '../../pwa/updateGate';
import type { HomeState } from './types';

/**
 * 홈(대시보드)에서 새 버전을 조용히 적용해도 되는지 — `useUpdateGuard`에 넘길 위험도.
 *
 * 홈은 문서 목록이라 리로드해도 같은 목록이 다시 그려진다 → 기본은 `safe`.
 * 다만 화면에 **사용자가 만들어 둔 일시적 상태**가 있으면(입력 중인 팝업, 판단
 * 중인 확인 다이얼로그, 좁혀 둔 검색, 진행 중인 작업) 그건 리로드로 사라지므로
 * `block`으로 올린다.
 *
 * 토스트/가져오기 결과 같은 **알림**은 막지 않는다 — 사라져도 사용자가 잃는 게 없다.
 */
export function homeUpdateRisk(state: HomeState): UpdateRisk {
  // 진행 중인 작업 — 리로드하면 중간에 끊긴다.
  if (state.creatingMap || state.loaderMsg || state.auth) return 'block';

  // 텍스트를 입력하는 팝업들.
  if (state.newSpaceOpen || state.folderModal || state.profileNameOpen) return 'block';
  if (state.accountSettingsOpen || state.confirmDeleteAccount) return 'block';

  // 사용자가 답을 고르는 중인 확인 다이얼로그.
  if (state.confirmDelete || state.confirmRestore || state.confirmPurge) return 'block';
  if (state.confirmEmptyTrash || state.confirmLogout) return 'block';
  if (state.confirmDeleteSpace || state.confirmDeleteFolder) return 'block';

  // 열어 둔 메뉴/서브메뉴와 드래그 중인 카드.
  if (state.openMenu || state.spaceMenu || state.moveFor || state.moveSpaceFor || state.exportFor) return 'block';
  if (state.draggingMap) return 'block';

  // 검색어로 목록을 좁혀 둔 상태 — 리로드하면 전체 목록으로 되돌아간다.
  if (state.search.trim()) return 'block';

  return 'safe';
}
