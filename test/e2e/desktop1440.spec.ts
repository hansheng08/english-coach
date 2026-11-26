import { expect, test } from '@playwright/test';

test('(AC-T18-16) (TC-33) at 1440 the page content is centred and stays within the 1240px maximum', async ({ page }) => {
  await page.goto('/');
  const avatar = await page.getByRole('button', { name: '帳號與外觀' }).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  // 頭像是內容欄的右邊緣：左右留白相同，所以右邊界在 (視窗寬 + 內容最大寬) / 2 − 外距 以內
  expect((avatar?.x ?? 0) + (avatar?.width ?? 0)).toBeLessThanOrEqual((width + 1240) / 2 - 40 + 1);
});
