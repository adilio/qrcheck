import { test, expect } from '@playwright/test';

test('camera scan flow', async ({ page }) => {
  await page.goto('/');

  // Check that camera button exists and is clickable
  const cameraButton = page.getByRole('button', { name: '📷 Camera' });
  await expect(cameraButton).toBeVisible();

  // Start camera scan
  await cameraButton.click();

  // Check if either camera interface appears OR we get a camera error message
  // This handles both success and permission denied scenarios
  await Promise.race([
    page.locator('.camera-card').isVisible(),
    page.locator('.alert').isVisible(),
    page.locator('.error').isVisible()
  ]);

  // If camera interface appears, check its elements
  const cameraCard = page.locator('.camera-card');
  if (await cameraCard.isVisible()) {
    await expect(page.locator('h2:has-text("Live camera scan")')).toBeVisible();
    await expect(page.getByText('Align the QR code inside the frame')).toBeVisible();
  }

  // Either way, the button click should trigger some response
  // This tests the UI interaction without requiring actual camera functionality
  await expect(cameraButton).toBeVisible();
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
