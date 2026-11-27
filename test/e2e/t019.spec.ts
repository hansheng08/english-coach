import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const OFFLINE_TITLE = '需要連網';
const OFFLINE_DETAIL = '目前沒有網路，連上後再繼續。';
const PANEL_TITLE = '今天的課表要連網才能載入';
const UPDATE_TITLE = '有新版本';
const ICON_FILES = ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'];

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

/** SW 已安裝並啟用（precache 完成）後才往下。 */
async function serviceWorkerReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

const offlineBar = (page: Page) => page.getByRole('status').filter({ hasText: OFFLINE_TITLE });
const updateCard = (page: Page) => page.getByRole('status').filter({ hasText: UPDATE_TITLE });

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function themeColors(page: Page) {
  return page.evaluate(() =>
    [...document.head.querySelectorAll('meta[name="theme-color"]')].map((m) => ({ media: m.getAttribute('media'), content: m.getAttribute('content') })),
  );
}

test.describe('service worker cache', () => {
  test('(AC-T19-4) (TC-5) Cache Storage holds only same-origin shell URLs, the four icons, and nothing under /functions/', async ({ page, baseURL }) => {
    await page.goto('/');
    await serviceWorkerReady(page);
    const urls = await page.evaluate(async () => {
      const found: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) found.push(request.url);
      }
      return found;
    });
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).origin).toBe(origin);
      expect(url).not.toContain('/functions/');
    }
    for (const icon of ICON_FILES) expect(urls.some((u) => u.endsWith(`/icons/${icon}`))).toBe(true);
  });

  test('(AC-T19-1) (AC-T19-2) the served manifest is linked from the page and its four icons are fetchable', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).not.toBeNull();
    const manifest = (await (await request.get(href ?? '/manifest.webmanifest')).json()) as {
      theme_color: string;
      background_color: string;
      icons: { src: string; purpose: string }[];
    };
    expect(manifest.theme_color).toBe('#0F2236');
    expect(manifest.background_color).toBe('#0F2236');
    expect(manifest.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable', 'maskable']);
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  });
});

test.describe('offline', () => {
  test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

  test('(AC-T19-5) (TC-7) going offline shows the status bar without a button; coming back removes it', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '帳號與外觀' })).toBeVisible();
    await expect(offlineBar(page)).toHaveCount(0);
    await context.setOffline(true);
    const bar = offlineBar(page);
    await expect(bar).toBeVisible();
    await expect(bar.locator('strong')).toHaveText(OFFLINE_TITLE);
    await expect(bar).toContainText(OFFLINE_DETAIL);
    await expect(bar.getByRole('button')).toHaveCount(0);
    await context.setOffline(false);
    await expect(bar).toHaveCount(0);
  });

  test('(AC-T19-6) (TC-8) reloading offline shows the shell from precache with the bar and the panel; the reload button reloads', async ({ page, context }) => {
    await page.goto('/');
    await serviceWorkerReady(page);
    await context.setOffline(true);
    await page.reload();
    await expect(offlineBar(page)).toBeVisible();
    await expect(page.getByText(PANEL_TITLE)).toBeVisible();
    const button = page.getByRole('button', { name: '重新載入' });
    expect(Math.round((await boxOf(button)).height)).toBe(52);
    await page.evaluate(() => {
      Reflect.set(window, '__ecBeforeReload', true);
    });
    await button.click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__ecBeforeReload') as unknown)).toBeUndefined();
    await expect(page.getByText(PANEL_TITLE)).toBeVisible();
  });
});

for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
  test.describe(`stacking at ${String(vp.width)}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });

    test(`(AC-T19-8) (TC-11) preview bar above the offline bar in one sticky container at top 0, still at the top after scrolling (${String(vp.width)})`, async ({
      page,
      context,
    }) => {
      await page.goto('/');
      await expect(page.getByRole('note')).toBeVisible();
      await context.setOffline(true);
      const bar = offlineBar(page);
      await expect(bar).toBeVisible();
      const preview = page.getByRole('note');
      const container = preview.locator('xpath=..');
      expect(await bar.locator('xpath=..').evaluate((el, other) => el === other, await container.elementHandle())).toBe(true);
      await expect(container).toHaveCSS('position', 'sticky');
      await expect(container).toHaveCSS('top', '0px');
      expect((await boxOf(preview)).y).toBeLessThan((await boxOf(bar)).y);

      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '3000px';
        document.getElementById('root')?.append(spacer);
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect((await boxOf(preview)).y).toBe(0);
      expect((await boxOf(bar)).y).toBeGreaterThan(0);
      expect((await boxOf(container)).y).toBe(0);
    });
  });
}

test.describe('update card', () => {
  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

    test('(AC-T19-9) (TC-12) (TC-13) 12px from the sides, 76px from the bottom, the last content above it, and the button is at least 48x88', async ({ page }) => {
      await page.goto('/?pwa=update');
      const card = updateCard(page);
      await expect(card).toBeVisible();
      await expect(card).toContainText('按更新會重新載入頁面。');
      const box = await boxOf(card);
      expect(Math.round(box.x)).toBe(12);
      expect(Math.round(360 - (box.x + box.width))).toBe(12);
      expect(Math.round(640 - (box.y + box.height))).toBe(76);
      const hint = await boxOf(page.getByText('今日任務會顯示在這裡。'));
      expect(hint.y + hint.height).toBeLessThanOrEqual(box.y);
      const button = await boxOf(card.getByRole('button', { name: '更新' }));
      expect(button.height).toBeGreaterThanOrEqual(47.99);
      expect(button.width).toBeGreaterThanOrEqual(87.99);
      await expect(card.getByRole('button')).toHaveCount(1);
    });

    test('(AC-T19-9) (TC-12) with the card shown the content area gets 184px of bottom padding on a phone', async ({ page }) => {
      await page.goto('/?pwa=update');
      await expect(updateCard(page)).toBeVisible();
      const padding = await page
        .getByText('今日任務會顯示在這裡。')
        .evaluate((el) => {
          const area = el.closest('main')?.parentElement?.parentElement;
          return area === null || area === undefined ? '' : getComputedStyle(area).paddingBottom;
        });
      expect(padding).toBe('184px');
    });
  });

  test.describe('on a desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, colorScheme: 'light', reducedMotion: 'no-preference' });

    test('(AC-T19-9) (TC-12) 24px from the right and bottom, 380px wide', async ({ page }) => {
      await page.goto('/?pwa=update');
      const card = updateCard(page);
      await expect(card).toBeVisible();
      const box = await boxOf(card);
      expect(Math.round(1280 - (box.x + box.width))).toBe(24);
      expect(Math.round(800 - (box.y + box.height))).toBe(24);
      expect(Math.round(box.width)).toBe(380);
    });

    test('(AC-T19-9) (TC-13) tabbing to update shows a 2px gold-text ring offset by 2px', async ({ page }) => {
      await page.goto('/?pwa=update');
      const button = updateCard(page).getByRole('button', { name: '更新' });
      await expect(button).toBeVisible();
      for (let i = 0; i < 6; i += 1) {
        if (await button.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press('Tab');
      }
      await expect(button).toBeFocused();
      await expect(button).toHaveCSS('outline-width', '2px');
      await expect(button).toHaveCSS('outline-offset', '2px');
      await expect(button).toHaveCSS('outline-color', 'rgb(138, 98, 0)');
    });

    test('(AC-T19-7) the card stays until update is pressed: no automatic reload', async ({ page }) => {
      await page.goto('/?pwa=update');
      await expect(updateCard(page)).toBeVisible();
      await page.evaluate(() => {
        Reflect.set(window, '__ecStillHere', true);
      });
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => Reflect.get(window, '__ecStillHere') as unknown)).toBe(true);
      await expect(updateCard(page)).toBeVisible();
    });
  });
});

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, reducedMotion: 'reduce' });

  test('(AC-T19-10) (TC-14) the offline bar and the update card appear without an animation', async ({ page, context }) => {
    await page.goto('/?pwa=update');
    const card = updateCard(page);
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
    await context.setOffline(true);
    const bar = offlineBar(page);
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => el.getAnimations().length)).toBe(0);
  });
});

test.describe('theme-color', () => {
  test('(AC-T19-12) (TC-18) choosing dark leaves one theme-color #0A1420, before and after a reload', async ({ page }) => {
    await page.goto('/');
    expect(await themeColors(page)).toEqual([
      { media: '(prefers-color-scheme: light)', content: '#F4F5F7' },
      { media: '(prefers-color-scheme: dark)', content: '#0A1420' },
    ]);
    await page.getByRole('button', { name: '帳號與外觀' }).click();
    await page.getByRole('radio', { name: '深色' }).check();
    expect(await themeColors(page)).toEqual([{ media: null, content: '#0A1420' }]);
    await page.reload();
    await expect(page.getByRole('button', { name: '帳號與外觀' })).toBeVisible();
    expect(await themeColors(page)).toEqual([{ media: null, content: '#0A1420' }]);
  });

  test('(AC-T19-12) choosing light then system restores the media pair', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '帳號與外觀' }).click();
    await page.getByRole('radio', { name: '淺色' }).check();
    expect(await themeColors(page)).toEqual([{ media: null, content: '#F4F5F7' }]);
    await page.getByRole('radio', { name: '跟隨系統' }).check();
    expect((await themeColors(page)).map((m) => m.media)).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
  });
});

for (const vp of VIEWPORTS) {
  test.describe(`${String(vp.width)}x${String(vp.height)} system notices`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 500, reducedMotion: 'reduce' });

    test(`(AC-T19-13) (TC-19) the offline bar and the cold-open panel are visible with no horizontal scroll at ${String(vp.width)}`, async ({ page, context }) => {
      await page.goto('/');
      await serviceWorkerReady(page);
      await context.setOffline(true);
      await expect(offlineBar(page)).toBeVisible();
      await noHorizontalScroll(page);
      await page.reload();
      await expect(offlineBar(page)).toBeVisible();
      await expect(page.getByText(PANEL_TITLE)).toBeVisible();
      await noHorizontalScroll(page);
      if (vp.width < 500) {
        const box = await boxOf(page.getByRole('button', { name: '重新載入' }));
        expect(box.width).toBeGreaterThanOrEqual(47.99);
        expect(box.height).toBeGreaterThanOrEqual(47.99);
      }
    });

    test(`(AC-T19-13) (TC-19) the update card is visible with no horizontal scroll at ${String(vp.width)}`, async ({ page }) => {
      await page.goto('/?pwa=update');
      const card = updateCard(page);
      await expect(card).toBeVisible();
      await noHorizontalScroll(page);
      if (vp.width < 500) {
        const box = await boxOf(card.getByRole('button', { name: '更新' }));
        expect(box.width).toBeGreaterThanOrEqual(47.99);
        expect(box.height).toBeGreaterThanOrEqual(47.99);
      }
    });
  });
}
