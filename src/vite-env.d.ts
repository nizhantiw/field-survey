/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BASEMAP_URL?: string;
  readonly VITE_BASEMAP_ATTRIBUTION?: string;
  readonly VITE_LOCAL_HARNESS?: string;
  readonly VITE_HARNESS_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __FS_FAULTS?: {
    failSave?: boolean;
    failAttachment?: boolean;
    storageQuota?: { usage: number; quota: number };
    cancelDownload?: boolean;
    tokenRefreshAvailable?: boolean;
    syncFault?: { boundary: string; times: number; kind: string };
  };
}
