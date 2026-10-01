import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MobileNotificationsPage } from './MobileNotificationsPage';
import { NotificationsProvider } from '../components/NotificationsContext';
import { readLocalNotifications, writeLocalNotifications, type StoredNotification } from '../../../adapters/local/localNotifications';
import { __resetUpdateControl } from '../../../pwa/updateControl';

// 모바일 「알림」 탭 — 데스크톱 알림 창과 같은 규칙(열면 읽음 · 방금 읽은 것은 점) + 거르기.

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderPage(onOpenVersion: () => void = vi.fn()) {
  return render(
    <NotificationsProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MobileNotificationsPage onOpenVersion={onOpenVersion} />} />
          <Route path="/editor" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </NotificationsProvider>,
  );
}

function seed(rows: Partial<StoredNotification>[]): void {
  writeLocalNotifications(
    rows.map((r, i) => ({
      id: `n${i + 1}`,
      recipientEmail: 'me@example.com',
      kind: 'mention',
      documentId: 'd1',
      nodeId: 'x1',
      actorName: '홍길동',
      preview: '확인 부탁',
      docTitle: '분기 계획',
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      readAt: null,
      ...r,
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  __resetUpdateControl();
});
afterEach(() => {
  cleanup();
  __resetUpdateControl();
});

describe('모바일 알림 탭', () => {
  it('들어오면 전부 읽음 처리하고, 방금 읽은 것은 점으로 남긴다', async () => {
    seed([{ id: 'n1' }, { id: 'n2', kind: 'share', nodeId: null, preview: '', actorName: '김서연' }]);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-notification-item]').length).toBe(2));
    await waitFor(() => expect(readLocalNotifications().every((n) => n.readAt)).toBe(true));
    expect(container.querySelectorAll('[data-notification-fresh]').length).toBe(2);
    expect(container.querySelector('[data-m-noti-eyebrow]')!.textContent).toBe('안 읽음 2');
    // 사람 중심 문장 — 이름이 굵게 앞에 선다.
    expect(container.querySelector('[data-notification-item="mention"] b')!.textContent).toBe('홍길동');

    fireEvent.click(screen.getByRole('button', { name: '모두 읽음' }));
    expect(container.querySelectorAll('[data-notification-fresh]').length).toBe(0);
    expect(container.querySelector('[data-m-noti-eyebrow]')!.textContent).toBe('모두 읽었어요');
  });

  it('거르기 — 멘션(댓글·답글 포함) · 공유 · 일정', async () => {
    seed([
      { id: 'n1', kind: 'mention' },
      { id: 'n2', kind: 'reply' },
      { id: 'n3', kind: 'share', nodeId: null, preview: '' },
    ]);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-notification-item]').length).toBe(3));
    const tab = (k: string) => container.querySelector(`[data-m-noti-filter="${k}"]`) as HTMLElement;
    expect(tab('mention').textContent).toBe('멘션2');
    expect(tab('share').textContent).toBe('공유1');
    expect(tab('cal').textContent).toBe('일정0');

    fireEvent.click(tab('share'));
    expect(tab('share').getAttribute('aria-selected')).toBe('true');
    expect([...container.querySelectorAll('[data-notification-item]')].map((b) => b.getAttribute('data-notification-item'))).toEqual(['share']);
    fireEvent.click(tab('cal'));
    expect(screen.getByText('일정 알림이 없어요.')).toBeTruthy();
  });

  it('항목을 누르면 그 문서의 그 댓글로 간다', async () => {
    seed([{ id: 'n1', documentId: 'doc-9', nodeId: 'node-3' }]);
    const { container } = renderPage();
    const item = await waitFor(() => {
      const el = container.querySelector('[data-notification-item]');
      if (!el) throw new Error('no item');
      return el as HTMLElement;
    });
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/editor?map=doc-9&comments=node-3'));
  });
});
