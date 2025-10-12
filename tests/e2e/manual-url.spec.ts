import { test, expect } from '@playwright/test';

test('camera scan flow', async ({ page }) => {
  await page.goto('/');

  // Start camera scan
  await page.getByRole('button', { name: '📷 Camera' }).click();

  // Wait for camera interface to appear
  await expect(page.getByText('Live camera scan')).toBeVisible();
  await expect(page.getByText('Align the QR code inside the frame')).toBeVisible();

  // Check that video element is present
  const videoElement = page.locator('video');
  await expect(videoElement).toBeVisible();

  // Check for stop scanning button
  await expect(page.getByRole('button', { name: 'Stop scanning' })).toBeVisible();
});

test('theme toggle functionality', async ({ page }) => {
  await page.goto('/');

  // Check theme toggle button is present
  await expect(page.getByTitle('Switch to light mode')).toBeVisible();

  // Click theme toggle
  await page.getByTitle('Switch to light mode').click();

  // Check that title changed to switch to dark mode
  await expect(page.getByTitle('Switch to dark mode')).toBeVisible();
});
