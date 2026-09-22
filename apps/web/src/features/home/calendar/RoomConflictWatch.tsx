// 배경 훑기를 **문지기 안에** 한 번 마운트하는 자리 — 그리는 것은 없다.
//
// 일정 알림(`ReminderHost`)과 같은 괄호다: 로그인한 화면이면 어디서든 돌아야 하고
// (제보: 일정 화면을 보고 있지 않으면 알림 센터에 쌓이지 않았다), 랜딩·로그인·약관
// 에서는 일정을 조회할 이유가 없다.

import { useRoomConflictWatch } from './useRoomConflictWatch';

export function RoomConflictWatch(): null {
  useRoomConflictWatch();
  return null;
}
