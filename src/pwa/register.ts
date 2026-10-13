import { registerSW } from 'virtual:pwa-register';

type ApplyUpdate = (reload?: boolean) => Promise<void>;

let applyUpdateFn: ApplyUpdate | null = null;
const listeners = new Set<() => void>();

export function bootServiceWorker(): void {
  if (applyUpdateFn || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      listeners.forEach((listener) => listener());
    },
  });
}

export function onAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyAppUpdate(): void {
  void applyUpdateFn?.(true);
}
