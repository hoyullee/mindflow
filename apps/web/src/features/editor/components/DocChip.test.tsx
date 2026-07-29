// 독칩의 저장 충돌 안내 — 제보 2건의 회귀 가드.
// ① 좁은 칩 폭에서 문구가 말줄임으로 잘려 읽을 수 없었다 → 전광판(마퀴)으로 전체
//    문장이 흐른다. ② 안내 줄이 붙으면 칩이 높아져 그림자가 속성 패널을 침범했다
//    → 그동안 패널이 내려간다(panelWrapStyle의 lowered — 별도 describe).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UI_THEME } from '../theme';
import type { EditorController } from '../useEditorState';
import { DocChip } from './DocChip';
import { panelWrapStyle } from './panel/panelPrimitives';

function stub(over: Partial<{ saveConflict: { currentVersion: number } | null }>): EditorController {
  return {
    uiTheme: UI_THEME,
    docTitle: '테스트 맵',
    saveState: 'saved',
    editingTitle: false,
    saveConflict: over.saveConflict ?? null,
    goHome: vi.fn(),
    saveNow: vi.fn(),
    startEditTitle: vi.fn(),
    dismissSaveConflict: vi.fn(),
  } as unknown as EditorController;
}

afterEach(cleanup);

describe('DocChip 저장 충돌 안내', () => {
  it('충돌이 없으면 안내가 없다', () => {
    render(<DocChip controller={stub({})} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('전체 문장이 전광판으로 렌더된다 — 말줄임으로 잘리지 않는다', () => {
    render(<DocChip controller={stub({ saveConflict: { currentVersion: 7 } })} />);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('mf-marquee');
    // 전체 문장(버전 포함)이 DOM에 있다 — 마퀴가 흐르며 다 보여 준다
    expect(alert.textContent).toContain('다른 기기/탭에서 먼저 저장됨 (v7) — 최신 버전을 기준으로 이어서 저장해요');
    // 이음매 없는 루프용 복제는 시각 전용이어야 한다(스크린리더가 두 번 읽지 않게)
    const copies = alert.querySelectorAll('.mf-marquee-run > span');
    expect(copies).toHaveLength(2);
    expect(copies[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(copies[0]!.textContent).toBe(copies[1]!.textContent);
  });

  it('클릭하면 닫힌다 (기존 동작 유지)', () => {
    const controller = stub({ saveConflict: { currentVersion: 2 } });
    render(<DocChip controller={controller} />);
    fireEvent.click(screen.getByRole('alert'));
    expect(controller.dismissSaveConflict).toHaveBeenCalled();
  });
});

describe('속성 패널 오프셋 (독칩이 높아진 동안)', () => {
  it('평소에는 top 80, 충돌 안내가 떠 있으면 98로 내려가 칩 그림자와 겹치지 않는다', () => {
    expect(panelWrapStyle(UI_THEME, false).top).toBe(80);
    expect(panelWrapStyle(UI_THEME, false, true).top).toBe(98);
    // 아래 여백 예약도 함께 이동 — 내려간 만큼 최대 높이가 줄어야 화면 밖으로 안 나간다
    expect(panelWrapStyle(UI_THEME, false).maxHeight).toBe('calc(100% - 158px)');
    expect(panelWrapStyle(UI_THEME, false, true).maxHeight).toBe('calc(100% - 176px)');
  });

  it('모바일 바텀시트는 영향받지 않는다', () => {
    expect(panelWrapStyle(UI_THEME, true, true).bottom).toBe(0);
    expect(panelWrapStyle(UI_THEME, true, true).top).toBeUndefined();
  });
});
