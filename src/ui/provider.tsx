import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createHarnessBackend } from '../backend/harness';
import { createSupabaseBackend, loadBundledManifest } from '../backend/supabase-backend';
import type { FieldBackend, SessionUser } from '../backend/types';
import type { PublicConfig } from '../config/env';
import { openDatabase, type FieldSurveyDB } from '../db/db';

interface AppValue {
  config: Extract<PublicConfig, { ok: true }>;
  backend: FieldBackend;
  db: FieldSurveyDB;
  user: SessionUser | null;
  offlineSession: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
  editing: boolean;
  uploading: boolean;
  setEditing: (value: boolean) => void;
  setUploading: (value: boolean) => void;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider(props: { config: Extract<PublicConfig, { ok: true }>; children: ReactNode }) {
  const db = useMemo(() => openDatabase(), []);
  const backend = useMemo(
    () =>
      props.config.localHarness
        ? createHarnessBackend(props.config.harnessPassword, loadBundledManifest)
        : createSupabaseBackend(props.config.supabaseUrl, props.config.supabaseAnonKey, loadBundledManifest),
    [props.config],
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [offlineSession, setOfflineSession] = useState(false);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    try {
      const session = await Promise.race([
        backend.getSession(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2500)),
      ]);
      if (session) {
        setUser(session);
        setOfflineSession(false);
        await db.meta.put({ key: 'last-user', value: JSON.stringify(session) });
        return;
      }
    } catch {
      // Fall through to the cached offline session.
    }
    if (!navigator.onLine) {
      const cached = await db.meta.get('last-user');
      if (cached) {
        setUser(JSON.parse(cached.value) as SessionUser);
        setOfflineSession(true);
        return;
      }
    }
    setUser(null);
    setOfflineSession(false);
  };

  useEffect(() => {
    void refresh().finally(() => setReady(true));
    // The backend instance is stable for the lifetime of this provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AppValue = {
    config: props.config,
    backend,
    db,
    user,
    offlineSession,
    ready,
    refresh,
    editing,
    uploading,
    setEditing,
    setUploading,
  };
  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp requires AppProvider');
  return value;
}

export function tabId(): string {
  const existing = sessionStorage.getItem('fieldsurvey.tab');
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem('fieldsurvey.tab', id);
  return id;
}
