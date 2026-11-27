import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';
import { watchForUpdate } from './update';

vi.mock('./register', () => ({
  registerServiceWorker: vi.fn(),
}));

describe('watchForUpdate default registration', () => {
  it('(AC-T19-18) (TC-28) without a register it registers the service worker and reports a new version', () => {
    let needRefresh: (() => void) | undefined;
    vi.mocked(registerServiceWorker).mockImplementation((options) => {
      needRefresh = options.onNeedRefresh;
      return () => Promise.resolve();
    });
    const onNeedUpdate = vi.fn();
    watchForUpdate(onNeedUpdate);
    expect(registerServiceWorker).toHaveBeenCalledTimes(1);
    expect(onNeedUpdate).not.toHaveBeenCalled();
    needRefresh?.();
    expect(onNeedUpdate).toHaveBeenCalledTimes(1);
  });
});
