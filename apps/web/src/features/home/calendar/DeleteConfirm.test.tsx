/**
 * 삭제 확인 팝업의 계약(요청) — 일정 상세·칸반 카드 상세가 함께 쓴다.
 *
 * 이 팝업이 지켜야 하는 것은 셋이다: 초점이 **취소**에 간다 · 지우는 중에는 진행을
 * 보여 주고 두 버튼이 잠긴다 · 지우는 중에는 닫히지 않는다(같은 삭제가 두 번 나가면
 * 두 번째는 없는 것을 지우려 한다).
 */

import { render, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeleteConfirm } from './DeleteConfirm';

describe('삭제 확인 팝업', () => {
  // 이 저장소의 vitest는 `globals`를 쓰지 않아 RTL 자동 정리가 돌지 않는다 —
  // 포털이 body에 남아 다음 테스트의 `document.querySelector`가 앞 판을 집는다.
  afterEach(cleanup);

  it('초점은 취소에 가고, 확인 버튼이 삭제를 시작한다', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirm title="일정을 삭제할까요?" body="되돌릴 수 없어요." isMobile={false} deleting={false} onCancel={() => {}} onConfirm={onConfirm} />);
    const card = document.querySelector('[data-delete-confirm]')!;
    expect(card.textContent).toContain('되돌릴 수 없어요');
    // 파괴적 버튼이 기본 초점이면 Enter 한 번에 지워진다.
    expect(document.activeElement).toBe(document.querySelector('[data-confirm-cancel]'));
    fireEvent.click(document.querySelector('[data-confirm-delete]')!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('지우는 중에는 스피너가 뜨고 두 버튼이 잠긴다', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteConfirm title="일정을 삭제할까요?" body="되돌릴 수 없어요." isMobile={false} deleting onCancel={onCancel} onConfirm={onConfirm} />);
    const note = document.querySelector('[data-deleting]') as HTMLElement;
    expect(note.textContent).toContain('삭제 중');
    expect((note.firstElementChild as HTMLElement).style.animation).toContain('mf-spin');
    expect((document.querySelector('[data-confirm-cancel]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-confirm-delete]') as HTMLButtonElement).disabled).toBe(true);
    // Escape로도 닫히지 않는다 — 요청은 이미 나갔다.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
