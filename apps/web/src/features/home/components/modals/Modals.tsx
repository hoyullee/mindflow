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
  const deleteDashName = state.dashboards.find((d) => d.id === state.confirmDeleteDash)?.name || '';
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

      {/* 대시보드 삭제 — 대시보드는 문서가 아니라 **배치**다. 사라지는 것이 배치뿐이고
          문서는 스페이스에 그대로라는 것을 문구가 말한다(폴더 삭제와 같은 태도). */}
      <ConfirmModal
        visible={!!state.confirmDeleteDash}
        zIndex={140}
        iconBg="var(--mf-danger-soft)"
        icon={TRASH_ICON}
        heading="대시보드를 삭제할까요?"
        body={`'${deleteDashName}' 대시보드를 삭제합니다. 배치만 사라지고, 올려 둔 문서는 스페이스에 그대로 있어요.`}
        cancelLabel="취소"
        confirmLabel="삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDeleteDash}
        onConfirm={controller.confirmDeleteDashYes}
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

      {/* 모든 기기에서 로그아웃(세션 정책 ①) — 다른 기기까지 끊는 동작이라 한 번 묻는다.
          되돌릴 수 있는 일(다시 로그인하면 된다)이므로 문구도 그렇게 말한다. */}
      <ConfirmModal
        visible={state.confirmLogoutAll}
        zIndex={160}
        iconBg="var(--mf-danger-soft)"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        }
        heading="모든 기기에서 로그아웃할까요?"
        body="이 기기와 다른 기기·브라우저의 로그인이 모두 해제돼요. 각 기기에서 다시 로그인하면 됩니다."
        cancelLabel="취소"
        confirmLabel="모두 로그아웃"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelLogoutAll}
        onConfirm={controller.confirmLogoutAllYes}
      />

      {/* Google 연결 해제 — 되돌릴 수 있지만(다시 연결하면 된다) 출입구가 하나
          사라지므로 한 번 묻는다. 비밀번호가 없으면 행 자체가 눌리지 않으니
          여기까지 오지 않는다(그 경우 계정에 들어올 길이 없어진다). */}
      <ConfirmModal
        visible={state.confirmUnlinkGoogle}
        zIndex={160}
        iconBg="var(--mf-danger-soft)"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 14.5 5.7 18.3a3.5 3.5 0 0 1-4.9-5l3.8-3.8" />
            <path d="M14.5 9.5l3.8-3.8a3.5 3.5 0 0 1 4.9 5l-3.8 3.8" />
            <line x1="9" y1="15" x2="15" y2="9" />
          </svg>
        }
        heading="Google 연결을 해제할까요?"
        body="앞으로 Google 계정으로는 로그인할 수 없어요. 이메일과 비밀번호로 로그인하면 되고, 언제든 다시 연결할 수 있어요."
        cancelLabel="취소"
        confirmLabel="연결 해제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelUnlinkGoogle}
        onConfirm={controller.confirmUnlinkGoogleYes}
      />

      {/* 회원 탈퇴 2단계(요청) — 문구를 입력하고 누르면 **한 번 더** 묻는다. 비가역
          동작이라 "문구를 쳤다"만으로 지우지 않고, 마지막 순간에 되돌릴 기회를 준다.
          1단계 창(z 160)보다 위에 뜬다. */}
      <ConfirmModal
        visible={state.confirmDeleteAccountFinal}
        zIndex={170}
        iconBg="var(--mf-danger-soft)"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        }
        heading="마지막으로 확인할게요"
        body="확인을 누르면 계정과 모든 맵·스페이스·폴더가 즉시 삭제되고, 되돌릴 수 없어요."
        cancelLabel="취소"
        confirmLabel="영구 삭제"
        confirmColor="var(--mf-danger)"
        onCancel={controller.cancelDeleteAccountFinal}
        onConfirm={controller.confirmDeleteAccountFinalYes}
      />
    </>
  );
}
