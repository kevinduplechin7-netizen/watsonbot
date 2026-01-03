console.log('Watson (free mode) script started');

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadState, saveState, getChatState } from './lib/state.mjs';
import { appendMessage, readMessagesSince, readRecent } from './lib/store.mjs';
import { buildCatchupDigest, buildSummaryDigest } from './lib/digest.mjs';
import { buildLooseEndsDigest, buildDecisionsDigest } from './lib/extract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

console.log('ENV loaded:', {
  hasToken: Boolean(TELEGRAM_BOT_TOKEN),
  tokenLength: TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.length : 0,
  envPath: path.join(__dirname, '.env'),
});

if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);



bot.catch((err, ctx) => {
  console.error('BOT_ERROR:', err);
  try {
    if (ctx && typeof ctx.reply === 'function') {
      return ctx.reply('Watson observes:\n- A paperwork incident occurred.\n- The archive remains available. /help');
    }
  } catch {}
});

process.on('unhandledRejection', (err) => console.error('UNHANDLED_REJECTION:', err));
process.on('uncaughtException', (err) => console.error('UNCAUGHT_EXCEPTION:', err));
////////////////////////////////////////////////////////////////////////////////
// WATSON_PREMIUM_GUARDRAILS
// - Rate limit command replies so Watson cannot be spammed.
// - Implement quiet /observe so Watson appears rarely and only when helpful.
// - Maintain per-chat template memory to reduce repetition.
////////////////////////////////////////////////////////////////////////////////

const _templateStateByChat = new Map();
const _lastCommandReplyAt = new Map(); // key: chatId:command -> ms
const _observeByChat = new Map(); // chatId -> { enabled, lastAutoAt, sinceCount }

// Cooldowns (milliseconds)
const _COOLDOWN_MS = {
  summary: 60_000,
  catchup: 120_000,
  audit: 60_000,
  looseends: 60_000,
  decisions: 60_000
};

// Observe behavior: rare, not annoying
const _OBSERVE_MIN_MESSAGES = 50;
const _OBSERVE_MIN_MS = 4 * 60 * 60 * 1000; // four hours
const _OBSERVE_QUIET_HOURS = { start: 22, end: 7 }; // ten pm to seven am (local)

function _isQuietHours() {
  const h = new Date().getHours();
  // quiet if hour >= start OR hour < end
  return (h >= _OBSERVE_QUIET_HOURS.start) || (h < _OBSERVE_QUIET_HOURS.end);
}

function _chatId(ctx) {
  return String(ctx.chat?.id ?? "");
}

function _getTemplateState(chatId) {
  if (!_templateStateByChat.has(chatId)) _templateStateByChat.set(chatId, {});
  return _templateStateByChat.get(chatId);
}

function _cmdKey(chatId, cmd) {
  return chatId + ":" + cmd;
}

function _tooSoon(chatId, cmd) {
  const key = _cmdKey(chatId, cmd);
  const last = _lastCommandReplyAt.get(key) || 0;
  const now = Date.now();
  const cooldown = _COOLDOWN_MS[cmd] || 0;
  return (now - last) < cooldown;
}

function _stampCmd(chatId, cmd) {
  _lastCommandReplyAt.set(_cmdKey(chatId, cmd), Date.now());
}

function _parseCommand(text) {
  if (!text) return "";
  const t = String(text).trim();
  if (!t.startsWith("/")) return "";
  return t.slice(1).split(/[ @\n\r\t]/)[0].toLowerCase();
}

// Middleware sits before command handlers.
bot.use(async (ctx, next) => {
  const chatId = _chatId(ctx);
  const text = ctx.message?.text;

  // Observe toggle interception (prevents duplicate handlers from being noisy)
  const cmd = _parseCommand(text);
  if (cmd === "observe") {
    const state = _observeByChat.get(chatId) || { enabled: false, lastAutoAt: 0, sinceCount: 0 };
    state.enabled = true;
    state.sinceCount = 0;
    _observeByChat.set(chatId, state);
    return ctx.reply("Watson will observe quietly. Reports will be rare and optional.");
  }
  if (cmd === "silence") {
    _observeByChat.set(chatId, { enabled: false, lastAutoAt: 0, sinceCount: 0 });
    return ctx.reply("Watson will remain silent until requested.");
  }

  // Command cooldown (prevents overkill)
  if (cmd && _COOLDOWN_MS[cmd]) {
    if (_tooSoon(chatId, cmd)) {
      return ctx.reply("Report recently filed. The archive requests a brief pause.");
    }
    _stampCmd(chatId, cmd);
  }

  // Let normal handlers run
  await next();

  // Quiet observe: after non-command messages only
  if (!cmd) {
    const state = _observeByChat.get(chatId);
    if (state?.enabled) {
      state.sinceCount = (state.sinceCount || 0) + 1;

      const now = Date.now();
      const enoughMsgs = state.sinceCount >= _OBSERVE_MIN_MESSAGES;
      const enoughTime = (now - (state.lastAutoAt || 0)) >= _OBSERVE_MIN_MS;

      if (enoughMsgs && enoughTime && !_isQuietHours()) {
        try {
          // Pull recent window and summarize. Keep it short.
          const messages = await store.getRecent(chatId, 120);
          const templateState = _getTemplateState(chatId);
          const out = buildSummaryDigest(messages, { templateState });

          await ctx.reply(out);
          state.lastAutoAt = now;
          state.sinceCount = 0;
        } catch (e) {
          // fail closed: do not spam errors into chat
        }
      }
      _observeByChat.set(chatId, state);
    }
  }
});// ---------- state boot marker ----------
const state = loadState();
const bootTs = Math.floor(Date.now() / 1000);

// For each known chat, mark the last seen timestamp as the "start" of this run.
for (const chatId of Object.keys(state.chats || {})) {
  const cs = getChatState(state, chatId);
  cs.bootMarkerTs = cs.lastSeenTs || 0;
}
state.bootTs = bootTs;
saveState(state);

function normalize(s) {
  return (s || '').trim();
}

function isCommand(text) {
  return normalize(text).startsWith('/');
}

function looksLikeQuestion(text) {
  const t = normalize(text).toLowerCase();
  return t.includes('?') || /^(who|what|when|where|why|how|anyone|can we|should we|are we|did we)\b/.test(t);
}

function watsonHeader() {
  return 'Watson observes:';
}

function line(...parts) {
  return `- ${parts.join(' ').trim()}`;
}

function clipQuote(s, maxLen) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + 'â€¦';
}

function findLastQuestionWithOutcome(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const txt = messages[i]?.text || '';
    if (!looksLikeQuestion(txt)) continue;

    const after = messages.slice(i + 1);
    const responded = after.some(m => {
      const t = m?.text || '';
      return t && !looksLikeQuestion(t) && !isCommand(t);
    });

    return { questionText: txt, responded };
  }
  return null;
}

function buildObserve(messages) {
  const last = messages.slice(-30);
  if (last.length === 0) return `${watsonHeader()}\n${line('Nothing of note.')}`;

  const total = last.length;
  const questionCount = last.filter(m => looksLikeQuestion(m.text)).length;
  const shortMsgs = last.filter(m => normalize(m.text).length <= 12).length;
  const emojis = last.filter(m => /[\u{1F300}-\u{1FAFF}]/u.test(m.text)).length;

  const hasLogistics = last.some(m => /\b(time|when|where|address|link|cost|price|ride|deploy|host)\b/i.test(m.text));
  const hasVibes =
    last.some(m => /\b(lol|haha|lmao|rip|bro|ok|nice|wild)\b/i.test(m.text)) || emojis > 0;

  const linesOut = [];
  linesOut.push(watsonHeader());

  if (hasVibes && !hasLogistics) linesOut.push(line('Energy was present.', 'Specifics were not.'));
  else if (hasVibes && hasLogistics) linesOut.push(line('Both enthusiasm and logistics appeared.'));
  else if (!hasVibes && hasLogistics) linesOut.push(line('Logistics were discussed.', 'Tone remained procedural.'));
  else linesOut.push(line('The thread proceeded without notable ornamentation.'));

  if (questionCount > 0) linesOut.push(line('Questions detected:', String(questionCount) + '.'));
  if (shortMsgs / total > 0.5) linesOut.push(line('Brevity was favored.'));
  if (emojis > 0) linesOut.push(line('Nonverbal signals were logged.'));

  return linesOut.join('\n');
}

function buildSilence(messages) {
  const last = messages.slice(-50);
  if (last.length === 0) return `${watsonHeader()}\n${line('Nothing of note.')}`;

  const q = findLastQuestionWithOutcome(last);

  const linesOut = [];
  linesOut.push(watsonHeader());

  if (!q) {
    linesOut.push(line('No recent question detected.'));
    return linesOut.join('\n');
  }

  if (q.responded) linesOut.push(line('A question was asked.', 'A response followed.'));
  else linesOut.push(line('A question was asked.', 'No response was detected.'));

  linesOut.push(line(`Question noted: "${clipQuote(q.questionText, 140)}"`));
  return linesOut.join('\n');
}

// ---------- archive everything (opt-in replies) ----------
bot.use(async (ctx, next) => {
  const text = ctx.message?.text;
  if (!text) return next();
  if (ctx.from?.is_bot) return next();

  const chatId = String(ctx.chat.id);
  const ts = ctx.message?.date || Math.floor(Date.now() / 1000);
  const userId = ctx.from?.id || null;

  // Safe debug
  console.log('INCOMING:', { chat: chatId, userId, text });

  await appendMessage({ chatId, ts, text, userId, isCommand: isCommand(text) });

  const cs = getChatState(state, chatId);
  cs.lastSeenTs = Math.max(cs.lastSeenTs || 0, Number(ts) || 0);
  saveState(state);

  return next();
});

// ---------- commands ----------
bot.command('rules', (ctx) =>
  ctx.reply(
    `Watson observes:\n- I summarize and record patterns.\n- I do not name people or assign motives.\n- I do not give advice.\n- I speak only when asked (/observe, /summary, /silence, /catchup).`
  )
);

bot.command('summary', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const cs = getChatState(state, chatId);

  const msgs = await readMessagesSince(chatId, cs.lastSummaryTs || 0, { limit: 2000, includeCommands: false });
  const out = buildSummaryDigest(msgs);

  // Advance the marker so /summary is incremental.
  cs.lastSummaryTs = cs.lastSeenTs || cs.lastSummaryTs || 0;
  saveState(state);

  return ctx.reply(out);
});

bot.command('catchup', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const cs = getChatState(state, chatId);

  const startTs = cs.bootMarkerTs || 0;
  const msgs = await readMessagesSince(chatId, startTs, { limit: 5000, includeCommands: false });
  const out = buildCatchupDigest(msgs);

  // Move the marker so repeated /catchup doesn't repeat.
  cs.bootMarkerTs = cs.lastSeenTs || cs.bootMarkerTs || 0;
  saveState(state);

  return ctx.reply(out);
});

bot.command('observe', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const msgs = await readRecent(chatId, 60, { includeCommands: false });
  return ctx.reply(buildObserve(msgs));
});

bot.command('silence', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const msgs = await readRecent(chatId, 80, { includeCommands: false });
  return ctx.reply(buildSilence(msgs));
});

bot.command('help', async (ctx) => {
  const lines = [
    "Watson is an opt-in archivist. He speaks only when requested (or when /observe is enabled).",
    "",
    "Commands:",
    "- /rules — what Watson is and is not",
    "- /summary — short ledger of recent activity",
    "- /catchup — smirking digest of backlog window",
    "- /audit — random Exhibit Audit (logic + form, harmless)",
    "- /looseends — unclaimed next steps",
    "- /decisions — commitments that actually attached",
    "- /observe — rare automatic summaries (quiet mode)",
    "- /silence — disables observe mode",
    "",
    "Watson does not name people. He reports signals."
  ];
  return ctx.reply(lines.join("\n"));
});
////////////////////////////////////////////////////////////////////////////////
// WATSON_CAPABILITY_NUDGE
// - Only active when /observe is enabled (opt-in)
// - Max once per week per chat
// - Quiet hours respected (uses _isQuietHours if present)
// - Low activity gate to avoid random interruptions
////////////////////////////////////////////////////////////////////////////////

const _capNudgeByChat = new Map(); // chatId -> lastNudgeAt ms

function _capNudgeText() {
  const variants = [
    "Reminder: the archive remains available. /summary /catchup /audit /looseends /decisions /help",
    "Capabilities persist. When ready: /summary, /catchup, /audit, /looseends, /decisions, /help",
    "Watson notes: tools exist. Use at will: /summary /catchup /audit /looseends /decisions /help",
    "If needed: /summary for ledger, /catchup for digest, /audit for Exhibit Audit. Others remain on file."
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

bot.use(async (ctx, next) => {
  await next();

  const chatId = String(ctx.chat?.id ?? "");
  const text = ctx.message?.text ?? "";
  const isCmd = typeof text === "string" && text.trim().startsWith("/");

  // Only consider nudges on normal messages
  if (isCmd) return;

  // Only when observe is enabled (guardrails map)
  try {
    if (typeof _observeByChat === "undefined") return;
    const state = _observeByChat.get(chatId);
    if (!state?.enabled) return;

    // Respect quiet hours if helper exists
    if (typeof _isQuietHours === "function" && _isQuietHours()) return;

    const now = Date.now();
    const last = _capNudgeByChat.get(chatId) || 0;

    // Once per week max
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (now - last < WEEK_MS) return;

    // Require some activity since observe enabled
    const since = state.sinceCount || 0;
    if (since < 25) return;

    await ctx.reply(_capNudgeText());
    _capNudgeByChat.set(chatId, now);
  } catch {
    // fail closed: no spam
  }
});





////////////////////////////////////////////////////////////////////////////////
// Loose ends + decisions (self-contained; reads JSONL archive directly)
// This avoids crashing when store helpers drift.
////////////////////////////////////////////////////////////////////////////////

function _watsonSafeText(x) {
  if (!x) return "";
  let s = String(x);
  s = s.replace(/@\w+/g, "@…");
  s = s.replace(/\b\d{7,}\b/g, "…");
  s = s.replace(/https?:\/\/\S+/gi, "[link]");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 180) s = s.slice(0, 177) + "…";
  return s;
}

function _isCommandText(t) {
  return typeof t === "string" && t.trim().startsWith("/");
}

async function _readRecentJsonl(chatId, limit = 250) {
  const file = path.join(process.cwd(), "data", "chats", `${chatId}.jsonl`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(limit, 50));
    const out = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const txt = _watsonSafeText(obj?.text ?? obj?.message?.text ?? obj?.caption ?? "");
        if (!txt) continue;
        out.push({ text: txt });
      } catch {}
    }
    return out;
  } catch (e) {
    // file not found or unreadable -> treat as empty archive
    return [];
  }
}

function _uniqLower(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function _extractLooseEnds(msgs) {
  const pats = [
    /\bwe should\b/i,
    /\bwe need to\b/i,
    /\bnext step\b/i,
    /\btodo\b/i,
    /\bto do\b/i,
    /\bfollow up\b/i,
    /\bremind me\b/i,
    /\bcan you\b/i,
    /\bcould you\b/i,
    /\bplease\b/i,
    /\blet's\b/i,
  ];
  const hits = [];
  for (const m of msgs) {
    const t = m?.text ?? "";
    if (!t || _isCommandText(t)) continue;
    if (pats.some(r => r.test(t))) hits.push(`"${t}"`);
  }
  return _uniqLower(hits).slice(0, 7);
}

function _extractDecisions(msgs) {
  const pats = [
    /\bdecided\b/i,
    /\bconfirmed\b/i,
    /\blocked in\b/i,
    /\bwe will\b/i,
    /\bwe're going to\b/i,
    /\bship it\b/i,
    /\bdone deal\b/i,
    /\bagreed\b/i,
    /\bfinal\b/i,
  ];
  const hits = [];
  for (const m of msgs) {
    const t = m?.text ?? "";
    if (!t || _isCommandText(t)) continue;
    if (pats.some(r => r.test(t))) hits.push(`"${t}"`);
  }
  return _uniqLower(hits).slice(0, 7);
}

bot.command("looseends", async (ctx) => {
  try {
    const chatId = String(ctx.chat?.id ?? "");
    const msgs = await _readRecentJsonl(chatId, 300);
    const items = _extractLooseEnds(msgs);

    if (!items.length) {
      return ctx.reply("Watson observes:\n- Loose ends were referenced.\n- None successfully attached.");
    }

    const lines = ["Watson observes:", "- Loose ends detected:"];
    for (const it of items) lines.push("- " + it);
    lines.push("- Ownership remained interpretive.");
    return ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error("LOOSEENDS_ERROR:", err);
    return ctx.reply("Watson observes:\n- Loose ends were requested.\n- The archive declined to cooperate. /help");
  }
});

bot.command("decisions", async (ctx) => {
  try {
    const chatId = String(ctx.chat?.id ?? "");
    const msgs = await _readRecentJsonl(chatId, 300);
    const items = _extractDecisions(msgs);

    if (!items.length) {
      return ctx.reply("Watson observes:\n- Decisions were discussed.\n- They did not attach.");
    }

    const lines = ["Watson observes:", "- Decisions recorded:"];
    for (const it of items) lines.push("- " + it);
    lines.push("- Documentation thanks you for your cooperation.");
    return ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error("DECISIONS_ERROR:", err);
    return ctx.reply("Watson observes:\n- Decisions were requested.\n- The record declined comment. /help");
  }
});

