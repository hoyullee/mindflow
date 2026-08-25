import { SPACE_COLORS, type HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { CreateDialog, DashChipIcon } from './CreateDialog';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** "새 대시보드 만들기"(첨부 디자인) — LNB의 `새 대시보드`가 이 팝업을 연다(예전에는
 * 이름을 자동으로 붙여 곧바로 만들었다). `state.dashDialog.id`가 있으면 **이름 변경**
 * 이고(행 우클릭 메뉴), 색은 스페이스와 같은 여섯 중에서 고른다 — 고른 색은 LNB 행
 * 글리프·히어로 점·다른 대시보드 알약에 나타난다(고르면 보이는 곳이 있어야 한다). */
export function DashboardModal({ state, controller }: Props) {
  const d = state.dashDialog;
  const editing = !!d?.id;
  return (
    <CreateDialog
      open={!!d}
      onClose={controller.closeDashDialog}
      title={editing ? '대시보드 이름 변경' : '새 대시보드 만들기'}
      subtitle={editing ? '이름과 색상을 바꿔요' : '보드를 모아 한눈에 볼 화면을 만들어요'}
      icon={<DashChipIcon />}
      fieldLabel="대시보드 이름"
      value={d?.name ?? ''}
      onChange={controller.onDashDialogName}
      maxLen={10}
      placeholder="예: 주간 현황"
      colors={SPACE_COLORS}
      color={d?.color ?? SPACE_COLORS[0]!}
      onColor={controller.pickDashColor}
      submitLabel={editing ? '변경' : '만들기'}
      onSubmit={controller.submitDashDialog}
      cardAttrs={{ 'data-dash-dialog': '' }}
    />
  );
}
