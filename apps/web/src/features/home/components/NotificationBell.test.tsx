import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { readLocalNotifications, writeLocalNotifications, type StoredNotification } from '../../../adapters/local/localNotifications';

// 홈 알림 센터(0022의 로컬 짝) — 벨 배지·열기=읽음 처리·항목 클릭=딥링크.

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <NotificationBell />
              <LocationProbe />
            </>
          }
        />
        <Route path="/editor" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
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
});
afterEach(() => cleanup());

describe('알림 센터', () => {
  it('안 읽은 개수 배지가 뜨고, 열면 목록이 보이며 전부 읽음 처리된다', async () => {
    seed([{}, { kind: 'share', preview: '', nodeId: null }, { readAt: '2026-01-01T00:00:00.000Z' }]);
    renderBell();
    const bell = await screen.findByRole('button', { name: '알림 2개' });
    expect(within(bell).getByText('2')).toBeTruthy();

    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    // 멘션 2(안 읽음 1 + 읽음 1) + 공유 1 — 읽은 것도 목록에는 남는다(기록).
    expect(within(panel).getAllByText(/홍길동님이 회원님을 멘션했어요/)).toHaveLength(2);
    expect(within(panel).getByText(/홍길동님이 맵을 공유했어요/)).toBeTruthy();
    // 열었으면 본 것 — 저장소가 읽음 처리되고 배지가 사라진다.
    await waitFor(() => expect(readLocalNotifications().every((n) => !!n.readAt)).toBe(true));
    expect(screen.queryByText('2')).toBeNull();
    // 방금 읽은 항목은 패널이 열려 있는 동안 점으로 남는다(2개 = 이번에 새로 본 것만).
    expect(panel.querySelectorAll('[data-notification-fresh]')).toHaveLength(2);
  });

  it('댓글류 알림을 누르면 그 주제의 댓글로 딥링크된다 (?comments=)', async () => {
    seed([{ kind: 'reply', documentId: 'd9', nodeId: 'topic7' }]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: '알림 1개' }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    fireEvent.click(within(panel).getByText(/답글을 남겼어요/));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/editor?map=d9&comments=topic7'));
  });

  it('공유 알림은 맵으로만 간다, 알림이 없으면 빈 안내', async () => {
    seed([{ kind: 'share', documentId: 'd3', nodeId: null, preview: '' }]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: '알림 1개' }));
    fireEvent.click(screen.getByText(/맵을 공유했어요/));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/editor?map=d3'));
  });

  it('알림이 없으면 배지 없이 빈 안내가 뜬다', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: '알림' });
    fireEvent.click(bell);
    expect(await screen.findByText(/새 알림이 없어요/)).toBeTruthy();
  });

  it('홈을 켜 둔 채 새 알림이 오면 벨을 누르지 않아도 배지가 선다(주기 확인, 제보)', async () => {
    vi.useFakeTimers();
    try {
      renderBell();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('button', { name: '알림' })).toBeTruthy();
      // 홈에 머무는 동안 다른 곳(협업 상대)에서 알림이 만들어진다.
      seed([{}]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const bell = screen.getByRole('button', { name: '알림 1개' });
      expect(within(bell).getByText('1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
