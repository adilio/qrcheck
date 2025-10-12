import { test, expect } from '@playwright/test';

test('shows camera functionality and QR scanning interface', async ({ page }) => {
  await page.goto('/');

  // Check that the main interface is displayed
  await expect(page.getByText('Know before you scan')).toBeVisible();
  await expect(page.getByText('Get a quick verdict on any QR code without leaving your browser.')).toBeVisible();

  // Check that camera button is present (button)
  await expect(page.getByRole('button', { name: '📷 Camera' })).toBeVisible();

  // Check that upload button is present (label element)
  await expect(page.getByText('📁 Upload')).toBeVisible();

  // Check the step indicators
  await expect(page.getByText('Point camera')).toBeVisible();
  await expect(page.getByText('Check verdict')).toBeVisible();
  await expect(page.getByText('Share safely')).toBeVisible();
});
