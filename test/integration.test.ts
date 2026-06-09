import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import type { Browser, Page, ConsoleMessage } from 'puppeteer';

const INTEGRATION_TIMEOUT = 30000;

describe('Oracle integration tests (headless browser)', () => {
  let browser: Browser;
  let page: Page;
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];
  let failedRequests: string[] = [];

  beforeAll(async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const puppeteer = await import('puppeteer');
    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--js-flags=--max_old_space_size=256',
      ],
    });

    page = await browser.newPage();

    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      else if (msg.type() === 'warning') consoleWarnings.push(text);
    });

    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.url()} — ${request.failure()?.errorText || 'unknown'}`);
    });
  }, INTEGRATION_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('index.html loads without console errors', async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const htmlPath = 'file://' + resolve(__dirname, '..', 'index.html');

    await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    // Log diagnostics for CI output
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Console warnings: ${consoleWarnings.length}`);
    console.log(`Failed requests: ${failedRequests.length}`);

    // CRITICAL: No DaoClient constructor crash (the 1.1.0-rc.1 bug)
    const hasConstructorCrash = consoleErrors.some(e =>
      e.includes('generateKeyPairSync') ||
      e.includes('Use generateKeyPair') ||
      e.includes('DaoClient')
    );
    expect(hasConstructorCrash).toBe(false);

    // No uncaught errors that would break the page
    const hasUncaughtError = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasUncaughtError).toBe(false);

    // Page renders — title mentions I Ching
    const title = await page.title();
    expect(title.toLowerCase()).toContain('i ching');

    // Key UI elements present
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('I Ching');
  }, INTEGRATION_TIMEOUT);

  it('draw.html loads without console errors', async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const drawPath = 'file://' + resolve(__dirname, '..', 'draw.html');

    // Reset collections for this page
    consoleErrors = [];
    consoleWarnings = [];
    failedRequests = [];

    await page.goto(drawPath, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    console.log(`Draw page — Console errors: ${consoleErrors.length}`);
    console.log(`Draw page — Console warnings: ${consoleWarnings.length}`);

    const hasConstructorCrash = consoleErrors.some(e =>
      e.includes('generateKeyPairSync') ||
      e.includes('Use generateKeyPair')
    );
    expect(hasConstructorCrash).toBe(false);

    const hasUncaughtError = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasUncaughtError).toBe(false);
  }, INTEGRATION_TIMEOUT);
});
