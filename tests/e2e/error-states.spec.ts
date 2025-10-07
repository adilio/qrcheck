import { test, expect } from '@playwright/test';

test('shows helpful message when no QR found', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type="file"]', 'tests/fixtures/blank.png');
  await expect(page.getByText('No QR code found')).toBeVisible();
});
