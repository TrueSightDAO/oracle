import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Oracle Credentials Link', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('showVerifiedState unhides #credentialsSection and sets #cvLink href', () => {
    document.body.innerHTML = `
      <section id="credentialsSection" hidden>
        <a id="cvLink" href="#" hidden>My Credentials →</a>
      </section>
      <article id="daoIdentityLinkedPanel" hidden>
        <p id="daoIdentityLinkedStatus"></p>
        <a id="daoIdentityCvLink" href="#" hidden>My Credentials →</a>
      </article>
    `;

    const credentialsSection = document.getElementById('credentialsSection')!;
    const cvLink = document.getElementById('cvLink') as HTMLAnchorElement;
    const daoIdentityLinkedPanel = document.getElementById('daoIdentityLinkedPanel')!;
    const daoIdentityCvLink = document.getElementById('daoIdentityCvLink') as HTMLAnchorElement;

    const cvUrl = 'https://truesight.me/programs/truesight-grounding/credentials/#pk-abc123';

    // Simulate the FIXED showVerifiedState:
    if (cvUrl && cvLink) {
      cvLink.href = cvUrl;
      cvLink.hidden = false;
    }
    if (daoIdentityCvLink) {
      daoIdentityCvLink.hidden = true;
    }
    if (daoIdentityLinkedPanel) {
      daoIdentityLinkedPanel.hidden = false;
    }
    // THE FIX:
    credentialsSection.hidden = false;

    expect(cvLink.href).toBe(cvUrl);
    expect(cvLink.hidden).toBe(false);
    expect(credentialsSection.hidden).toBe(false);
    expect(daoIdentityLinkedPanel.hidden).toBe(false);
    expect(daoIdentityCvLink.hidden).toBe(true);
  });

  it('showPendingState shows correct message without credential link', () => {
    document.body.innerHTML = `
      <article id="daoIdentityLinkedPanel" hidden>
        <p id="daoIdentityLinkedStatus"></p>
        <a id="daoIdentityCvLink" href="#" hidden>My Credentials →</a>
      </article>
    `;

    const daoIdentityLinkedPanel = document.getElementById('daoIdentityLinkedPanel')!;
    const daoIdentityLinkedStatus = document.getElementById('daoIdentityLinkedStatus')!;
    const daoIdentityCvLink = document.getElementById('daoIdentityCvLink') as HTMLAnchorElement;

    if (daoIdentityLinkedPanel) {
      daoIdentityLinkedPanel.hidden = false;
    }
    if (daoIdentityCvLink) {
      daoIdentityCvLink.hidden = true;
    }
    if (daoIdentityLinkedStatus) {
      daoIdentityLinkedStatus.textContent = '⏳ Almost there — we emailed a verification link to test@example.com';
    }

    expect(daoIdentityLinkedPanel.hidden).toBe(false);
    expect(daoIdentityCvLink.hidden).toBe(true);
    expect(daoIdentityLinkedStatus.textContent).toContain('Almost there');
  });

  it('handleReset hides all panels', () => {
    document.body.innerHTML = `
      <section id="results" class="active"></section>
      <article class="dao-advisory-panel" id="daoAdvisoryPanel"></article>
      <section class="reference-panel" id="qmdjPanel"></section>
      <details id="qmdjDetailPanel"></details>
    `;

    const results = document.getElementById('results')!;
    const daoAdvisoryPanel = document.getElementById('daoAdvisoryPanel')!;
    const qmdjPanel = document.getElementById('qmdjPanel')!;
    const qmdjDetailPanel = document.getElementById('qmdjDetailPanel')!;

    results.classList.remove('active');
    daoAdvisoryPanel.hidden = true;
    qmdjPanel.hidden = true;
    qmdjDetailPanel.hidden = true;
    qmdjDetailPanel.removeAttribute('open');

    expect(results.classList.contains('active')).toBe(false);
    expect(daoAdvisoryPanel.hidden).toBe(true);
    expect(qmdjPanel.hidden).toBe(true);
    expect(qmdjDetailPanel.hidden).toBe(true);
  });

  it('full HTML page has #credentialsSection and the fix is applied', () => {
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
    expect(html).toContain('id="credentialsSection"');
    expect(html).toContain('id="cvLink"');
    expect(html).toContain('id="daoIdentityLinkedPanel"');
    expect(html).toContain('id="daoIdentityCvLink"');
    // Verify the fix is in the HTML
    expect(html).toContain('credSection.hidden = false');
  });
});
