const CAMERA_FLAG = 'qrcheck_camera_ok';

type PermissionState = 'granted' | 'denied' | 'prompt';

type LegacyNavigator = Navigator & {
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  webkitGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  mozGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
  msGetUserMedia?: typeof navigator.mediaDevices.getUserMedia;
};

type LegacyGetUserMediaFn = (
  constraints: MediaStreamConstraints,
  onSuccess: (stream: MediaStream) => void,
  onError: (err: unknown) => void
) => void;

function resolveMediaDevices(): Pick<MediaDevices, 'getUserMedia'> | null {
  if (typeof navigator === 'undefined') return null;
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

export async function getPermissionState(): Promise<PermissionState | 'prompt'> {
  if (typeof navigator === 'undefined') return 'prompt';
  if (!('permissions' in navigator)) return 'prompt';

  try {
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state;
  } catch {
    return 'prompt';
  }
}

export async function ensureCameraAccess(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const stream = await startCamera();
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(CAMERA_FLAG, '1');
      }
    } finally {
      stopCamera(stream);
    }
    return true;
  } catch (error) {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CAMERA_FLAG);
    }
    throw error;
  }
}

export async function cameraReadyHint(): Promise<'ready' | 'ask' | 'blocked'> {
  const permission = await getPermissionState();
  const hasFlag = typeof window !== 'undefined' && window.localStorage.getItem(CAMERA_FLAG) === '1';

  if (permission === 'granted' || hasFlag) {
    return 'ready';
  }

  if (permission === 'denied') {
    return 'blocked';
  }

  return 'ask';
}

export function clearCameraFlag() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CAMERA_FLAG);
  }
}
