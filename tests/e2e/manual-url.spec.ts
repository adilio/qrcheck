import { test, expect } from '@playwright/test';

test('manual URL flow', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('https://example.com').fill('https://start.example');
  await page.getByRole('button', { name: 'Analyze' }).click();

  await expect(page.getByText('Risk score')).toBeVisible();
  await expect(page.getByRole('button', { name: /Link path/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide reasons' })).toBeVisible();
});
