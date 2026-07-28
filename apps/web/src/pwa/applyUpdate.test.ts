import { describe, expect, it, vi } from 'vitest';
import { applyUpdate } from './applyUpdate';

// 제보: 에디터에서 새 버전 토스트의 '새로고침'을 눌러도 아무 일도 일어나지 않고,
// 그 뒤로는 몇 번을 눌러도 무반응. 원인은 이 절차가 **끝나지 않을 수 있다**는 것
// (저장이 매달리거나, skipWaiting을 보냈는데 리로드가 오지 않거나) — 호출부의
// 중복 실행 방지 플래그가 걸린 채 남아 이후 클릭이 전부 무시됐다.
// 그래서 여기서는 "반드시 끝난다"를 검증한다.

const never = () => new Promise<boolean>(() => {}); // 영영 resolve되지 않는 저장

describe('applyUpdate', () => {
  it('저장이 확인되면 skipWaiting을 보낸다', async () => {
    const skipWaiting = vi.fn();
    const reload = vi.fn();
    const p = applyUpdate({ prepare: async () => true, skipWaiting, reload, reloadWatchdogMs: 10 });
    await expect(p).resolves.toBe('applied');
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('저장이 실패하면 리로드하지 않는다 (편집분이 사라지므로)', async () => {
    const skipWaiting = vi.fn();
    const reload = vi.fn();
    await expect(applyUpdate({ prepare: async () => false, skipWaiting, reload })).resolves.toBe('save-failed');
    expect(skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('저장이 던져도 멈추지 않고 실패로 끝낸다', async () => {
    await expect(
      applyUpdate({
        prepare: async () => {
          throw new Error('network down');
        },
        skipWaiting: vi.fn(),
        reload: vi.fn(),
      }),
    ).resolves.toBe('save-failed');
  });

  // ── 정지 지점 ①: 저장이 응답 없이 매달린다 ─────────────────────────────────
  it('저장이 끝나지 않아도 제한 시간 뒤 반드시 끝난다 (버튼이 죽지 않는다)', async () => {
    const skipWaiting = vi.fn();
    const started = Date.now();
    const outcome = await applyUpdate({ prepare: never, skipWaiting, reload: vi.fn(), prepareTimeoutMs: 60 });
    expect(outcome).toBe('save-failed');
    expect(skipWaiting).not.toHaveBeenCalled(); // 저장을 확인 못 했으니 적용하지 않는다
    expect(Date.now() - started).toBeLessThan(2000); // 매달리지 않고 돌아왔다
  });

  // ── 정지 지점 ②: skipWaiting을 보냈는데 controlling 이벤트가 오지 않는다 ────
  //    (대기 중이던 SW가 이미 다른 탭의 적용으로 활성화된 경우 등)
  it('skipWaiting 뒤 리로드가 오지 않으면 직접 리로드한다', async () => {
    const reload = vi.fn();
    await applyUpdate({ prepare: async () => true, skipWaiting: vi.fn(), reload, reloadWatchdogMs: 30 });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('직접 리로드는 저장이 확인된 뒤에만 한다', async () => {
    const reload = vi.fn();
    await applyUpdate({ prepare: never, skipWaiting: vi.fn(), reload, prepareTimeoutMs: 30, reloadWatchdogMs: 30 });
    expect(reload).not.toHaveBeenCalled();
  });
});
