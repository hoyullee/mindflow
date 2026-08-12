// 화이트보드 도구 막대(M4) — 캔버스 하단 중앙의 알약(Excalidraw류 관례).
// GNB 툴바에 넣지 않은 이유: 모바일 툴바는 이미 꽉 차 있고, 그리기 도구는
// "지금 캔버스를 어떤 손으로 만지는가"라 캔버스에 붙어 있는 것이 읽기 쉽다.
//
// 삽입(메모·이미지)과 실행취소/다시실행도 여기 있다(요청) — 화이트보드에서 할 수
// 있는 일이 그 둘뿐인데 GNB 메뉴 안에 숨어 있으면 매번 두 번 눌러야 한다.
// 두 줄 구성: 1행 = 도구·삽입·되돌리기(늘), 2행 = 펜 색·굵기(펜일 때만).
// 한 줄에 몰면 폰에서 화면을 넘긴다.
//
// **폰에서는 좌측 하단**에 붙고 도구/동작이 두 행으로 갈린다(제보: 우측 하단
// 줌·미니맵 묶음과 겹쳤다). 묶음을 위로 올려 봤지만 원래 자리가 낫다는 판단이라
// (요청) 비켜서는 쪽은 도구 막대다 — 폰 화이트보드의 관례이기도 하다(도구는
// 왼쪽, 보기 컨트롤은 오른쪽). 폭은 그 묶음 자리를 빼고 잡는다.

import { useEffect } from 'react';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';

const PEN_COLORS = ['#2b2b2b', '#d92626', '#2f7fd6', '#2f9e63', '#e0a53c'];
const PEN_WIDTHS = [2, 4, 8];

/** 폰에서 우측 하단 줌·미니맵 묶음(`ZoomControls`)에 내주는 가로 자리 —
 * 미니맵 폭 120 + 패딩·테두리 14 + 오른쪽 여백 16 + 사이 간격 10. 이 막대의
 * 최대 폭을 그만큼 줄여 두 상자가 만나지 않는다. */
const MOBILE_CLUSTER_RESERVE = 160;

export function BoardToolbar({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const tool = controller.boardTool;
  const isMobile = useIsMobile();

  // Escape = 선택 도구로 복귀(그리기에서 빠져나오는 가장 익숙한 길).
  useEffect(() => {
    if (tool === 'select') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') controller.setBoardTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, controller]);

  if (!controller.isBoard || controller.readOnly) return null;

  const size = isMobile ? 40 : 36;
  const btnBase = {
    width: size,
    height: size,
    border: 'none',
    borderRadius: 9,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  } as const;

  const toolBtn = (key: 'select' | 'pen' | 'eraser', label: string, hint: string, icon: JSX.Element) => (
    <button
      key={key}
      type="button"
      className="mf-ed-btn"
      aria-label={label}
      aria-pressed={tool === key}
      title={`${label} (${hint})`}
      onClick={() => controller.setBoardTool(key)}
      style={{ ...btnBase, background: tool === key ? hexA(th.accent, 0.14) : 'transparent', color: tool === key ? th.accent : th.subtext }}
    >
      {icon}
    </button>
  );

  const actionBtn = (label: string, icon: JSX.Element, run: () => void, disabled?: boolean) => (
    <button
      key={label}
      type="button"
      className="mf-ed-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={run}
      style={{ ...btnBase, background: 'transparent', color: th.subtext, opacity: disabled ? 0.38 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      {icon}
    </button>
  );

  const divider = (key: string) => <div key={key} style={{ width: 1, alignSelf: 'stretch', margin: '4px 3px', background: th.border }} />;

  const tools = [
    toolBtn(
      'select',
      '선택',
      'V',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 3l14 8-6.5 1.5L9 19z" />
      </svg>,
    ),
    toolBtn(
      'pen',
      '펜',
      'P',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      </svg>,
    ),
    toolBtn(
      'eraser',
      '지우개',
      'E',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 20H8.5l-5-5a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L13 18.5" />
      </svg>,
    ),
  ];

  // 삽입 — 화이트보드가 담을 수 있는 두 가지. 그리기 도구가 켜져 있어도 누를 수
  // 있고, 누르면 선택 도구로 돌아온다(방금 만든 것을 바로 만진다).
  const actions = [
    actionBtn(
      '메모 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 4h14a1 1 0 0 1 1 1v9.5L14.5 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M20 14.5h-4.5a1 1 0 0 0-1 1V20" />
      </svg>,
      () => {
        controller.setBoardTool('select');
        controller.addFloatAt();
      },
    ),
    actionBtn(
      '이미지 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="8.8" cy="10" r="1.5" />
        <path d="m4.5 17 5-5 3.5 3.5 3-3 4 4.5" />
      </svg>,
      () => {
        controller.setBoardTool('select');
        controller.promptAddImage();
      },
    ),
    divider('d2'),
    actionBtn(
      '실행 취소',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h10.5a5.5 5.5 0 0 1 0 11H8" />
        <path d="M7.5 4.5 4 8l3.5 3.5" />
      </svg>,
      controller.undo,
      !controller.canUndo,
    ),
    actionBtn(
      '다시 실행',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 8H9.5a5.5 5.5 0 0 0 0 11H16" />
        <path d="M16.5 4.5 20 8l-3.5 3.5" />
      </svg>,
      controller.redo,
      !controller.canRedo,
    ),
  ];

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 4 } as const;

  return (
    <div
      data-board-toolbar
      // `.mf-ed-vp`(배경 드래그 소유) 안에 있으므로 pointerdown이 새어 나가면
      // 배경 마퀴 드래그가 포인터를 **캡처**해 버튼이 pointerup/click을 영영 못
      // 받는다(ContextMenu·TextToolbar와 같은 함정 — 실브라우저에서만 드러난다).
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        // 폰 = 좌측 하단(우측 하단 묶음에 자리를 내준다), 데스크톱 = 하단 중앙.
        ...(isMobile ? { left: 12 } : { left: '50%', transform: 'translateX(-50%)' }),
        bottom: 16,
        zIndex: 120, // 그리기 오버레이(110)보다 위 — 그리는 중에도 도구를 바꾼다
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        padding: 5,
        borderRadius: 12,
        background: th.panel,
        border: `1px solid ${th.border}`,
        boxShadow: '0 8px 24px rgba(0,0,0,.14)',
        maxWidth: isMobile ? `calc(100vw - ${MOBILE_CLUSTER_RESERVE + 12}px)` : 'calc(100vw - 24px)',
      }}
    >
      {/* 폰에서는 도구 행과 동작 행을 나눈다 — 한 행에 몰면 우측 하단 묶음에
          내준 폭을 넘는다(가로 스크롤이나 겹침이 생긴다). 데스크톱은 한 행. */}
      {isMobile ? (
        <>
          <div style={rowStyle}>{tools}</div>
          <div style={rowStyle}>{actions}</div>
        </>
      ) : (
        <div style={rowStyle}>
          {tools}
          {divider('d1')}
          {actions}
        </div>
      )}

      {/* 펜 옵션 — 색 줄과 굵기 줄. 폰에서는 두 묶음이 한 줄에 못 들어가므로
          아예 행을 나눈다(wrap에 맡기면 굵기 하나가 색 줄 끝에 매달린다). */}
      {tool === 'pen' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4, borderTop: `1px solid ${th.border}`, width: '100%', justifyContent: 'center', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={rowStyle}>
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`펜 색 ${c}`}
                aria-pressed={controller.penColor === c}
                onClick={() => controller.setPenColor(c)}
                style={{
                  width: isMobile ? 24 : 20,
                  height: isMobile ? 24 : 20,
                  borderRadius: '50%',
                  background: c,
                  border: `2px solid ${controller.penColor === c ? th.accent : th.panel}`,
                  boxShadow: controller.penColor === c ? `0 0 0 1.5px ${hexA(th.accent, 0.4)}` : '0 1px 3px rgba(0,0,0,.18)',
                  cursor: 'pointer',
                  padding: 0,
                  margin: '0 2px',
                }}
              />
            ))}
          </div>
          {!isMobile && <div style={{ width: 1, alignSelf: 'stretch', margin: '2px 3px', background: th.border }} />}
          <div style={rowStyle}>
            {PEN_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`펜 굵기 ${w}`}
                aria-pressed={controller.penWidth === w}
                onClick={() => controller.setPenWidth(w)}
                style={{
                  width: isMobile ? 30 : 26,
                  height: isMobile ? 30 : 26,
                  border: 'none',
                  borderRadius: 7,
                  background: controller.penWidth === w ? hexA(th.accent, 0.14) : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <span style={{ width: 14, height: w, minHeight: 2, borderRadius: 99, background: controller.penWidth === w ? th.accent : th.subtext, display: 'block' }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
