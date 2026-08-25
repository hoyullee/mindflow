import { SPACE_COLORS, type HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { CreateDialog, FolderChipIcon } from './CreateDialog';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** "새 스페이스 만들기"(첨부 디자인) — 공용 만들기 껍데기(`CreateDialog`)에 스페이스의
 * 글자만 부었다. `state.editingSpace`가 있으면 **이름 변경** 팝업이 된다(제목·버튼
 * 글자만 바뀌고 색까지 그대로 고칠 수 있다 — 잘못 고른 색이 영구가 되지 않게). */
export function NewSpaceModal({ state, controller }: Props) {
  const editing = !!state.editingSpace;
  return (
    <CreateDialog
      open={state.newSpaceOpen}
      onClose={controller.closeNewSpace}
      title={editing ? '스페이스 이름 변경' : '새 스페이스 만들기'}
      subtitle={editing ? '이름과 색상을 바꿔요' : '주제별로 보드를 정리할 공간을 만들어요'}
      icon={<FolderChipIcon />}
      fieldLabel="스페이스 이름"
      value={state.newSpaceName}
      onChange={controller.onNewSpaceName}
      maxLen={10}
      placeholder="예: 팀 프로젝트"
      colors={SPACE_COLORS}
      color={state.newSpaceColor}
      onColor={controller.pickSpaceColor}
      submitLabel={editing ? '변경' : '만들기'}
      onSubmit={controller.submitSpace}
      cardAttrs={{ 'data-space-dialog': '' }}
    />
  );
}
