import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { NotificationsProvider } from './NotificationsContext';
import { pushLocalNotification, readLocalNotifications, writeLocalNotifications, type StoredNotification } from '../../../adapters/local/localNotifications';
import { __resetUpdateControl, publishUpdateStatus, setUpdateControls } from '../../../pwa/updateControl';
import { pushReminderNotice } from '../../reminders/reminderInbox';
import { takeCalendarFocus } from '../calendarFocus';

// 홈 알림 센터(0022의 로컬 짝) — 벨 배지·열기=읽음 처리·항목 클릭=딥링크.

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderBell(isMobile = false, onOpenVersion: () => void = vi.fn()) {
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
              <NotificationBell isMobile={isMobile} onOpenVersion={onOpenVersion} />
              <LocationProbe />
            </>
          }
        />
        <Route path="/editor" element={<LocationProbe />} />
        <Route path="/home" element={<LocationProbe />} />
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
    const bell = await screen.findByRole('button', { name: /^알림 2개 ·/ });
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
    fireEvent.click(await screen.findByRole('button', { name: /^알림 1개 ·/ }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    fireEvent.click(within(panel).getByText(/답글을 남겼어요/));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/editor?map=d9&comments=topic7'));
  });

  it('공유 알림은 맵으로만 간다, 알림이 없으면 빈 안내', async () => {
    seed([{ kind: 'share', documentId: 'd3', nodeId: null, preview: '' }]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^알림 1개 ·/ }));
    fireEvent.click(screen.getByText(/맵을 공유했어요/));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/editor?map=d3'));
  });

  it('패널은 다듬은 스크롤바 클래스(.notif-scroll)를 쓰고, 벨은 LNB 행이다(요청)', async () => {
    seed([{}]);
    renderBell(true);
    const bell = await screen.findByRole('button', { name: /^알림 1개 ·/ });
    // LNB 행이다 — 툴바의 박스형 아이콘 버튼이 아니다. 두 줄 카드라 폰에서는 56px.
    expect(bell.hasAttribute('data-notification-nav')).toBe(true);
    expect(bell.className).toContain('nav-item');
    expect(bell.style.minHeight).toBe('56px');
    expect(bell.textContent).toContain('알림');
    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    // 목록이 길어질 때 기본 스크롤바가 패널을 가리지 않게 — .lnb-scroll과 같은 처리.
    // 홈 리디자인 후 스크롤은 패널이 아니라 **안쪽 목록**이 한다(머리·꼬리는 고정).
    expect(panel.querySelector('.notif-scroll')).toBeTruthy();
  });

  it('LNB 행 hover가 틴트를 회색으로 갈아 끼우지 않는다 — 지금 보는 화면·안 읽음은 자기 색을 지킨다', async () => {
    // 공용 `.nav-item:hover`가 면을 panel2로 덮으면 손을 얹는 순간 그 항목이 꺼진
    // 것처럼 보인다(달력 칩·켜진 알약에서 이미 겪은 계열). jsdom은 :hover를
    // 계산하지 않으므로 CSS 계약을 파일에서 직접 가드한다.
    const { readFileSync, existsSync } = await import('node:fs');
    const cssPath = ['src/features/home/home.css', 'apps/web/src/features/home/home.css'].find((f) => existsSync(f))!;
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.nav-item\[aria-current='page'\]:hover/);
    expect(css).toMatch(/\.nav-item\[data-tinted='1'\]:hover/);
    // 틴트는 유지하고 밝기만 움직인다.
    const block = css.slice(css.indexOf(".nav-item[aria-current='page']:hover"));
    expect(block.slice(0, 260)).toContain('var(--mf-accent-soft)');
    expect(block.slice(0, 260)).toContain('--mf-hover-bright');
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

  it('LNB 행은 세 상태를 말한다 — 안 읽음(배지+갈색 요약) · 다 읽음(배지 없이 흐린 회색) · 없음(요청)', async () => {
    // ③ 아무것도 없을 때 — 요약 자리가 비어 있지 않고 그 사실을 말한다.
    const { unmount } = renderBell();
    let sum = (await screen.findByRole('button', { name: /^알림 ·/ })).querySelector('[data-nav-card-summary]') as HTMLElement;
    expect(sum.textContent).toBe('아직 받은 알림이 없어요');
    expect(sum.style.color).toBe('var(--mf-muted)');
    unmount();
    cleanup();

    // ① 안 읽음 — 강조색 틴트 면 + 개수 배지 + `종류 · 내용 · 시간`이 본문 톤으로.
    seed([{ kind: 'mention', preview: '제가 바꿀게요', createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() }]);
    renderBell();
    let bell = await screen.findByRole('button', { name: /^알림 1개 ·/ });
    expect(bell.style.background).toBe('var(--mf-accent-soft)');
    expect(within(bell).getByText('1')).toBeTruthy();
    sum = bell.querySelector('[data-nav-card-summary]') as HTMLElement;
    expect(sum.textContent).toBe('멘션 · 제가 바꿀게요 · 2시간 전');
    expect(sum.style.color).toBe('var(--mf-subtext)');
    cleanup();

    // ② 다 읽음 — 배지도 면도 사라지고 같은 요약이 흐린 회색으로 남는다.
    seed([{ kind: 'mention', preview: '제가 바꿀게요', createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), readAt: new Date().toISOString() }]);
    renderBell();
    bell = await screen.findByRole('button', { name: /^알림 ·/ });
    expect(bell.style.background).toBe('transparent');
    expect(bell.querySelector('[data-notification-count]')).toBeNull();
    sum = bell.querySelector('[data-nav-card-summary]') as HTMLElement;
    expect(sum.textContent).toBe('멘션 · 제가 바꿀게요 · 2시간 전');
    expect(sum.style.color).toBe('var(--mf-muted)');
  });

  it('내용이 길어도 시간은 잘리지 않는다 — 말줄임은 내용 쪽이 진다', async () => {
    // 한 문자열로 이으면 꼬리(시간)부터 사라진다 — 시간은 짧고 언제나 읽혀야 한다.
    seed([{ preview: '아주 긴 댓글 내용이라 한 줄에 다 들어가지 않습니다 확인 부탁드립니다', createdAt: new Date(Date.now() - 3600_000).toISOString() }]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /^알림 1개 ·/ });
    const sum = bell.querySelector('[data-notification-summary]') as HTMLElement;
    const [content, when] = [...sum.children] as HTMLElement[];
    expect(content!.style.textOverflow).toBe('ellipsis');
    expect(when!.textContent).toBe(' · 1시간 전');
    expect(when!.style.flexShrink).toBe('0'); // 줄지 않는다
  });

  it('벨 타일은 읽었든 안 읽었든 늘 채운 강조색이다(요청) — 개수는 오른쪽 끝, 셰브론은 없다', async () => {
    // 읽음 여부는 **타일 모서리의 점**과 개수 배지·요약 색이 말한다 — 타일까지
    // 함께 흐려지면 "알림 자리"라는 표식이 사라진다.
    seed([{ readAt: new Date().toISOString() }]);
    const { unmount } = renderBell();
    let card = await screen.findByRole('button', { name: /^알림 ·/ });
    let tile = card.querySelector('[data-nav-card-glyph]') as HTMLElement;
    expect(tile.dataset.navCardTile).toBe('accent');
    expect(tile.style.background).toBe('var(--mf-accent)');
    expect(tile.style.color).toBe('var(--mf-accent-ink)'); // 흰 벨
    expect(card.querySelector('[data-nav-card-tile-dot]')).toBeNull(); // 다 읽음
    // 이 카드는 하위 메뉴를 펼치는 것이 아니라 패널을 띄운다 — 셰브론을 두면
    // "누르면 펼쳐진다"는 거짓 약속이 된다.
    expect(card.querySelector('[data-nav-card-chevron]')).toBeNull();
    unmount();
    cleanup();

    seed([{}]);
    renderBell();
    card = await screen.findByRole('button', { name: /^알림 1개 ·/ });
    tile = card.querySelector('[data-nav-card-glyph]') as HTMLElement;
    expect(tile.style.background).toBe('var(--mf-accent)');
    expect(card.querySelector('[data-nav-card-tile-dot]')).not.toBeNull();
    // 개수 배지는 이름 옆이 아니라 **오른쪽 끝**이다(첨부 디자인) — 이름이 길어도
    // 자리를 다투지 않고 두 카드의 오른쪽 끝이 한 열에 선다.
    const badge = card.querySelector('[data-notification-count]') as HTMLElement;
    const summary = card.querySelector('[data-nav-card-summary]') as HTMLElement;
    expect(badge.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('패널 목록은 첨부 디자인대로 — 안 읽은 줄만 강조색 카드, 둘째 줄은 [문서 칩][시간], 묶음은 오늘/이번 주/이전', async () => {
    const day = 24 * 3600_000;
    // `오늘` 묶음의 항목은 **시각 오프셋이 아니라 날짜로** 못박는다 — `Date.now() - 2h`는
    // 자정~새벽 2시에 돌리면 어제가 되어 `오늘` 머리가 사라진다(CI가 01:05 UTC에 돌아
    // 실제로 깨졌다). 오늘 09:00을 쓰되 아직 오지 않았으면 `지금`으로 물러선다.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todayish = new Date(Math.min(midnight.getTime() + 9 * 3600_000, Date.now())).toISOString();
    seed([
      { id: 'a', preview: '제가 바꿀게요', docTitle: '분기 계획', createdAt: todayish },
      { id: 'b', kind: 'reply', docTitle: '회고 (KPT)', preview: '확인했어요', createdAt: new Date(Date.now() - 2 * day).toISOString(), readAt: new Date().toISOString() },
      { id: 'c', kind: 'share', preview: '', docTitle: '옛 맵', createdAt: new Date(Date.now() - 20 * day).toISOString(), readAt: new Date().toISOString() },
    ]);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^알림 1개 ·/ }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    const rows = [...panel.querySelectorAll('[data-notification-item]')] as HTMLElement[];
    expect(rows).toHaveLength(3);

    // 안 읽었던 줄만 강조색 틴트 카드 — 읽은 줄은 면이 없다.
    expect(rows[0]!.style.background).toBe('var(--mf-accent-soft)');
    expect(rows[0]!.getAttribute('data-unread')).toBe('1');
    expect(rows[1]!.style.background).toBe('transparent');
    expect(rows[1]!.hasAttribute('data-unread')).toBe(false);

    // 둘째 줄은 칩 + 시간뿐이다 — 따옴표 친 별도 본문 줄은 없다.
    // 칩은 **본문이 있으면 본문**, 없으면(공유 초대) 맵 이름이다(사용자 선정).
    expect(rows[0]!.querySelector('[data-notification-chip]')!.textContent).toBe('제가 바꿀게요');
    expect(rows[0]!.textContent).not.toContain('“제가 바꿀게요”');
    // 화면에서 감춰지는 맵 이름은 툴팁이 메운다.
    expect(rows[0]!.title).toBe('분기 계획 · 제가 바꿀게요');
    expect(rows[2]!.querySelector('[data-notification-chip]')!.textContent).toBe('옛 맵'); // 공유 = 본문 없음

    // 묶음 머리 셋.
    const heads = [...panel.querySelectorAll('span')].map((e) => e.textContent).filter((t) => t === '오늘' || t === '이번 주' || t === '이전');
    expect(heads).toEqual(['오늘', '이번 주', '이전']);
  });

  it('알림이 없으면 배지 없이 빈 안내가 뜬다', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: /^알림 ·/ });
    fireEvent.click(bell);
    expect(await screen.findByText(/새 알림이 없어요/)).toBeTruthy();
  });

  it('새 알림이 만들어지면 폴링을 기다리지 않고 즉시 배지가 선다(ping 신호)', async () => {
    renderBell();
    await screen.findByRole('button', { name: /^알림 ·/ });
    // 알림 생성 지점(로컬 어댑터 = 데모의 "DB 트리거")이 ping을 쏜다 — 60초
    // 폴링만 있다면 이 테스트는 타임아웃 안에 배지를 보지 못한다.
    act(() => {
      pushLocalNotification({ recipientEmail: 'me@example.com', kind: 'doc_mention', documentId: 'd1', nodeId: null, actorName: '상대', preview: '', docTitle: '새 맵' });
    });
    const bell = await screen.findByRole('button', { name: /^알림 1개 ·/ });
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
    fireEvent.click(await screen.findByRole('button', { name: /^알림 2개 ·/ }));
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
      expect(screen.getByRole('button', { name: /^알림 ·/ })).toBeTruthy();
      // 홈에 머무는 동안 다른 곳(협업 상대)에서 알림이 만들어진다.
      seed([{}]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const bell = screen.getByRole('button', { name: /^알림 1개 ·/ });
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
    fireEvent.click(await screen.findByRole('button', { name: /^알림 1개 ·/ }));
    const panel = await screen.findByRole('region', { name: '알림 센터' });
    // jsdom에는 레이아웃이 없어 Radix의 실제 side 판정을 믿을 수 없다 —
    // 우리가 정하는 값(패널이 자라나는 기준점)으로 계약을 고정한다.
    expect(panel.style.transformOrigin).toBe('left top');
  });
});

// 새 버전을 **여기서** 알린다(요청) — 예전에는 화면 하단 토스트가 물었고, 편집 중에
// 끼어드는 자리였다. 지금은 목록 맨 위 고정 한 줄이고 누르면 설정 › 「버전 확인」이
// 열린다. 알림 창구를 하나로 모은 것의 마지막 조각이다.
describe('알림 센터 — 새 버전', () => {
  /** 웹 새 판이 대기 중인 상태 — `UpdatePrompt`가 올려 두는 것과 같은 모양. */
  function webReady(): void {
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    act(() => publishUpdateStatus({ ready: true }));
  }

  it('대기 중인 새 버전이 맨 위 고정 한 줄로 서고, 누르면 「버전 확인」이 열린다', async () => {
    const onOpenVersion = vi.fn();
    renderBell(false, onOpenVersion);
    webReady();

    // 우편함이 비어 있어도 카드가 그 소식을 요약한다 — 열어 보지 않아도 안다.
    const bell = await screen.findByRole('button', { name: /새 버전이 준비됐어요/ });
    expect(bell.querySelector('[data-notification-count]')!.textContent).toBe('1');

    fireEvent.click(bell);
    const row = await waitFor(() => {
      const el = document.querySelector('[data-notification-update]');
      if (!el) throw new Error('아직');
      return el as HTMLElement;
    });
    expect(row.getAttribute('data-notification-update')).toBe('ready');
    expect(row.textContent).toContain('새 버전이 준비됐어요');
    // 우편함이 비었다고 말하지 않는다 — 바로 위에 볼 것이 있다.
    expect(document.querySelector('[data-notification-empty]')).toBeNull();

    fireEvent.click(row);
    expect(onOpenVersion).toHaveBeenCalledTimes(1);
  });

  it('안 읽은 우편함 항목이 있으면 요약은 그쪽이 먼저다 — 개수는 둘을 함께 센다', async () => {
    seed([{ id: 'n1' }]);
    renderBell();
    webReady();

    // 멘션·답글은 지나가는 사건이고 새 버전은 적용할 때까지 남는 상태다 — 상태가
    // 이 자리를 차지하면 그동안 도착한 소식이 요약에서 통째로 가려진다.
    const bell = await screen.findByRole('button', { name: /^알림 2개 · 멘션 · 확인 부탁/ });
    expect(bell.querySelector('[data-notification-count]')!.textContent).toBe('2');

    // 목록을 열면 **둘 다** 보인다(하나의 창구).
    fireEvent.click(bell);
    await waitFor(() => expect(document.querySelector('[data-notification-update]')).toBeTruthy());
    expect(document.querySelectorAll('[data-notification-item]').length).toBe(1);
    // 열어도 새 버전 줄은 남는다 — 적용할 때까지 끝나지 않는 일이다.
    await waitFor(() => expect(readLocalNotifications().every((n) => n.readAt)).toBe(true));
    expect(document.querySelector('[data-notification-update]')).toBeTruthy();
  });

  it('저장하지 못해 멈췄으면 경고 톤으로 말한다', async () => {
    renderBell();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    act(() => publishUpdateStatus({ ready: true, saveBlocked: true }));

    fireEvent.click(await screen.findByRole('button', { name: /업데이트를 멈췄어요/ }));
    const row = await waitFor(() => {
      const el = document.querySelector('[data-notification-update]');
      if (!el) throw new Error('아직');
      return el as HTMLElement;
    });
    expect(row.getAttribute('data-notification-update')).toBe('blocked');
  });

  it('새 버전이 없으면 아무것도 더하지 않는다 — 창구에 늘 무언가 있으면 신호를 잃는다', async () => {
    renderBell();
    setUpdateControls({ check: vi.fn(), apply: vi.fn() });
    // 확인 중·최신은 **사용자가 할 일이 없다**.
    act(() => publishUpdateStatus({ checking: true }));

    const bell = await screen.findByRole('button', { name: /아직 받은 알림이 없어요/ });
    expect(bell.querySelector('[data-notification-count]')).toBeNull();
    fireEvent.click(bell);
    await waitFor(() => expect(document.querySelector('[data-notification-empty]')).toBeTruthy());
    expect(document.querySelector('[data-notification-update]')).toBeNull();
  });

  it('폰의 ☰ 점도 새 버전을 말한다 — 서랍이 닫혀 있으면 그 안의 카드가 안 보인다', async () => {
    const { navDotOf } = await import('./navDot');
    expect(navDotOf(0, 0, true)).toEqual({
      on: true,
      title: '메뉴 열기 (새 버전)',
      label: '메뉴 열기, 새 버전',
    });
    // 개수가 아니라 있음/없음이라 따로 적는다 — `새 알림 N개`에 섞으면 그 숫자가
    // 우편함 항목 수와 어긋난다.
    expect(navDotOf(0, 2, true).label).toBe('메뉴 열기, 새 알림 2개 · 새 버전');
  });
});

// ── 일정 알림도 우편함에 남는다(제보) ───────────────────────────────────────
//
// 그 알림은 **서버가 만들지 않는다** — 스케줄러가 이 기기에서 띄우고 기록도 여기
// 남는다(캘린더 데이터를 서버에 쌓지 않는다는 방침 그대로). 우편함은 서버 것과
// 이 기록을 **합쳐** 보여 준다.
describe('일정 알림이 우편함에 남는다', () => {
  const fired = {
    key: 'e1#2026-09-15',
    eventId: 'e1',
    date: '2026-09-15',
    title: '팀 회의',
    startTime: '10:30',
    fireAt: Date.parse('2026-09-15T10:20:00'),
    startAt: Date.parse('2026-09-15T10:30:00'),
    minutes: 10,
  };

  it('배지·목록에 섞이고, 누르면 **그 일정**으로 간다(맵이 아니라)', async () => {
    // 서버 알림 하나 + 이 기기의 일정 알림 하나 — 한 목록이다.
    seed([{ id: 'n1', createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }]);
    pushReminderNotice(fired);
    renderBell();

    const bell = await screen.findByRole('button', { name: /알림/ });
    // 안 읽은 둘을 함께 센다.
    await waitFor(() => expect(bell.textContent).toContain('2'));

    fireEvent.click(bell);
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-notification-panel]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    // 사람이 없는 알림이라 얼굴 자리에 달력이 오고, 문장은 "언제 시작하는가"다.
    expect(panel.querySelector('[data-notification-cal]')).toBeTruthy();
    const row = within(panel).getByText('팀 회의').closest('button') as HTMLElement;
    expect(row.textContent).toContain('10분');

    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/home'));
    // 화면만 바꾸는 것으로는 부족하다 — 그 회차가 놓인 날까지 들고 간다.
    expect(takeCalendarFocus()).toEqual({ date: '2026-09-15', eventId: 'e1', source: 'geurio' });
  });

  it('열면 함께 읽음 처리된다 — 서버 것과 같은 규칙', async () => {
    pushReminderNotice(fired);
    renderBell();
    const bell = await screen.findByRole('button', { name: /알림/ });
    await waitFor(() => expect(bell.textContent).toContain('1'));
    fireEvent.click(bell);
    await waitFor(() => expect(bell.textContent).not.toContain('1'));
    expect(localStorage.getItem('mf_reminder_inbox')).toContain('"read":true');
  });
});
