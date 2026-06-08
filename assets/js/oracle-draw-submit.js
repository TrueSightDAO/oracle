/**
 * oracle-draw-submit.js — auto-generate keypair + auto-submit [PRACTICE EVENT] to Edgar
 *
 * On page load:
 *   1. Auto-generates an RSA keypair if not present (no user action needed).
 *   2. Watches #daoAdvisoryPanel for visibility (hidden=false) via MutationObserver.
 *   3. When the advisory panel becomes visible, auto-submits the [PRACTICE EVENT]
 *      to Edgar in the background.
 *   4. Deduplicates via localStorage key 'truesight-grounding-submitted' — if the
 *      signature matches today's reading, skip re-submission.
 *   5. Exposes a "My Credentials" link pointing to
 *      truesight.me/programs/truesight-grounding/credentials/#{slug}.
 *
 * Uses @truesight/dao-client (loaded via CDN) for all crypto and Edgar submission.
 */
(function () {
  'use strict';

  const EDGAR_SUBMIT_URL = 'https://edgar.truesight.me/dao/submit_contribution';
  const TRUESIGHT_BASE = 'https://truesight.me';
  const PROGRAM = 'truesight-grounding';
  const PRACTICE_TYPE = 'oracle-consultation';

  // Match the dapp's localStorage keys so existing keys are reused.
  const LS_PUBLIC_KEY = 'publicKey';
  const LS_PRIVATE_KEY = 'privateKey';
  const LS_READING_KEY = 'truesight-oracle-last-reading';
  const LS_SUBMITTED_KEY = 'truesight-grounding-submitted';

  // ---- keypair management (delegates to @truesight/dao-client) ----

  function getDaoClient() {
    // Use empty storagePrefix so it reads/writes the same keys as the DApp
    return new DaoClient({ storagePrefix: '' });
  }

  async function ensureKeypair() {
    const client = getDaoClient();
    return client.publicKey;
  }

  function getStoredPublicKey() {
    return localStorage.getItem(LS_PUBLIC_KEY) || null;
  }

  async function getCvUrl() {
    const pub = getStoredPublicKey();
    if (!pub) return null;
    const client = getDaoClient();
    const slug = await client.getSlug();
    return TRUESIGHT_BASE + '/programs/truesight-grounding/credentials/#' + slug;
  }

  // ---- submit ----

  async function submitSession() {
    const statusEl = document.getElementById('recordStatus');
    const linkEl = document.getElementById('cvLink');

    try {
      // Read the current reading from localStorage
      const raw = localStorage.getItem(LS_READING_KEY);
      if (!raw) {
        if (statusEl) {
          statusEl.textContent = 'No reading found. Please cast the oracle first.';
          statusEl.className = 'hero-glass-status error';
          statusEl.hidden = false;
        }
        return { ok: false, error: 'No reading in localStorage' };
      }

      const reading = JSON.parse(raw);
      const client = getDaoClient();
      const sourceUrl = buildReadingPermalink(reading);

      // Build the payload JSON inline
      const primary = reading.primaryHexagram || {};
      const related = reading.relatedHexagram || null;
      const lines = reading.lines || [];
      const advisoryBody = document.getElementById('daoAdvisoryBody');
      const qmdjMeta = document.getElementById('qmdjMeta');

      const hexagrams = [{
        number: primary.number,
        name: primary.name,
        changing_lines: lines.filter(function(l) { return l.isChanging; }).map(function(l) { return l.lineNumber; }),
      }];
      if (related) {
        hexagrams[0].relates_to = related.number;
        hexagrams[0].relates_to_name = related.name;
      }

      const payloadObj = {
        hexagrams: hexagrams,
        advisory_summary: advisoryBody ? advisoryBody.textContent.trim().slice(0, 500) : 'Morning oracle grounding session.',
        total_minutes: 15,
        mood: 'reflective',
      };
      if (qmdjMeta && qmdjMeta.textContent.trim()) {
        payloadObj.qmdj_card = qmdjMeta.textContent.trim().slice(0, 200);
      }

      // Use DaoClient to sign and build share text
      const { txId, shareText } = await client.sign('PRACTICE EVENT', {
        'Program': PROGRAM,
        'Practice Type': PRACTICE_TYPE,
        'Practitioner Public Key': client.publicKey,
        'Captured At': reading.timestamp || new Date().toISOString(),
        'Source URL': sourceUrl,
        'Payload JSON': JSON.stringify(payloadObj, null, 2),
      });

      if (statusEl) {
        statusEl.textContent = 'Submitting to Edgar...';
        statusEl.className = 'hero-glass-status info';
        statusEl.hidden = false;
      }

      const formData = new FormData();
      formData.append('text', shareText);

      const resp = await fetch(EDGAR_SUBMIT_URL, { method: 'POST', body: formData });
      const slug = await client.getSlug();

      if (!resp.ok) {
        const errText = await resp.text().catch(function() { return ''; });
        if (statusEl) {
          statusEl.textContent = 'Submission failed: HTTP ' + resp.status;
          statusEl.className = 'hero-glass-status error';
        }
        return { ok: false, error: 'HTTP ' + resp.status + ' ' + errText.slice(0, 120) };
      }

      // Mark as submitted
      localStorage.setItem(LS_SUBMITTED_KEY, new Date().toISOString());

      if (statusEl) {
        statusEl.textContent = 'Session recorded.';
        statusEl.className = 'hero-glass-status success';
      }

      // Show CV link
      const cvUrl = await getCvUrl();
      if (linkEl && cvUrl) {
        linkEl.href = cvUrl;
        linkEl.textContent = 'My Credentials ->';
        linkEl.hidden = false;
        revealCredentialsSection();
      }

      return { ok: true, requestHash: txId, slug: slug };
    } catch (err) {
      console.error('[OracleDrawSubmit] submit failed:', err);
      if (statusEl) {
        statusEl.textContent = 'Error: ' + (err.message || err);
        statusEl.className = 'hero-glass-status error';
      }
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  // ---- reading permalink ----

  function buildReadingPermalink(reading) {
    try {
      const lines = Array.isArray(reading && reading.lines) ? reading.lines : [];
      const sums = lines
        .slice()
        .sort(function (a, b) { return (a.lineNumber || 0) - (b.lineNumber || 0); })
        .map(function (l) { return l.sum; })
        .filter(function (s) { return [6, 7, 8, 9].indexOf(Number(s)) !== -1; });
      if (sums.length !== 6) return window.location.origin + '/';
      const url = new URL(window.location.origin + '/');
      url.searchParams.set('reading', sums.join('-'));
      if (reading.timestamp) url.searchParams.set('cast', reading.timestamp);
      return url.toString();
    } catch (e) {
      return window.location.origin + '/';
    }
  }

  // ---- credentials UI ----

  function revealCredentialsSection() {
    const section = document.getElementById('credentialsSection');
    if (section) section.hidden = false;
  }

  async function showCredentialsLink(statusText) {
    const linkEl = document.getElementById('cvLink');
    const cvUrl = await getCvUrl();
    if (linkEl && cvUrl) {
      linkEl.href = cvUrl;
      linkEl.textContent = 'My Credentials ->';
      linkEl.hidden = false;
      revealCredentialsSection();
    }
    if (statusText) {
      const statusEl = document.getElementById('recordStatus');
      if (statusEl) {
        statusEl.textContent = statusText;
        statusEl.hidden = false;
      }
    }
  }

  // ---- check if already submitted today ----

  function wasSubmittedToday() {
    try {
      const submitted = localStorage.getItem(LS_SUBMITTED_KEY);
      if (!submitted) return false;
      const submittedDate = new Date(submitted);
      const today = new Date();
      return submittedDate.toDateString() === today.toDateString();
    } catch (e) {
      return false;
    }
  }

  // ---- MutationObserver: watch #daoAdvisoryPanel for visibility ----

  function setupAdvisoryObserver() {
    const panel = document.getElementById('daoAdvisoryPanel');
    if (!panel) return;

    const observer = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
          if (!panel.hidden) {
            observer.disconnect();
            setTimeout(function() {
              autoSubmitIfNeeded();
            }, 500);
          }
        }
      }
    });

    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ---- auto-submit logic ----

  async function autoSubmitIfNeeded() {
    try {
      const raw = localStorage.getItem(LS_READING_KEY);
      const reading = raw ? JSON.parse(raw) : null;
      if (reading && reading.sharedFromUrl) {
        await showCredentialsLink('Viewing a restored reading - not recorded as a session.');
        return;
      }
    } catch (e) { /* fall through */ }

    if (wasSubmittedToday()) {
      await showCredentialsLink('Already submitted today.');
      const statusEl = document.getElementById('recordStatus');
      if (statusEl) statusEl.className = 'hero-glass-status success';
      return;
    }

    await ensureKeypair();
    await submitSession();
  }

  // ---- init ----

  function init() {
    ensureKeypair()
      .then(function () {
        return showCredentialsLink(
          wasSubmittedToday()
            ? 'Session recorded today.'
            : 'Sessions record to your lineage automatically after each reading.'
        );
      })
      .catch(function (err) {
        console.error('[OracleDrawSubmit] keypair generation failed:', err);
      });

    setupAdvisoryObserver();

    const panel = document.getElementById('daoAdvisoryPanel');
    if (panel && !panel.hidden) {
      setTimeout(function () {
        autoSubmitIfNeeded();
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.OracleDrawSubmit = {
    ensureKeypair,
    getStoredPublicKey,
    getCvUrl,
    submitSession,
    wasSubmittedToday,
  };
})();
