import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { NotificationsProvider } from './NotificationsContext';
import { pushLocalNotification, readLocalNotifications, writeLocalNotifications, type StoredNotification } from '../../../adapters/local/localNotifications';

// 홈 알림 센터(0022의 로컬 짝) — 벨 배지·열기=읽음 처리·항목 클릭=딥링크.

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderBell(isMobile = false) {
  // 상태(목록·안 읽음 수)는 공급자가 든다 — 실제 앱에서는 `Home`이 감싼다(LNB의
  // 벨과 폰 ☰의 점이 같은 수를 봐야 한다).
  return render(
    <NotificationsProvider>
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <NotificationBell isMobile={isMobile} />
              <LocationProbe />
            </>
          }
        />
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
});
afterEach(() => cleanup());

describe('알림 센터', () => {
  it('패널은 펼침·접힘 애니메이션을 그린다 — 닫아도 잠깐 마운트가 남는다(요청)', async () => {
    seed([{ id: 'n1' }]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /알림/ });

    fireEvent.click(bell);
    const panel = () => document.querySelector('[data-notification-panel]') as HTMLElement | null;
    // 상태는 클래스가 아니라 **자기 속성**으로 알린다(Radix Popover) — 애니메이션은
    // CSS가 `[data-state]`에 걸고, 닫히는 동안 Radix가 노드를 붙잡아 둔다.
    await waitFor(() => expect(panel()?.getAttribute('data-state')).toBe('open'));
    expect(panel()!.className).toContain('mf-pop-anim');

    fireEvent.click(bell);
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

  it('패널은 다듬은 스크롤바 클래스(.notif-scroll)를 쓰고, 벨은 LNB 행이다(요청)', async () => {
    seed([{}]);
    renderBell(true);
    const bell = await screen.findByRole('button', { name: '알림 1개' });
    // LNB의 다른 행(`일정`·대시보드)과 같은 문법 — 34px(폰 44px)·radius 10·
    // 글리프 + 이름 + 오른쪽 끝 배지. 툴바의 박스형 아이콘 버튼이 아니다.
    expect(bell.hasAttribute('data-notification-nav')).toBe(true);
    expect(bell.className).toContain('nav-item');
    expect(bell.style.minHeight).toBe('44px'); // 폰 터치 타깃
    expect(bell.style.background).toBe('transparent');
    expect(bell.textContent).toContain('알림');
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
    // 버튼 숨김은 네 스크롤 영역이 함께 쓰는 규칙 하나에 있다(LNB·알림·최근·위젯).
    const btn = css.slice(css.indexOf('.lnb-scroll::-webkit-scrollbar-button,'));
    const btnRule = btn.slice(0, btn.indexOf('}'));
    expect(btnRule).toContain('.notif-scroll::-webkit-scrollbar-button');
    expect(btnRule).toContain('display: none');
    // 트랙 여백은 알림 센터만의 것(둥근 모서리 안쪽으로 썸을 들여놓는다)
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

describe('알림 자리 — LNB(요청)', () => {
  it('☰의 점은 알림·공유를 **하나로** 합쳐 말한다', async () => {
    const { navDotOf } = await import('./navDot');
    expect(navDotOf(0, 0)).toEqual({ on: false, title: '메뉴 열기', label: '메뉴 열기' });
    expect(navDotOf(0, 2).on).toBe(true);
    expect(navDotOf(0, 2).title).toContain('새 알림 2개');
    expect(navDotOf(3, 0).title).toContain('새 공유 3개');
    // 둘 다 있으면 점은 하나, 문구가 둘 다 말한다.
    const both = navDotOf(3, 2);
    expect(both.label).toContain('새 알림 2개');
    expect(both.label).toContain('새 공유 3개');
  });

  it('패널은 LNB 옆으로 뻗는다 — 사이드바 목록을 덮지 않게(데스크톱)', async () => {
    seed([{}]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: '알림 1개' }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    // jsdom에는 레이아웃이 없어 Radix의 실제 side 판정을 믿을 수 없다 —
    // 우리가 정하는 값(패널이 자라나는 기준점)으로 계약을 고정한다.
    expect(panel.style.transformOrigin).toBe('left top');
  });
});
