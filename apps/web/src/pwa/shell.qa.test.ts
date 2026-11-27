// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../test/setup';
import { App } from '../App';
import { ApiProvider } from '../api';
import { createMockApi } from '../api/mock';
import { UpdateCard } from './UpdateCard';
import type { RegisterSW } from './update';

// QA probes for T-019 AC-T19-5～7（pwa.md §3.2、§3.3）。
afterEach(() => {
  vi.restoreAllMocks();
});

function renderApp(register?: RegisterSW) {
  const app = register === undefined ? createElement(App) : createElement(App, { register });
  const router = createElement(MemoryRouter, { initialEntries: ['/'] }, app);
  return render(createElement(ApiProvider, { runtime: createMockApi(''), children: router }));
}
const setOnline = (value: boolean) => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
};
const bars = () => screen.queryAllByRole('status').filter((el) => el.textContent.includes('需要連網'));

describe('T-019 QA offline bar and update card', () => {
  it('(QA-15) flapping offline/online never shows more than one bar and ends with none', async () => {
    renderApp();
    await screen.findByText('今日任務會顯示在這裡。');
    for (let i = 0; i < 3; i += 1) {
      setOnline(false);
      expect(bars()).toHaveLength(1);
      setOnline(true);
      expect(bars()).toHaveLength(0);
    }
    expect(screen.getByText('今日任務會顯示在這裡。')).toBeTruthy();
  });

  it('(QA-16) a failed apply re-enables the button and keeps the card; it does not take focus when shown', async () => {
    let fail: (e: Error) => void = () => undefined;
    const apply = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const before = document.activeElement;
    render(createElement(UpdateCard, { apply }));
    expect(document.activeElement).toBe(before);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '更新' });
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    await act(async () => {
      fail(new Error('x'));
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);
    expect(screen.getByText('有新版本')).toBeTruthy();
    fireEvent.click(button);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('(QA-17) the update card and the offline bar can both be shown; the card is outside .sysbars', async () => {
    let notify: (() => void) | undefined;
    const register: RegisterSW = (options) => {
      notify = options.onNeedRefresh;
      return () => Promise.resolve();
    };
    renderApp(register);
    await screen.findByText('今日任務會顯示在這裡。');
    act(() => {
      notify?.();
    });
    setOnline(false);
    const card = screen.getAllByRole('status').find((el) => el.textContent.includes('有新版本'));
    expect(card).toBeDefined();
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.parentElement?.contains(card ?? null)).toBe(false);
  });
});
