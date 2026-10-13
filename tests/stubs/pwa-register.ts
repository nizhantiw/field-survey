export function registerSW(options?: { onNeedRefresh?: () => void; immediate?: boolean }) {
  void options;
  return async (_reload?: boolean) => undefined;
}
