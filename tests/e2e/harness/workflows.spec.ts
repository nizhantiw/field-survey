import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function reloadWhileOffline(page: Page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ERR_INTERNET_DISCONNECTED')) throw error;
  }
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  const anyway = page.getByRole('button', { name: 'Sign out anyway' });
  const signedOut = page.getByRole('heading', { name: 'Sign in' });
  await expect(anyway.or(signedOut)).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(signedOut).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('harness-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
}

test('invalid credentials fail without a sensitive detail', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@fieldsurvey.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-in failed. Check your email and password.');
  await expect(page.getByRole('alert')).not.toContainText('stack');
});

test('P2 editor preserves labels and renders untrusted text safely', async ({ page }) => {
  await signIn(page, 'researcher@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await expect(page.getByRole('heading', { name: 'Form editor' })).toBeVisible();
  const label = page.getByLabel('Label for question 2');
  await expect(label).toHaveValue('Site name');
  await label.fill('<script>alert(1)</script>');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByLabel('Mobile preview').check();
  await expect(page.getByText('<script>alert(1)</script>')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Version 1' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 snapshot' })).toBeVisible();
  await expect(page.getByText('Site name (q_site_name)')).toBeVisible();
});

test('fieldworker cannot publish and can complete a conditional form', async ({ page }) => {
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collect' }).nth(1).click();
  await expect(page.getByRole('heading', { name: 'Wildlife count' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete record' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.getByLabel('Count').fill('0');
  await page.getByLabel('No').check();
  await expect(page.getByText('Evidence photo')).toHaveCount(0);
  await expect(page.locator('p[role="status"]', { hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Complete record' }).click();
  await expect(page.getByText('Local status: queued')).toBeVisible();
});

test('P3-07 a failed local write is visible and is not marked saved', async ({ page }) => {
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('button', { name: 'Collect' }).first().click();
  await page.evaluate(() => {
    window.__FS_FAULTS = { failSave: true };
  });
  await page.getByLabel('Site name').fill('Not written');
  await expect(page.getByText('The draft could not be saved on this device.')).toBeVisible();
  await expect(page.locator('p[role="status"]', { hasText: /^Saved$/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Site name')).toHaveValue('');
});

test('P3-01 answers survive reload and a persistent-profile restart', async ({ baseURL }) => {
  test.setTimeout(60_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldsurvey-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, { baseURL, serviceWorkers: 'block' });
  const page = context.pages()[0] ?? (await context.newPage());
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('button', { name: 'Collect' }).first().click();
  await page.getByLabel('Site name').fill('Cedar bend');
  await expect(page.locator('p[role="status"]', { hasText: /^Saved$/ })).toBeVisible();
  const url = page.url();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Site name')).toHaveValue('Cedar bend');
  await page.getByRole('link', { name: 'Drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible();
  await signOut(page);
  await signIn(page, 'viewer@fieldsurvey.test');
  await page.getByRole('link', { name: 'Drafts' }).click();
  await expect(page.getByText('No local records for this account.')).toBeVisible();
  await signOut(page);
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'Drafts' }).click();
  await page.getByRole('link', { name: 'Site visit' }).click();
  await expect(page.getByLabel('Site name')).toHaveValue('Cedar bend');
  expect(page.url()).toBe(url);
  await page.goto('about:blank');
  await context.close();

  const child = spawn(process.execPath, ['tests/e2e/harness/restart-profile.mjs'], {
    env: { ...process.env, FS_PROFILE: userDataDir, FS_BASE: baseURL ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  expect(exitCode, Buffer.concat(stderr).toString()).toBe(0);
  expect(Buffer.concat(stdout).toString()).toContain('Cedar bend');
});

test('P5 manual location is labeled and a denied fix does not invent coordinates', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 44.5, longitude: -110.2 });
  await context.grantPermissions([]);
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('button', { name: 'Collect' }).first().click();
  await page.getByRole('button', { name: 'Capture location' }).click();
  await expect(page.getByText(/No coordinates were recorded/)).toBeVisible();
  await page.getByLabel('Manual latitude').fill('44.2');
  await page.getByLabel('Manual longitude').fill('-110.4');
  await page.getByRole('button', { name: 'Save manual location' }).click();
  await expect(page.getByText('Manual', { exact: true })).toBeVisible();
  await expect(page.getByText(/Basemap unavailable|Coordinates-only/)).toBeVisible();
});

test('P8 pending ingestion stays out of the default review list and CSV escapes formulas', async ({ page }) => {
  await signIn(page, 'researcher@fieldsurvey.test');
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('link', { name: 'Review submissions' }).click();
  await expect(page.getByText('99999999-9999-4999-8999-999999999991')).toBeVisible();
  await expect(page.getByText('99999999-9999-4999-8999-999999999992')).toHaveCount(0);
  await page.getByLabel('Show pending ingestion').check();
  await expect(page.getByText('Pending — not a completed result')).toBeVisible();
  await page.getByRole('button', { name: 'Preview CSV' }).click();
  const preview = page.getByTestId('export-preview');
  await expect(preview).toContainText("'=cmd|calc");
  await expect(preview).not.toContainText('99999999-9999-4999-8999-999999999992');
});

test('P4-02 completes a downloaded survey with the network blocked', async ({ page, context }) => {
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'Prepare' }).click();
  await page.getByRole('button', { name: 'Download forms and map' }).click();
  await expect(page.getByText('Application shell cached: yes')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Forms downloaded: yes')).toBeVisible();
  await expect(page.getByText('Offline map verified: yes')).toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'North Basin Survey' }).click();
  await page.getByRole('link', { name: 'Riparian plots' }).click();
  await page.getByRole('button', { name: 'Collect' }).nth(1).click();
  await expect(page.getByRole('heading', { name: 'Wildlife count' })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Count').fill('1');
  await page.getByLabel('No').check();
  await expect(page.locator('p[role="status"]', { hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Complete record' }).click();
  await expect(page.getByText('Local status: queued')).toBeVisible();
});

test('P6 downloads the synthetic map and renders it with the network blocked', async ({ page, context }) => {
  await signIn(page, 'fieldworker@fieldsurvey.test');
  await page.getByRole('link', { name: 'Prepare' }).click();
  await page.getByRole('button', { name: 'Download forms and map' }).click();
  await expect(page.getByText('Application shell cached: yes')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Forms downloaded: yes')).toBeVisible();
  await expect(page.getByText('Offline map verified: yes')).toBeVisible();
  await page.getByRole('link', { name: 'Map' }).click();
  await expect(page.locator('p', { hasText: 'Synthetic FieldSurvey test tiles. Not for navigation.' })).toBeVisible();
  await expect(page.getByText(/outside the downloaded map/i)).toBeVisible();
  await expect(page.getByText(/zoom level was not included/i)).toBeVisible();
  const map = page.getByRole('region', { name: 'Downloaded map' });
  await expect(map.locator('img').first()).toBeVisible();
  await page.screenshot({ path: 'test-artifacts/p6-offline-map-online.png', fullPage: true });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await context.setOffline(true);
  await reloadWhileOffline(page);
  await expect(page.locator('p', { hasText: 'Synthetic FieldSurvey test tiles. Not for navigation.' })).toBeVisible();
  await expect(map.locator('img').first()).toBeVisible();
  expect(requests.filter((url) => url.includes('basemap.invalid') || url.includes('/map-package/'))).toEqual([]);
  await page.screenshot({ path: 'test-artifacts/p6-offline-map.png', fullPage: true });
});

test('P9-04 has no horizontal overflow at target widths', async ({ page }) => {
  await signIn(page, 'fieldworker@fieldsurvey.test');
  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('P9-05 exposes labels and has no serious axe violations on sign-in', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').focus();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
