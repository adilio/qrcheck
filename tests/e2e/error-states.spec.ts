import { test, expect } from '@playwright/test';

test('shows validation when no URL provided', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a URL to analyze.');
});
