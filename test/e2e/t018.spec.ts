import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const HERO_TEXT = '每天 80 分鐘，把英文講得像 Senior。';
const BANNER = '預覽：假資料';

const VIEWPORTS = [
  { width: 360, height: 640, touch: true },
  { width: 412, height: 915, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 1440, height: 900, touch: false },
] as const;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no bounding box');
  return box;
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: '帳號與外觀' }).click();
  const dialog = page.getByRole('dialog', { name: '帳號與外觀' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test.describe('mock preview', () => {
  test('(AC-T18-8) (TC-13) "/" and "/login" show the preview banner and make no request besides the preview server', async ({ page, baseURL }) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      urls.push(request.url());
    });
    await page.goto('/');
    await expect(page.getByRole('note')).toContainText(BANNER);
    await page.goto('/login');
    await expect(page.getByRole('note')).toContainText(BANNER);
    const external = urls.filter((u) => /^https?:/.test(u) && !u.startsWith(baseURL ?? 'http://localhost'));
    expect(external).toEqual([]);
  });

  test('(AC-T18-7) (TC-12) an unknown scenario shows the notice and the page still renders', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto('/?scenario=nope');
    await expect(page.getByText('未知情境「nope」，改用 default')).toBeVisible();
    await expect(page.getByRole('button', { name: '帳號與外觀' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('(AC-T18-9) (TC-15) (TC-16) the error scenario rejects the login; the default scenario signs in', async ({ page }) => {
    await page.goto('/login?scenario=error');
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByLabel('密碼').fill('x');
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page.getByText('Email 或密碼不對，再試一次。')).toBeVisible();
    await expect(page.getByLabel('密碼')).toHaveAttribute('aria-invalid', 'true');

    await page.goto('/login');
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByLabel('密碼').fill('x');
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: '帳號與外觀' })).toBeVisible();
  });
});

test.describe('theme', () => {
  test('(AC-T18-11) (TC-22) the chosen theme survives a reload', async ({ page }) => {
    await page.goto('/');
    await openMenu(page);
    await page.getByRole('radio', { name: '深色' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openMenu(page);
    await expect(page.getByRole('radio', { name: '深色' })).toBeChecked();
  });

  for (const value of ['dark', 'light']) {
    test(`(AC-T18-12) (TC-24) ec-theme=${value} is applied before DOMContentLoaded`, async ({ page }) => {
      await page.addInitScript((v) => {
        localStorage.setItem('ec-theme', v);
        document.addEventListener('DOMContentLoaded', () => {
          Reflect.set(window, '__ecThemeAtDcl', document.documentElement.dataset['theme'] ?? null);
        });
      }, value);
      await page.goto('/login');
      expect(await page.evaluate(() => Reflect.get(window, '__ecThemeAtDcl') as unknown)).toBe(value);
    });
  }

  for (const value of ['system', 'blue', null]) {
    test(`(AC-T18-12) (TC-24) ec-theme=${String(value)} leaves data-theme unset and the page renders`, async ({ page }) => {
      await page.addInitScript((v) => {
        if (v !== null) localStorage.setItem('ec-theme', v);
      }, value);
      await page.goto('/login');
      await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset['theme'] ?? null)).toBeNull();
    });
  }

  test('(AC-T18-12) (TC-24) a throwing localStorage.getItem does not break the page', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('denied');
      };
    });
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'] ?? null)).toBeNull();
  });
});

for (const vp of VIEWPORTS) {
  test.describe(`${String(vp.width)}x${String(vp.height)}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch && vp.width < 500,
      reducedMotion: 'reduce',
      colorScheme: 'light',
    });

    test(`(AC-T18-17) (TC-34) no horizontal scroll on "/", "/login" and "/" with the menu open at ${String(vp.width)}`, async ({ page }) => {
      await page.goto('/login');
      await noHorizontalScroll(page);
      await page.goto('/');
      await noHorizontalScroll(page);
      await openMenu(page);
      await noHorizontalScroll(page);
    });

    test(`(AC-T18-16) (TC-33) layout switches at 900px (${String(vp.width)})`, async ({ page }) => {
      await page.goto('/login');
      const hero = page.getByText(HERO_TEXT);
      const form = page.locator('form');
      if (vp.width >= 900) {
        await expect(hero).toBeVisible();
        for (const item of ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題']) await expect(page.getByText(item)).toBeVisible();
        expect((await boxOf(form)).width).toBeLessThanOrEqual(400);
      } else {
        await expect(hero).toBeHidden();
        await expect(form).toBeVisible();
      }

      await page.goto('/');
      const dialog = await openMenu(page);
      const box = await boxOf(dialog);
      if (vp.width >= 900) {
        const avatar = await boxOf(page.getByRole('button', { name: '帳號與外觀' }));
        expect(box.y).toBeGreaterThanOrEqual(avatar.y + avatar.height);
        expect(Math.abs(box.x + box.width - (avatar.x + avatar.width))).toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(box.y + box.height - vp.height)).toBeLessThanOrEqual(1);
        expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
      }
    });

    if (vp.width < 500) {
      test(`(AC-T18-18) (TC-35) every visible tap target is at least 48x48 at ${String(vp.width)}`, async ({ page }) => {
        const check = async () => {
          for (const element of await page.locator('button, a, input, [role=radio]').all()) {
            if (!(await element.isVisible())) continue;
            const box = await boxOf(element);
            expect(box.width).toBeGreaterThanOrEqual(47.99);
            expect(box.height).toBeGreaterThanOrEqual(47.99);
          }
        };
        await page.goto('/login');
        await check();
        for (const name of ['Email', '密碼']) expect(Math.round((await boxOf(page.getByLabel(name))).height)).toBe(52);
        await page.goto('/');
        await check();
        await openMenu(page);
        await check();
      });
    }
  });
}

test.describe('desktop focus, hover and motion', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, colorScheme: 'light', reducedMotion: 'no-preference' });

  test('(AC-T18-19) (AC-T18-30) (TC-36) (TC-54) light: focus ring is 2px gold-text with a 2px offset; hover turns the button btn-hover', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByRole('button', { name: '登入' });
    await expect(button).toBeVisible();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('outline-width', '2px');
    await expect(button).toHaveCSS('outline-offset', '2px');
    await expect(button).toHaveCSS('outline-color', 'rgb(138, 98, 0)');
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(29, 53, 80)');
  });

  test('(AC-T18-19) (TC-36) reduced motion: the popover appears without an animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const dialog = await openMenu(page);
    expect(await dialog.evaluate((el) => el.getAnimations().length)).toBe(0);
  });
});

test.describe('desktop dark focus', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, colorScheme: 'dark' });

  test('(AC-T18-19) (AC-T18-30) (TC-36) (TC-54) dark: the focus ring is the gold color', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByRole('button', { name: '登入' });
    await expect(button).toBeVisible();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('outline-color', 'rgb(242, 193, 78)');
  });

  test('(AC-T18-29) (TC-51) the served build is the mock build', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(BANNER).first()).toBeVisible();
  });
});
