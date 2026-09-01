// 공용 `Modal`(Radix Dialog) 계약 — 이 파일이 지키는 것은 **행동**이다. 예전에는
// 모달 열두 개가 각자 손으로 짰고, 그래서 파일마다 빠진 것이 달랐다:
// `aria-modal`이 없거나(18개 중 7개만 있었다), 초점이 카드 밖으로 새거나, 닫아도
// 초점이 어디로 갈지 정해져 있지 않거나, 닫힌 채 `display: none`으로 DOM에 남거나.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, useCardMorph } from './Modal';

afterEach(cleanup);

function Harness({ dismissOnBackdrop = true, onClose = () => {} }: { dismissOnBackdrop?: boolean; onClose?: () => void }) {
  return (
    <>
      <button data-outside>바깥 버튼</button>
      <Modal open onClose={onClose} label="시험 모달" dismissOnBackdrop={dismissOnBackdrop}>
        <>
          <button data-first>첫 버튼</button>
          <button data-last>끝 버튼</button>
        </>
      </Modal>
    </>
  );
}

describe('Modal (Radix Dialog)', () => {
  it('role·이름·aria-modal이 붙고, 내용은 body로 포털된다', () => {
    const { container } = render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: '시험 모달' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // 카드는 컨테이너 밖(body)에 그려진다 — 그래서 배경 z-index·overflow에 갇히지 않는다.
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('초점이 카드 안으로 들어가고 Tab이 카드를 벗어나지 않는다(초점 트랩)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: '시험 모달' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // 끝 버튼에서 한 번 더 Tab → 카드 안 첫 버튼으로 돌아온다(바깥 버튼으로 새지 않는다).
    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.outside).toBeUndefined();
  });

  it('닫으면 초점이 열기 전 자리로 돌아온다', async () => {
    const onClose = vi.fn();
    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-open onClick={() => setOpen(true)}>
            열기
          </button>
          <Modal
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            label="시험 모달"
          >
            <button data-inside>안 버튼</button>
          </Modal>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Toggle />);
    const opener = document.querySelector('[data-open]') as HTMLElement;
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '시험 모달' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '시험 모달' })).toBeNull());
    // 열기 전 초점 자리로 복귀 — Radix 기본은 `Dialog.Trigger`를 찾는데 우리 모달은
    // 메뉴·행·단축키에서 열려 트리거가 없다(그때 초점이 body로 떨어진다).
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('닫히면 DOM에서 사라진다 — 닫힌 모달이 남아 접근성 트리·조회에 걸리지 않는다', async () => {
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button data-close onClick={() => setOpen(false)}>
            닫기 트리거
          </button>
          <Modal open={open} onClose={() => setOpen(false)} label="시험 모달">
            <span>내용</span>
          </Modal>
        </>
      );
    }
    render(<Toggle />);
    expect(screen.getByRole('dialog', { name: '시험 모달' })).toBeTruthy();
    fireEvent.click(document.querySelector('[data-close]') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '시험 모달' })).toBeNull());
    expect(screen.queryByText('내용')).toBeNull();
  });

  it('dismissOnBackdrop=false면 막 클릭으로 닫히지 않는다(Escape는 닫힌다)', async () => {
    const onClose = vi.fn();
    render(<Harness dismissOnBackdrop={false} onClose={onClose} />);
    const overlay = document.querySelector('[data-modal-overlay]') as HTMLElement;
    await new Promise((r) => setTimeout(r, 0));
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1, configurable: true });
    fireEvent(overlay, down);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // 제보(#6) — 새 일정 팝업이 "커졌다가 줄어드는" 리사이즈: 릴리스가 인라인 폭을 ''로
  // 지워 React가 준 폭(560/900/'100%')이 DOM에서 사라지고 카드가 내용 폭으로
  // 주저앉았다(실측 900 → 804). 릴리스는 React의 값을 **되살려야** 한다.
  it('useCardMorph — 전이가 끝나면 React의 인라인 폭을 되살린다(빈 값으로 지우지 않는다)', () => {
    vi.useFakeTimers();
    let notify: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb; }
      observe() {}
      disconnect() {}
    });
    function Probe() {
      const ref = useCardMorph();
      return <div ref={ref} data-morph style={{ width: 900 }} />;
    }
    const { container } = render(<Probe />);
    const el = container.querySelector('[data-morph]') as HTMLElement;
    // jsdom엔 레이아웃이 없어 실측을 흉내낸다 — 첫 관측 560, 목적지 전환 후 900.
    const size = { w: 560, h: 400 };
    Object.defineProperty(el, 'offsetWidth', { get: () => size.w });
    Object.defineProperty(el, 'offsetHeight', { get: () => size.h });
    notify!(); // 첫 관측 — 기준 크기만 기억한다
    size.w = 900;
    size.h = 500;
    notify!(); // 크기 변화 — 이전 크기에서 새 크기로 전이
    expect(el.style.width).toBe('900px'); // 목표로 가는 중
    vi.advanceTimersByTime(300); // 릴리스(280ms) 뒤
    expect(el.style.width).toBe('900px'); // ''가 아니다 — React의 폭이 살아 있다
    expect(el.style.transition).toBe('');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
