// 화이트보드 도구 막대(M4) — 캔버스 하단의 알약(Excalidraw류 관례).
// GNB 툴바에 넣지 않은 이유: 모바일 툴바는 이미 꽉 차 있고, 그리기 도구는
// "지금 캔버스를 어떤 손으로 만지는가"라 캔버스에 붙어 있는 것이 읽기 쉽다.
//
// 삽입(메모·이미지)과 실행취소/다시실행도 여기 있다(요청) — 화이트보드에서 할 수
// 있는 일이 그 둘뿐인데 GNB 메뉴 안에 숨어 있으면 매번 두 번 눌러야 한다.
//
// **폰 배치는 시안대로 셋으로 나뉜다**(요청):
//   ┌ 실행취소·다시실행(작은 알약, 좌측) …… 줌·미니맵 묶음(우측) ┐  ← 같은 띠
//   └ 도구 막대: 선택·펜·지우개·메모·이미지 (전폭 한 줄)         ┘  ← 화면 바닥
// 도구가 다섯이라 전폭 한 줄이면 넉넉하고, 되돌리기와 보기 컨트롤은 성격이 달라
// 위 띠로 물러난다. 묶음은 이 막대 높이만큼 올라간다(`BOARD_BAR_LIFT`).
//
// 펜을 누르면 막대가 **메뉴를 전환한다**(요청) — 도구 목록 자리에 [‹ 뒤로]·색·
// 굵기가 들어선다. 행을 하나 더 쌓지 않으므로 좁은 화면에서 바닥이 두꺼워지지
// 않고, ‹로 돌아가도 펜은 그대로 켜져 있다(메뉴 전환이지 도구 변경이 아니다).
// 데스크톱은 한 줄에 다 들어가므로 기존 배치(도구·삽입·되돌리기 + 펜 옵션 행) 그대로.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import { useIsMobile } from '../../../hooks/useMediaQuery';

const PEN_COLORS = ['#2b2b2b', '#d92626', '#2f7fd6', '#2f9e63', '#e0a53c'];
const PEN_WIDTHS = [2, 4, 8];

/** 폰에서 도구 막대가 차지하는 높이 + 여백 — 줌·미니맵 묶음(`ZoomControls`)과
 * 실행취소 알약이 이만큼 위로 올라가 막대와 겹치지 않는다. 버튼 44 + 패딩 10 +
 * 테두리 2 = 56, 바닥 여백 16, 사이 8. */
export const BOARD_BAR_LIFT = 80;

/** 도구 목록 ↔ 펜 메뉴 밀어내기 전환 길이(ms) — editor.css의 키프레임과 같은 값. */
const PANEL_ANIM_MS = 200;

export function BoardToolbar({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const tool = controller.boardTool;
  const isMobile = useIsMobile();
  // 폰에서 막대가 펜 옵션으로 전환돼 있는가. 펜에서 벗어나면 저절로 닫힌다.
  const [penPanel, setPenPanel] = useState(false);
  // 전환 애니메이션 — 나가는 층이 무엇인지(true=펜 메뉴, false=도구 목록).
  // 그 층을 잠깐 더 그려야 "밀려 나가는" 모습이 보인다. null이면 전환 아님.
  const [leaving, setLeaving] = useState<boolean | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchPanel = useCallback(
    (next: boolean) => {
      if (penPanel === next) return;
      setPenPanel(next);
      setLeaving(penPanel);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        setLeaving(null);
      }, PANEL_ANIM_MS);
    },
    [penPanel],
  );
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  useEffect(() => {
    if (tool !== 'pen') switchPanel(false);
  }, [tool, switchPanel]);

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

  const size = isMobile ? 44 : 36;
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
      onClick={() => {
        controller.setBoardTool(key);
        // 폰: 펜은 색·굵기가 딸린 도구라 누르는 순간 그 메뉴로 전환한다.
        if (isMobile) switchPanel(key === 'pen');
      }}
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

  // 폰 막대에서는 좌우 마진을 두지 않는다 — 간격은 `space-evenly`가 정하므로
  // 마진을 더하면 구분선 양옆만 넓어져 아이콘 열이 어긋나 보인다(실측 18 vs 21).
  const divider = (key: string) => <div key={key} style={{ width: 1, alignSelf: 'stretch', margin: isMobile ? '4px 0' : '4px 3px', background: th.border }} />;

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
  const inserts = [
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
  ];

  const undoRedo = [
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

  const colorBtns = PEN_COLORS.map((c) => (
    <button
      key={c}
      type="button"
      aria-label={`펜 색 ${c}`}
      aria-pressed={controller.penColor === c}
      onClick={() => controller.setPenColor(c)}
      style={{
        width: isMobile ? 26 : 20,
        height: isMobile ? 26 : 20,
        borderRadius: '50%',
        background: c,
        border: `2px solid ${controller.penColor === c ? th.accent : th.panel}`,
        boxShadow: controller.penColor === c ? `0 0 0 1.5px ${hexA(th.accent, 0.4)}` : '0 1px 3px rgba(0,0,0,.18)',
        cursor: 'pointer',
        padding: 0,
        margin: '0 2px',
      }}
    />
  ));

  const widthBtns = PEN_WIDTHS.map((w) => (
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
  ));

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 4 } as const;
  // `.mf-ed-vp`(배경 드래그 소유) 안에 있으므로 pointerdown이 새어 나가면 배경
  // 마퀴 드래그가 포인터를 **캡처**해 버튼이 pointerup/click을 영영 못 받는다
  // (ContextMenu·TextToolbar와 같은 함정 — 실브라우저에서만 드러난다).
  const stopDrag = {
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };
  const shell: CSSProperties = {
    position: 'absolute',
    zIndex: 120, // 그리기 오버레이(110)보다 위 — 그리는 중에도 도구를 바꾼다
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 14,
    boxShadow: '0 8px 24px rgba(0,0,0,.14)',
  };

  // 폰 막대의 두 층 — 도구 목록(선택·펜·지우개 | 메모·이미지)과 펜 메뉴.
  // 아이콘 간격은 `space-evenly`라 양 끝 여백까지 균일하고, 구분선은 그 간격
  // 규칙 안의 한 항목이라 "도구"와 "삽입"이 눈으로 갈린다(요청).
  const toolMenu = (
    <>
      {tools}
      {divider('dm')}
      {inserts}
    </>
  );
  const penMenu = (
    <>
      <button
        type="button"
        className="mf-ed-btn"
        aria-label="도구 목록으로"
        title="도구 목록으로"
        onClick={() => switchPanel(false)}
        style={{ ...btnBase, background: hexA(th.accent, 0.14), color: th.accent }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>
      <div style={rowStyle}>{colorBtns}</div>
      <div style={{ ...rowStyle, gap: 2, padding: 2, borderRadius: 10, background: th.panel2 }}>{widthBtns}</div>
    </>
  );
  const layerStyle = (pen: boolean): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: pen ? 'space-between' : 'space-evenly',
  });

  if (isMobile) {
    return (
      <>
        {/* 되돌리기 묶음 — 도구가 아니라 "방금 한 일"을 다루므로 막대에서 떼어
            위 띠 왼쪽에 둔다(시안). 오른쪽 같은 띠에는 줌·미니맵 묶음이 선다. */}
        <div data-board-undo style={{ ...shell, left: 12, bottom: BOARD_BAR_LIFT, display: 'flex', alignItems: 'center', padding: 4 }} {...stopDrag}>
          {undoRedo[0]}
          {divider('du')}
          {undoRedo[1]}
        </div>

        <div data-board-toolbar data-pen-panel={penPanel ? 'true' : undefined} style={{ ...shell, left: 12, right: 12, bottom: 16, padding: 5 }} {...stopDrag}>
          {/* 전환은 **밀어내기**(요청): 펜을 열면 펜 메뉴가 오른쪽에서 들어오고
              도구 목록은 왼쪽으로 나가고, ‹로 돌아오면 반대. 나가는 쪽을 잠깐 더
              그려야 하므로 두 층을 겹쳐 놓는다 — 그래서 높이를 고정한다(버튼 높이). */}
          <div style={{ position: 'relative', height: size, overflow: 'hidden' }}>
            <div key={penPanel ? 'pen' : 'tools'} className={leaving === null ? undefined : penPanel ? 'mf-board-in-right' : 'mf-board-in-left'} style={layerStyle(penPanel)}>
              {penPanel ? penMenu : toolMenu}
            </div>
            {leaving !== null && (
              <div aria-hidden className={leaving ? 'mf-board-out-right' : 'mf-board-out-left'} style={{ ...layerStyle(leaving), pointerEvents: 'none' }}>
                {leaving ? penMenu : toolMenu}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div data-board-toolbar style={{ ...shell, left: '50%', transform: 'translateX(-50%)', bottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: 5, borderRadius: 12, maxWidth: 'calc(100vw - 24px)' }} {...stopDrag}>
      <div style={rowStyle}>
        {tools}
        {divider('d1')}
        {inserts}
        {divider('d2')}
        {undoRedo}
      </div>

      {tool === 'pen' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4, borderTop: `1px solid ${th.border}`, width: '100%', justifyContent: 'center' }}>
          <div style={rowStyle}>{colorBtns}</div>
          <div style={{ width: 1, alignSelf: 'stretch', margin: '2px 3px', background: th.border }} />
          <div style={rowStyle}>{widthBtns}</div>
        </div>
      )}
    </div>
  );
}
