import jsQR from 'jsqr';

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

export function decodeQRFromImageData(image: ImageData): string {
  const code = jsQR(image.data, image.width, image.height);
  if (!code) {
    throw new Error('No QR code found');
  }
  return code.data.trim();
}

export async function decodeQRFromFile(file: File): Promise<string> {
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
    // Try to create bitmap with options for better image processing
    bitmap = await createImageBitmap(file, {
      resizeWidth: Math.min(file.size ? 800 : 400, 1200), // Resize large images for better performance
      resizeHeight: Math.min(file.size ? 800 : 400, 1200),
      resizeQuality: 'high'
    });
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
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  try {
    // Draw the image and try multiple approaches for better QR detection
    ctx.drawImage(bitmap, 0, 0);

    // First attempt: normal orientation
    try {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return decodeQRFromImageData(image);
    } catch (err) {
      console.debug('Normal QR decode failed, trying alternatives');
    }

    // Second attempt: try with enhanced contrast
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const enhanced = enhanceImageForQR(imageData);
      return decodeQRFromImageData(enhanced);
    } catch (err) {
      console.debug('Enhanced QR decode failed');
    }

    // Third attempt: try adaptive thresholding for better logo detection
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const adaptive = adaptiveThreshold(imageData);
      return decodeQRFromImageData(adaptive);
    } catch (err) {
      console.debug('Adaptive threshold QR decode failed');
    }

    // Fourth attempt: try flipping the image (some QR codes might be upside down)
    try {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      ctx.restore();

      const flippedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return decodeQRFromImageData(flippedImage);
    } catch (err) {
      console.debug('Flipped QR decode failed');
    }

    // Fifth attempt: try with inverted colors (white on black QR codes)
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const inverted = invertColors(imageData);
      return decodeQRFromImageData(inverted);
    } catch (err) {
      console.debug('Inverted QR decode failed');
    }

    // If all attempts fail, analyze the image to provide helpful feedback
    const feedback = analyzeQRImage(ctx, canvas.width, canvas.height);
    throw new Error(feedback);

  } catch (err) {
    console.error('QR decode failed', err);
    if (err instanceof Error && err.message.includes('No QR code found')) {
      throw err;
    }
    throw new Error('Unable to read QR code from this image. Please try a clearer image.');
  } finally {
    // Clean up bitmap to free memory
    if ('close' in bitmap) {
      (bitmap as any).close();
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
 * Inverts colors to handle white-on-black QR codes
 */
function invertColors(imageData: ImageData): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];       // Red
    data[i + 1] = 255 - data[i + 1]; // Green
    data[i + 2] = 255 - data[i + 2]; // Blue
    // Alpha channel remains unchanged
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
          body: parts.length > 2 ? parts[2] : undefined
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