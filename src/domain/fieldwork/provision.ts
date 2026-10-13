export interface ProvisionChecklist {
  appShellCached: boolean;
  signedIn: boolean;
  formsDownloaded: boolean;
  mapReady: boolean;
  mapRequired: boolean;
}

export function isFieldReady(checklist: ProvisionChecklist): boolean {
  if (!checklist.appShellCached || !checklist.signedIn || !checklist.formsDownloaded) return false;
  if (checklist.mapRequired && !checklist.mapReady) return false;
  return true;
}

export class StoragePressureError extends Error {
  constructor() {
    super('Not enough free space. FieldSurvey did not delete existing records.');
    this.name = 'StoragePressureError';
  }
}

export function assertStorageForDownload(
  estimate: { usage: number; quota: number } | null,
  bytesNeeded: number,
): void {
  if (!estimate) return;
  if (estimate.quota - estimate.usage < bytesNeeded) throw new StoragePressureError();
}

export const RETENTION_POLICY =
  'Signing out keeps unsynchronized records and photos on this device, scoped to the account that collected them. They are not deleted to free space. Remove them only with the explicit cleanup control after they are synced, or after you accept that unsynced work will be erased.';

export function logoutWarning(unsyncedCount: number): string | null {
  if (unsyncedCount < 1) return null;
  return `You have ${unsyncedCount} unsynchronized record${unsyncedCount === 1 ? '' : 's'} on this device. ${RETENTION_POLICY}`;
}

export function mayApplyAppUpdate(activity: { editing: boolean; uploading: boolean }): boolean {
  return !activity.editing && !activity.uploading;
}

export const FIRST_USE_OFFLINE =
  'This device has not been prepared for offline fieldwork. Connect to the internet, sign in, and finish Prepare for fieldwork before leaving coverage. A fresh install cannot open surveys or maps while offline.';
