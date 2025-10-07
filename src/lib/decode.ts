import jsQR from 'jsqr';

export function decodeQRFromImageData(image: ImageData): string {
  const code = jsQR(image.data, image.width, image.height);
  if (!code) {
    throw new Error('No QR code found');
  }
  return code.data.trim();
}

export async function decodeQRFromFile(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.error('Failed to create image bitmap for QR decode', err);
    throw new Error('No QR code found');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0);
  try {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return decodeQRFromImageData(image);
  } catch (err) {
    console.error('QR decode failed', err);
    throw new Error('No QR code found');
  }
}
