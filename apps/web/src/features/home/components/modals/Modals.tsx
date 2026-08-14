import type { HomeController } from '../../useHomeController';
import { sourceOf } from '../../storage';
import { DRIVE_FILES, type HomeState } from '../../types';
import { ConfirmModal } from './ConfirmModal';

const TRASH_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

// Restore (counter-clockwise circular arrow) — the SVG counterpart to the ♻️
// emoji, in the same green as the restore confirm button/tint.
const RESTORE_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-success)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 4 3 10 9 10" />
    <path d="M5.4 15a8 8 0 1 0 1.9-8.3L3 10" />
  </svg>
);

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:368-466 — delete/restore/logout confirm dialogs (delete-map handled separately
 * below since its heading/body depend on whether the title is a Drive file). */
export function Modals({ state, controller }: Props) {
  const deleteIsDrive = state.confirmDelete ? sourceOf(state.confirmDelete, DRIVE_FILES) === 'drive' : false;
  const deleteSpaceName = state.spaces.find((s) => s.id === state.confirmDeleteSpace)?.name || '';
  // 폴더 삭제 확인창 — 폴더는 이름표라 지워도 안의 것은 남는다. 무엇이 몇 개
  // 어디로 올라가는지 문장으로 밝힌다(내용이 있어도 삭제할 수 있게 되면서 필요해진
  // 안내 — 예전에는 빈 폴더만 지울 수 있었다).
  const del = state.confirmDeleteFolder ? controller.folderDeleteSummary(state.confirmDeleteFolder) : null;
  const deleteFolderBody = del
    ? del.maps || del.folders
      ? `'${del.name}' 폴더를 삭제합니다. 안에 있는 ${[del.maps ? `맵 ${del.maps}개` : '', del.folders ? `하위 폴더 ${del.folders}개` : ''].filter(Boolean).join('와 ')}는 삭제되지 않고 '${del.upName}'(으)로 옮겨져요.`
      : `'${del.name}' 폴더를 삭제합니다. 이 작업은 되돌릴 수 없어요.`
    : '';

  return (
    <>
      <ConfirmModal
        visible={!!state.confirmDelete}
        zIndex={120}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading={deleteIsDrive ? 'Google Drive에서 삭제할까요?' : '삭제하시겠습니까?'}
        body={
          state.confirmDelete
            ? deleteIsDrive
              ? `'${state.confirmDelete}' 파일을 삭제하면 연결된 Google Drive의 원본 파일도 함께 휴지통으로 이동됩니다.`
              : `'${state.confirmDelete}' 맵을 휴지통으로 이동합니다. 휴지통에서 다시 복원할 수 있어요.`
            : ''
        }
        cancelLabel="취소"
        confirmLabel={deleteIsDrive ? 'Drive에서 삭제' : '삭제'}
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDelete}
        onConfirm={controller.confirmDeleteYes}
      />

      {/* 여러 장 삭제(요청) — 한 장 확인창과 같은 꼴이되 몇 개인지 말한다. */}
      <ConfirmModal
        visible={!!state.confirmDeleteMulti}
        zIndex={120}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="선택한 맵을 삭제할까요?"
        body={`맵 ${state.confirmDeleteMulti?.length ?? 0}개를 휴지통으로 이동합니다. 휴지통에서 다시 복원할 수 있어요.`}
        cancelLabel="취소"
        confirmLabel="삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDelete}
        onConfirm={controller.confirmDeleteYes}
      />

      <ConfirmModal
        visible={!!state.confirmRestore}
        zIndex={120}
        iconBg="var(--mf-success-soft)"
        icon={RESTORE_ICON}
        heading="복원하시겠습니까?"
        body={`'${state.confirmRestore || ''}' 맵을 휴지통에서 원래 위치로 복원합니다.`}
        cancelLabel="취소"
        confirmLabel="복원"
        confirmColor="var(--mf-success)"
        onCancel={controller.cancelRestore}
        onConfirm={controller.confirmRestoreYes}
      />

      <ConfirmModal
        visible={!!state.confirmPurge}
        zIndex={125}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="영구 삭제하시겠습니까?"
        body={`'${state.confirmPurge || ''}' 맵이 완전히 삭제됩니다. 이 작업은 되돌릴 수 없어요.`}
        cancelLabel="취소"
        confirmLabel="영구 삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelPurge}
        onConfirm={controller.confirmPurgeYes}
      />

      <ConfirmModal
        visible={state.confirmEmptyTrash}
        zIndex={125}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="휴지통을 비우시겠습니까?"
        body={`휴지통의 ${state.trash.length}개 항목이 모두 완전히 삭제됩니다. 이 작업은 되돌릴 수 없어요.`}
        cancelLabel="취소"
        confirmLabel="모두 삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelEmptyTrash}
        onConfirm={controller.confirmEmptyTrashYes}
      />

      <ConfirmModal
        visible={!!state.confirmDeleteFolder}
        zIndex={130}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="폴더를 삭제하시겠습니까?"
        body={deleteFolderBody}
        cancelLabel="취소"
        confirmLabel="삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDeleteFolder}
        onConfirm={controller.confirmDeleteFolderYes}
      />

      <ConfirmModal
        visible={!!state.confirmDeleteSpace}
        zIndex={140}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="스페이스를 삭제하시겠습니까?"
        body={`'${deleteSpaceName}' 스페이스를 삭제합니다. 이 작업은 되돌릴 수 없어요.`}
        cancelLabel="취소"
        confirmLabel="삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDeleteSpace}
        onConfirm={controller.confirmDeleteSpaceYes}
      />

      <ConfirmModal
        visible={state.confirmLogout}
        zIndex={140}
        iconBg="var(--mf-danger-soft)"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        }
        heading="로그아웃하시겠습니까?"
        body="로그아웃하면 로그인 페이지로 이동합니다."
        cancelLabel="취소"
        confirmLabel="로그아웃"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelLogout}
        onConfirm={controller.confirmLogoutYes}
      />
    </>
  );
}
