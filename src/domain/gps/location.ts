import type { DeviceFix, LocationReading } from '../survey/types';

export interface GeoPosition {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
}

export interface GeoError {
  code: number;
  message: string;
}

export interface GeoProvider {
  getCurrentPosition(
    success: (position: GeoPosition) => void,
    error: (error: GeoError) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

export const PERMISSION_DENIED = 1;
export const POSITION_UNAVAILABLE = 2;
export const TIMEOUT = 3;

export type CaptureResult =
  | { ok: true; reading: LocationReading }
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'invalid'; message: string };

export function captureDeviceLocation(provider: GeoProvider, timeoutMs = 10_000): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CaptureResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        reason: 'timeout',
        message: 'Location request timed out. Your other answers are unchanged. Retry when you have a clearer view of the sky.',
      });
    }, timeoutMs + 50);
    try {
      provider.getCurrentPosition(
        (position) => {
          clearTimeout(timer);
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            finish({ ok: false, reason: 'invalid', message: 'The device returned an unusable location. No coordinates were saved.' });
            return;
          }
          finish({
            ok: true,
            reading: {
              latitude,
              longitude,
              accuracy: Number.isFinite(accuracy) ? accuracy : null,
              timestamp: new Date(position.timestamp || Date.now()).toISOString(),
              source: 'device',
            },
          });
        },
        (error) => {
          clearTimeout(timer);
          if (error.code === PERMISSION_DENIED) {
            finish({
              ok: false,
              reason: 'denied',
              message: 'Location permission was denied. No coordinates were recorded. You can retry or enter a manual location if this question allows it.',
            });
            return;
          }
          if (error.code === TIMEOUT) {
            finish({
              ok: false,
              reason: 'timeout',
              message: 'Location request timed out. Your other answers are unchanged. Retry when you have a clearer view of the sky.',
            });
            return;
          }
          finish({
            ok: false,
            reason: 'unavailable',
            message: 'Location is unavailable. No coordinates were recorded.',
          });
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
    } catch {
      clearTimeout(timer);
      finish({ ok: false, reason: 'unavailable', message: 'Location is unavailable. No coordinates were recorded.' });
    }
  });
}

export function applyManualAdjustment(original: LocationReading | null, latitude: number, longitude: number, now = new Date().toISOString()): LocationReading {
  const originalDevice: DeviceFix | undefined = original
    ? original.originalDevice ?? {
        latitude: original.latitude,
        longitude: original.longitude,
        accuracy: original.accuracy,
        timestamp: original.timestamp,
      }
    : undefined;
  const reading: LocationReading = {
    latitude,
    longitude,
    accuracy: null,
    timestamp: now,
    source: 'manual',
  };
  if (originalDevice && original?.source === 'device') reading.originalDevice = originalDevice;
  if (original?.source === 'manual' && original.originalDevice) reading.originalDevice = original.originalDevice;
  return reading;
}

export function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null || !Number.isFinite(accuracy)) return 'Accuracy unknown';
  return `± ${Math.round(accuracy)} m`;
}

/** Display fewer decimals when the fix is coarse so the UI does not imply extra precision. */
export function formatCoordinate(value: number, accuracy: number | null): string {
  const digits = accuracy === null ? 5 : accuracy > 100 ? 3 : accuracy > 10 ? 4 : accuracy > 1 ? 5 : 6;
  return value.toFixed(digits);
}

export function toGeoJsonPosition(reading: Pick<LocationReading, 'latitude' | 'longitude'>): [number, number] {
  return [reading.longitude, reading.latitude];
}
