// 프로필 이미지 변경 흐름 — 파일 고르기 → 다듬기 → 업로드 → 화면 반영.
//
// `prepareAvatar`는 캔버스를 쓰므로 jsdom에서 실제로 돌지 않는다. 여기서는 그
// 준비 단계를 mock으로 대신하고 **컨트롤러 이후**(어댑터 인자·아바타 반영·오류
// 문구·지우기)를 본다. 다듬기 자체의 규칙(정사각 256·webp)은 실브라우저에서 확인.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const prepared = { blob: new Blob(['bytes'], { type: 'image/webp' }) };
const prepareAvatar = vi.fn(async () => prepared as { blob?: Blob; error?: string });
vi.mock('./avatarImage', () => ({ prepareAvatar: () => prepareAvatar(), AVATAR_SIZE: 256 }));

import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import type { Backend } from '../../adapters/ports';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalTagStore } from '../../adapters/local/localTagStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalEventStore } from '../../adapters/local/localEventStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import { mockMatchMedia } from '../../test/matchMedia';

function renderHome(auth: LocalAuth) {
  const backend: Backend = {
    auth,
    docStore: new LocalDocStore(),
    spaceStore: new LocalSpaceStore(),
    shareStore: new LocalShareStore(),
    feedbackStore: new LocalFeedbackStore(), tagStore: new LocalTagStore(),
    imageStore: new LocalImageStore(),
    commentStore: new LocalCommentStore(),
    notificationStore: new LocalNotificationStore(), eventStore: new LocalEventStore(),
    mode: 'local',
  };
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
  await user.click(screen.getByRole('button', { name: '설정' }));
  return screen.getByRole('dialog', { name: '설정' });
}

/** 사진·이름은 설정 모달의 **한 겹 안** '프로필 설정' 화면에 있다(요청). */
async function openProfileSettings(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const dialog = await openSettings(user);
  await user.click(dialog.querySelector('[data-profile-detail-row]') as HTMLElement);
  return dialog;
}

describe('프로필 이미지 변경', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'me@example.com' } }));
    prepareAvatar.mockClear();
  });
  afterEach(cleanup);

  it('고른 파일이 다듬어져 올라가고, 돌아온 주소가 아바타에 뜬다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const calls: (Blob | null)[] = [];
    vi.spyOn(auth, 'updateAvatar').mockImplementation(async (blob) => {
      calls.push(blob);
      return { url: blob ? 'https://cdn.example.com/a.webp' : null };
    });
    renderHome(auth);
    const dialog = await openProfileSettings(user);

    await user.upload(dialog.querySelector('[data-avatar-input]') as HTMLInputElement, new File(['x'], 'me.png', { type: 'image/png' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(prepareAvatar).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(prepared.blob); // 원본이 아니라 다듬은 것
    // 아바타가 그 주소를 그린다(설정 모달 + LNB 프로필 버튼).
    await waitFor(() => expect(document.querySelectorAll('img[src="https://cdn.example.com/a.webp"]').length).toBeGreaterThan(0));
    // 다음 방문의 첫 페인트를 위해 캐시에도 남는다.
    expect(JSON.parse(localStorage.getItem('mf_profile_avatars') || '{}')['me@example.com']).toBe('https://cdn.example.com/a.webp');
  });

  it('**다른 기기에서 바꾼 사진**이 이 기기에도 온다 — 서버 값으로 맞춘다(제보 4)', async () => {
    const auth = new LocalAuth();
    // 이 기기의 세션·캐시는 옛 사진을 들고 있다(토큰 스냅샷).
    localStorage.setItem('mf_profile_avatars', JSON.stringify({ 'me@example.com': 'https://cdn.example.com/old.webp' }));
    vi.spyOn(auth, 'getProfileAvatar').mockResolvedValue('https://cdn.example.com/new.webp');
    renderHome(auth);

    await waitFor(() => expect(document.querySelectorAll('img[src="https://cdn.example.com/new.webp"]').length).toBeGreaterThan(0));
    // 캐시도 함께 고친다 — 다음 방문의 첫 페인트가 그 값이다.
    expect(JSON.parse(localStorage.getItem('mf_profile_avatars') || '{}')['me@example.com']).toBe('https://cdn.example.com/new.webp');
  });

  it('다른 기기에서 **지운** 사진이면 이 기기도 기본 얼굴로, **모르면** 건드리지 않는다(제보 4)', async () => {
    const auth = new LocalAuth();
    localStorage.setItem('mf_profile_avatars', JSON.stringify({ 'me@example.com': 'https://cdn.example.com/old.webp' }));
    // `undefined` = 모른다(로컬 모드·조회 실패) — 있던 사진을 지우면 안 된다.
    vi.spyOn(auth, 'getProfileAvatar').mockResolvedValue(undefined);
    const first = renderHome(auth);
    await waitFor(() => expect(document.querySelectorAll('img[src="https://cdn.example.com/old.webp"]').length).toBeGreaterThan(0));
    expect(JSON.parse(localStorage.getItem('mf_profile_avatars') || '{}')['me@example.com']).toBe('https://cdn.example.com/old.webp');
    first.unmount();

    // `null` = 지웠다 — 그때는 기본 얼굴로 되돌리고 캐시도 비운다.
    const auth2 = new LocalAuth();
    vi.spyOn(auth2, 'getProfileAvatar').mockResolvedValue(null);
    renderHome(auth2);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mf_profile_avatars') || '{}')['me@example.com']).toBeUndefined());
    expect(document.querySelector('img[src="https://cdn.example.com/old.webp"]')).toBeNull();
  });

  it('올리기가 실패하면 그 자리에 알리고 아바타는 그대로다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    vi.spyOn(auth, 'updateAvatar').mockResolvedValue({ error: 'boom' });
    renderHome(auth);
    const dialog = await openProfileSettings(user);

    await user.upload(dialog.querySelector('[data-avatar-input]') as HTMLInputElement, new File(['x'], 'me.png', { type: 'image/png' }));
    await waitFor(() => expect((dialog.querySelector('[data-avatar-hint]') as HTMLElement).textContent).toContain('올리지 못했어요'));
    expect(document.querySelector('img[src^="https://cdn"]')).toBeNull();
  });

  it('사진이 있으면 기본으로 되돌릴 수 있고, 없으면 그 버튼이 없다', async () => {
    const user = userEvent.setup();
    const auth = new LocalAuth();
    const calls: (Blob | null)[] = [];
    vi.spyOn(auth, 'updateAvatar').mockImplementation(async (blob) => {
      calls.push(blob);
      return { url: blob ? 'https://cdn.example.com/a.webp' : null };
    });
    renderHome(auth);
    let dialog = await openProfileSettings(user);
    expect(dialog.querySelector('[data-avatar-remove]')).toBeNull(); // 사진 없음

    await user.upload(dialog.querySelector('[data-avatar-input]') as HTMLInputElement, new File(['x'], 'me.png', { type: 'image/png' }));
    dialog = screen.getByRole('dialog', { name: '설정' });
    await waitFor(() => expect(dialog.querySelector('[data-avatar-remove]')).toBeTruthy());

    await user.click(dialog.querySelector('[data-avatar-remove]') as HTMLElement);
    await waitFor(() => expect(calls[calls.length - 1]).toBeNull()); // 지우기 = null
    await waitFor(() => expect(dialog.querySelector('[data-avatar-remove]')).toBeNull());
    expect(JSON.parse(localStorage.getItem('mf_profile_avatars') || '{}')['me@example.com']).toBeUndefined();
  });

  it("프로필명 변경 진입점은 설정 → '프로필 설정'이다 — 팝오버·첫 화면에는 없다(요청)", async () => {
    const user = userEvent.setup();
    renderHome(new LocalAuth());
    await user.click(await screen.findByRole('button', { name: '계정 메뉴' }));
    expect(screen.queryByRole('button', { name: '프로필명 변경' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '설정' }));
    const dialog = screen.getByRole('dialog', { name: '설정' });
    // 첫 화면은 진입 행만 — 손보는 항목은 한 겹 안에 있다.
    expect(within(dialog).queryByText('프로필명 변경')).toBeNull();
    expect(within(dialog).queryByText('프로필 이미지 변경')).toBeNull();
    await user.click(dialog.querySelector('[data-profile-detail-row]') as HTMLElement);
    expect(within(dialog).getByText('프로필 이미지 변경')).toBeTruthy();
    await user.click(within(dialog).getByText('프로필명 변경'));
    // 이름 바꾸기 팝업이 열린다(기존 흐름 재사용).
    expect(await screen.findByRole('dialog', { name: '프로필명 변경' })).toBeTruthy();
  });
});
