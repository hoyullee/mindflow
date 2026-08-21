import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackModal } from './FeedbackModal';
import { BackendProvider } from '../adapters/BackendContext';
import type { Backend, FeedbackEntry } from '../adapters/ports';

// 피드백 모달 — 카테고리 선택 + 본문을 FeedbackStore 포트로 제출한다.
// 홈/에디터가 함께 쓰고, 로컬(데모) 모드에서는 실제 전송이 아님을 안내한다.

function backendWith(mode: 'local' | 'supabase', submit = vi.fn(async (entry: FeedbackEntry) => ({ ok: !!entry }) as { error?: string })) {
  return {
    backend: { feedbackStore: { submit }, mode } as unknown as Backend,
    submit,
  };
}

function renderModal(backend: Backend, onClose = vi.fn()) {
  const utils = render(
    <BackendProvider backend={backend}>
      <FeedbackModal open onClose={onClose} page="home" />
    </BackendProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('FeedbackModal', () => {
  it('카테고리와 내용을 포트로 제출하고 완료 화면을 띄운다', async () => {
    const { backend, submit } = backendWith('supabase');
    renderModal(backend);
    fireEvent.click(screen.getByRole('button', { name: '오류 제보' }));
    fireEvent.change(screen.getByLabelText('피드백 내용'), { target: { value: '메모가 이상해요' } });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.getByText('전달됐어요, 고마워요!')).toBeTruthy());
    // 완료 배지는 이모지가 아니라 SVG 아이콘이다(요청 — 플랫폼 무관 렌더).
    expect(document.querySelector('[data-done-icon] svg')).toBeTruthy();
    const entry = submit.mock.calls[0]![0];
    expect(entry).toMatchObject({ category: 'bug', message: '메모가 이상해요', page: 'home' });
    expect(entry.meta).toMatchObject({ build: expect.any(String), ua: expect.any(String) });
  });

  it('빈 내용은 제출하지 않고 알려 준다', async () => {
    const { backend, submit } = backendWith('supabase');
    renderModal(backend);
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('제출 실패면 오류를 보여주고 입력을 유지한다 (재시도 가능)', async () => {
    const submit = vi.fn(async (entry: FeedbackEntry) => ({ error: entry ? '전송에 실패했어요.' : '' }));
    const { backend } = backendWith('supabase', submit);
    renderModal(backend);
    fireEvent.change(screen.getByLabelText('피드백 내용'), { target: { value: '내용' } });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.getByText('전송에 실패했어요.')).toBeTruthy());
    expect((screen.getByLabelText('피드백 내용') as HTMLTextAreaElement).value).toBe('내용');
  });

  it('로컬(데모) 모드에는 실제 전송이 아님을 안내한다', () => {
    const { backend } = backendWith('local');
    renderModal(backend);
    expect(screen.getByText(/데모 모드예요/)).toBeTruthy();
  });

  it('Esc·배경 클릭으로 닫힌다', async () => {
    const { backend } = backendWith('supabase');
    const { onClose } = renderModal(backend);
    // 모달은 Radix Dialog가 body로 포털한다 — 키는 document에서 듣고, 막(dim)은
    // 오버레이 요소다(예전에는 dim div가 곧 컨테이너의 자식이었다).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // 바깥 클릭 판정은 pointerdown 뒤의 **click**에서 확정된다(끌다가 밖에서 손을
    // 떼는 것을 닫힘으로 읽지 않으려는 규칙). 리스너 등록도 한 틱 뒤다.
    const overlay = await waitFor(() => {
      const el = document.querySelector('[data-modal-overlay]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    await new Promise((r) => setTimeout(r, 0));
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1, configurable: true });
    fireEvent(overlay, down);
    fireEvent.click(overlay);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
