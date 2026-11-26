import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// 360、412 用觸控模擬：所有看得到的可點元素 ≥48×48；登入頁輸入框高 52；.seg 每格 ≥48。
const smallTargets = async (page: Page): Promise<string[]> => {
  const small: string[] = [];
  for (const el of await page.locator('button, a, input, [role=radio]').all()) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (box === null) continue;
    if (box.width < 48 || box.height < 48) {
      small.push(`${await el.evaluate((n) => n.tagName)} ${String(box.width)}x${String(box.height)}`);
    }
  }
  return small;
};

test('(AC-T18-18) (TC-35) the pointer is coarse on touch viewports', async ({ page }) => {
  await page.goto('/login');
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
});

test('(AC-T18-18) (TC-35) every visible tap target on /login is at least 48x48 and the inputs are 52 high', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  for (const name of ['Email', '密碼']) {
    const box = await page.getByLabel(name).boundingBox();
    expect(box?.height).toBe(52);
  }
});

test('(AC-T18-18) (TC-35) every visible tap target on / and in the theme sheet is at least 48x48', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  await expect(page.getByRole('dialog', { name: '帳號與外觀' })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  for (const name of ['淺色', '深色', '跟隨系統']) {
    const box = await page.getByRole('radio', { name }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
});
