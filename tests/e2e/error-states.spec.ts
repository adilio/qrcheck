import { test, expect } from '@playwright/test';

test('shows camera functionality and QR scanning interface', async ({ page }) => {
  await page.goto('/');

  // Check that the main interface is displayed
  await expect(page.getByText('Know before you scan')).toBeVisible();

  // Check that camera button is present (button with Camera text)
  await expect(page.getByRole('button', { name: 'Camera' })).toBeVisible();

  // Check that upload button is present (label element)
  await expect(page.getByText('Upload')).toBeVisible();
});
