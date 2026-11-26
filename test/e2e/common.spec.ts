import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const noHorizontalScroll = async (page: Page): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
};

test('(AC-T18-8) (TC-13) / and /login show 預覽：假資料 and make no request outside the preview server', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });
  await page.goto('/');
  await expect(page.getByText('預覽：假資料')).toBeVisible();
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByText('預覽：假資料')).toBeVisible();
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
  expect(foreign).toEqual([]);
});

test('(AC-T18-7) (TC-12) an unknown scenario falls back to default and says so, without an uncaught exception', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?scenario=nope');
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  await expect(page.getByText('未知情境「nope」，改用 default')).toBeVisible();
  expect(errors).toEqual([]);
});

test('(AC-T18-9) (TC-15) ?scenario=error: wrong credentials show the message and aria-invalid on the password', async ({ page }) => {
  await page.goto('/login?scenario=error');
  await page.getByLabel('Email').fill('a@example.com');
  await page.getByLabel('密碼').fill('x');
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByText('Email 或密碼不對，再試一次。')).toBeVisible();
  await expect(page.getByLabel('密碼')).toHaveAttribute('aria-invalid', 'true');
});

test('(AC-T18-9) (TC-16) default scenario: signing in goes to /', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('a@example.com');
  await page.getByLabel('密碼').fill('x');
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
});

test('(AC-T18-11) (TC-22) the chosen theme survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  await page.getByRole('radio', { name: '深色' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  await expect(page.getByRole('radio', { name: '深色' })).toBeChecked();
});

test.describe('(AC-T18-12) (TC-24) the inline script applies the theme before DOMContentLoaded', () => {
  const cases: readonly { readonly stored: string | null; readonly expected: string }[] = [
    { stored: 'dark', expected: 'dark' },
    { stored: 'light', expected: 'light' },
    { stored: 'system', expected: 'none' },
    { stored: 'blue', expected: 'none' },
    { stored: null, expected: 'none' },
  ];
  for (const c of cases) {
    test(`ec-theme=${c.stored ?? '(unset)'} → data-theme ${c.expected}`, async ({ page }) => {
      await page.addInitScript(
        ([stored]) => {
          if (stored !== null) localStorage.setItem('ec-theme', stored);
          document.addEventListener('DOMContentLoaded', () => {
            window.name = document.documentElement.dataset['theme'] ?? 'none';
          });
        },
        [c.stored] as const,
      );
      await page.goto('/login');
      expect(await page.evaluate(() => window.name)).toBe(c.expected);
      await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
    });
  }

  test('localStorage.getItem throwing → no data-theme and the page still renders', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('blocked');
      };
      document.addEventListener('DOMContentLoaded', () => {
        window.name = document.documentElement.dataset['theme'] ?? 'none';
      });
    });
    await page.goto('/login');
    expect(await page.evaluate(() => window.name)).toBe('none');
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
  });
});

test('(AC-T18-17) (TC-34) no horizontal scroll on /, /login and / with the theme sheet open', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  await expect(page.getByRole('dialog', { name: '帳號與外觀' })).toBeVisible();
  await noHorizontalScroll(page);
});
