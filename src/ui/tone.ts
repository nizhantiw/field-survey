export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export function toneFor(value: string): Tone {
  const v = value.trim().toLowerCase();
  if (v.includes('fail') || v.includes('reject')) return 'bad';
  if (v.includes('pending') || v.includes('blocked') || v.includes('needs_followup') || v.includes('not a completed') || v === 'manual') {
    return 'warn';
  }
  if (v === 'synced' || v === 'complete' || v === 'accepted' || v === 'owner' || v === 'device' || v.includes('complete ingestion')) {
    return 'ok';
  }
  if (v === 'queued' || v === 'uploading' || v === 'admin' || v === 'researcher' || v === 'fieldworker') return 'info';
  return 'neutral';
}
