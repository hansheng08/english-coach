// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../test/setup';
import { PreviewBanner } from './PreviewBanner';

describe('PreviewBanner', () => {
  it('(AC-T52-7) (TC-14) is a note without buttons; detail text swaps for an unknown scenario', () => {
    const { unmount } = render(<PreviewBanner marker="m" unknownScenario={null} />);
    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('資料只在這個分頁，重新整理就回到初始狀態。')).toBeTruthy();
    unmount();

    render(<PreviewBanner marker="m" unknownScenario="nope" />);
    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('未知情境「nope」，改用 default')).toBeTruthy();
    expect(screen.queryByText('資料只在這個分頁，重新整理就回到初始狀態。')).toBeNull();
  });
});
