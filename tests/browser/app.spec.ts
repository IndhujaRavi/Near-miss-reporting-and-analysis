import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('create, persist, edit, export and delete a reviewed report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#transcript').fill('At Oak Street, a truck blocked the exit. I stopped and waited for it to move.');
  await page.locator('#extract').click();
  await expect(page.locator('#location')).toHaveValue('Oak Street');
  await page.locator('#title').fill('Delivery exit obstructed');
  await page.locator('#confirmed').check();
  await page.locator('#save').click();
  await expect(page.locator('#report-list article')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#report-list')).toContainText('Delivery exit obstructed');
  await page.getByRole('button', { name: 'Review Delivery exit obstructed', exact: true }).click();
  await page.locator('#location').fill('12 Oak Street');
  await expect(page.locator('#confirmed')).not.toBeChecked();
  await page.locator('#confirmed').check();
  await page.locator('#save').click();
  await expect(page.locator('#report-list')).toContainText('12 Oak Street');
  await expect(page.locator('#report-list article')).toHaveCount(1);
  const downloaded = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const file = await downloaded;
  const report = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(report.dataset).toBe('real');
  expect(report.reports[0].confirmed).toBe(true);
  expect(report.reports[0].source).toBe('typed');
  expect(report.reports[0]).not.toHaveProperty('audio');
  await page.getByRole('button', { name: 'Delete Delivery exit obstructed', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#report-list article')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#report-list article')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('examples remain separate and are not duplicated', async ({ page }) => {
  await page.goto('/');
  await page.locator('#load-demo').click();
  await expect(page.locator('#report-list article')).toHaveCount(5);
  await page.locator('#load-demo').click();
  await expect(page.locator('#report-list article')).toHaveCount(5);
  await page.locator('#real-data').click();
  await expect(page.locator('#report-list article')).toHaveCount(0);
  await page.locator('#demo-data').click();
  await page.locator('#search').fill('pine');
  await expect(page.locator('#report-list article')).toHaveCount(2);
  await expect(page.locator('#location-list')).toContainText('2 reports');
});

test('draft replacement requires a decision and transcripts render as text', async ({ page }) => {
  await page.goto('/');
  await page.locator('#transcript').fill('<img src=x onerror="alert(1)"> A delivery obstruction.');
  await page.locator('#extract').click();
  await page.locator('#sample').click();
  await expect(page.locator('#draft-dialog')).toBeVisible();
  await page.locator('#keep-draft').click();
  await expect(page.locator('#transcript')).toHaveValue(/<img/);
  await page.locator('#confirmed').check();
  await page.locator('#save').click();
  await expect(page.locator('#report-list article')).toHaveCount(1);
  await expect(page.locator('#report-list img')).toHaveCount(0);
});

test('microphone failures preserve the typed draft', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }; });
  await page.goto('/');
  await page.locator('#transcript').fill('At Oak Street, a truck blocked the exit.');
  await page.locator('#record').click();
  await expect(page.getByRole('status')).toContainText('Microphone could not start');
  await expect(page.locator('#transcript')).toHaveValue('At Oak Street, a truck blocked the exit.');
  await expect(page.locator('#record')).toBeEnabled();
});

test('records a fake microphone and releases it when the tab hides', async ({ page }) => {
  await page.goto('/');
  await page.locator('#record').click();
  await expect(page.locator('#record-label')).toHaveText('Recording your account');
  await page.locator('#stop-recording').click();
  await expect(page.locator('#audio-preview')).toBeVisible();
  await page.locator('#record').click();
  await expect(page.locator('#record-label')).toHaveText('Recording your account');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status')).toContainText('discarded');
  await expect(page.locator('#record')).toBeEnabled();
});

test('Ollama suggestions are schema-checked and still require human confirmation', async ({ page }) => {
  await page.route('**/ollama/api/tags', (route) => route.fulfill({ json: { models: [{ name: 'test-model' }] } }));
  await page.route('**/ollama/api/chat', (route) => route.fulfill({ json: { message: { content: JSON.stringify({ title: 'Obstructed exit', location: 'Oak Street', category: 'Obstructed access', maneuver: 'Stopped', outcome: 'Not stated', evidence: 'a truck blocked the exit' }) } } }));
  await page.goto('/');
  await page.locator('#transcript').fill('At Oak Street, a truck blocked the exit. I stopped.');
  await page.locator('#extraction-mode').selectOption('ollama');
  await expect(page.locator('#ollama-model')).toHaveValue('test-model');
  await page.locator('#extract').click();
  await expect(page.locator('#title')).toHaveValue('Obstructed exit');
  await expect(page.locator('#confirmed')).not.toBeChecked();
  await expect(page.locator('#report-list article')).toHaveCount(0);
});

test('mobile layout does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#sample').click();
  await page.locator('#extract').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('real local embedding model compares demo reports without external requests', async ({ page }) => {
  test.setTimeout(120000);
  const external: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4191/') && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto('/');
  await page.locator('#load-demo').click();
  await expect(page.locator('#report-list article')).toHaveCount(5);
  await page.locator('#find-patterns').click();
  await expect(page.locator('#processing')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#semantic-note')).toContainText('Compared 5');
  await expect(page.locator('.semantic-pair').first()).toBeVisible();
  expect(external).toEqual([]);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});

test('real local speech model transcribes an uploaded synthetic note', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.locator('#audio-upload').setInputFiles('tests/fixtures/near-miss.wav');
  await page.locator('#transcribe').click();
  await expect(page.locator('#processing')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#transcript')).toHaveValue(/truck/i);
  await expect(page.locator('#transcript')).toHaveValue(/exit/i);
  await expect(page.locator('#confirmed')).not.toBeChecked();
  await page.locator('#extract').click();
  await expect(page.locator('#category')).toHaveValue('Obstructed access');
});
