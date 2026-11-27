// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../test/setup';
import { App } from '../App';
import { ApiProvider } from '../api';
import { createMockApi } from '../api/mock';
import { OfflinePanel } from './OfflinePanel';
import { registerServiceWorker } from './register';
import { chooseRegister, previewUpdateRegister, shouldShowUpdatePrompt, watchForUpdate } from './update';
import type { RegisterSW } from './update';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 假 registerSW：記下 onNeedRefresh 與 updateSW，測試自己決定何時觸發。 */
function fakeRegister() {
  let needRefresh: (() => void) | undefined;
  const updateSW = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve());
  const register: RegisterSW = (options) => {
    needRefresh = options.onNeedRefresh;
    return updateSW;
  };
  return {
    register,
    updateSW,
    trigger: () => {
      act(() => {
        needRefresh?.();
      });
    },
  };
}

function renderApp(register?: RegisterSW) {
  return render(
    <ApiProvider runtime={createMockApi('')}>
      <MemoryRouter initialEntries={['/']}>{register === undefined ? <App /> : <App register={register} />}</MemoryRouter>
    </ApiProvider>,
  );
}

const goOffline = () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
};

describe('watchForUpdate', () => {
  it('(AC-T19-7) (TC-9) calls onNeedUpdate only when the service worker reports a new version', () => {
    const { register, trigger } = fakeRegister();
    const onNeedUpdate = vi.fn();
    watchForUpdate(onNeedUpdate, register);
    expect(onNeedUpdate).not.toHaveBeenCalled();
    trigger();
    expect(onNeedUpdate).toHaveBeenCalledTimes(1);
  });

  it('(AC-T19-7) (TC-10) apply reloads through updateSW(true) and nothing is applied by itself', async () => {
    const { register, updateSW, trigger } = fakeRegister();
    let apply: (() => Promise<void>) | undefined;
    watchForUpdate((next) => {
      apply = next;
    }, register);
    trigger();
    expect(updateSW).not.toHaveBeenCalled();
    await apply?.();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('(AC-T19-7) (AC-T19-18) (TC-9) without a register the default registration is used (no SW support here: no throw, no notice), and the show-or-hold decision is a single point that is on for now', () => {
    const onNeedUpdate = vi.fn();
    expect(() => {
      watchForUpdate(onNeedUpdate);
    }).not.toThrow();
    expect(onNeedUpdate).not.toHaveBeenCalled();
    expect(shouldShowUpdatePrompt()).toBe(true);
  });
});

describe('chooseRegister', () => {
  it('(AC-T19-19) (TC-29) ?pwa=update only counts in a preview build; everything else registers the real service worker', () => {
    expect(chooseRegister(false, '?pwa=update')).toBe(registerServiceWorker);
    expect(chooseRegister(true, '?pwa=update')).toBe(previewUpdateRegister);
    expect(chooseRegister(true, '')).toBe(registerServiceWorker);
    expect(chooseRegister(true, '?pwa=other')).toBe(registerServiceWorker);
  });
});

describe('update card', () => {
  it('(AC-T19-7) (TC-9) no card until a new version, then a status card with the text and only the update button', () => {
    const { register, updateSW, trigger } = fakeRegister();
    renderApp(register);
    expect(screen.queryByText('有新版本')).toBeNull();
    trigger();
    const card = screen.getByText('有新版本').closest('[role="status"]');
    expect(card?.textContent).toContain('按更新會重新載入頁面。');
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /稍後|關閉/ })).toBeNull();
    expect(card?.querySelectorAll('button')).toHaveLength(1);
    expect(updateSW).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('(AC-T19-7) (TC-10) pressing update calls apply once; the button is disabled while it runs', async () => {
    const { register, updateSW, trigger } = fakeRegister();
    let finish: () => void = () => undefined;
    updateSW.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderApp(register);
    trigger();
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '更新' });
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(updateSW).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(updateSW).toHaveBeenCalledTimes(1);
  });
});

describe('offline bar and panel', () => {
  it('(AC-T19-5) (TC-7) offline shows a status bar with the title in its own element and no button; online again removes it', () => {
    renderApp();
    expect(screen.queryByText('需要連網')).toBeNull();
    goOffline();
    const title = screen.getByText('需要連網');
    expect(title.tagName).toBe('STRONG');
    const bar = title.closest('[role="status"]');
    expect(bar?.textContent).toContain('目前沒有網路，連上後再繼續。');
    expect(bar?.querySelectorAll('button')).toHaveLength(0);
    vi.restoreAllMocks();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('需要連網')).toBeNull();
  });

  it('(AC-T19-8) (TC-11) the preview bar comes before the offline bar inside the same .sysbars container', async () => {
    renderApp();
    goOffline();
    const preview = await screen.findByRole('note');
    const offline = screen.getByText('需要連網').closest('[role="status"]');
    expect(preview.parentElement).toBe(offline?.parentElement);
    expect(preview.nextElementSibling).toBe(offline);
  });

  it('(AC-T19-6) (TC-8) a screen that was already open keeps its content when the connection drops', async () => {
    renderApp();
    await screen.findByRole('button', { name: '帳號與外觀' });
    goOffline();
    expect(screen.getByRole('button', { name: '帳號與外觀' })).toBeTruthy();
    expect(screen.queryByText('今天的課表要連網才能載入')).toBeNull();
  });

  it('(AC-T19-6) (TC-8) opening while offline shows the panel with a reload button instead of the page', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp();
    expect(screen.getByText('今天的課表要連網才能載入')).toBeTruthy();
    expect(screen.getByText('App 外殼已經開好，但課表、字卡和紀錄都在雲端，不存在這台裝置。連上網路後按「重新載入」。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '帳號與外觀' })).toBeNull();
    expect(screen.getByText('需要連網')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新載入' })).toBeTruthy();
  });

  it('(AC-T19-16) (TC-25) offline at open, then online, then offline again: panel, page, page with the bar and no panel', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp();
    expect(screen.getByText('今天的課表要連網才能載入')).toBeTruthy();
    vi.restoreAllMocks();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
    expect(screen.queryByText('今天的課表要連網才能載入')).toBeNull();
    goOffline();
    expect(screen.getByRole('button', { name: '帳號與外觀' })).toBeTruthy();
    expect(screen.getByText('需要連網')).toBeTruthy();
    expect(screen.queryByText('今天的課表要連網才能載入')).toBeNull();
  });

  it('(AC-T19-6) (TC-8) the reload button calls onReload', () => {
    const onReload = vi.fn();
    render(<OfflinePanel onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('(AC-T19-6) (TC-8) once the connection is back, the page replaces the panel', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp();
    expect(screen.getByText('今天的課表要連網才能載入')).toBeTruthy();
    vi.restoreAllMocks();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
    expect(screen.queryByText('今天的課表要連網才能載入')).toBeNull();
  });
});
