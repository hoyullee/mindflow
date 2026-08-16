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
//
// 삽입이 넷(메모·이미지·연결선·영역)이 되면서 폰에서는 **삽입도 같은 전환 메뉴**다:
// 도구 넷 + 삽입 넷을 한 줄에 늘어놓으면 44px 버튼 여덟에 구분선까지 353px라
// 폰 폭(사용 가능 ~354px)에 여백이 0이 된다. 도구 줄에는 삽입 진입(＋) 하나만
// 두고, 누르면 [‹ 뒤로][메모][이미지][연결선][영역]으로 밀려 들어온다(펜 메뉴와
// 같은 문법). 삽입하면 도구 목록으로 돌아온다 — 방금 만든 것을 바로 만진다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import { FLOAT_SHADOW, accentGradient, glassCard } from '../chrome';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { HL_COLORS, HL_WIDTHS, PEN_COLORS, PEN_WIDTHS } from '../boardTools';
import type { BoardTool } from '../boardTools';

/** 폰에서 도구 막대가 차지하는 높이 + 여백 — 줌·미니맵 묶음(`ZoomControls`)과
 * 실행취소 알약이 이만큼 위로 올라가 막대와 겹치지 않는다. 버튼 44 + 패딩 10 +
 * 테두리 2 = 56, 바닥 여백 16, 사이 8. */
export const BOARD_BAR_LIFT = 80;

/** 도구 목록 ↔ 펜 메뉴 밀어내기 전환 길이(ms) — editor.css의 키프레임과 같은 값. */
const PANEL_ANIM_MS = 200;

/** 폰 막대가 지금 보여 주는 층. 'tools'가 집이고 나머지는 그 위에서 열린다. */
type BoardPanel = 'tools' | 'draw' | 'insert';

export function BoardToolbar({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const tool = controller.boardTool;
  const isMobile = useIsMobile();
  // 폰에서 막대가 지금 무엇을 보여 주는가 — 도구 목록 / 펜 옵션 / 삽입.
  const [panel, setPanel] = useState<BoardPanel>('tools');
  // 전환 애니메이션 — 나가는 층이 무엇인지. 그 층을 잠깐 더 그려야 "밀려 나가는"
  // 모습이 보인다. null이면 전환 아님.
  const [leaving, setLeaving] = useState<BoardPanel | null>(null);
  // 펜·형광펜 옵션 팝오버의 **꼬리**가 그 도구 버튼을 가리키게 — 알약 중심에서
  // 얼마나 벗어났는지를 재서 옮긴다(도구가 늘어도 값을 손으로 고칠 일이 없다).
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeToolRef = useRef<HTMLButtonElement | null>(null);
  const [tailDx, setTailDx] = useState(0);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchPanel = useCallback(
    (next: BoardPanel) => {
      if (panel === next) return;
      setPanel(next);
      setLeaving(panel);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        setLeaving(null);
      }, PANEL_ANIM_MS);
    },
    [panel],
  );
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const btn = activeToolRef.current;
    if (!shell || !btn) return;
    const s = shell.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const dx = Math.round(b.left + b.width / 2 - (s.left + s.width / 2));
    setTailDx((cur) => (cur === dx ? cur : dx));
  });
  useEffect(() => {
    // 색·굵기가 딸린 도구(펜·형광펜)에서 벗어나면 옵션 메뉴는 저절로 닫힌다.
    if (tool !== 'pen' && tool !== 'hl') setPanel((cur) => (cur === 'draw' ? 'tools' : cur));
  }, [tool]);

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

  // 디자인 원본: 알약 안의 **원형 버튼**(38px). 폰은 44px 터치 타깃.
  const size = isMobile ? 44 : 38;
  const btnBase = {
    width: size,
    height: size,
    border: 'none',
    borderRadius: 999,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  } as const;

  // 켜진 도구는 **강조색 그라디언트 + 아래 점**(디자인 원본) — 옅은 틴트보다
  // 지금 무엇으로 캔버스를 만지는지가 멀리서도 읽힌다.
  const toolBtn = (key: BoardTool, label: string, hint: string, icon: JSX.Element) => {
    const on = tool === key;
    return (
      <button
        key={key}
        ref={on ? activeToolRef : undefined}
        type="button"
        className="mf-ed-btn"
        aria-label={label}
        aria-pressed={on}
        title={`${label} (${hint})`}
        onClick={() => {
          controller.setBoardTool(key);
          // 폰: 펜·형광펜은 색·굵기가 딸린 도구라 누르는 순간 그 메뉴로 전환한다.
          if (isMobile) switchPanel(key === 'pen' || key === 'hl' ? 'draw' : 'tools');
        }}
        style={{ ...btnBase, background: on ? accentGradient(th) : 'transparent', color: on ? th.accentInk : th.subtext }}
      >
        {icon}
        {on && <span aria-hidden style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: 999, background: th.accentInk }} />}
      </button>
    );
  };

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
  const divider = (key: string) => <div key={key} style={{ width: 1, height: 24, alignSelf: 'center', margin: isMobile ? 0 : '0 3px', background: th.border }} />;

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
      'hl',
      '형광펜',
      'H',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* 굵은 심의 마커 — 펜(가는 촉)과 실루엣으로 구별된다 */}
        <path d="M15.5 3.5 20.5 8.5 11 18H6v-5z" />
        <path d="M13 6 18 11" />
        <path d="M3.5 21.5h9" />
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

  // 삽입 — 화이트보드가 담을 수 있는 것들(메모·이미지·연결선·영역). 그리기 도구가
  // 켜져 있어도 누를 수 있고, 누르면 선택 도구로 돌아온다(방금 만든 것을 바로 만진다).
  const insert = (run: () => void) => () => {
    controller.setBoardTool('select');
    switchPanel('tools'); // 폰: 삽입 메뉴를 열어 골랐으면 도구 목록으로 돌아온다
    run();
  };
  const inserts = [
    actionBtn(
      '메모 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 4h14a1 1 0 0 1 1 1v9.5L14.5 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M20 14.5h-4.5a1 1 0 0 0-1 1V20" />
      </svg>,
      insert(controller.addFloatAt),
    ),
    actionBtn(
      '이미지 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="8.8" cy="10" r="1.5" />
        <path d="m4.5 17 5-5 3.5 3.5 3-3 4 4.5" />
      </svg>,
      insert(controller.promptAddImage),
    ),
    actionBtn(
      '연결선 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* 화살표 달린 연결선 — 삽입 메뉴(ToolbarMenus)의 LineIcon과 같은 도형 */}
        <path d="M4 19 20 5" />
        <path d="M13.5 5H20v6.5" />
      </svg>,
      insert(controller.addLineAt),
    ),
    actionBtn(
      '영역 추가',
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" strokeDasharray="3.4 2.6" />
      </svg>,
      insert(controller.addZoneAt),
    ),
    // 댓글 핀 — 다른 객체와 같은 줄에서 만든다(요청). 꽂으면 그 핀의 팝업이 열린다.
    ...(controller.canComment
      ? [
          actionBtn(
            '댓글 추가',
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6a8 8 0 0 1 8-8h1a8 8 0 0 1 8 3z" />
              <path d="M8.5 11.5h7M8.5 14.5h4" />
            </svg>,
            insert(controller.addCommentPinAt),
          ),
        ]
      : []),
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

  // 색·굵기 UI는 펜과 형광펜이 함께 쓴다 — 지금 켜진 도구의 값만 갈아 끼운다
  // (설정은 도구별로 따로 기억된다: 형광펜을 한 번 쓴 뒤 펜이 노란 20px이 되면 안 된다).
  const drawing = tool === 'hl' ? 'hl' : 'pen';
  const curColor = drawing === 'hl' ? controller.hlColor : controller.penColor;
  const curWidth = drawing === 'hl' ? controller.hlWidth : controller.penWidth;
  const setColor = drawing === 'hl' ? controller.setHlColor : controller.setPenColor;
  const setWidth = drawing === 'hl' ? controller.setHlWidth : controller.setPenWidth;
  const colorLabel = drawing === 'hl' ? '형광펜' : '펜';

  const colorBtns = (drawing === 'hl' ? HL_COLORS : PEN_COLORS).map((c) => (
    <button
      key={c}
      type="button"
      aria-label={`${colorLabel} 색 ${c}`}
      aria-pressed={curColor === c}
      onClick={() => setColor(c)}
      style={{
        width: isMobile ? 26 : 20,
        height: isMobile ? 26 : 20,
        borderRadius: '50%',
        background: c,
        border: `2px solid ${curColor === c ? th.accent : 'transparent'}`,
        boxShadow: 'inset 0 0 0 1px rgba(46,42,38,.1)',
        cursor: 'pointer',
        padding: 0,
        margin: '0 2px',
        flexShrink: 0,
      }}
    />
  ));

  const widthBtns = (drawing === 'hl' ? HL_WIDTHS : PEN_WIDTHS).map((w) => (
    <button
      key={w}
      type="button"
      aria-label={`${colorLabel} 굵기 ${w}`}
      aria-pressed={curWidth === w}
      onClick={() => setWidth(w)}
      style={{
        width: isMobile ? 34 : 32,
        height: isMobile ? 30 : 26,
        border: 'none',
        borderRadius: 8,
        background: curWidth === w ? hexA(th.accent, 0.14) : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      {/* 형광펜 심은 12~30px이라 그대로 그리면 버튼을 넘는다 — 비율만 보이게 줄인다. */}
      <span style={{ width: 14, height: drawing === 'hl' ? Math.round(w / 4) : w, minHeight: 2, borderRadius: 99, background: curWidth === w ? th.accent : th.subtext, display: 'block' }} />
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
    ...glassCard(th, 0.96),
    // 디자인 원본의 **알약**: 버튼(38·44) + 패딩 7 만큼의 반지름이면 완전한 알약이 된다.
    borderRadius: 999,
    boxShadow: FLOAT_SHADOW,
  };

  // 폰 막대의 두 층 — 도구 목록(선택·펜·지우개 | 메모·이미지)과 펜 메뉴.
  // 아이콘 간격은 `space-evenly`라 양 끝 여백까지 균일하고, 구분선은 그 간격
  // 규칙 안의 한 항목이라 "도구"와 "삽입"이 눈으로 갈린다(요청).
  const backBtn = (
    <button
      type="button"
      className="mf-ed-btn"
      aria-label="도구 목록으로"
      title="도구 목록으로"
      onClick={() => switchPanel('tools')}
      style={{ ...btnBase, background: hexA(th.accent, 0.14), color: th.accent }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5 8 12l7 7" />
      </svg>
    </button>
  );
  const toolMenu = (
    <>
      {tools}
      {divider('dm')}
      {/* 삽입 진입 — 넷을 한 줄에 늘어놓으면 폰 폭이 모자란다(파일 머리 설명). */}
      <button
        type="button"
        className="mf-ed-btn"
        aria-label="삽입"
        title="삽입 (메모·이미지·연결선·영역)"
        onClick={() => switchPanel('insert')}
        style={{ ...btnBase, background: 'transparent', color: th.subtext }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </>
  );
  const penMenu = (
    <>
      {backBtn}
      {/* 색이 여덟이 되면서 폰 한 줄에 다 들어가지 않는다(실측 390px에서 넘침) —
          색 묶음만 **가로로 스크롤**한다. 굵기와 ‹는 자리를 지켜 늘 눌린다.
          `.mf-ed-vp`가 `touch-action: none`이라 그대로 두면 손가락 스크롤이
          먹지 않는다 — 이 묶음에서만 `pan-x`로 되살린다. */}
      <div className="mf-noscrollbar" style={{ ...rowStyle, flex: '1 1 auto', minWidth: 0, overflowX: 'auto', touchAction: 'pan-x' }}>
        {colorBtns}
      </div>
      <div style={{ ...rowStyle, gap: 2, padding: 2, borderRadius: 10, background: th.panel2, flexShrink: 0 }}>{widthBtns}</div>
    </>
  );
  const insertMenu = (
    <>
      {backBtn}
      {inserts}
    </>
  );
  const menuOf = (p: BoardPanel) => (p === 'draw' ? penMenu : p === 'insert' ? insertMenu : toolMenu);
  const layerStyle = (p: BoardPanel): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    // 펜 메뉴만 양 끝으로 벌린다(색·굵기가 묶음이라 균등 배치가 어색하다).
    justifyContent: p === 'draw' ? 'space-between' : 'space-evenly',
  });

  if (isMobile) {
    return (
      <>
        {/* 되돌리기 묶음 — 도구가 아니라 "방금 한 일"을 다루므로 막대에서 떼어
            위 띠 왼쪽에 둔다(시안). 오른쪽 같은 띠에는 줌·미니맵 묶음이 선다. */}
        <div data-board-undo style={{ ...shell, left: 12, bottom: BOARD_BAR_LIFT, display: 'flex', alignItems: 'center', padding: 5 }} {...stopDrag}>
          {undoRedo[0]}
          {divider('du')}
          {undoRedo[1]}
        </div>

        <div
          data-board-toolbar
          data-board-panel={panel}
          data-pen-panel={panel === 'draw' ? 'true' : undefined}
          style={{ ...shell, left: 12, right: 12, bottom: 16, padding: 6 }}
          {...stopDrag}
        >
          {/* 전환은 **밀어내기**(요청): 하위 메뉴(펜·삽입)를 열면 오른쪽에서 들어오고
              도구 목록은 왼쪽으로 나가고, ‹로 돌아오면 반대. 나가는 쪽을 잠깐 더
              그려야 하므로 두 층을 겹쳐 놓는다 — 그래서 높이를 고정한다(버튼 높이). */}
          <div style={{ position: 'relative', height: size, overflow: 'hidden' }}>
            <div key={panel} className={leaving === null ? undefined : panel === 'tools' ? 'mf-board-in-left' : 'mf-board-in-right'} style={layerStyle(panel)}>
              {menuOf(panel)}
            </div>
            {leaving !== null && (
              <div aria-hidden className={leaving === 'tools' ? 'mf-board-out-left' : 'mf-board-out-right'} style={{ ...layerStyle(leaving), pointerEvents: 'none' }}>
                {menuOf(leaving)}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div ref={shellRef} data-board-toolbar style={{ ...shell, left: '50%', transform: 'translateX(-50%)', bottom: 22, display: 'flex', alignItems: 'center', gap: 5, padding: 7, maxWidth: 'calc(100vw - 24px)' }} {...stopDrag}>
      {tools}
      {divider('d1')}
      {inserts}
      {divider('d2')}
      {undoRedo}

      {/* 색·굵기는 막대에 줄을 더하지 않고 **위에 뜬 팝오버**로(디자인 원본) —
          꼬리가 지금 켜진 도구를 가리키므로 무엇의 설정인지 헷갈리지 않는다. */}
      {(tool === 'pen' || tool === 'hl') && (
        <div
          data-stroke-popover
          className="mf-board-rise"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '100%',
            marginBottom: 10,
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '9px 16px',
            borderRadius: 20,
            ...glassCard(th, 0.97),
            boxShadow: '0 18px 38px -22px rgba(46,42,38,.5)',
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              bottom: -5,
              width: 10,
              height: 10,
              transform: `translateX(calc(-50% + ${tailDx}px)) rotate(45deg)`,
              background: th.panel,
              borderRight: `1px solid ${th.border}`,
              borderBottom: `1px solid ${th.border}`,
              display: 'block',
            }}
          />
          <div style={rowStyle}>{colorBtns}</div>
          <div style={{ width: 1, height: 20, background: th.border }} />
          <div style={rowStyle}>{widthBtns}</div>
        </div>
      )}
    </div>
  );
}
