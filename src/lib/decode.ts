// jsqr is ~252 KB — the bulk of the bundle — but only needed when an image is
// actually scanned, not when pasting a URL. It's dynamic-imported on first use.
type JsQR = typeof import('jsqr').default;

let jsQR: JsQR | null = null;
let jsQRLoading: Promise<JsQR> | null = null;

/**
 * Load the QR decoder chunk. Call ahead of time (camera start, file select)
 * so the synchronous per-frame decode path never has to wait.
 */
export function ensureDecoderLoaded(): Promise<JsQR> {
  if (!jsQRLoading) {
    jsQRLoading = import('jsqr').then((module) => {
      jsQR = module.default;
      return jsQR;
    });
  }
  return jsQRLoading;
}

export interface QRContent {
  type: 'url' | 'text' | 'email' | 'phone' | 'sms' | 'wifi' | 'vcard' | 'geo' | 'unknown';
  text: string;
  raw: string;
  metadata?: {
    subject?: string;
    body?: string;
    phone?: string;
    ssid?: string;
    password?: string;
    encryption?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    latitude?: number;
    longitude?: number;
  };
}

/**
 * Decode every code visible in one frame's worth of image data (e.g. a live
 * camera capture), using the same find-and-mask loop as the file-upload path.
 * Unlike decodeAllQRFromFile, this skips the tiling/contrast passes — those
 * are too slow to run every animation frame, and a live feed gets another
 * shot at the next frame anyway. Mutates the passed ImageData.
 */
export function decodeAllQRFromImageData(image: ImageData): string[] {
  const found = new Set<string>();
  collectCodesInRegion(image, found);
  return Array.from(found);
}

export async function decodeQRFromFile(file: File): Promise<string> {
  const codes = await decodeAllQRFromFile(file);
  return codes[0];
}

// Images larger than this are downscaled (preserving aspect ratio — a forced
// square resize distorts QR modules and breaks decoding) before scanning.
const MAX_DECODE_DIMENSION = 2000;
// Cap the find-and-mask loop per region so a pathological image can't spin.
const MAX_CODES_PER_REGION = 6;

type QRLocation = NonNullable<ReturnType<JsQR>>['location'];

/** Paint white over a decoded code's bounding box so the next pass finds the next code. */
function maskLocation(image: ImageData, loc: QRLocation) {
  const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
  const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
  const pad = 4;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const x1 = Math.min(image.width - 1, Math.ceil(Math.max(...xs)) + pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const y1 = Math.min(image.height - 1, Math.ceil(Math.max(...ys)) + pad);
  const data = image.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * image.width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
}

/**
 * Decode every code in one region by repeatedly decoding and masking out the
 * hit. jsQR only ever reports a single code per call, so this is how a region
 * holding several codes yields all of them. Mutates the passed ImageData.
 */
function collectCodesInRegion(image: ImageData, found: Set<string>) {
  if (!jsQR) return;
  for (let i = 0; i < MAX_CODES_PER_REGION; i++) {
    const code = jsQR(image.data, image.width, image.height);
    if (!code) return;
    const text = code.data.trim();
    if (text) found.add(text);
    maskLocation(image, code.location);
  }
}

/** Tile offsets along one axis: half-tile steps, last tile anchored to the far edge. */
function tilePositions(dim: number, tile: number): number[] {
  const step = Math.ceil(tile / 2);
  const positions: number[] = [];
  for (let p = 0; p + tile < dim; p += step) positions.push(p);
  positions.push(Math.max(0, dim - tile));
  return Array.from(new Set(positions));
}

/**
 * Re-scan overlapping tiles and full-width/-height strips (scales 1/2 and
 * 1/3), optionally pre-processing each region before decoding. A phone photo
 * of a screen showing small QR codes needs this per-tile, not just once on
 * the full frame: a contrast fix that helps a small code can wash out
 * unrelated parts of a busy frame, and the full-frame pass alone doesn't
 * isolate the code the way a tile does.
 */
function sweepTiles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  found: Set<string>,
  prepare: (image: ImageData) => ImageData = (image) => image
) {
  for (const scale of [2, 3]) {
    const tileW = Math.ceil(width / scale);
    const tileH = Math.ceil(height / scale);
    if (tileW < 60 || tileH < 60) continue;
    const xs = tilePositions(width, tileW);
    const ys = tilePositions(height, tileH);
    for (const sy of ys) {
      for (const sx of xs) {
        const w = Math.min(tileW, width - sx);
        const h = Math.min(tileH, height - sy);
        collectCodesInRegion(prepare(ctx.getImageData(sx, sy, w, h)), found);
      }
    }
    for (const sy of ys) {
      collectCodesInRegion(prepare(ctx.getImageData(0, sy, width, Math.min(tileH, height - sy))), found);
    }
    for (const sx of xs) {
      collectCodesInRegion(prepare(ctx.getImageData(sx, 0, Math.min(tileW, width - sx), height)), found);
    }
  }
}

/**
 * Decode all QR codes in an image file.
 *
 * jsQR fails outright on images containing several codes — competing finder
 * patterns confuse its locator. Beyond the full-frame find-and-mask pass, the
 * image is rescanned as overlapping grid tiles and full-width/-height strips
 * (scales 1/2 and 1/3) so each code eventually appears in a region where it
 * dominates. Results are deduped by decoded content.
 */
export async function decodeAllQRFromFile(file: File): Promise<string[]> {
  // Kick off the decoder download in parallel with image validation/bitmap work
  const decoderReady = ensureDecoderLoaded();

  // Validate file type and size
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select an image file');
  }

  // Check file size (limit to 10MB to prevent browser crashes)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    throw new Error('Image file is too large. Please use an image under 10MB.');
  }

  if (file.size === 0) {
    throw new Error('Image file is empty');
  }

  let bitmap: ImageBitmap;
  try {
    // Explicit so EXIF-rotated phone photos decode consistently across
    // browsers that disagree on the spec's default (e.g. Firefox has
    // historically defaulted to 'none' instead of 'from-image').
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const largest = Math.max(bitmap.width, bitmap.height);
    if (largest > MAX_DECODE_DIMENSION) {
      const scale = MAX_DECODE_DIMENSION / largest;
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.round(bitmap.width * scale),
        resizeHeight: Math.round(bitmap.height * scale),
        resizeQuality: 'high'
      });
      bitmap.close();
      bitmap = resized;
    }
  } catch (err) {
    console.error('Failed to create image bitmap for QR decode', err);
    throw new Error('Unable to process this image. Please try a different image format.');
  }

  // Validate bitmap dimensions
  if (bitmap.width < 20 || bitmap.height < 20) {
    throw new Error('Image is too small to contain a QR code');
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  await decoderReady;

  try {
    ctx.drawImage(bitmap, 0, 0);
    const width = canvas.width;
    const height = canvas.height;
    const found = new Set<string>();

    // Pass 1: full frame, find-and-mask
    collectCodesInRegion(ctx.getImageData(0, 0, width, height), found);

    // Pass 2: overlapping tiles and strips. Grid tiles isolate codes that
    // confuse the full-frame locator; strips catch codes jsQR only resolves
    // with the full extent of one axis present.
    sweepTiles(ctx, width, height, found);

    // Pass 3 (nothing found yet): contrast/threshold variants on the full
    // frame for low-quality single-code photos. Rotation/inversion variants
    // aren't needed — jsQR is orientation-invariant and tries both polarities.
    if (found.size === 0) {
      collectCodesInRegion(enhanceImageForQR(ctx.getImageData(0, 0, width, height)), found);
    }
    if (found.size === 0) {
      collectCodesInRegion(adaptiveThreshold(ctx.getImageData(0, 0, width, height)), found);
    }

    // Pass 4 (still nothing — e.g. a phone photo of a screen, where moiré
    // and small QR codes against a busy background need both isolation and
    // contrast fixing at once): re-run the tile sweep with each region
    // contrast-enhanced first, since a fix that helps a small code can wash
    // out the rest of a busy frame if only applied once, full-frame.
    // (adaptiveThreshold is O(pixels × blockSize²) — too slow to repeat per
    // tile, so only the cheap linear enhanceImageForQR runs at this stage.)
    if (found.size === 0) {
      sweepTiles(ctx, width, height, found, enhanceImageForQR);
    }

    if (found.size === 0) {
      throw new Error(analyzeQRImage(ctx, width, height));
    }

    return Array.from(found);
  } catch (err) {
    console.error('QR decode failed', err);
    if (err instanceof Error && err.message.includes('No QR code detected')) {
      throw err;
    }
    throw new Error('Unable to read QR code from this image. Please try a clearer image.');
  } finally {
    // Clean up bitmap to free memory
    if ('close' in bitmap) {
      (bitmap as { close(): void }).close();
    }
  }
}

/**
 * Enhances image data to improve QR code detection by adjusting contrast and brightness
 */
function enhanceImageForQR(imageData: ImageData): ImageData {
  const data = imageData.data;
  const threshold = 128; // Simple threshold for binarization

  for (let i = 0; i < data.length; i += 4) {
    // Convert to grayscale
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

    // Apply threshold to create high contrast
    const value = gray > threshold ? 255 : 0;

    data[i] = value;     // Red
    data[i + 1] = value; // Green
    data[i + 2] = value; // Blue
    // Alpha channel (data[i + 3]) remains unchanged
  }

  return imageData;
}

/**
 * Applies adaptive thresholding to improve QR detection with logos or uneven lighting
 */
function adaptiveThreshold(imageData: ImageData): ImageData {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const blockSize = 15; // Size of the local neighborhood
  const C = 2; // Constant subtracted from the mean

  // Convert to grayscale first
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  // Apply adaptive threshold
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      // Calculate local mean
      for (let dy = -blockSize; dy <= blockSize; dy++) {
        for (let dx = -blockSize; dx <= blockSize; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            sum += gray[ny * width + nx];
            count++;
          }
        }
      }

      const localMean = sum / count;
      const idx = (y * width + x) * 4;
      const pixelValue = gray[y * width + x];

      const thresholded = pixelValue < (localMean - C) ? 0 : 255;
      data[idx] = thresholded;     // Red
      data[idx + 1] = thresholded; // Green
      data[idx + 2] = thresholded; // Blue
    }
  }

  return imageData;
}

/**
 * Analyzes the QR image to provide helpful feedback about detection failures
 */
function analyzeQRImage(ctx: CanvasRenderingContext2D, width: number, height: number): string {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Basic image analysis
  let contrast = 0;
  let brightness = 0;
  let edgeStrength = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    brightness += gray;

    if (i > width * 4) { // Check neighboring pixels for edge detection
      const prevGray = data[i - width * 4] * 0.299 + data[i - width * 4 + 1] * 0.587 + data[i - width * 4 + 2] * 0.114;
      edgeStrength += Math.abs(gray - prevGray);
    }
  }

  brightness /= (data.length / 4);
  contrast = edgeStrength / (data.length / 4);

  // Analyze common QR code detection issues
  const issues = [];

  if (contrast < 10) {
    issues.push("low contrast (try better lighting or use the black & white setting)");
  }

  if (brightness < 50 || brightness > 200) {
    issues.push("poor lighting (too dark or too bright)");
  }

  if (width < 100 || height < 100) {
    issues.push("image too small (try a higher resolution image)");
  }

  // Check for potential logo interference (simplified heuristic)
  const centerRegion = ctx.getImageData(width/3, height/3, width/3, height/3);
  const centerData = centerRegion.data;
  let centerVariation = 0;

  for (let i = 0; i < centerData.length; i += 4) {
    const gray = centerData[i] * 0.299 + centerData[i + 1] * 0.587 + centerData[i + 2] * 0.114;
    if (i > 0) {
      const prevGray = centerData[i - 4] * 0.299 + centerData[i - 4 + 1] * 0.587 + centerData[i - 4 + 2] * 0.114;
      centerVariation += Math.abs(gray - prevGray);
    }
  }

  if (centerVariation > centerData.length / 4 * 30) {
    issues.push("possible logo or design in center (try finding a cleaner version)");
  }

  // Build helpful error message
  let message = "No QR code detected. ";

  if (issues.length > 0) {
    message += "Possible issues: " + issues.join(", ") + ". ";
  }

  message += "Tips: Ensure the QR code is flat, well-lit, and clear. Try cropping closer to the QR code or using a different angle.";

  return message;
}

/**
 * Parses the raw QR code data into a structured QRContent object
 */
export function parseQRContent(data: string): QRContent {
  const trimmedData = data.trim();
  
  // Check for URL
  if (trimmedData.startsWith('http://') || trimmedData.startsWith('https://')) {
    return {
      type: 'url',
      text: trimmedData,
      raw: data
    };
  }
  
  // Check for email
  if (trimmedData.startsWith('mailto:')) {
    const email = trimmedData.substring(7);
    const [address, ...params] = email.split('?');
    const metadata: QRContent['metadata'] = {};
    
    if (params.length > 0) {
      const paramsStr = params.join('?');
      const urlParams = new URLSearchParams(paramsStr);
      
      if (urlParams.has('subject')) {
        metadata.subject = urlParams.get('subject') || undefined;
      }
      
      if (urlParams.has('body')) {
        metadata.body = urlParams.get('body') || undefined;
      }
    }
    
    return {
      type: 'email',
      text: address,
      raw: data,
      metadata
    };
  }
  
  // Check for phone
  if (trimmedData.startsWith('tel:') || trimmedData.startsWith('TEl:')) {
    return {
      type: 'phone',
      text: trimmedData.substring(4),
      raw: data,
      metadata: {
        phone: trimmedData.substring(4)
      }
    };
  }
  
  // Check for SMS
  if (trimmedData.startsWith('smsto:') || trimmedData.startsWith('SMS:')) {
    const parts = trimmedData.split(':');
    if (parts.length >= 2) {
      return {
        type: 'sms',
        text: parts[1],
        raw: data,
        metadata: {
          phone: parts[1],
          // Rejoin on ':' — the body itself may contain colons (e.g. URLs)
          body: parts.length > 2 ? parts.slice(2).join(':') : undefined
        }
      };
    }
  }
  
  // Check for WiFi
  if (trimmedData.startsWith('WIFI:')) {
    const wifiRegex = /^WIFI:(T:([^;]+);)?(S:([^;]+);)?(P:([^;]+);)?/;
    const match = wifiRegex.exec(trimmedData);

    if (match) {
      return {
        type: 'wifi',
        text: match[4] || 'Unknown Network',
        raw: data,
        metadata: {
          ssid: match[4],
          password: match[6],
          encryption: match[2] || 'nopass'
        }
      };
    }
  }
  
  // Check for vCard
  if (trimmedData.startsWith('BEGIN:VCARD')) {
    const firstNameRegex = /FN:(.+)/;
    const lastNameRegex = /LN:(.+)/;
    const emailRegex = /EMAIL:(.+)/;
    
    const firstNameMatch = firstNameRegex.exec(trimmedData);
    const lastNameMatch = lastNameRegex.exec(trimmedData);
    const emailMatch = emailRegex.exec(trimmedData);
    
    return {
      type: 'vcard',
      text: firstNameMatch ? firstNameMatch[1] : 'Contact',
      raw: data,
      metadata: {
        firstName: firstNameMatch ? firstNameMatch[1] : undefined,
        lastName: lastNameMatch ? lastNameMatch[1] : undefined,
        email: emailMatch ? emailMatch[1] : undefined
      }
    };
  }
  
  // Check for Geo location
  if (trimmedData.startsWith('geo:')) {
    const geoRegex = /^geo:([^,]+),([^,]+)/;
    const match = geoRegex.exec(trimmedData);

    if (match) {
      return {
        type: 'geo',
        text: `Location: ${match[1]}, ${match[2]}`,
        raw: data,
        metadata: {
          latitude: parseFloat(match[1] || '0'),
          longitude: parseFloat(match[2] || '0')
        }
      };
    }
  }
  
  // Default to plain text
  return {
    type: 'text',
    text: trimmedData,
    raw: data
  };
}