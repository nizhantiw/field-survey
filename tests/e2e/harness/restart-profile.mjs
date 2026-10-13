import { chromium } from '@playwright/test';

const profile = process.env.FS_PROFILE;
const baseURL = process.env.FS_BASE;
if (!profile || !baseURL) {
  console.error('FS_PROFILE and FS_BASE are required');
  process.exit(2);
}

const context = await chromium.launchPersistentContext(profile, {
  baseURL,
  serviceWorkers: 'block',
  timeout: 20_000,
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(8_000);
await page.goto('/login');
const email = page.getByLabel('Email');
const projects = page.getByRole('heading', { name: 'Projects' });
await email.or(projects).waitFor();
if (await email.isVisible()) {
  await email.fill('fieldworker@fieldsurvey.test');
  await page.getByLabel('Password').fill('harness-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
await projects.waitFor();
if (!(await page.getByText('Signed in as').textContent())?.includes('Field')) {
  console.error(await page.locator('main').innerText());
  process.exit(1);
}
await page.getByRole('link', { name: 'Drafts' }).click();
await page.getByRole('link', { name: 'Site visit' }).click();
const value = await page.getByLabel('Site name').inputValue();
const url = page.url();
await context.close();
if (value !== 'Cedar bend' || !url.includes('/drafts/')) {
  console.error(JSON.stringify({ value, url }));
  process.exit(1);
}
console.log(JSON.stringify({ value, url }));
