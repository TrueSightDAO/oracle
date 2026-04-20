/**
 * Apps Script editor:
 * https://script.google.com/home/projects/1_jTHZZI033E0y2TQNZg98N_bW6lNP2I9sLA__nNQEWpRAw2Q6vsn9DsL/edit
 *
 * iChing Oracle -> DAO Advisory bridge (GET only, GitHub Pages friendly).
 *
 * Context sources fetched on every oracle_advice call:
 *  - ADVISORY_SNAPSHOT.md  (agentic_ai_context mirror — updated by generate_advisory_snapshot.py)
 *  - advisory/BASE.md      (slow-changing DAO orientation)
 *  - reminders/current.json (operator's open Apple Reminders — synced end-of-day via --with-rem)
 *
 * NOTE: LATEST_ADVISORY_SNAPSHOT_FROM_INDEX was removed — it was identical to ADVISORY_SNAPSHOT.md
 * (both written by the same generate_advisory_snapshot.py run). The freed token budget is used
 * for the reminders block which grounds Grok in the operator's real open intentions.
 *
 * Script Properties expected:
 *  - ANTHROPIC_API_KEY      (required when ADVISOR_MODEL=anthropic; default)
 *  - ANTHROPIC_MODEL        (optional, default: claude-sonnet-4-6)
 *  - XAI_API_KEY            (required when ADVISOR_MODEL=xai, or as auto-fallback
 *                            when Anthropic is unavailable)
 *  - XAI_MODEL              (optional, default: grok-3-mini)
 *  - ADVISOR_MODEL          (optional, default: 'anthropic'; set to 'xai' to force Grok)
 *  - ORACLE_SHARED_SECRET   (optional — if set, query param `token` must match)
 *
 * Deploy: clasp push from iching_oracle/gas/, then deploy a new web app version in the editor.
 * Run runOneSetup() once from the editor after first deploy to grant UrlFetch + Properties perms.
 */

var RAW_URLS = {
  advisorySnapshot:
    'https://raw.githubusercontent.com/TrueSightDAO/agentic_ai_context/main/ADVISORY_SNAPSHOT.md',
  advisoryBase:
    'https://raw.githubusercontent.com/TrueSightDAO/ecosystem_change_logs/main/advisory/BASE.md',
  reminders:
    'https://raw.githubusercontent.com/TrueSightDAO/ecosystem_change_logs/main/reminders/current.json',
  // GitHub Contents API listing for the raws dir (each iPhone POST from Edgar lands as one file).
  // Oracle filters entries newer than reminders/current.json.generated_at to surface
  // iPhone intents not yet normalized by a Mac full-sync.
  remindersRawsDir:
    'https://api.github.com/repos/TrueSightDAO/ecosystem_change_logs/contents/reminders_raws'
};

var PENDING_RAWS_MAX = 20;

function doGet(e) {
  var params = (e && e.parameter) || {};
  var mode = (params.mode || '').trim();

  if (mode === 'oracle_advice') {
    return jsonResponse_(handleOracleAdvice_(params));
  }

  return jsonResponse_({
    ok: true,
    service: 'iching_oracle_advisory_bridge',
    usage: 'Add mode=oracle_advice and draw fields from iching_oracle',
    now_utc: new Date().toISOString(),
    links: RAW_URLS
  });
}

/**
 * One-time method to run from GAS editor so Google grants permissions.
 * Run this manually once after clasp push.
 */
function runOneSetup() {
  var status = {
    ok: true,
    now_utc: new Date().toISOString(),
    fetched: {},
    script_properties_present: {},
    note:
      'If this ran successfully, UrlFetch + Properties permissions are granted. Deploy a new web app version next.'
  };

  var props = PropertiesService.getScriptProperties();
  status.script_properties_present.XAI_API_KEY = Boolean(props.getProperty('XAI_API_KEY'));
  status.script_properties_present.XAI_MODEL = Boolean(props.getProperty('XAI_MODEL'));
  status.script_properties_present.ORACLE_SHARED_SECRET = Boolean(
    props.getProperty('ORACLE_SHARED_SECRET')
  );

  status.fetched.advisorySnapshot = fetchTextWithMeta_(RAW_URLS.advisorySnapshot);
  status.fetched.advisoryBase = fetchTextWithMeta_(RAW_URLS.advisoryBase);
  status.fetched.reminders = fetchTextWithMeta_(RAW_URLS.reminders);

  return status;
}

function handleOracleAdvice_(params) {
  try {
    verifySharedSecretIfConfigured_(params);

    var draw = extractDraw_(params);
    var advisorySnapshot = fetchText_(RAW_URLS.advisorySnapshot);
    var advisoryBase = fetchText_(RAW_URLS.advisoryBase);
    var remindersJson = fetchRemindersJson_();
    var pendingRaws = fetchPendingRemindersRaws_(remindersJson);

    var promptParts = buildOraclePromptParts_({
      draw: draw,
      advisorySnapshot: advisorySnapshot,
      advisoryBase: advisoryBase,
      remindersJson: remindersJson,
      pendingRaws: pendingRaws
    });
    var ai = callAdvisor_(promptParts);

    return {
      ok: true,
      generated_at_utc: new Date().toISOString(),
      model: ai.model,
      advice: ai.text,
      links: RAW_URLS,
      draw: draw
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      generated_at_utc: new Date().toISOString()
    };
  }
}

function verifySharedSecretIfConfigured_(params) {
  var props = PropertiesService.getScriptProperties();
  var expected = (props.getProperty('ORACLE_SHARED_SECRET') || '').trim();
  if (!expected) return;
  var got = (params.token || '').trim();
  if (!got || got !== expected) {
    throw new Error('Unauthorized: invalid token');
  }
}

function extractDraw_(params) {
  return {
    signature: (params.signature || '').trim(),
    primary_number: (params.primary_number || '').trim(),
    primary_name: (params.primary_name || '').trim(),
    primary_judgment: (params.primary_judgment || '').trim(),
    related_number: (params.related_number || '').trim(),
    related_name: (params.related_name || '').trim(),
    related_judgment: (params.related_judgment || '').trim(),
    changing_lines: (params.changing_lines || 'none').trim(),
    timestamp_utc: (params.timestamp_utc || new Date().toISOString()).trim()
  };
}

function fetchRemindersJson_() {
  try {
    var text = fetchText_(RAW_URLS.reminders);
    var parsed = JSON.parse(text);
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Return iPhone reminder intents that Edgar appended to reminders_raws/ AFTER the last
 * Mac full-sync (watermark = remindersJson.generated_at). Everything older is already
 * normalized into current.json by iCloud → Apple Reminders → `rem list`.
 *
 * Filename convention: reminders_raws/YYYYMMDDTHHMMSSZ.json (compact ISO basic format).
 * current.json.generated_at is extended ISO ("2026-04-18T21:59:20Z"); strip dashes and
 * colons for lexical comparison.
 *
 * On any failure (network, rate-limit, parse) return an empty array — the oracle should
 * still render the rest of the context rather than hard-fail.
 */
function fetchPendingRemindersRaws_(remindersJson) {
  try {
    var watermark = remindersJsonWatermark_(remindersJson);
    var res = UrlFetchApp.fetch(RAW_URLS.remindersRawsDir, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/vnd.github+json' },
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return [];
    var entries = JSON.parse(res.getContentText());
    if (!Array.isArray(entries)) return [];

    var pending = [];
    for (var i = 0; i < entries.length; i++) {
      var ent = entries[i] || {};
      var name = String(ent.name || '');
      if (!/^\d{8}T\d{6}Z\.json$/.test(name)) continue;
      var stamp = name.slice(0, name.length - '.json'.length);
      if (watermark && stamp <= watermark) continue;
      pending.push({ stamp: stamp, downloadUrl: ent.download_url });
    }

    // Oldest first so the order reads like a short timeline.
    pending.sort(function (a, b) { return a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0; });

    var out = [];
    var cap = Math.min(pending.length, PENDING_RAWS_MAX);
    for (var j = 0; j < cap; j++) {
      var row = parsePendingRaw_(pending[j]);
      if (row) out.push(row);
    }
    return out;
  } catch (err) {
    return [];
  }
}

function remindersJsonWatermark_(remindersJson) {
  var raw = (remindersJson && remindersJson.generated_at) || '';
  // "2026-04-18T21:59:20Z" -> "20260418T215920Z"
  return String(raw).replace(/[-:]/g, '');
}

function parsePendingRaw_(pending) {
  try {
    var res = UrlFetchApp.fetch(pending.downloadUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return null;
    var wrap = JSON.parse(res.getContentText());
    var body = wrap && wrap.raw_body ? wrap.raw_body : '';
    var parsed = null;
    try { parsed = JSON.parse(body); } catch (_) { parsed = null; }
    var title =
      (parsed && (parsed.update || parsed.title || parsed.text)) ||
      (typeof body === 'string' ? body : '');
    title = String(title || '').trim();
    if (!title) return null;
    return {
      title: title,
      received_at: wrap && wrap.received_at ? wrap.received_at : '',
      raw_id: pending.stamp
    };
  } catch (err) {
    return null;
  }
}

function buildPendingRawsBlock_(pendingRaws) {
  if (!pendingRaws || !pendingRaws.length) {
    return '(no iPhone intents since last full sync)';
  }
  var lines = [];
  for (var i = 0; i < pendingRaws.length; i++) {
    var r = pendingRaws[i];
    var when = r.received_at ? ' [received: ' + r.received_at + ']' : '';
    lines.push('- ' + r.title + when);
  }
  return lines.join('\n');
}

function buildRemindersBlock_(remindersJson) {
  if (!remindersJson || !Array.isArray(remindersJson.reminders) || !remindersJson.reminders.length) {
    return '(no open reminders synced)';
  }
  var lines = ['Generated: ' + (remindersJson.generated_at || 'unknown')];
  var items = remindersJson.reminders.slice(0, 40);
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    var title = String(r.name || r.title || '').trim();
    if (!title) continue;
    var due = r.due_date ? ' [due: ' + r.due_date + ']' : '';
    var flagged = r.flagged ? ' [flagged]' : '';
    lines.push('- ' + title + due + flagged);
  }
  if (remindersJson.count > 40) {
    lines.push('... (' + (remindersJson.count - 40) + ' more not shown)');
  }
  return lines.join('\n');
}

/**
 * Prompt header — solo-operator-aware, founder-scale-action, north-star grounded.
 * Tuned through a Claude advisory conversation where an earlier generic version
 * produced DAO-scale platitudes ("run a reconciliation pass") instead of the
 * concrete founder-scale action the operator needed ("write five personal notes
 * to the five most recent QR buyers tomorrow morning"). Keep this text identical
 * across API calls so Anthropic ephemeral prompt caching hits within the 5-min
 * window.
 */
var ORACLE_PROMPT_HEADER =
  'You are an advisor to TrueSight DAO. The operator you are advising is Gary, working solo or near-solo on execution. Any advice you give has to be carried out by one person with finite hours, not a team. Integrate I Ching symbolism with concrete DAO operating context.\n\n' +
  'Treat the I Ching as a lens, not a justification. The hexagram should sharpen a reading you could defend without it. If you find yourself reverse-justifying priorities from the judgment text, stop, write the analysis straight, then check whether the hexagram actually fits.\n\n' +
  'Scale advice to a solo operator. The DAO has many surfaces — tokenomics, inventory, stores, DApp, Beer Hall, signature onboarding, Hit List, Agroverse shop. Gary cannot work on all of them in a week. Good advice picks one or two, explicitly deprioritizes the rest for now, and favors actions that compound (writing to a customer, diagnosing one stuck store) over actions that spread attention (auditing everything, reconciling all surfaces). If an action requires coordination with other contributors, surface that coordination cost as part of the action.\n\n' +
  'Every suggestion should trace back to the north star in the advisory snapshot (purpose: heal the world with love; mission: restore 10,000 hectares of Amazon rainforest). When a suggestion does not obviously serve the mission, say so.\n\n' +
  'Output plain text only with these sections:\n' +
  '1) Reading synthesis (2-4 lines) — what the hexagram illuminates about the current situation, not a generic gloss of the judgment.\n' +
  '2) Context gaps worth naming (1-3 bullets) — what the snapshot cannot tell you that would change the advice. Propose the most likely read and note what would change if the alternative is true. Skip this section only if the snapshot is genuinely sufficient.\n' +
  '3) Priorities this week for a solo operator (3 bullets max) — specific to what is actually shipping or stalled, with an explicit note on what Gary should NOT spend time on this week.\n' +
  '4) Risks / watch-outs (3 bullets) — distinguish real signals from artifacts (seasonality, deliberate dormancy, expected off-cycles). If a metric looks alarming, check whether the business shape explains it before flagging. Flag risks Gary can actually act on, not ambient ones.\n' +
  '5) One decisive action in next 24h — something Gary can do tomorrow morning in under two hours, solo, with a concrete first step (the exact sheet to open, the exact five rows to pull, the exact first email to write, the exact store to call). No "run a reconciliation pass" abstractions. If the right action is smaller than it sounds (write five notes, not fifty), say so and explain why smaller is better.\n\n' +
  'Keep it practical, specific, and aligned with current advisory materials. If the honest answer is "the snapshot does not support a strong read, here is what I would need from Gary," say that instead of generating plausible-sounding strategy.';

/**
 * Split the prompt into three pieces for Anthropic prompt caching:
 *   - header: the advisor instructions (cache block 1, stable across sessions).
 *   - staticContext: ADVISORY_SNAPSHOT + BASE (cache block 2, stable within ~5min).
 *   - dynamicContext: draw + reminders + pending raws (per-call, not cached).
 *
 * xAI path flattens all three into a single string for backward compatibility.
 */
function buildOraclePromptParts_(ctx) {
  var draw = ctx.draw;
  var drawBlock =
    'I CHING DRAW\n' +
    '- Signature: ' + draw.signature + '\n' +
    '- Primary: #' + draw.primary_number + ' ' + draw.primary_name + '\n' +
    '- Primary judgment: ' + draw.primary_judgment + '\n' +
    '- Related: ' +
    (draw.related_number ? '#' + draw.related_number + ' ' + draw.related_name : 'none') + '\n' +
    '- Related judgment: ' + (draw.related_judgment || 'n/a') + '\n' +
    '- Changing lines: ' + draw.changing_lines + '\n' +
    '- Timestamp UTC: ' + draw.timestamp_utc;

  var snapshotTrimmed = trimForPrompt_(ctx.advisorySnapshot, 14000);
  var baseTrimmed = trimForPrompt_(ctx.advisoryBase, 7000);
  var remindersTrimmed = trimForPrompt_(buildRemindersBlock_(ctx.remindersJson), 4000);
  var pendingTrimmed = trimForPrompt_(buildPendingRawsBlock_(ctx.pendingRaws), 2000);

  var staticContext =
    'ADVISORY_SNAPSHOT_MD\n' + snapshotTrimmed + '\n\n' +
    'ADVISORY_BASE_MD\n' + baseTrimmed;

  var dynamicContext =
    drawBlock + '\n\n' +
    'OPEN_REMINDERS (operator\'s current open Apple Reminders — use to connect hexagram to real priorities)\n' +
    remindersTrimmed + '\n\n' +
    'PENDING_IOS_INTENTS (iPhone reminders posted via Edgar after the last Mac sync — tentative intents, not yet in macOS Reminders; rapid consecutive entries with near-identical titles are likely edits of the same item)\n' +
    pendingTrimmed;

  return {
    header: ORACLE_PROMPT_HEADER,
    staticContext: staticContext,
    dynamicContext: dynamicContext
  };
}

function flattenPromptParts_(parts) {
  return parts.header + '\n\n' + parts.staticContext + '\n\n' + parts.dynamicContext;
}

function trimForPrompt_(text, maxLen) {
  var t = String(text || '');
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '\n...[truncated]';
}

/**
 * Route the advisor call based on ADVISOR_MODEL script property.
 *   - 'anthropic' (default) uses Claude with prompt caching on header + static context.
 *   - 'xai' falls back to Grok (useful if Anthropic rate-limits or the key is missing).
 * On Anthropic failure (missing key, rate limit, 5xx) automatically falls back to xAI
 * so the oracle always returns something rather than 500ing. The failure reason is
 * logged and surfaced in the returned `model` string as e.g. "grok-3-mini (anthropic_fallback)".
 */
function callAdvisor_(promptParts) {
  var props = PropertiesService.getScriptProperties();
  var preferred = (props.getProperty('ADVISOR_MODEL') || 'anthropic').trim().toLowerCase();
  if (preferred === 'xai' || preferred === 'grok') {
    return callXai_(promptParts);
  }
  try {
    return callAnthropic_(promptParts);
  } catch (err) {
    try {
      Logger.log('Anthropic advisor call failed, falling back to xAI: ' + err);
    } catch (_) { /* Logger may be unavailable in some contexts */ }
    var fallback = callXai_(promptParts);
    fallback.model = fallback.model + ' (anthropic_fallback)';
    return fallback;
  }
}

function callAnthropic_(promptParts) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('ANTHROPIC_API_KEY') || '').trim();
  if (!apiKey) throw new Error('Missing script property ANTHROPIC_API_KEY');
  var model = (props.getProperty('ANTHROPIC_MODEL') || 'claude-sonnet-4-6').trim();

  // System blocks with ephemeral cache_control on the stable pieces so repeat
  // calls within ~5 minutes only pay ~10% input cost on the cached prefix.
  // Anthropic minimum for caching is 1024 tokens on Sonnet; header + static
  // easily clear that bar (>4000 tokens typical).
  var payload = {
    model: model,
    max_tokens: 1500,
    temperature: 0.35,
    system: [
      { type: 'text', text: promptParts.header, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: promptParts.staticContext, cache_control: { type: 'ephemeral' } }
    ],
    messages: [
      { role: 'user', content: promptParts.dynamicContext }
    ]
  };

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Anthropic call failed (' + code + '): ' + body.slice(0, 600));
  }

  var parsed = JSON.parse(body);
  var out = '';
  if (parsed && Array.isArray(parsed.content)) {
    for (var i = 0; i < parsed.content.length; i++) {
      var block = parsed.content[i];
      if (block && block.type === 'text' && block.text) out += block.text;
    }
  }
  out = out.trim();
  if (!out) throw new Error('Anthropic response had no text blocks');
  return { model: model, text: out };
}

function callXai_(promptParts) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('XAI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('Missing script property XAI_API_KEY');
  var model = (props.getProperty('XAI_MODEL') || 'grok-3-mini').trim();

  // xAI/OpenAI-style chat completions don't support block-level caching,
  // so flatten the three parts into a single user message.
  var prompt = flattenPromptParts_(promptParts);
  var payload = {
    model: model,
    messages: [
      {
        role: 'system',
        content:
          'You provide concise, actionable advisory guidance for DAO operations. Avoid fluff and avoid legal/financial guarantees.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.35
  };

  var res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('xAI call failed (' + code + '): ' + body.slice(0, 600));
  }

  var parsed = JSON.parse(body);
  var text =
    parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message &&
    parsed.choices[0].message.content;
  if (!text) {
    throw new Error('xAI response missing choices[0].message.content');
  }
  return { model: model, text: String(text).trim() };
}

function fetchText_(url) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Fetch failed (' + code + ') for ' + url + ': ' + body.slice(0, 500));
  }
  return body;
}

function fetchTextWithMeta_(url) {
  var out = { url: url, ok: false, response_code: null, length: 0 };
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });
  out.response_code = res.getResponseCode();
  var txt = res.getContentText() || '';
  out.length = txt.length;
  out.ok = out.response_code >= 200 && out.response_code < 300;
  return out;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
