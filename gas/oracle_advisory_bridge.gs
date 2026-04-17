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
 *  - XAI_API_KEY            (required)
 *  - XAI_MODEL              (optional, default: grok-3-mini)
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
    'https://raw.githubusercontent.com/TrueSightDAO/ecosystem_change_logs/main/reminders/current.json'
};

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

    var prompt = buildOraclePrompt_({
      draw: draw,
      advisorySnapshot: advisorySnapshot,
      advisoryBase: advisoryBase,
      remindersJson: remindersJson
    });
    var ai = callXai_(prompt);

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

function buildOraclePrompt_(ctx) {
  var draw = ctx.draw;
  var header =
    'You are an advisor to TrueSight DAO. Integrate I Ching symbolism with concrete DAO operating context.\n' +
    'Output plain text only with these sections:\n' +
    '1) Reading synthesis (2-4 lines)\n' +
    '2) DAO priorities today (3 bullets)\n' +
    '3) Risks / watch-outs (3 bullets)\n' +
    '4) One decisive action in next 24h\n' +
    'Keep it practical, specific, and aligned with current advisory materials and open reminders.';

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
  var remindersBlock = buildRemindersBlock_(ctx.remindersJson);
  var remindersTrimmed = trimForPrompt_(remindersBlock, 4000);

  return (
    header + '\n\n' +
    drawBlock + '\n\n' +
    'ADVISORY_SNAPSHOT_MD\n' + snapshotTrimmed + '\n\n' +
    'ADVISORY_BASE_MD\n' + baseTrimmed + '\n\n' +
    'OPEN_REMINDERS (operator\'s current open Apple Reminders — use to connect hexagram to real priorities)\n' +
    remindersTrimmed
  );
}

function trimForPrompt_(text, maxLen) {
  var t = String(text || '');
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '\n...[truncated]';
}

function callXai_(prompt) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('XAI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('Missing script property XAI_API_KEY');
  var model = (props.getProperty('XAI_MODEL') || 'grok-3-mini').trim();

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
