// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../test/setup';
import { subscribeOnlineStatus } from './online';

afterEach(() => {
  vi.restoreAllMocks();
});

const setNavigatorOnLine = (value: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);

describe('subscribeOnlineStatus', () => {
  it('(AC-T19-5) (TC-6) calls with the current state, follows offline and online, and stops after unsubscribe', () => {
    setNavigatorOnLine(true);
    const seen: boolean[] = [];
    const unsubscribe = subscribeOnlineStatus((online) => {
      seen.push(online);
    }, window);
    expect(seen).toEqual([true]);
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(seen).toEqual([true, false, true]);
    unsubscribe();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(seen).toEqual([true, false, true]);
  });

  it('(AC-T19-5) (TC-6) starts from navigator.onLine when it is already offline', () => {
    setNavigatorOnLine(false);
    const seen: boolean[] = [];
    const unsubscribe = subscribeOnlineStatus((online) => {
      seen.push(online);
    });
    expect(seen).toEqual([false]);
    unsubscribe();
  });
});
