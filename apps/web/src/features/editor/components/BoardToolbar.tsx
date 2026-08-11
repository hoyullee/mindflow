// 화이트보드 도구 막대(M4) — 캔버스 하단 중앙의 알약(Excalidraw류 관례).
// GNB 툴바에 넣지 않은 이유: 모바일 툴바는 이미 꽉 차 있고, 그리기 도구는
// "지금 캔버스를 어떤 손으로 만지는가"라 캔버스에 붙어 있는 것이 읽기 쉽다.
// 펜이 켜지면 색·굵기 선택이 같은 알약 안에 늘어난다.

import { useEffect } from 'react';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';

const PEN_COLORS = ['#2b2b2b', '#d92626', '#2f7fd6', '#2f9e63', '#e0a53c'];
const PEN_WIDTHS = [2, 4, 8];

export function BoardToolbar({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const tool = controller.boardTool;

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

  const toolBtn = (key: 'select' | 'pen' | 'eraser', label: string, icon: JSX.Element) => (
    <button
      key={key}
      type="button"
      className="mf-ed-btn"
      aria-label={label}
      aria-pressed={tool === key}
      title={label}
      onClick={() => controller.setBoardTool(key)}
      style={{
        width: 36,
        height: 36,
        border: 'none',
        borderRadius: 9,
        background: tool === key ? hexA(th.accent, 0.14) : 'transparent',
        color: tool === key ? th.accent : th.subtext,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      {icon}
    </button>
  );

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
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 16,
        zIndex: 120, // 그리기 오버레이(110)보다 위 — 그리는 중에도 도구를 바꾼다
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 5,
        borderRadius: 12,
        background: th.panel,
        border: `1px solid ${th.border}`,
        boxShadow: '0 8px 24px rgba(0,0,0,.14)',
      }}
    >
      {toolBtn(
        'select',
        '선택',
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 3l14 8-6.5 1.5L9 19z" />
        </svg>,
      )}
      {toolBtn(
        'pen',
        '펜',
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
        </svg>,
      )}
      {toolBtn(
        'eraser',
        '지우개',
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 20H8.5l-5-5a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L13 18.5" />
        </svg>,
      )}
      {tool === 'pen' && (
        <>
          <div style={{ width: 1, alignSelf: 'stretch', margin: '4px 3px', background: th.border }} />
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`펜 색 ${c}`}
              aria-pressed={controller.penColor === c}
              onClick={() => controller.setPenColor(c)}
              style={{
                width: 20,
                height: 20,
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
          <div style={{ width: 1, alignSelf: 'stretch', margin: '4px 3px', background: th.border }} />
          {PEN_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`펜 굵기 ${w}`}
              aria-pressed={controller.penWidth === w}
              onClick={() => controller.setPenWidth(w)}
              style={{
                width: 26,
                height: 26,
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
        </>
      )}
    </div>
  );
}
