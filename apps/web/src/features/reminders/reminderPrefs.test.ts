import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleRemindersEnabled,
  markReminderFired,
  notifyPermission,
  onRemindersEnabledChange,
  remindersEnabled,
  setGoogleRemindersEnabled,
  setRemindersEnabled,
  showOsNotification,
  wasReminderFired,
} from './reminderPrefs';

beforeEach(() => localStorage.clear());

describe('알림의 기기 쪽 상태', () => {
  it('기본은 켜짐 — 이 스위치는 알림을 만들어 내지 않으므로(일정마다의 기본은 `없음`)', () => {
    expect(remindersEnabled()).toBe(true);
    setRemindersEnabled(false);
    expect(remindersEnabled()).toBe(false);
    setRemindersEnabled(true);
    expect(remindersEnabled()).toBe(true);
  });

  it('켜고 끄면 열려 있는 모든 화면에 알린다(스케줄러가 화면마다 있다)', () => {
    const fn = vi.fn();
    const off = onRemindersEnabledChange(fn);
    setRemindersEnabled(false);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setRemindersEnabled(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('이미 띄운 것은 기억하고, **일정을 옮기면 다시 띄운다**(알림 시각이 키에 들어 있다)', () => {
    expect(wasReminderFired('e1#2026-09-15', 1000)).toBe(false);
    markReminderFired('e1#2026-09-15', 1000);
    expect(wasReminderFired('e1#2026-09-15', 1000)).toBe(true);
    // 같은 일정이지만 알림 시각이 달라졌다 = 사용자가 시각·알림을 고쳤다 → 새 알림이다.
    expect(wasReminderFired('e1#2026-09-15', 2000)).toBe(false);
    // 다른 회차도 따로 센다.
    expect(wasReminderFired('e1#2026-09-16', 1000)).toBe(false);
  });

  it('오래된 기억은 버린다 — 저장소를 무한히 먹지 않게', () => {
    const old = Date.now() - 2 * 24 * 60 * 60_000;
    markReminderFired('old', 1, old);
    markReminderFired('new', 2);
    expect(wasReminderFired('old', 1)).toBe(false);
    expect(wasReminderFired('new', 2)).toBe(true);
  });

  it('권한이 없으면 OS 알림을 띄우지 않고 `false`를 돌려준다(호출부가 인앱 토스트로 대신한다)', () => {
    // jsdom에는 `Notification`이 없다 — 그때는 그 자리를 그리지도 않는다.
    expect(notifyPermission()).toBe('unsupported');
    expect(showOsNotification({ title: 'x', body: 'y', tag: 't' })).toBe(false);

    const ctor = vi.fn();
    class FakeNotification {
      static permission = 'denied';
      static requestPermission = vi.fn();
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, opts: unknown) {
        ctor(title, opts);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    expect(notifyPermission()).toBe('denied');
    expect(showOsNotification({ title: 'x', body: 'y', tag: 't' })).toBe(false);
    expect(ctor).not.toHaveBeenCalled();

    FakeNotification.permission = 'granted';
    expect(showOsNotification({ title: '팀 회의', body: '오전 10:30 · 10분 후 시작', tag: 'k' })).toBe(true);
    expect(ctor).toHaveBeenCalledWith('팀 회의', expect.objectContaining({ body: '오전 10:30 · 10분 후 시작', tag: 'k' }));
    vi.unstubAllGlobals();
  });
});

describe('구글 일정 알림 설정(2단계)', () => {
  it('기본은 **꺼짐**이다 — 그 알림은 구글이 이미 보낸다', () => {
    expect(googleRemindersEnabled()).toBe(false);
    // 그리오 알림은 반대로 기본이 켜짐이다(스위치의 뜻이 다르다).
    expect(remindersEnabled()).toBe(true);
  });

  it('켜고 끈 값이 이 기기에 남고, 열려 있는 화면들이 따라온다', () => {
    const seen: boolean[] = [];
    const off = onRemindersEnabledChange(() => seen.push(googleRemindersEnabled()));
    setGoogleRemindersEnabled(true);
    expect(googleRemindersEnabled()).toBe(true);
    setGoogleRemindersEnabled(false);
    expect(googleRemindersEnabled()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
  });
});
