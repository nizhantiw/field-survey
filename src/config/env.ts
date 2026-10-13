export const REQUIRED_PUBLIC_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

export type RequiredPublicEnv = (typeof REQUIRED_PUBLIC_ENV)[number];

export type PublicConfig =
  | {
      ok: true;
      supabaseUrl: string;
      supabaseAnonKey: string;
      localHarness: boolean;
      harnessPassword: string;
      basemapUrl: string | null;
      basemapAttribution: string | null;
    }
  | {
      ok: false;
      missing: RequiredPublicEnv[];
      message: string;
    };

export type EnvSource = Record<string, string | boolean | undefined>;

export function readPublicConfig(env: EnvSource = import.meta.env): PublicConfig {
  const url = stringValue(env.VITE_SUPABASE_URL);
  const anon = stringValue(env.VITE_SUPABASE_ANON_KEY);
  const missing: RequiredPublicEnv[] = [];
  if (!url) missing.push('VITE_SUPABASE_URL');
  if (!anon) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    return { ok: false, missing, message: setupMessage(missing) };
  }
  const basemapUrl = stringValue(env.VITE_BASEMAP_URL);
  const basemapAttribution = stringValue(env.VITE_BASEMAP_ATTRIBUTION);
  return {
    ok: true,
    supabaseUrl: url,
    supabaseAnonKey: anon,
    localHarness: env.VITE_LOCAL_HARNESS === '1',
    harnessPassword: stringValue(env.VITE_HARNESS_PASSWORD) || 'harness-password',
    basemapUrl,
    basemapAttribution,
  };
}

export function setupMessage(missing: readonly string[]): string {
  const list = missing.join(', ');
  return [
    `FieldSurvey cannot start because required configuration is missing: ${list}.`,
    'Copy .env.example to .env.local, create a Supabase project, and set the public project URL and anon key.',
    'Apply the SQL migrations in supabase/migrations, then restart the dev server.',
    'Put the service role key only in a server-side or test environment variable named SUPABASE_SERVICE_ROLE_KEY.',
    'Never prefix that key with VITE_. It must not be shipped to the browser.',
    'See README.md section "Setup" for the full checklist.',
  ].join(' ');
}

function stringValue(value: string | boolean | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** Names that must never be read by client code. Used by the secret scan test. */
export const SERVER_ONLY_ENV = ['SUPABASE_SERVICE_ROLE_KEY'] as const;
