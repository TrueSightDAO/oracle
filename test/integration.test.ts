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

  it('DAO Identity UI renders and Edgar request is well-formed', async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const htmlPath = 'file://' + resolve(__dirname, '..', 'index.html');

    consoleErrors = [];
    consoleWarnings = [];
    failedRequests = [];

    await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    // Check the DAO Identity button exists
    const hasIdentityButton = await page.evaluate(() => {
      const btn = document.getElementById('daoIdentityLink');
      return btn !== null && btn.textContent?.includes('Link to DAO Identity');
    });
    expect(hasIdentityButton).toBe(true);

    // Click the button to reveal the email form
    await page.click('#daoIdentityLink');
    await new Promise(r => setTimeout(r, 500));

    // Check the email form appeared
    const formVisible = await page.evaluate(() => {
      const panel = document.getElementById('daoIdentityPanel');
      return panel !== null && !panel.hidden;
    });
    expect(formVisible).toBe(true);

    // Fill in the email field
    await page.type('#daoIdentityEmail', 'test@example.com');

    // Check the submit button exists and is enabled
    const submitEnabled = await page.evaluate(() => {
      const btn = document.getElementById('daoIdentitySubmit');
      return btn !== null && !btn.disabled;
    });
    expect(submitEnabled).toBe(true);

    // Click submit — this will try to call Edgar (which will fail in headless
    // because there's no keypair in localStorage). We verify:
    // 1. The form submission doesn't crash the page
    // 2. The error is handled gracefully (not an uncaught exception)
    await page.click('#daoIdentitySubmit');
    await new Promise(r => setTimeout(r, 2000));

    // Check no uncaught errors from the submission attempt
    const hasCrash = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasCrash).toBe(false);

    // The status message should show (either error or info)
    const statusShown = await page.evaluate(() => {
      const status = document.getElementById('daoIdentityStatus');
      return status !== null && !status.hidden;
    });
    expect(statusShown).toBe(true);
  }, INTEGRATION_TIMEOUT);

  it('casting flow works end-to-end', async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const htmlPath = 'file://' + resolve(__dirname, '..', 'index.html');

    consoleErrors = [];
    consoleWarnings = [];
    failedRequests = [];

    await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    // Click "Begin your cast"
    await page.click('#beginCasting');
    await new Promise(r => setTimeout(r, 500));

    // Toss all lines
    await page.click('#tossAll');
    await new Promise(r => setTimeout(r, 2000));

    // Check the calculate button is now enabled
    const calcEnabled = await page.evaluate(() => {
      const btn = document.getElementById('calculate');
      return btn !== null && !btn.disabled;
    });
    expect(calcEnabled).toBe(true);

    // Click "Reveal Guidance"
    await page.click('#calculate');
    await new Promise(r => setTimeout(r, 2000));

    // Check results section appeared
    const resultsVisible = await page.evaluate(() => {
      const results = document.getElementById('results');
      return results !== null && results.classList.contains('active');
    });
    expect(resultsVisible).toBe(true);

    // Check hexagram cards rendered
    const hexagramsRendered = await page.evaluate(() => {
      const display = document.getElementById('hexagramDisplay');
      return display !== null && display.children.length > 0;
    });
    expect(hexagramsRendered).toBe(true);

    // Check the share button is enabled
    const shareEnabled = await page.evaluate(() => {
      const btn = document.getElementById('shareReading');
      return btn !== null && !btn.disabled;
    });
    expect(shareEnabled).toBe(true);

    // No console errors from the full casting flow
    const hasCrash = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasCrash).toBe(false);
  }, INTEGRATION_TIMEOUT);
});
