type LegacyNavigator = Navigator & {
  webkitGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  mozGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  msGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
};

function resolveMediaDevices(): Pick<MediaDevices, 'getUserMedia'> | null {
  const devices = navigator.mediaDevices;
  if (devices?.getUserMedia) {
    return devices;
  }

  const legacy = navigator as LegacyNavigator;
  const legacyGetter =
    legacy.getUserMedia || legacy.webkitGetUserMedia || legacy.mozGetUserMedia || legacy.msGetUserMedia;

  if (!legacyGetter) {
    return null;
  }

  return {
    getUserMedia(constraints) {
      return new Promise<MediaStream>((resolve, reject) => {
        legacyGetter.call(legacy, constraints, resolve, reject);
      });
    }
  };
}

export async function startCamera(): Promise<MediaStream> {
  const devices = resolveMediaDevices();
  if (!devices) {
    throw new Error('Camera access requires a secure context (HTTPS) and a supported browser');
  }
  return devices.getUserMedia({ video: { facingMode: 'environment' } });
}

export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}
