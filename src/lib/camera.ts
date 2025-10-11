type LegacyNavigator = Navigator & {
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  webkitGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  mozGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  msGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
};

// eslint-disable-next-line no-unused-vars
type LegacyGetUserMediaFn = (constraints: MediaStreamConstraints, onSuccess: (stream: MediaStream) => void, onError: (err: unknown) => void) => void;

function resolveMediaDevices(): Pick<MediaDevices, 'getUserMedia'> | null {
  const nav = navigator as Navigator & {
    mediaDevices?: MediaDevices & { getUserMedia?: MediaDevices['getUserMedia'] };
  };
  const devices = nav.mediaDevices;
  if (devices?.getUserMedia) {
    return {
      getUserMedia: devices.getUserMedia.bind(devices)
    };
  }

  const legacy = navigator as LegacyNavigator;
  const legacyGetter = (
    legacy.getUserMedia ||
    legacy.webkitGetUserMedia ||
    legacy.mozGetUserMedia ||
    legacy.msGetUserMedia
  ) as unknown as LegacyGetUserMediaFn | undefined;

  if (!legacyGetter) {
    return null;
  }

  return {
    getUserMedia(constraints: MediaStreamConstraints) {
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
  // Use more specific constraints to help browsers remember permissions
  return devices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
}

export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}
