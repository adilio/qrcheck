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