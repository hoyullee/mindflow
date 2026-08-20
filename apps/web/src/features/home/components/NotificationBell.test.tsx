import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { pushLocalNotification, readLocalNotifications, writeLocalNotifications, type StoredNotification } from '../../../adapters/local/localNotifications';

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
  it('패널은 펼침·접힘 애니메이션을 그린다 — 닫아도 잠깐 마운트가 남는다(요청)', async () => {
    seed([{ id: 'n1' }]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /알림/ });

    fireEvent.click(bell);
    const panel = () => document.querySelector('[data-notification-panel]') as HTMLElement | null;
    expect(panel()!.className).toContain('is-in');

    // 닫으면 곧바로 사라지지 않는다 — 그러지 않으면 나가는 애니메이션을 그릴 것이 없다.
    fireEvent.click(bell);
    expect(panel()!.className).toContain('is-out');
    // 애니메이션이 끝나면 정리된다.
    await waitFor(() => expect(panel()).toBeNull());
  });

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

  it('패널은 다듬은 스크롤바 클래스(.notif-scroll)를 쓰고, 모바일 벨은 고스트 아이콘이다(제보 2건)', async () => {
    seed([{}]);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NotificationBell isMobile />} />
        </Routes>
      </MemoryRouter>,
    );
    const bell = await screen.findByRole('button', { name: '알림 1개' });
    // 모바일: 좁은 앱 바에서 박스형 버튼은 깨져 보인다 — ☰과 같은 고스트(테두리·면 없음).
    expect(bell.getAttribute('style') || '').not.toContain('border: 1px solid'); // 박스형 테두리가 없다(jsdom은 border:none을 직렬화하지 않는다)
    expect(bell.style.background).toBe('transparent');
    expect(bell.querySelector('svg')?.getAttribute('width')).toBe('20');
    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    // 목록이 길어질 때 기본 스크롤바가 패널을 가리지 않게 — .lnb-scroll과 같은 처리.
    // 홈 리디자인 후 스크롤은 패널이 아니라 **안쪽 목록**이 한다(머리·꼬리는 고정).
    expect(panel.querySelector('.notif-scroll')).toBeTruthy();
  });

  it('알림 패널 스크롤바: 위/아래 화살표 버튼이 없고 트랙이 둥근 모서리 안쪽으로 들여진다(제보)', async () => {
    // jsdom은 ::-webkit-scrollbar 의사 요소를 렌더하지 않으므로 CSS 계약을
    // 파일에서 직접 가드한다(Windows 크롬에서만 보이는 버튼 조각이 대상).
    const { readFileSync, existsSync } = await import('node:fs');
    // vitest의 import.meta.url은 file: 스킴이 아니라 cwd 기준 상대 경로로 찾는다
    // (apps/web에서 실행 / 루트에서 실행 둘 다).
    const cssPath = ['src/features/home/home.css', 'apps/web/src/features/home/home.css'].find((f) => existsSync(f))!;
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.notif-scroll::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.notif-scroll::-webkit-scrollbar-track\s*\{[^}]*margin:\s*12px 0/);
    // 표준 속성(scrollbar-width/color)은 ::-webkit-scrollbar 미지원 브라우저
    // 전용 블록에만 있어야 한다 — 크롬 121+는 표준 속성이 있는 요소에서
    // ::-webkit-scrollbar 커스텀을 통째로 무시하므로, 같이 걸면 위의 버튼
    // 숨김·4px 폭이 전혀 적용되지 않는다(제보: 새 빌드에서도 화살표 잔존).
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)/);
    expect(css).not.toMatch(/\n\.notif-scroll \{/); // 최상위 표준 속성 규칙 없음
  });

  it('알림이 없으면 배지 없이 빈 안내가 뜬다', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: '알림' });
    fireEvent.click(bell);
    expect(await screen.findByText(/새 알림이 없어요/)).toBeTruthy();
  });

  it('새 알림이 만들어지면 폴링을 기다리지 않고 즉시 배지가 선다(ping 신호)', async () => {
    renderBell();
    await screen.findByRole('button', { name: '알림' });
    // 알림 생성 지점(로컬 어댑터 = 데모의 "DB 트리거")이 ping을 쏜다 — 60초
    // 폴링만 있다면 이 테스트는 타임아웃 안에 배지를 보지 못한다.
    act(() => {
      pushLocalNotification({ recipientEmail: 'me@example.com', kind: 'doc_mention', documentId: 'd1', nodeId: null, actorName: '상대', preview: '', docTitle: '새 맵' });
    });
    const bell = await screen.findByRole('button', { name: '알림 1개' });
    expect(within(bell).getByText('1')).toBeTruthy();
  });

  it('목록은 최신이 위 — 어댑터 배열 순서가 시간순이 아니어도 오늘 묶음이 이전 묶음보다 먼저 선다', async () => {
    // 벨은 어댑터의 배열 순서를 믿지 않고 createdAt으로 정렬한다. 로컬 어댑터는
    // "추가순 = 시간순"을 전제로 reverse()하는데, 저장 배열이 시간순이 아니면
    // (기기 간 시계 어긋남·재작성 경로) '이전' 그룹이 '오늘' 위에 선다 —
    // 실브라우저 프로브에서 재현한 화면.
    seed([
      { id: 'new', createdAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { id: 'old', createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(), kind: 'share', nodeId: null, preview: '' },
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: '알림 2개' }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    const texts = [...panel.querySelectorAll('div,span')].map((e) => e.textContent?.trim()).filter((t) => t === '오늘' || t === '이전');
    expect(texts[0]).toBe('오늘');
    // 첫 행이 최신 항목(멘션)이다 — 공유(어제)가 위로 오면 안 된다.
    expect(within(panel).getAllByText(/님이/)[0]!.textContent).toContain('멘션');
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
