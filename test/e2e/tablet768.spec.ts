import { expect, test } from '@playwright/test';

test('(AC-T18-16) (TC-33) at 768 /login uses the phone layout: no focus card, the form only', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('每天 80 分鐘，把英文講得像 Senior。')).toBeHidden();
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
});

test('(AC-T18-16) (TC-33) at 768 the theme control is a bottom sheet, not a popover', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  await expect(page.getByRole('dialog', { name: '帳號與外觀' })).toHaveCSS('position', 'fixed');
});
