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
 *  - ORACLE_LOGS_PAT         (required for draw logging — GitHub PAT with Contents:write on oracle_logs)
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

    // Persist draw to oracle_logs for later triage by autopilot/opencode
    writeToOracleLogs_(draw, ai);

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
  var draw = {
    signature: (params.signature || '').trim(),
    primary_number: (params.primary_number || '').trim(),
    primary_name: (params.primary_name || '').trim(),
    primary_judgment: (params.primary_judgment || '').trim(),
    related_number: (params.related_number || '').trim(),
    related_name: (params.related_name || '').trim(),
    related_judgment: (params.related_judgment || '').trim(),
    changing_lines: (params.changing_lines || 'none').trim(),
    timestamp_utc: (params.timestamp_utc || new Date().toISOString()).trim(),
    qmdj_chart: null
  };
  // Optional: client may send a QiMen Dunjia chart computed from the same
  // timestamp as the I-Ching cast. JSON-encoded, parsed defensively — bad
  // input must NOT break the I-Ching path; we just drop the chart and let
  // the LLM skip the QMDJ-specific sections.
  var raw = (params.qmdj_chart || '').trim();
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        draw.qmdj_chart = parsed;
      }
    } catch (err) {
      try { Logger.log('QMDJ chart JSON parse failed; continuing without it: ' + err); } catch (_) {}
    }
  }
  return draw;
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
// Static QMDJ framework reference — what the LLM needs to know to read a
// chart. Stable across calls; lives in the cached static block. Update by
// editing this constant and redeploying the GAS web app.
var QMDJ_FRAMEWORK_REFERENCE = [
  'QMDJ_FRAMEWORK_REFERENCE',
  '',
  'What QiMen Dunjia (奇門遁甲) is',
  'QMDJ is a classical Chinese strategic-divination framework that maps any specific moment in time onto a 9-palace Luo-Shu grid. Unlike I Ching (which uses random coin throws), QMDJ is fully deterministic from the timestamp — solar term, yuan, day pillar and hour pillar pick a single chart. The chart layers five kinds of information onto each of the 9 palaces: a Spirit, a Star, a Door, and two stems (Heaven plate, Earth plate). Practitioners read the chart for WHERE to act and WHEN to act — the spatial / strategic shape of the moment.',
  '',
  'The 9 Palaces (each is a compass direction AND a life-domain)',
  '- Palace 1 坎 (N)  — water; career, secrets, hidden things, study, depth, danger.',
  '- Palace 2 坤 (SW) — earth; motherhood, support, partnerships, marriage, the public.',
  '- Palace 3 震 (E)  — wood; action, decisive beginnings, ambition, public movement.',
  '- Palace 4 巽 (SE) — wood; wealth, persuasion, travel, communication.',
  '- Palace 5 中 (Center) — earth; the axis, self, rulership, neutrality. NOT a direction for outward action.',
  '- Palace 6 乾 (NW) — metal; leadership, authority, fathers, mentors, helpful people, government.',
  '- Palace 7 兌 (W)  — metal; joy, speech, romance, attraction, charm — also gossip and superficiality.',
  '- Palace 8 艮 (NE) — earth; stillness, knowledge, education, real estate, accumulation.',
  '- Palace 9 離 (S)  — fire; brightness, fame, recognition, vision, manifestation, exposure.',
  '',
  'The 8 Doors (八門) — gates of action',
  '- 開門 Open  — auspicious 三吉. Beginnings, expansion, official success, public-facing action.',
  '- 休門 Rest  — auspicious 三吉. Renewal, peace, recovery, romance.',
  '- 生門 Birth — auspicious 三吉. Growth, wealth, new ventures, partnerships, sales.',
  '- 杜門 Block — neutral. Hiding, defensive holding, secrecy, study.',
  '- 景門 Scenery — neutral. Vision, signaling, communication, but no direct action.',
  '- 傷門 Hurt  — inauspicious 三凶. Injury, conflict, sharp force, debt collection.',
  '- 死門 Death — inauspicious 三凶. Endings, finality, loss.',
  '- 驚門 Surprise — inauspicious 三凶. Disputes, lawsuits, unexpected disturbance.',
  '',
  'The 9 Stars (九星) — cosmic influence on the direction',
  '- 天蓬 (water)  — inauspicious. Movement, theft, danger, scheming.',
  '- 天芮 (earth)  — inauspicious. Illness, weakness, decay.',
  '- 天沖 (wood)   — mixed (good for action, bad for stillness). Burst of energy.',
  '- 天輔 (wood)   — auspicious. Education, planning, scholarship, mentorship.',
  '- 天禽 (earth)  — auspicious. Stability, magnanimity. Sits in center; lent to a cardinal palace.',
  '- 天心 (metal)  — auspicious. Healing, decisive wisdom, leadership.',
  '- 天柱 (metal)  — inauspicious. Disputes, breakage, transformation through tension.',
  '- 天任 (earth)  — auspicious. Reliability, slow steady progress.',
  '- 天英 (fire)   — mixed. Honor, fame, exposure — also conflict.',
  '',
  'The 8 Spirits (八神) — subtle forces overlaid on each palace',
  '- 值符 — strongest auspicious. The palace where 值符 sits is the focal point of the moment\'s energy.',
  '- 螣蛇 / 滕蛇 — inauspicious. Strange events, illusion, deception, anxious dreams.',
  '- 太陰 — auspicious. Hidden support, secret help, behind-the-scenes allies.',
  '- 六合 — auspicious. Cooperation, partnership, networking, marriage.',
  '- 九地 — auspicious. Solid ground, defensive position, retention, safekeeping.',
  '- 九天 — auspicious. High vantage, expansion, outward bold action, travel.',
  '- 朱雀 (yang chart) / 白虎 (yin chart) — inauspicious. Disputes / conflict.',
  '- 勾陳 (yang chart) / 玄武 (yin chart) — inauspicious. Entanglement / theft.',
  '',
  'The 10 Heavenly Stems on Heaven and Earth plates',
  '- 甲 — never appears directly on the chart; hidden behind a Yi (the 遁甲 of QMDJ).',
  '- 乙 丙 丁 — Three Wonders 三奇. Mark windows of opportunity wherever they land.',
  '- 戊 己 庚 辛 壬 癸 — Six Yi 六儀. Specifically: 庚 (Geng) marks blockage / conflict — wherever 庚 lands, treat that direction with caution. 庚 paired with the day stem amplifies the warning.',
  '',
  'Per-palace outlook (heuristic provided by the client)',
  'For each non-center palace, the client computes a heuristic outlook score combining door (+/- 2), spirit (+/- 1), each Three Wonder on heaven or earth plate (+1), each 庚 (-1), and a +1 bonus when the palace contains 值符. Score is mapped to one of: "strong" (>= +3), "favorable" (+1, +2), "mixed" (0), "caution" (-1, -2), "avoid" (<= -3). Center is forced neutral. This is a quick visual prior, NOT a master-practitioner read — real QMDJ also weighs 五行 generation/control between palaces, 反吟/伏吟 patterns, and the question\'s nature. Use the outlook as a starting point and cross-check against the chart structure.',
  '',
  'Notable patterns to watch for',
  '- 三奇 + 三吉門 in the same palace — a Three Wonder (乙/丙/丁) sitting with an auspicious door (開/休/生). Strong window for outward action in that direction.',
  '- 庚 collisions — wherever 庚 lands, treat with caution; 庚 paired with the day stem or 值符 amplifies the warning.',
  '- 死門 on the day stem — the direction associated with the day stem carrying 死門 is loss territory; read carefully.',
  '- 值符 palace alignment — the 值符 palace concentrates the moment\'s primary energy; pair with the door in that palace to judge what action that energy supports.',
  '',
  'How to use QMDJ alongside the I Ching reading',
  '- Use I Ching as the narrative / transformational lens (what is moving, what is the quality of this moment).',
  '- Use QMDJ as the spatial / strategic overlay (where the energy supports action, what direction is auspicious, when an auspicious window opens).',
  '- They are COMPLEMENTARY, not redundant. Do NOT let QMDJ override the I Ching reading. Let it sharpen the action recommendation by adding directional / timing specificity.',
  '- Combining I Ching and QMDJ for the same question is a MODERN SYNTHESIS, not classical practice — they have different question-frames in tradition. Acknowledge this when relevant.',
  '- If no QMDJ chart is provided in the dynamic context (older client, or chart computation failed), proceed with I Ching only and skip the QMDJ-specific output sections (2 and 3).'
].join('\n');

var ORACLE_PROMPT_HEADER =
  'You are an advisor to TrueSight DAO. The operator you are advising is Gary, working solo or near-solo on execution. Any advice you give has to be carried out by one person with finite hours, not a team. Integrate I Ching symbolism with concrete DAO operating context.\n\n' +
  'Treat the I Ching as a lens, not a justification. The hexagram should sharpen a reading you could defend without it. If you find yourself reverse-justifying priorities from the judgment text, stop, write the analysis straight, then check whether the hexagram actually fits.\n\n' +
  'You may also receive a QiMen Dunjia (QMDJ) chart computed from the same moment as the I Ching cast. Use I Ching as the narrative / transformational lens (what is moving, what is the quality of this instant) and QMDJ as the spatial / strategic overlay (where the energy supports action, what direction is auspicious or to avoid, when an auspicious window opens). They are complementary, not redundant — do not let QMDJ override I Ching; let it sharpen the action recommendation. Combining the two for the same question is a modern synthesis, not classical practice. The static QMDJ_FRAMEWORK_REFERENCE block describes how to read the chart; the dynamic context will include the chart itself when the client sends one.\n\n' +
  'Scale advice to a solo operator. The DAO has many surfaces — tokenomics, inventory, stores, DApp, Beer Hall, signature onboarding, Hit List, Agroverse shop. Gary cannot work on all of them in a week. Good advice picks one or two, explicitly deprioritizes the rest for now, and favors actions that compound (writing to a customer, diagnosing one stuck store) over actions that spread attention (auditing everything, reconciling all surfaces). If an action requires coordination with other contributors, surface that coordination cost as part of the action.\n\n' +
  'Every suggestion should trace back to the north star in the advisory snapshot (purpose: heal the world with love; mission: restore 10,000 hectares of Amazon rainforest). When a suggestion does not obviously serve the mission, say so.\n\n' +
  'Output plain text only with these sections:\n' +
  '1) Reading synthesis (2-4 lines) — what the I Ching hexagram illuminates about the current situation, not a generic gloss of the judgment.\n' +
  '2) QMDJ configuration of this moment (3-5 lines) — name the Ju (局), where the Three Wonders 三奇 (乙 / 丙 / 丁) sit, where the Three Auspicious Doors 三吉門 (開 / 休 / 生) sit, where the day stem sits, and any notable alignment (e.g. Wonder + Auspicious Door in the same palace, 死門 on the day stem, 庚 paired with 值符). Keep it structural — what is true of the moment, not yet what to do. SKIP this section entirely if no QMDJ chart was provided in the dynamic context.\n' +
  '3) Combined frame (1-2 lines) — how the I Ching narrative reading and the QMDJ structural reading point at the same situation, and where they reinforce or diverge. SKIP if no QMDJ chart.\n' +
  '4) Context gaps worth naming (1-3 bullets) — what the snapshot cannot tell you that would change the advice. Propose the most likely read and note what would change if the alternative is true. Skip this section only if the snapshot is genuinely sufficient.\n' +
  '5) Priorities this week for a solo operator (3 bullets max) — specific to what is actually shipping or stalled, with an explicit note on what Gary should NOT spend time on this week.\n' +
  '6) Risks / watch-outs (3 bullets) — distinguish real signals from artifacts (seasonality, deliberate dormancy, expected off-cycles). If a metric looks alarming, check whether the business shape explains it before flagging. Flag risks Gary can actually act on, not ambient ones.\n' +
  '7) One decisive action in next 24h — something Gary can do tomorrow morning in under two hours, solo, with a concrete first step (the exact sheet to open, the exact five rows to pull, the exact first email to write, the exact store to call). No "run a reconciliation pass" abstractions. If the right action is smaller than it sounds (write five notes, not fifty), say so and explain why smaller is better. When QMDJ surfaces a clear directional or timing signal (e.g. an auspicious door + Wonder in a specific palace, or a 死門 + 庚 collision elsewhere), name it ("the action benefits from facing east before noon" / "wait until after the next 2h shichen"). Do not fabricate directional advice when QMDJ does not show a clear signal — say "QMDJ does not surface a strong directional read here" and proceed with the I Ching-grounded action.\n\n' +
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

  // Static block: snapshot + base + QMDJ framework reference. The framework
  // reference is included unconditionally so the cached prefix stays stable
  // across calls regardless of whether a chart was sent.
  var staticContext =
    'ADVISORY_SNAPSHOT_MD\n' + snapshotTrimmed + '\n\n' +
    'ADVISORY_BASE_MD\n' + baseTrimmed + '\n\n' +
    QMDJ_FRAMEWORK_REFERENCE;

  // Dynamic block: I Ching draw + (optional) QMDJ chart for this moment +
  // reminders + pending raws.
  var qmdjBlock = draw.qmdj_chart ? formatQmdjChartBlock_(draw.qmdj_chart) : '';

  var dynamicContext =
    drawBlock + '\n\n' +
    (qmdjBlock ? qmdjBlock + '\n\n' : '') +
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

/**
 * Format the QMDJ chart payload (parsed from the qmdj_chart query param)
 * into a block of plain text the LLM can read. The client pre-computes
 * the per-palace heuristic outlook (level + score) so the LLM can focus
 * on synthesis rather than recomputation.
 *
 * Defensive — bad / partial input returns empty string so the I Ching
 * path always works.
 */
function formatQmdjChartBlock_(chart) {
  if (!chart || typeof chart !== 'object') return '';
  var lines = [];
  lines.push('QMDJ CHART (computed from the same timestamp as the I Ching cast above)');
  if (chart.jieqi || chart.yuan) {
    lines.push('- Solar term / yuan: ' + (chart.jieqi || '?') + ' / ' + (chart.yuan || '?'));
  }
  if (chart.ju) {
    lines.push('- Ju (局): ' + chart.ju);
  }
  if (chart.year_pillar || chart.month_pillar || chart.day_pillar || chart.hour_pillar) {
    lines.push(
      '- Pillars (year/month/day/hour): ' +
        (chart.year_pillar || '?') + ' / ' +
        (chart.month_pillar || '?') + ' / ' +
        (chart.day_pillar || '?') + ' / ' +
        (chart.hour_pillar || '?')
    );
  }
  if (chart.zhifu_star || chart.zhifu_palace) {
    lines.push('- Zhi Fu (值符) star: ' + (chart.zhifu_star || '?') + ' @ palace ' + (chart.zhifu_palace || '?'));
  }
  if (chart.zhishi_door || chart.zhishi_palace) {
    lines.push('- Zhi Shi (值使) door: ' + (chart.zhishi_door || '?') + ' @ palace ' + (chart.zhishi_palace || '?'));
  }
  if (typeof chart.feibu !== 'undefined' && chart.feibu !== null) {
    lines.push('- Flying steps (飛步): ' + chart.feibu);
  }
  if (Array.isArray(chart.palaces) && chart.palaces.length === 9) {
    lines.push('');
    lines.push('Per-palace state (3x3 grid, row-major, south at top):');
    for (var i = 0; i < 9; i++) {
      var p = chart.palaces[i] || {};
      var dir = p.dir || '?';
      var palace = p.palace || '?';
      var isCenter = palace === '中';
      var line = '  ' + dir + ' (' + palace + ')';
      if (isCenter) {
        line += ' — Center · neutral · stems 天 ' + (p.heaven || '—') + ' / 地 ' + (p.earth || '—');
      } else {
        line +=
          ' — Spirit ' + (p.spirit || '—') +
          ', Star ' + (p.star || '—') +
          ', Door ' + (p.door || '—') +
          ', Stems 天 ' + (p.heaven || '—') + ' / 地 ' + (p.earth || '—');
        if (p.level || typeof p.score !== 'undefined') {
          line += ' [outlook: ' + (p.level || '?') + ' (' + (typeof p.score === 'number' ? (p.score >= 0 ? '+' + p.score : p.score) : '?') + ')]';
        }
      }
      lines.push(line);
    }
  }
  return lines.join('\n');
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

/**
 * Persist the oracle draw to oracle_logs repo for later triage.
 * Writes draws/YYYY-MM-DD.md via GitHub Contents API.
 * Format is structured Markdown parseable by autopilot and opencode.
 * Non-fatal: if PAT is missing or write fails, the draw still completes.
 */
function writeToOracleLogs_(draw, ai) {
  try {
    var props = PropertiesService.getScriptProperties();
    var pat = (props.getProperty('ORACLE_LOGS_PAT') || '').trim();
    if (!pat) {
      Logger.log('[oracle_logs] ORACLE_LOGS_PAT not set — skipping draw persistence');
      return;
    }

    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    var path = 'draws/' + dateStr + '.md';

    // Build structured Markdown
    var md = '# Oracle Draw — ' + dateStr + '\n\n';
    md += '## Hexagram\n';
    md += '- Primary: #' + draw.primary_number + ' ' + draw.primary_name + '\n';
    md += '- Related: ' + (draw.related_number ? '#' + draw.related_number + ' ' + draw.related_name : 'none') + '\n';
    md += '- Changing lines: ' + draw.changing_lines + '\n';
    md += '- Timestamp: ' + (draw.timestamp_utc || now.toISOString()) + '\n\n';
    md += '## Advisory\n';
    md += (ai.text || '') + '\n';

    // Upload via GitHub Contents API
    var apiUrl = 'https://api.github.com/repos/TrueSightDAO/oracle_logs/contents/' + path;
    var payload = {
      message: 'Oracle draw for ' + dateStr,
      content: Utilities.base64Encode(Utilities.newBlob(md).getBytes()),
      branch: 'main'
    };

    var res = UrlFetchApp.fetch(apiUrl, {
      method: 'put',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + pat,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      Logger.log('[oracle_logs] Draw persisted to oracle_logs/' + path);
    } else {
      Logger.log('[oracle_logs] GitHub write failed (' + code + '): ' + res.getContentText().slice(0, 500));
    }
  } catch (err) {
    Logger.log('[oracle_logs] Write exception (non-fatal): ' + err);
  }
}
