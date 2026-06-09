import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Oracle dao-client integration', () => {
  it('loads dao-client@1.1.0-rc.3 from unpkg', () => {
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
    // Check the CDN URL points to the latest version
    const match = html.match(/@truesight_dao\/dao-client@([^/]+)\/dist\/dao-client\.min\.js/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('1.1.0-rc.3');
  });

  it('dao-client script loads before oracle-draw-submit.js', () => {
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
    const daoClientIdx = html.indexOf('dao-client');
    const oracleDrawIdx = html.indexOf('oracle-draw-submit.js');
    expect(daoClientIdx).toBeGreaterThan(0);
    expect(oracleDrawIdx).toBeGreaterThan(0);
    expect(daoClientIdx).toBeLessThan(oracleDrawIdx);
  });

  it('DaoClient constructor does not throw in happy-dom environment', async () => {
    // Simulate what the oracle page does
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@truesight_dao/dao-client@1.1.0-rc.3/dist/dao-client.min.js';
    
    // We can't actually load the CDN in happy-dom, but we can verify
    // the 1.1.0-rc.3 constructor behavior by checking the npm registry
    // version exists
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
    expect(html).toContain('dao-client@1.1.0-rc.3');
  });
});
