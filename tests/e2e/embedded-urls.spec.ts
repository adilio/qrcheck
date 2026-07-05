import { test, expect } from '@playwright/test';

function pasteText(text: string) {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('main')!.dispatchEvent(evt);
}

test('multi-URL text payload shows a chooser and analyzes only the chosen link', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(pasteText, 'Menu: https://example.com/menu — feedback at https://example.org/form');

  // Chooser appears with both links, neither analyzed yet
  await expect(page.getByText('2 links found in this content')).toBeVisible();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('example.org', { exact: true })).toBeVisible();

  // Pick the first link — only now does URL analysis run
  await page.getByRole('button', { name: 'Analyze' }).first().click();

  // The full URL flow runs on the chosen link
  await expect(page.locator('.results-card')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.final-url')).toContainText('example.com/menu');
});

test('text payload without links gets a type-appropriate verdict, no chooser', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(pasteText, 'hello world, plain text only');

  await expect(page.locator('.results-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('links found in this content')).toHaveCount(0);
  await expect(page.locator('.check-label', { hasText: 'Plain text' })).toBeVisible();
});
