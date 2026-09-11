import { describe, expect, it } from 'vitest';
import { initialHomeState } from './types';
import { homeUpdateRisk } from './updateRisk';

describe('homeUpdateRisk (홈에서 새 버전 자동 적용 판단)', () => {
  it('가만히 목록만 보고 있으면 `defer` — 보고 있는 동안은 LNB 알림이 말하고, 탭을 떠나면 조용히 적용된다', () => {
    // 리로드해도 같은 목록이 다시 그려지므로 `safe`로 둘 수도 있지만, 그러면 보고
    // 있는 화면이 눈앞에서 갈아끼워져 **LNB의 새 버전 알림이 뜰 자리가 없다**(요청:
    // 업데이트도 알림 창구 하나에서). 유휴 에디터와 같은 규칙이다.
    expect(homeUpdateRisk(initialHomeState())).toBe('defer');
  });

  it('검색어로 목록을 좁혀 뒀으면 막는다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), search: '회의' })).toBe('block');
    // 공백만 친 건 좁힌 게 아니다
    expect(homeUpdateRisk({ ...initialHomeState(), search: '   ' })).toBe('defer');
  });

  it('텍스트를 입력하는 팝업이 열려 있으면 막는다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), newSpaceOpen: true })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), profileNameOpen: true })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), folderModal: { mode: 'new', id: null, name: '' } })).toBe('block');
  });

  it('회원 탈퇴 흐름은 막는다 — 타이핑 게이트를 통과해 둔 상태가 사라지면 안 된다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), accountSettingsOpen: true })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), confirmDeleteAccount: true })).toBe('block');
  });

  it('사용자가 답을 고르는 중인 확인 다이얼로그는 막는다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), confirmDelete: '주간 회의' })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), confirmEmptyTrash: true })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), confirmLogout: true })).toBe('block');
  });

  it('진행 중인 작업(맵 생성·로더·인증)은 막는다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), creatingMap: true })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), loaderMsg: '맵을 여는 중이에요' })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), auth: 'connecting' })).toBe('block');
  });

  it('열어 둔 메뉴와 드래그 중인 카드도 막는다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), ctxMenu: { x: 10, y: 10, target: { kind: 'map', key: '주간 회의' } } })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), ctxMenu: { x: 10, y: 10, target: { kind: 'bg' } } })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), renameMap: { key: 'd1', docId: 'd1', name: '주간 회의' } })).toBe('block');
    expect(homeUpdateRisk({ ...initialHomeState(), draggingMap: '주간 회의' })).toBe('block');
  });

  it('사라져도 잃을 게 없는 알림은 막지 않는다 — 유휴와 같은 판단이다', () => {
    expect(homeUpdateRisk({ ...initialHomeState(), toast: '이동했어요', toastTitle: '이동 완료' })).toBe('defer');
    expect(homeUpdateRisk({ ...initialHomeState(), importDone: '가져온 맵' })).toBe('defer');
  });
});
