// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setMedia } from '../../test/setup.ts';
import { AccountMenu } from './AccountMenu.tsx';

const DARK = '(prefers-color-scheme: dark)';

const open = (): void => {
  fireEvent.click(screen.getByRole('button', { name: '帳號與外觀' }));
};

describe('account menu and theme control', () => {
  it('(AC-T18-11) (TC-20) the avatar opens 帳號與外觀 with radios 淺色 / 深色 / 跟隨系統, 跟隨系統 selected', () => {
    setMedia(DARK, false);
    render(<AccountMenu />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('dialog', { name: '帳號與外觀' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['light', 'dark', 'system']);
    expect(screen.getByRole('radio', { name: '淺色' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '深色' })).toBeTruthy();
    const system = screen.getByRole('radio', { name: '跟隨系統' });
    expect(system).toHaveProperty('checked', true);
    expect(screen.getByText('跟隨系統，現在是淺色。只存在這台裝置。')).toBeTruthy();
  });

  it('(AC-T18-11) (TC-21) switching applies at once and follows the system while on 跟隨系統', () => {
    setMedia(DARK, false);
    render(<AccountMenu />);
    open();

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByText('現在是深色。只存在這台裝置。')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '淺色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByText('現在是淺色。只存在這台裝置。')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '跟隨系統' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    act(() => {
      setMedia(DARK, true);
    });
    expect(screen.getByText('跟隨系統，現在是深色。只存在這台裝置。')).toBeTruthy();
    expect(window.localStorage.getItem('ec-theme')).toBe('system');
  });

  it('(AC-T18-11) (TC-21) a stored preference is the selected option when the panel opens again', () => {
    window.localStorage.setItem('ec-theme', 'dark');
    render(<AccountMenu />);
    open();
    expect(screen.getByRole('radio', { name: '深色' })).toHaveProperty('checked', true);
  });

  it('(AC-T18-11) (TC-20) Escape closes the panel', () => {
    render(<AccountMenu />);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
