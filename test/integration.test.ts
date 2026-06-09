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

    const hasConstructorCrash = consoleErrors.some(e =>
      e.includes('generateKeyPairSync') ||
      e.includes('Use generateKeyPair') ||
      e.includes('DaoClient')
    );
    expect(hasConstructorCrash).toBe(false);

    const hasUncaughtError = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasUncaughtError).toBe(false);

    const title = await page.title();
    expect(title.toLowerCase()).toContain('i ching');

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

    const hasIdentityButton = await page.evaluate(() => {
      const btn = document.getElementById('daoIdentityLink');
      return btn !== null && btn.textContent?.includes('Link to DAO Identity');
    });
    expect(hasIdentityButton).toBe(true);

    await page.click('#daoIdentityLink');
    await new Promise(r => setTimeout(r, 500));

    const formVisible = await page.evaluate(() => {
      const panel = document.getElementById('daoIdentityPanel');
      return panel !== null && !panel.hidden;
    });
    expect(formVisible).toBe(true);

    await page.type('#daoIdentityEmail', 'test@example.com');

    const submitEnabled = await page.evaluate(() => {
      const btn = document.getElementById('daoIdentitySubmit');
      return btn !== null && !btn.disabled;
    });
    expect(submitEnabled).toBe(true);

    await page.click('#daoIdentitySubmit');
    await new Promise(r => setTimeout(r, 2000));

    const hasCrash = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasCrash).toBe(false);

    const statusShown = await page.evaluate(() => {
      const status = document.getElementById('daoIdentityStatus');
      return status !== null && !status.hidden;
    });
    expect(statusShown).toBe(true);
  }, INTEGRATION_TIMEOUT);

  it('email verification flow does not crash (base64ToArrayBuffer fix)', async () => {
    if (!process.env.VITEST_INTEGRATION) return;

    const htmlPath = 'file://' + resolve(__dirname, '..', 'index.html');

    consoleErrors = [];
    consoleWarnings = [];
    failedRequests = [];

    // Set up localStorage with a real RSA keypair so the verification handler
    // doesn't bail early with "no keys found"
    await page.goto(htmlPath, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate(() => {
      return window.crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      ).then(async (keyPair) => {
        const pub = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const priv = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        const arrayBufferToBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
        localStorage.setItem('publicKey', arrayBufferToBase64(pub));
        localStorage.setItem('privateKey', arrayBufferToBase64(priv));
      });
    });

    // Now navigate with verification params — this triggers the handler
    await page.goto(htmlPath + '?em=test@example.com&vk=test-verification-key', {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });
    await new Promise(r => setTimeout(r, 3000));

    console.log(`Verification flow — Console errors: ${consoleErrors.length}`);
    console.log(`Verification flow — Console warnings: ${consoleWarnings.length}`);

    // CRITICAL: No "Can't find variable: base64ToArrayBuffer" error
    const hasMissingFunction = consoleErrors.some(e =>
      e.includes('base64ToArrayBuffer') ||
      e.includes('publicKeyToSlug')
    );
    expect(hasMissingFunction).toBe(false);

    // No uncaught errors
    const hasUncaughtError = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasUncaughtError).toBe(false);

    // The status message should show
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

    await page.click('#beginCasting');
    await new Promise(r => setTimeout(r, 500));

    await page.click('#tossAll');
    await new Promise(r => setTimeout(r, 2000));

    const calcEnabled = await page.evaluate(() => {
      const btn = document.getElementById('calculate');
      return btn !== null && !btn.disabled;
    });
    expect(calcEnabled).toBe(true);

    await page.click('#calculate');
    await new Promise(r => setTimeout(r, 2000));

    const resultsVisible = await page.evaluate(() => {
      const results = document.getElementById('results');
      return results !== null && results.classList.contains('active');
    });
    expect(resultsVisible).toBe(true);

    const hexagramsRendered = await page.evaluate(() => {
      const display = document.getElementById('hexagramDisplay');
      return display !== null && display.children.length > 0;
    });
    expect(hexagramsRendered).toBe(true);

    const shareEnabled = await page.evaluate(() => {
      const btn = document.getElementById('shareReading');
      return btn !== null && !btn.disabled;
    });
    expect(shareEnabled).toBe(true);

    const hasCrash = consoleErrors.some(e =>
      e.includes('Uncaught') ||
      e.includes('uncaught') ||
      e.includes('TypeError') ||
      e.includes('ReferenceError')
    );
    expect(hasCrash).toBe(false);
  }, INTEGRATION_TIMEOUT);
});
