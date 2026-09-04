import { useEffect, useRef } from 'react';
import type { EditorController } from '../useEditorState';
import { useOnline } from '../../../hooks/useOnline';
import { CHIP_SHADOW, accentButton, glassCard } from '../chrome';

interface DocChipProps {
  controller: EditorController;
}

/**
 * Top-left document chip — port of the home/title/save cluster
 * (MindFlow.dc.html:103-122): home navigation, title editing
 * (`onTitleInput`/`commitTitle`), the save button (`saveNow`), and the
 * dirty/saving/saved indicator (`state.saveState`) are all wired (Editor-b).
 */
export function DocChip({ controller }: DocChipProps) {
  const th = controller.uiTheme;
  // 열 수 없는 맵(`bodyMissing`)은 여기서 다루지 않는다 — 에디터 자체가 렌더되지 않고
  // 전용 화면(`MapUnavailable`)이 대신 나온다.
  // 오프라인이면 저장 상태보다 **연결**이 먼저다 — "변경됨"만 보이면 저장이 왜
  // 안 끝나는지 알 길이 없다. 연결이 돌아오면 컨트롤러가 바로 올린다(`online` 훅).
  const online = useOnline();
  const offline = !online && !controller.readOnly;
  const dotColor = offline ? '#c0532e' : controller.readOnly ? '#3f8fd0' : controller.saveState === 'saved' ? '#3fae6a' : controller.saveState === 'saving' ? '#e0b23c' : th.subtext;
  // 보기 전용(#22)에는 저장 상태 대신 권한을 말한다 — 뷰어에게 "저장됨"은 무의미하고,
  // 제목 옆에서 이 맵을 왜 못 고치는지 한 번 더 설명해 준다.
  const saveLabel = controller.saveState === 'saved' ? '저장됨' : controller.saveState === 'saving' ? '저장 중…' : controller.saveState === 'unsaved' ? '저장 전' : '변경됨';
  const label = offline ? (controller.saveState === 'saved' ? '오프라인' : '오프라인 · 저장 대기') : controller.readOnly ? '보기 전용' : saveLabel;

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        top: 16,
        zIndex: 16,
        width: 236,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        // 디자인 원본: 캔버스가 비치는 유리질 카드(반투명 + 블러).
        ...glassCard(th),
        borderRadius: 14,
        boxShadow: CHIP_SHADOW,
        padding: '9px 10px',
      }}
    >
      <button
        type="button"
        className="mf-ed-btn"
        onClick={controller.goBack}
        title="뒤로 가기"
        aria-label="뒤로 가기"
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${th.border}`,
          borderRadius: 11,
          background: th.panel2,
          color: th.text,
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: 0,
        }}
      >
        {/* 집 → 뒤로 화살표: 이 버튼은 이제 "홈"이 아니라 **직전 화면**으로 간다
            (대시보드·일정·스페이스 어디서든 들어오므로). 홈으로 가는 문은 상단
            바의 브랜드 로고가 그대로 맡는다. */}
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
      </button>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {controller.editingTitle ? (
          <TitleEdit controller={controller} />
        ) : (
          <div
            title={controller.docTitle}
            onDoubleClick={controller.startEditTitle}
            style={{ fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, cursor: controller.readOnly ? 'default' : 'text' }}
          >
            {controller.docTitle}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: th.subtext }}>{label}</span>
        </div>
        {controller.movedNotice && (
          <div
            role="alert"
            title="원래 id가 다른 계정의 문서라 새 문서로 옮겨 저장했어요. (클릭해서 닫기)"
            onClick={controller.dismissMovedNotice}
            className="mf-marquee"
            style={{ fontSize: 10.5, fontWeight: 600, color: '#c0532e', cursor: 'pointer' }}
          >
            <span className="mf-marquee-run">
              <span>⚠ 같은 주소를 쓰는 다른 계정의 맵이 있어 이 맵을 새 문서로 옮겨 저장했어요</span>
              <span aria-hidden="true">⚠ 같은 주소를 쓰는 다른 계정의 맵이 있어 이 맵을 새 문서로 옮겨 저장했어요</span>
            </span>
          </div>
        )}
        {controller.imageNotice && (
          <div
            role="alert"
            title={`${controller.imageNotice} (클릭해서 닫기)`}
            onClick={controller.dismissImageNotice}
            className="mf-marquee"
            style={{ fontSize: 10.5, fontWeight: 600, color: '#c0532e', cursor: 'pointer' }}
          >
            <span className="mf-marquee-run">
              <span>⚠ {controller.imageNotice}</span>
              <span aria-hidden="true">⚠ {controller.imageNotice}</span>
            </span>
          </div>
        )}
        {controller.saveConflict && (
          <div
            role="alert"
            title="다른 기기/탭에서 먼저 저장되어 최신 버전을 기준으로 이어서 저장해요. (클릭해서 닫기)"
            onClick={controller.dismissSaveConflict}
            className="mf-marquee"
            style={{ fontSize: 10.5, fontWeight: 600, color: '#c0532e', cursor: 'pointer' }}
          >
            {/* 전광판: 좁은 칩 폭에서 말줄임으로 잘리던 안내(제보)를 흐르는 한 줄로.
                같은 문장을 두 번 이어 붙이고 절반만큼 이동시켜 이음매 없이 돈다
                (editor.css .mf-marquee). 두 번째 복제는 시각 전용(aria-hidden). */}
            <span className="mf-marquee-run">
              <span>⚠ 다른 기기/탭에서 먼저 저장됨 (v{controller.saveConflict.currentVersion}) — 최신 버전을 기준으로 이어서 저장해요</span>
              <span aria-hidden="true">⚠ 다른 기기/탭에서 먼저 저장됨 (v{controller.saveConflict.currentVersion}) — 최신 버전을 기준으로 이어서 저장해요</span>
            </span>
          </div>
        )}
      </div>
      {!controller.readOnly && (
      <button
        type="button"
        className="mf-ed-btn"
        onClick={controller.saveNow}
        title="저장 (Ctrl+S)"
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 11,
          ...accentButton(th),
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: 0,
        }}
      >
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      </button>
      )}
    </div>
  );
}

function TitleEdit({ controller }: { controller: EditorController }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      className="mf-edit"
      defaultValue={controller.docTitle}
      maxLength={40}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          controller.commitTitle(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          controller.cancelTitleEdit();
        }
      }}
      onBlur={(e) => controller.commitTitle(e.currentTarget.value)}
      style={{
        fontSize: 13.5,
        fontWeight: 700,
        color: controller.uiTheme.text,
        lineHeight: 1.2,
        width: '100%',
        border: 'none',
        borderBottom: `1.5px solid ${controller.uiTheme.accent}`,
        background: 'transparent',
        outline: 'none',
        padding: '0 0 1px',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
  );
}
