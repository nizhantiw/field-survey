import { expect, test, type Page } from '@playwright/test';

async function reloadWhileOffline(page: Page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ERR_INTERNET_DISCONNECTED')) throw error;
  }
}

test('P0-04 shows an actionable setup error when credentials are missing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FieldSurvey needs configuration' })).toBeVisible();
  await expect(page.getByText('VITE_SUPABASE_URL', { exact: true })).toBeVisible();
  await expect(page.getByText('VITE_SUPABASE_ANON_KEY', { exact: true })).toBeVisible();
  await expect(page.locator('ol li', { hasText: 'Copy .env.example to .env.local.' })).toBeVisible();
  await expect(page.locator('ol li', { hasText: 'SUPABASE_SERVICE_ROLE_KEY' })).toBeVisible();
});

test('P4-01 and P4-03 open the cached shell offline and explain first use', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    return Boolean(registration?.active);
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await expect(page.getByRole('heading', { name: 'FieldSurvey needs configuration' })).toBeVisible();
  await context.setOffline(true);
  await reloadWhileOffline(page);
  await expect(page.getByRole('heading', { name: 'FieldSurvey needs configuration' })).toBeVisible();
  await expect(page.getByText(/has not been prepared for offline fieldwork/i)).toBeVisible();
  await page.screenshot({ path: 'test-artifacts/p4-offline-shell.png', fullPage: true });
});
