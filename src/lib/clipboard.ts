export type ClipboardPayload =
  | { kind: 'image'; file: File }
  | { kind: 'text'; text: string };

export interface ClipboardSource {
  read?: () => Promise<ClipboardItem[]>;
  readText?: () => Promise<string>;
}

export class ClipboardUnavailableError extends Error {
  constructor() {
    super('Clipboard image access is unavailable.');
    this.name = 'ClipboardUnavailableError';
  }
}

function extensionForMimeType(type: string): string {
  const subtype = type.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/gi, '');
  return subtype || 'png';
}

export async function readClipboardPayload(source?: ClipboardSource): Promise<ClipboardPayload | null> {
  if (!source || (!source.read && !source.readText)) {
    throw new ClipboardUnavailableError();
  }

  if (source.read) {
    const items = await source.read();

    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) continue;

      const blob = await item.getType(imageType);
      return {
        kind: 'image',
        file: new File([blob], `clipboard.${extensionForMimeType(imageType)}`, { type: imageType })
      };
    }

    for (const item of items) {
      if (!item.types.includes('text/plain')) continue;

      const text = (await (await item.getType('text/plain')).text()).trim();
      if (text) {
        return { kind: 'text', text };
      }
    }
  }

  if (source.readText) {
    const text = (await source.readText()).trim();
    if (text) {
      return { kind: 'text', text };
    }
  }

  return null;
}

export function imageFileFromPaste(data: DataTransfer): File | null {
  const imageItem = Array.from(data.items || []).find((item) => item.type.startsWith('image/'));
  const fromItems = imageItem?.getAsFile() ?? null;
  if (fromItems) return fromItems;

  // Safari — iOS especially — often reports an empty `items` list while still
  // exposing the pasted image on `files`.
  return Array.from(data.files || []).find((file) => file.type.startsWith('image/')) ?? null;
}

export function isEditablePasteTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;

  return Boolean(element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

// Failures the manual paste box can still rescue: the browser either has no
// readable clipboard API, refused the programmatic read, or handed back nothing.
export function isRecoverableClipboardError(error: unknown): boolean {
  if (error instanceof ClipboardUnavailableError) return true;

  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError' || error.name === 'NotFoundError')
  );
}

export function clipboardErrorMessage(error: unknown): string {
  if (error instanceof ClipboardUnavailableError) {
    return 'This browser cannot read clipboard images. Use Upload instead.';
  }

  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Clipboard access was denied. Allow clipboard access, then try again—or use Upload.';
  }

  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'The copied image is no longer available. Copy it again or use Upload.';
  }

  return 'We could not read the clipboard. Copy the QR image again or use Upload.';
}
