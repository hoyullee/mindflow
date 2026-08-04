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

  it('Esc·배경 클릭으로 닫힌다', () => {
    const { backend } = backendWith('supabase');
    const { onClose, container } = renderModal(backend);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-feedback-modal]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
