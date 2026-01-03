console.log('Watson (free mode) script started');

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';

import { loadState, saveState, getChatState } from './lib/state.mjs';
import { appendMessage, readMessagesSince, readRecent } from './lib/store.mjs';
import { buildCatchupDigest, buildSummaryDigest } from './lib/digest.mjs';

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

// ---------- state boot marker ----------
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
  return t.slice(0, maxLen) + '…';
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

bot.launch()
  .then(() => console.log('Watson is running (free mode, long polling).'))
  .catch((err) => console.error('Failed to launch Watson:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
