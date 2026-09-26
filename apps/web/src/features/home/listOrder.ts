/**
 * 목록 순서 바꾸기 — LNB 스페이스 구획의 ⠿ 모드가 쓴다.
 *
 * 원래 대시보드 모델(`dashboard/model.ts`)에 있던 것을 대시보드를 걷어내면서 옮겼다.
 * 대시보드 전용이 아니라 **순서를 사용자가 정하는 목록이면 어디서나** 쓰는 순수
 * 함수라, 화면 하나가 사라진다고 함께 사라질 이유가 없다.
 */

/** 목록 안에서 한 칸 이동(위/아래·드래그 공용). 범위를 벗어나면 **같은 참조** 그대로. */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
