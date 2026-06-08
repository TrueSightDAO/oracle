/**
 * oracle-draw-submit.js — auto-generate keypair + auto-submit [PRACTICE EVENT] to Edgar
 *                     + fire-and-forget daily briefing trigger
 *
 * On page load:
 *   1. Auto-generates an RSA keypair if not present (no user action needed).
 *   2. Watches #daoAdvisoryPanel for visibility (hidden=false) via MutationObserver.
 *   3. When the advisory panel becomes visible, auto-submits the [PRACTICE EVENT]
 *      to Edgar in the background.
 *   4. Also fire-and-forgets a signed POST to sophia.truesight.me/daily-briefing
 *      so Sophia composes and posts the governor's morning standup to Telegram #General.
 *   5. Deduplicates via localStorage key 'truesight-grounding-submitted' — if the
 *      signature matches today's reading, skip re-submission.
 *   6. Exposes a "My Credentials" link pointing to
 *      truesight.me/programs/truesight-grounding/credentials/#{slug}.
 *
 * Reuses the same dapp keypair pattern from:
 *   dapp/create_signature.html + capoeira/assets/js/practice-event-submit.js
 */
(function () {
  'use strict';

  const EDGAR_SUBMIT_URL = 'https://edgar.truesight.me/dao/submit_contribution';
  const DAILY_BRIEFING_URL = 'https://sophia.truesight.me/daily-briefing';
  const TRUESIGHT_BASE = 'https://truesight.me';
  const PROGRAM = 'truesight-grounding';
  const PRACTICE_TYPE = 'oracle-consultation';

  // Match the dapp's localStorage keys so existing keys are reused.
  const LS_PUBLIC_KEY = 'publicKey';
  const LS_PRIVATE_KEY = 'privateKey';
  const LS_READING_KEY = 'truesight-oracle-last-reading';
  const LS_SUBMITTED_KEY = 'truesight-grounding-submitted';
  const LS_BRIEFING_KEY = 'truesight-daily-briefing-sent';

  // ---- low-level helpers (mirror the dapp implementations) ----

  function base64ToArrayBuffer(b64) {
    const bin = window.atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function arrayBufferToBase64(buf) {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin);
  }

  function base64ToBase64Url(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function publicKeyToSlug(publicKeyBase64) {
    const keyBytes = base64ToArrayBuffer(publicKeyBase64);
    const hashBuf = await window.crypto.subtle.digest('SHA-256', keyBytes);
    const b64 = arrayBufferToBase64(hashBuf);
    return 'pk-' + base64ToBase64Url(b64).slice(0, 12);
  }

  // ---- keypair management ----

  async function generateKeypair() {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const publicKeyBase64 = arrayBufferToBase64(publicKey);
    const privateKeyBase64 = arrayBufferToBase64(privateKey);
    localStorage.setItem(LS_PUBLIC_KEY, publicKeyBase64);
    localStorage.setItem(LS_PRIVATE_KEY, privateKeyBase64);
    return publicKeyBase64;
  }

  async function ensureKeypair() {
    let pub = localStorage.getItem(LS_PUBLIC_KEY);
    const priv = localStorage.getItem(LS_PRIVATE_KEY);
    if (pub && priv) return pub;
    pub = await generateKeypair();
    return pub;
  }

  function getStoredPublicKey() {
    return localStorage.getItem(LS_PUBLIC_KEY) || null;
  }

  async function getCvUrl() {
    const pub = getStoredPublicKey();
    if (!pub) return null;
    const slug = await publicKeyToSlug(pub);
    return `${TRUESIGHT_BASE}/programs/truesight-grounding/credentials/#${slug}`;
  }

  // ---- payload + signing ----

  function buildPracticeEventText(reading, opts) {
    const captured = reading.timestamp || new Date().toISOString();
    const primary = reading.primaryHexagram || {};
    const related = reading.relatedHexagram || null;
    const lines = reading.lines || [];

    // Build hexagrams array
    const hexagrams = [{
      number: primary.number,
      name: primary.name,
      changing_lines: lines.filter(l => l.isChanging).map(l => l.lineNumber),
    }];
    if (related) {
      hexagrams[0].relates_to = related.number;
      hexagrams[0].relates_to_name = related.name;
    }

    // Get advisory summary from the DOM if available
    const advisoryBody = document.getElementById('daoAdvisoryBody');
    const advisorySummary = advisoryBody ? advisoryBody.textContent.trim().slice(0, 500) : '';

    const payload = {
      hexagrams: hexagrams,
      advisory_summary: advisorySummary || 'Morning oracle grounding session.',
      total_minutes: 15,
      mood: 'reflective',
    };

    // Try to get QMDJ card from the panel
    const qmdjMeta = document.getElementById('qmdjMeta');
    if (qmdjMeta && qmdjMeta.textContent.trim()) {
      payload.qmdj_card = qmdjMeta.textContent.trim().slice(0, 200);
    }

    const payloadJson = JSON.stringify(payload, null, 2);

    return (
      '[PRACTICE EVENT]\n'
      + '- Program: ' + PROGRAM + '\n'
      + '- Practice Type: ' + PRACTICE_TYPE + '\n'
      + '- Practitioner Public Key: ' + opts.publicKey + '\n'
      + (opts.practitionerName ? '- Practitioner Name: ' + opts.practitionerName + '\n' : '')
      + '- Captured At: ' + captured + '\n'
      + '- Source URL: ' + opts.sourceUrl + '\n'
      + '- Payload JSON:\n' + payloadJson + '\n'
      + '--------'
    );
  }

  async function signRequestText(requestText) {
    const privateKeyB64 = localStorage.getItem(LS_PRIVATE_KEY);
    if (!privateKeyB64) throw new Error('No private key in localStorage');
    const privateKeyObj = await window.crypto.subtle.importKey(
      'pkcs8',
      base64ToArrayBuffer(privateKeyB64),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const encoder = new TextEncoder();
    const sig = await window.crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKeyObj,
      encoder.encode(requestText)
    );
    return arrayBufferToBase64(sig);
  }

  // ---- daily briefing trigger ----

  /**
   * Build the briefing payload from the current reading.
   * Matches the shape expected by sophia.truesight.me/daily-briefing:
   *   payload.reading.primary_hexagram
   *   payload.reading.related_hexagram (optional)
   *   payload.reading.changing_lines (optional)
   *   payload.reading.timestamp_utc
   *   payload.timestamp (ISO 8601, for server-side skew check)
   *   payload.nonce (unique per request, for replay protection)
   */
  function buildBriefingPayload(reading) {
    const primary = reading.primaryHexagram || {};
    const related = reading.relatedHexagram || null;
    const lines = reading.lines || [];
    const changingLines = lines.filter(l => l.isChanging).map(l => l.lineNumber);
    const now = new Date().toISOString();

    const readingPayload = {
      primary_hexagram: {
        number: primary.number,
        name: primary.name,
      },
      timestamp_utc: reading.timestamp || now,
    };

    if (related) {
      readingPayload.related_hexagram = {
        number: related.number,
        name: related.name,
      };
    }

    if (changingLines.length > 0) {
      readingPayload.changing_lines = changingLines;
    }

    return {
      reading: readingPayload,
      timestamp: now,
      nonce: now + '-' + Math.random().toString(36).slice(2, 10),
    };
  }

  /**
   * Sign the briefing payload using the same scheme as the chat endpoint:
   * JSON-serialize with separators=(",", ":"), RSA-SHA256 sign.
   */
  async function signBriefingPayload(payload) {
    const payloadJson = JSON.stringify(payload, (key, value) => {
      // Ensure undefined values are omitted (JSON.stringify drops them anyway)
      return value;
    }, '');
    // Use compact serialization matching the server's separators=(",", ":")
    const compact = JSON.stringify(payload, Object.keys(payload).sort(), '');
    // Actually the server uses json.dumps(payload, separators=(",", ":")) which
    // sorts keys by insertion order. The browser's JSON.stringify with a replacer
    // that sorts keys produces the same result.
    const sortedCompact = JSON.stringify(payload, Object.keys(payload).sort());
    const signature = await signRequestText(sortedCompact);
    return signature;
  }

  /**
   * Fire-and-forget the daily briefing request.
   * Non-blocking — errors are logged to console only.
   * The server handles dedup (per governor per day), so the browser always sends.
   */
  async function triggerDailyBriefing() {
    try {
      const raw = localStorage.getItem(LS_READING_KEY);
      if (!raw) {
        console.log('[DailyBriefing] No reading found — skipping.');
        return;
      }

      const reading = JSON.parse(raw);

      // Skip if this is a restored/shared reading (not a fresh cast)
      if (reading.sharedFromUrl) {
        console.log('[DailyBriefing] Restored reading — skipping briefing.');
        return;
      }

      const publicKey = await ensureKeypair();
      const payload = buildBriefingPayload(reading);
      const signature = await signBriefingPayload(payload);

      const body = JSON.stringify({
        payload: payload,
        signature: signature,
      });

      console.log('[DailyBriefing] Sending briefing request...');

      const resp = await fetch(DAILY_BRIEFING_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Public-Key': publicKey,
        },
        body: body,
      });

      const result = await resp.json();

      if (result.ok) {
        console.log('[DailyBriefing] Success:', result.message || 'Briefing posted');
        // Mark as sent so we don't retry on page reload
        try {
          localStorage.setItem(LS_BRIEFING_KEY, new Date().toISOString());
        } catch (e) { /* non-fatal */ }
      } else if (result.dedup) {
        console.log('[DailyBriefing] Already briefed today — server dedup.');
      } else {
        console.warn('[DailyBriefing] Server rejected:', result.error || 'unknown error');
      }
    } catch (err) {
      // Fire-and-forget: never disrupt the user's reading flow
      console.warn('[DailyBriefing] Failed to send briefing (non-blocking):', err);
    }
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
      const publicKey = await ensureKeypair();
      const sourceUrl = buildReadingPermalink(reading);
      const requestText = buildPracticeEventText(reading, { publicKey, sourceUrl });
      const requestHash = await signRequestText(requestText);
      const shareText = (
        requestText
        + '\n\nMy Digital Signature: ' + publicKey
        + '\n\nRequest Transaction ID: ' + requestHash
        + '\n\nThis submission was generated using ' + sourceUrl
        + '\n\nVerify submission here: https://dapp.truesight.me/verify_request.html'
      );

      if (statusEl) {
        statusEl.textContent = 'Submitting to Edgar...';
        statusEl.className = 'hero-glass-status info';
        statusEl.hidden = false;
      }

      const formData = new FormData();
      formData.append('text', shareText);

      const resp = await fetch(EDGAR_SUBMIT_URL, { method: 'POST', body: formData });
      const slug = await publicKeyToSlug(publicKey);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        if (statusEl) {
          statusEl.textContent = 'Submission failed: HTTP ' + resp.status;
          statusEl.className = 'hero-glass-status error';
        }
        return { ok: false, error: 'HTTP ' + resp.status + ' ' + errText.slice(0, 120) };
      }

      // Mark as submitted
      localStorage.setItem(LS_SUBMITTED_KEY, new Date().toISOString());

      if (statusEl) {
        statusEl.textContent = '\u2713 Session recorded.';
        statusEl.className = 'hero-glass-status success';
      }

      // Show CV link
      const cvUrl = await getCvUrl();
      if (linkEl && cvUrl) {
        linkEl.href = cvUrl;
        linkEl.textContent = 'My Credentials \u2192';
        linkEl.hidden = false;
        revealCredentialsSection();
      }

      return { ok: true, requestHash, slug };
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

  // Build a URL that fully reproduces the reading: the `reading` signature
  // (six line sums) restores the hexagram(s), and `cast` restores the
  // original timestamp the QMDJ chart is derived from. This is what lands in
  // the [PRACTICE EVENT] Source URL, so the credential page's source link
  // shows the actual reading — not a blank oracle page.
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

  // Unhide the wrapper section around the CV link (index.html keeps the
  // link inside a `hidden` <section id="credentialsSection">; without this
  // the link can never become visible there).
  function revealCredentialsSection() {
    const section = document.getElementById('credentialsSection');
    if (section) section.hidden = false;
  }

  // Populate + reveal the "My Credentials" link as soon as a keypair exists —
  // the practitioner's CV on truesight.me should always be one click away,
  // not gated behind today's submission.
  async function showCredentialsLink(statusText) {
    const linkEl = document.getElementById('cvLink');
    const cvUrl = await getCvUrl();
    if (linkEl && cvUrl) {
      linkEl.href = cvUrl;
      linkEl.textContent = 'My Credentials \u2192';
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
            // Small delay to let advisory body populate
            setTimeout(() => {
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
    // Never auto-record a reading that was merely VIEWED via a permalink
    // (credential source link, shared link) rather than freshly cast.
    try {
      const raw = localStorage.getItem(LS_READING_KEY);
      const reading = raw ? JSON.parse(raw) : null;
      if (reading && reading.sharedFromUrl) {
        await showCredentialsLink('Viewing a restored reading — not recorded as a session.');
        return;
      }
    } catch (e) { /* fall through to normal flow */ }

    // Check dedup: if already submitted today, skip
    if (wasSubmittedToday()) {
      // Still show the credentials link
      await showCredentialsLink('Already submitted today.');
      const statusEl = document.getElementById('recordStatus');
      if (statusEl) statusEl.className = 'hero-glass-status success';
    } else {
      // Ensure keypair exists before submitting
      await ensureKeypair();
      await submitSession();
    }

    // Fire-and-forget the daily briefing trigger (always sends; server dedups)
    // This runs regardless of whether the PRACTICE EVENT was submitted or deduped,
    // because the briefing and the practice event are independent concerns.
    triggerDailyBriefing();
  }

  // ---- init ----

  function init() {
    // Auto-generate keypair on page load if not present, then surface the
    // practitioner's credential link immediately — oracle.truesight.me should
    // always link to the generated credential on truesight.me, not only
    // after today's session has been recorded.
    ensureKeypair()
      .then(function () {
        return showCredentialsLink(
          wasSubmittedToday()
            ? '\u2713 Session recorded today.'
            : 'Sessions record to your lineage automatically after each reading.'
        );
      })
      .catch(function (err) {
        console.error('[OracleDrawSubmit] keypair generation failed:', err);
      });

    // Set up observer to auto-submit when advisory panel appears
    setupAdvisoryObserver();

    // If the panel is already visible on init (e.g. restored from cache), submit immediately
    const panel = document.getElementById('daoAdvisoryPanel');
    if (panel && !panel.hidden) {
      setTimeout(function () {
        autoSubmitIfNeeded();
      }, 500);
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.OracleDrawSubmit = {
    ensureKeypair,
    getStoredPublicKey,
    publicKeyToSlug,
    getCvUrl,
    submitSession,
    wasSubmittedToday,
    triggerDailyBriefing,
  };
})();
