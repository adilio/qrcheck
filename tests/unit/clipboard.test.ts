import { describe, expect, it, vi } from 'vitest';
import {
  ClipboardUnavailableError,
  clipboardErrorMessage,
  imageFileFromPaste,
  isEditablePasteTarget,
  readClipboardPayload
} from '../../src/lib/clipboard';

function clipboardItem(types: Record<string, Blob>): ClipboardItem {
  return {
    types: Object.keys(types),
    getType: vi.fn(async (type: string) => types[type])
  } as unknown as ClipboardItem;
}

describe('readClipboardPayload', () => {
  it('prefers an image when the clipboard also contains text', async () => {
    const image = new Blob(['qr-image'], { type: 'image/png' });
    const text = new Blob(['https://example.com'], { type: 'text/plain' });

    const payload = await readClipboardPayload({
      read: vi.fn(async () => [clipboardItem({ 'text/plain': text, 'image/png': image })]),
      readText: vi.fn(async () => 'https://fallback.example')
    });

    expect(payload?.kind).toBe('image');
    if (payload?.kind === 'image') {
      expect(payload.file.name).toBe('clipboard.png');
      expect(payload.file.type).toBe('image/png');
    }
  });

  it('reads text from ClipboardItem data without requesting the clipboard twice', async () => {
    const readText = vi.fn(async () => 'https://fallback.example');
    const text = new Blob([], { type: 'text/plain' });
    Object.defineProperty(text, 'text', {
      value: vi.fn(async () => '  https://example.com/path  ')
    });
    const payload = await readClipboardPayload({
      read: vi.fn(async () => [
        clipboardItem({ 'text/plain': text })
      ]),
      readText
    });

    expect(payload).toEqual({ kind: 'text', text: 'https://example.com/path' });
    expect(readText).not.toHaveBeenCalled();
  });

  it('falls back to readText when the richer clipboard API is unavailable', async () => {
    const payload = await readClipboardPayload({
      readText: vi.fn(async () => '  hello world  ')
    });

    expect(payload).toEqual({ kind: 'text', text: 'hello world' });
  });

  it('returns null for an empty clipboard', async () => {
    const payload = await readClipboardPayload({
      read: vi.fn(async () => []),
      readText: vi.fn(async () => '  ')
    });

    expect(payload).toBeNull();
  });

  it('reports when no clipboard-reading API is available', async () => {
    await expect(readClipboardPayload()).rejects.toBeInstanceOf(ClipboardUnavailableError);
  });
});

describe('paste-event helpers', () => {
  it('extracts an image file from pasted data', () => {
    const file = new File(['qr-image'], 'copied-qr.png', { type: 'image/png' });
    const transfer = {
      items: [{ type: 'image/png', getAsFile: () => file }]
    } as unknown as DataTransfer;

    expect(imageFileFromPaste(transfer)).toBe(file);
  });

  it('does not treat plain text as an image', () => {
    const transfer = {
      items: [{ type: 'text/plain', getAsFile: () => null }]
    } as unknown as DataTransfer;

    expect(imageFileFromPaste(transfer)).toBeNull();
  });

  it('recognizes editable paste targets and their descendants', () => {
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editor.append(child);

    expect(isEditablePasteTarget(input)).toBe(true);
    expect(isEditablePasteTarget(child)).toBe(true);
    expect(isEditablePasteTarget(document.createElement('button'))).toBe(false);
  });
});

describe('clipboardErrorMessage', () => {
  it('offers upload when clipboard image reading is unsupported', () => {
    expect(clipboardErrorMessage(new ClipboardUnavailableError())).toContain('Use Upload instead');
  });

  it('explains permission denial without exposing browser error text', () => {
    const error = new DOMException('A browser-specific permission failure', 'NotAllowedError');

    expect(clipboardErrorMessage(error)).toBe(
      'Clipboard access was denied. Allow clipboard access, then try again—or use Upload.'
    );
  });
});
