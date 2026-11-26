import { expect, test } from '@playwright/test';

test('(AC-T18-16) (TC-33) at 1280 /login is split: focus card with the four portions, form at most 400px wide', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('每天 80 分鐘，把英文講得像 Senior。')).toBeVisible();
  for (const p of ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題']) await expect(page.getByText(p)).toBeVisible();
  const form = await page.locator('form').boundingBox();
  expect(form?.width).toBeLessThanOrEqual(400);
  expect(page.viewportSize()?.width).toBe(1280);
});

test('(AC-T18-16) (TC-33) at 1280 the theme control is a popover below the avatar, aligned to its right edge', async ({ page }) => {
  await page.goto('/');
  const avatar = page.getByRole('button', { name: '帳號與外觀' });
  await avatar.click();
  const panel = page.getByRole('dialog', { name: '帳號與外觀' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'absolute');
  const a = await avatar.boundingBox();
  const p = await panel.boundingBox();
  expect(p?.y ?? 0).toBeGreaterThanOrEqual((a?.y ?? 0) + (a?.height ?? 0));
  expect(Math.abs((p?.x ?? 0) + (p?.width ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0)))).toBeLessThanOrEqual(1);
});

test('(AC-T18-19) (TC-36) light: keyboard focus is a 2px gold-text outline offset 2px; hover darkens the 登入 button', async ({ page }) => {
  await page.goto('/login');
  const submit = page.getByRole('button', { name: '登入' });
  for (let i = 0; i < 4 && !(await submit.evaluate((n) => n === document.activeElement)); i += 1) await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await expect(submit).toHaveCSS('outline-width', '2px');
  await expect(submit).toHaveCSS('outline-offset', '2px');
  await expect(submit).toHaveCSS('outline-color', 'rgb(138, 98, 0)');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await submit.hover();
  await expect(submit).toHaveCSS('background-color', 'rgb(29, 53, 80)');
});

test('(AC-T18-19) (TC-36) dark: the focus outline is the dark gold-text', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ec-theme', 'dark');
  });
  await page.goto('/login');
  const submit = page.getByRole('button', { name: '登入' });
  for (let i = 0; i < 4 && !(await submit.evaluate((n) => n === document.activeElement)); i += 1) await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await expect(submit).toHaveCSS('outline-color', 'rgb(242, 193, 78)');
});

test('(AC-T18-19) (TC-36) prefers-reduced-motion: reduce → the popover appears without any animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  const panel = page.getByRole('dialog', { name: '帳號與外觀' });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((n) => n.getAnimations().length)).toBe(0);
});
