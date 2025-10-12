import { test, expect } from '@playwright/test';

test('manual URL flow', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('https://example.com').fill('https://httpbin.org/redirect/1');
  await page.getByRole('button', { name: 'Analyze' }).click();

  // Wait for either result or error
  await Promise.race([
    page.waitForSelector('.result-card', { timeout: 15000 }),
    page.waitForSelector('.error', { timeout: 15000 })
  ]);

  // Check if there's an error message first
  const errorElement = page.locator('.error');
  if (await errorElement.isVisible()) {
    console.log('Error found:', await errorElement.textContent());
  }

  await expect(page.getByText('Risk score')).toBeVisible();
  await expect(page.getByRole('button', { name: /Link path/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide reasons' })).toBeVisible();
});
