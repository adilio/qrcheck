import { test, expect } from '@playwright/test';

test('manual URL flow', async ({ page }) => {
  await page.goto('/');

  // Open the scan modal
  await page.getByRole('button', { name: 'Scan or upload QR' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan or upload a QR code' })).toBeVisible();

  // Fill in the manual URL input
  await page.getByPlaceholder('https://example.com').fill('https://start.example');
  await page.getByRole('button', { name: 'Analyze' }).click();

  // Check for results
  await expect(page.getByText(/Risk score/)).toBeVisible();
  await expect(page.getByText('Redirect history')).toBeVisible();
});
