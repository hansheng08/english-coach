import { expect, test } from '@playwright/test';

test('(AC-T18-16) (TC-33) at 360 the theme sheet sits flush with the bottom of the window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  const panel = page.getByRole('dialog', { name: '帳號與外觀' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'fixed');
  const box = await panel.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - height)).toBeLessThanOrEqual(1);
});

test('(AC-T18-16) (TC-33) at 360 /login is only the form (no focus card)', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('每天 80 分鐘，把英文講得像 Senior。')).toBeHidden();
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
});
