import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/**
 * Decode-level tests. These drive `decodeAllQRFromFile` directly rather than
 * going through the UI, because what is under test is the escalation ladder
 * inside it — which pass finds which code — and that is invisible from the
 * rendered result.
 */
async function decode(page: import('@playwright/test').Page, path: string, type: string) {
  const bytes = Array.from(await readFile(path));
  return page.evaluate(
    async ({ imageBytes, mime, specifier }) => {
      // Resolved by the dev server at runtime, so the specifier is passed in
      // rather than written literally — tsc cannot resolve a served URL.
      const { decodeAllQRFromFile } = (await import(specifier)) as {
        decodeAllQRFromFile(file: File): Promise<string[]>;
      };
      const file = new File([new Uint8Array(imageBytes)], 'fixture', { type: mime });
      return decodeAllQRFromFile(file);
    },
    { imageBytes: bytes, mime: type, specifier: '/src/lib/decode.ts' }
  );
}

test('a photo of a screen showing two QR codes yields both', async ({ page }) => {
  await page.goto('/');

  // Regression guard: every pass after the first used to be gated on having
  // found *nothing*, so the cheap full-frame contrast pass would decode one
  // code and thereby skip the contrast-enhanced tile sweep — the only pass
  // that resolves both codes in a photo of a screen.
  const codes = await decode(page, 'tests/fixtures/two-qr-screen-photo.jpeg', 'image/jpeg');

  expect(codes.sort()).toEqual(['https://4dl.ca', 'https://adilio.ca']);
});

test('a clean single-code image still decodes', async ({ page }) => {
  await page.goto('/');

  const codes = await decode(page, 'docs/adilio.ca-qr.png', 'image/png');

  expect(codes).toEqual(['https://adilio.ca']);
});
