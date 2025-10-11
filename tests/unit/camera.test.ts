import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cameraReadyHint, clearCameraFlag, ensureCameraAccess, getPermissionState } from '../../src/lib/camera';

const getUserMedia = vi.fn();
const permissionsQuery = vi.fn();

function mockNavigator() {
  Object.assign(globalThis, {
    navigator: {
      mediaDevices: { getUserMedia },
      permissions: { query: permissionsQuery }
    }
  });
}

describe('camera helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNavigator();
    Object.assign(globalThis, {
      window: {
        localStorage: {
          store: new Map<string, string>(),
          getItem(key: string) {
            return this.store.get(key) ?? null;
          },
          setItem(key: string, value: string) {
            this.store.set(key, value);
          },
          removeItem(key: string) {
            this.store.delete(key);
          }
        }
      }
    });
  });

  it('resolves permission state via API when available', async () => {
    permissionsQuery.mockResolvedValue({ state: 'granted' });
    expect(await getPermissionState()).toBe('granted');
  });

  it('marks hint as ready when flag exists', async () => {
    permissionsQuery.mockResolvedValue({ state: 'prompt' });
    window.localStorage.setItem('qrcheck_camera_ok', '1');
    const hint = await cameraReadyHint();
    expect(hint).toBe('ready');
  });

  it('sets flag after ensureCameraAccess', async () => {
    permissionsQuery.mockResolvedValue({ state: 'granted' });
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    const granted = await ensureCameraAccess();
    expect(granted).toBe(true);
    expect(window.localStorage.getItem('qrcheck_camera_ok')).toBe('1');
  });

  it('clears flag via helper', () => {
    window.localStorage.setItem('qrcheck_camera_ok', '1');
    clearCameraFlag();
    expect(window.localStorage.getItem('qrcheck_camera_ok')).toBeNull();
  });
});
