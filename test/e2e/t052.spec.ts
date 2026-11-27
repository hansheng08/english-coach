import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const FORMAT_MESSAGE = 'Email 格式不對，例如 name@example.com。';
const OFFLINE_TITLE = '需要連網才能登入';

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const THEMES = [
  { scheme: 'light', bad: '#B42318', badSoft: '#FDECEA', sunken: '#EEF0F3', ink2: '#56657A', ink3: '#5F6E82' },
  { scheme: 'dark', bad: '#FF8A7E', badSoft: '#3A1A17', sunken: '#0E1926', ink2: '#A7B1BF', ink3: '#7D8DA3' },
] as const;

/** 把 #RRGGBB（不分大小寫）換成 rgb(r, g, b)，和 computed style 同一種寫法。 */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no bounding box');
  return box;
}

/** 量位置、大小前，等元素與祖先上所有動畫結束。 */
async function settled(locator: Locator) {
  await locator.evaluate(async (el) => {
    const animations: Animation[] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) animations.push(...node.getAnimations());
    await Promise.all(animations.map((a) => a.finished));
  });
}

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

const css = (locator: Locator, property: string) => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

const emailInput = (page: Page) => page.getByLabel('Email');
const submitButton = (page: Page) => page.getByRole('button', { name: '登入' });
const formAlert = (page: Page) => page.getByRole('alert');
const offlineBar = (page: Page) => page.getByRole('status').filter({ hasText: '需要連網' });
const previewBar = (page: Page) => page.getByRole('note');

async function fillLogin(page: Page, email: string, password: string) {
  await emailInput(page).fill(email);
  await page.getByLabel('密碼').fill(password);
}

for (const { width, height } of [VIEWPORTS[0], VIEWPORTS[3]]) {
  test(`(AC-T52-3) (TC-7) offline login at ${String(width)}: notice + top bar, stays on /login, recovers`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await fillLogin(page, 'a@example.com', 'x');
    await context.setOffline(true);
    await submitButton(page).click();
    await expect(formAlert(page)).toContainText(OFFLINE_TITLE);
    await expect(offlineBar(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login/u);
    await expect(submitButton(page)).toBeFocused();
    await context.setOffline(false);
    await submitButton(page).click();
    await expect(page).toHaveURL(/\/$/u);
  });
}

for (const { width, height } of VIEWPORTS) {
  test(`(AC-T52-2) (AC-T52-6) (TC-8) malformed email at ${String(width)}: message under Email, focus, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await fillLogin(page, 'name', 'x');
    await submitButton(page).click();
    const message = page.getByText(FORMAT_MESSAGE);
    await expect(message).toBeVisible();
    await expect(emailInput(page)).toBeFocused();
    expect((await boxOf(message)).y).toBeGreaterThanOrEqual((await boxOf(emailInput(page))).y + (await boxOf(emailInput(page))).height);
    await noHorizontalScroll(page);
    if (width === 360) {
      expect((await boxOf(emailInput(page))).height).toBe(52);
      const button = await boxOf(submitButton(page));
      expect(button.width).toBeGreaterThanOrEqual(48);
      expect(button.height).toBeGreaterThanOrEqual(48);
    }
  });
}

for (const theme of THEMES) {
  test(`(AC-T52-5) (AC-T52-6) (TC-9) ${theme.scheme}: form notice and field error colours and position`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: 'reduce' });
    await page.goto('/login');
    await fillLogin(page, 'name', 'x');
    await submitButton(page).click();
    await expect(emailInput(page)).toHaveCSS('border-top-color', rgb(theme.bad));
    await expect(emailInput(page)).toHaveCSS('border-top-width', '2px');

    await fillLogin(page, 'a@example.com', 'x');
    await context.setOffline(true);
    await submitButton(page).click();
    const alert = formAlert(page);
    await expect(alert).toBeVisible();
    await settled(alert);
    expect(await css(alert, 'background-color')).toBe(rgb(theme.badSoft));
    expect(await css(alert, 'border-top-color')).toBe(rgb(theme.bad));
    const alertBox = await boxOf(alert);
    const formBox = await boxOf(page.locator('form'));
    expect(alertBox.y + alertBox.height).toBeLessThanOrEqual((await boxOf(emailInput(page))).y);
    expect(alertBox.x).toBeGreaterThanOrEqual(formBox.x);
    expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(formBox.x + formBox.width);
  });
}

for (const theme of THEMES) {
  for (const { width, height } of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`(AC-T52-7) (TC-10) preview banner style, ${theme.scheme} at ${String(width)}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: 'reduce' });
      await page.goto('/login');
      const bar = previewBar(page);
      await expect(bar).toBeVisible();
      await settled(bar);
      expect(await css(bar, 'background-color')).toBe(rgb(theme.sunken));
      expect(await css(bar, 'border-bottom-style')).toBe('dashed');
      expect(await css(bar, 'border-bottom-width')).toBe('1px');
      expect(await css(bar, 'border-bottom-color')).toBe(rgb(theme.ink3));
      const title = bar.locator('strong');
      expect(await css(title, 'font-size')).toBe('13px');
      expect(Number(await css(title, 'font-weight'))).toBeGreaterThanOrEqual(600);
      const detail = bar.getByText('資料只在這個分頁，重新整理就回到初始狀態。');
      expect(await css(detail, 'font-size')).toBe('12px');
      expect(await css(detail, 'color')).toBe(rgb(theme.ink2));
      await expect(bar.getByRole('button')).toHaveCount(0);
    });
  }
}

test('(AC-T52-7) (TC-11) preview banner sits above the offline bar in the same container on /login', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await context.setOffline(true);
  await expect(offlineBar(page)).toBeVisible();
  const sameContainer = await previewBar(page).evaluate((note) => {
    const status = [...document.querySelectorAll('[role="status"]')].find((el) => el.textContent.includes('需要連網'));
    return status !== undefined && status.parentElement === note.parentElement;
  });
  expect(sameContainer).toBe(true);
  expect((await boxOf(previewBar(page))).y).toBeLessThan((await boxOf(offlineBar(page))).y);
});

test('(AC-T52-8) (TC-12) banner detail wraps below the title at 360 and shares the line at 1280', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const { width, height, below } of [
    { width: 360, height: 640, below: true },
    { width: 1280, height: 800, below: false },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/login');
    const bar = previewBar(page);
    await settled(bar);
    const title = await boxOf(bar.locator('strong'));
    const detail = await boxOf(bar.getByText('資料只在這個分頁，重新整理就回到初始狀態。'));
    if (below) expect(detail.y).toBeGreaterThanOrEqual(title.y + title.height);
    else expect(detail.y).toBeLessThan(title.y + title.height);
  }
});

test('(AC-T52-8) (TC-13) unknown scenario with a long name is bad-coloured and does not scroll sideways at 360', async ({ page }) => {
  const name = 'x'.repeat(60);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(`/login?scenario=${name}`);
  const text = page.getByText(`未知情境「${name}」，改用 default`);
  await expect(text).toBeVisible();
  expect(await css(text, 'color')).toBe(rgb(THEMES[0].bad));
  await noHorizontalScroll(page);
});
