import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const QR_FIXTURE = 'docs/adilio.ca-qr.png';

async function qrBytes(): Promise<number[]> {
  return Array.from(await readFile(QR_FIXTURE));
}

test('Paste button reads and analyzes a QR image from the clipboard', async ({ page }) => {
  const bytes = await qrBytes();
  await page.addInitScript((imageBytes) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [{
          types: ['image/png'],
          getType: async () => new Blob([new Uint8Array(imageBytes)], { type: 'image/png' })
        }]
      }
    });
  }, bytes);

  await page.goto('/');
  await page.getByRole('button', { name: 'Paste' }).click();

  await expect(page.locator('.results-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Last scanned')).toBeVisible();
});

test('keyboard paste analyzes an image without uploading it', async ({ page }) => {
  const bytes = await qrBytes();
  await page.goto('/');

  await page.evaluate((imageBytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      [new Uint8Array(imageBytes)],
      'copied-qr.png',
      { type: 'image/png' }
    ));
    document.querySelector('main')!.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  }, bytes);

  await expect(page.locator('.results-card')).toBeVisible({ timeout: 15000 });
});

test('paste inside an editable field is left to the field', async ({ page }) => {
  await page.goto('/');

  const wasPrevented = await page.evaluate(() => {
    const input = document.createElement('input');
    document.querySelector('main')!.append(input);
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'https://example.com');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(wasPrevented).toBe(false);
  await expect(page.locator('.results-card')).toHaveCount(0);
});

test('a refused clipboard read offers the manual paste box', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => {
          throw new DOMException('Read permission denied', 'NotAllowedError');
        }
      }
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Paste' }).click();

  const catcher = page.getByRole('textbox', { name: 'Paste your copied QR image here' });
  await expect(catcher).toBeVisible();
  await expect(catcher).toBeFocused();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(catcher).toHaveCount(0);
});

test('a clipboard that reads but exposes nothing offers the manual paste box', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [] }
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Paste' }).click();

  await expect(page.getByRole('textbox', { name: 'Paste your copied QR image here' })).toBeVisible();
});

test('an image pasted into the manual box is decoded', async ({ page }) => {
  const bytes = await qrBytes();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [] }
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Paste' }).click();

  const catcher = page.getByRole('textbox', { name: 'Paste your copied QR image here' });
  await expect(catcher).toBeVisible();

  await page.evaluate((imageBytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(imageBytes)], 'pasted.png', { type: 'image/png' }));
    document.querySelector('.paste-catcher')!.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  }, bytes);

  await expect(catcher).toHaveCount(0);
  await expect(page.locator('.results-card')).toBeVisible({ timeout: 15000 });
});

test('clipboard actions remain usable at a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');

  const actions = page.locator('.action-buttons');
  await expect(actions).toBeVisible();
  await expect(page.getByRole('button', { name: 'Camera' })).toBeVisible();
  await expect(page.getByText('Upload', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paste' })).toBeVisible();

  const box = await actions.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
