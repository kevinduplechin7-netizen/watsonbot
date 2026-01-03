console.log("Watson (free mode) script started");

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Telegraf } from "telegraf";

// Force-load .env from THIS folder (bulletproof)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Safe debug: shows whether token exists, without printing it
console.log("ENV loaded:", {
  hasToken: Boolean(TELEGRAM_BOT_TOKEN),
  tokenLength: TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.length : 0,
  envPath: path.join(__dirname, ".env"),
});

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Log incoming text so you can debug “no response”
bot.use(async (ctx, next) => {
  const t = ctx.message?.text;
  const chat = ctx.chat?.id;
  const from = ctx.from?.username || ctx.from?.first_name || "unknown";
  if (t) console.log("INCOMING:", { chat, from, text: t });
  return next();
});

// ---- In-memory buffer so /summary has context ----
const recentByChat = new Map();
const MAX_RECENT = 60;

function addRecent(chatId, from, text) {
  const arr = recentByChat.get(chatId) || [];
  arr.push({ from, text });
  while (arr.length > MAX_RECENT) arr.shift();
  recentByChat.set(chatId, arr);
}

function getRecent(chatId) {
  return recentByChat.get(chatId) || [];
}

function normalize(s) {
  return (s || "").trim();
}

function isCommand(text) {
  return normalize(text).startsWith("/");
}

function looksLikeQuestion(text) {
  const t = normalize(text).toLowerCase();
  return t.includes("?") || /^(who|what|when|where|why|how|anyone|can we|should we|are we)\b/.test(t);
}

function watsonHeader() {
  return "Watson observes:";
}

function line(...parts) {
  return `- ${parts.join(" ").trim()}`;
}

function safeFrom(ctx) {
  return ctx.from?.username
    ? `@${ctx.from.username}`
    : [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Someone";
}

function clipQuote(s, maxLen) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "…";
}

function findLastQuestionWithOutcome(messages) {
  // Find the most recent question, then check whether any non-command response followed.
  for (let i = messages.length - 1; i >= 0; i--) {
    const txt = messages[i]?.text || "";
    if (!looksLikeQuestion(txt)) continue;

    const after = messages.slice(i + 1);
    const responded = after.some(m => {
      const t = m?.text || "";
      return t && !looksLikeQuestion(t) && !isCommand(t);
    });

    return { questionText: txt, responded };
  }
  return null;
}

// ---- /summary (drier + smarter) ----
function buildSummary(messages) {
  const last = messages.slice(-12);
  if (last.length === 0) return `${watsonHeader()}\n${line("Nothing of note.")}`;

  const hasTimeWords = last.some(m => /\b(today|tonight|tomorrow|sat|sun|mon|tue|wed|thu|fri|\d{1,2}(:\d{2})?\b)/i.test(m.text));
  const hasPlanWords = last.some(m => /\b(plan|plans|hang|meet|dinner|wings|movie|trip|when|where|time)\b/i.test(m.text));
  const hasDecisionWords = last.some(m => /\b(decided|confirmed|locked|booked|final|we will|let's do|lets do)\b/i.test(m.text));

  const q = findLastQuestionWithOutcome(last);

  const lines = [];
  lines.push(watsonHeader());

  if (hasPlanWords) lines.push(line("A plan was mentioned."));
  else lines.push(line("General activity occurred."));

  if (hasDecisionWords) lines.push(line("A conclusion was recorded."));
  else lines.push(line("No conclusion was recorded."));

  if (hasTimeWords) lines.push(line("Timing surfaced."));
  else if (hasPlanWords) lines.push(line("Timing remained aspirational."));

  if (q) {
    const status = q.responded ? "Response recorded." : "Acknowledgement pending.";
    lines.push(line("A question was filed.", status));
  }

  const rep = last[last.length - 1]?.text || "";
  if (rep) lines.push(line(`Final entry logged: "${clipQuote(rep, 120)}"`));

  return lines.join("\n");
}

// ---- /observe (dry, mildly unimpressed, never cruel) ----
function buildObserve(messages) {
  const last = messages.slice(-30);
  if (last.length === 0) return `${watsonHeader()}\n${line("Nothing of note.")}`;

  const total = last.length;
  const questionCount = last.filter(m => looksLikeQuestion(m.text)).length;
  const shortMsgs = last.filter(m => normalize(m.text).length <= 12).length;
  const emojis = last.filter(m => /[\u{1F300}-\u{1FAFF}]/u.test(m.text)).length;

  const hasLogistics = last.some(m => /\b(time|when|where|address|link|cost|price|ride)\b/i.test(m.text));
  const hasVibes =
    last.some(m => /\b(lol|haha|lmao|rip|bro|ok|nice|wild)\b/i.test(m.text)) || emojis > 0;

  const lines = [];
  lines.push(watsonHeader());

  if (hasVibes && !hasLogistics) lines.push(line("Energy was present.", "Specifics were not."));
  else if (hasVibes && hasLogistics) lines.push(line("Both enthusiasm and logistics appeared."));
  else if (!hasVibes && hasLogistics) lines.push(line("Logistics were discussed.", "Tone remained procedural."));
  else lines.push(line("The thread proceeded without notable ornamentation."));

  if (questionCount > 0) lines.push(line("Questions detected:", String(questionCount) + "."));
  if (shortMsgs / total > 0.5) lines.push(line("Brevity was favored."));
  if (emojis > 0) lines.push(line("Nonverbal signals were logged."));

  return lines.join("\n");
}

// ---- /silence (neutral, non-shaming) ----
function buildSilence(messages) {
  const last = messages.slice(-50);
  if (last.length === 0) return `${watsonHeader()}\n${line("Nothing of note.")}`;

  const q = findLastQuestionWithOutcome(last);

  const lines = [];
  lines.push(watsonHeader());

  if (!q) {
    lines.push(line("No recent question detected."));
    return lines.join("\n");
  }

  if (q.responded) lines.push(line("A question was asked.", "A response followed."));
  else lines.push(line("A question was asked.", "No response was detected."));

  lines.push(line(`Question noted: "${clipQuote(q.questionText, 140)}"`));
  return lines.join("\n");
}

// Capture messages so Watson has context (silent unless asked)
bot.on("text", async (ctx, next) => {
  if (ctx.from?.is_bot) return next();

  const chatId = String(ctx.chat.id);
  const from = safeFrom(ctx);
  const text = ctx.message?.text || "";

  if (!isCommand(text)) addRecent(chatId, from, text);
  return next();
});

// Commands
bot.command("rules", (ctx) =>
  ctx.reply(
    `Watson observes:
- I summarize and record patterns.
- I do not name people or assign motives.
- I do not give advice.
- I speak only when asked (/observe, /summary, /silence).`
  )
);

bot.command("summary", (ctx) => ctx.reply(buildSummary(getRecent(String(ctx.chat.id)))));
bot.command("observe", (ctx) => ctx.reply(buildObserve(getRecent(String(ctx.chat.id)))));
bot.command("silence", (ctx) => ctx.reply(buildSilence(getRecent(String(ctx.chat.id)))));

bot.launch()
  .then(() => console.log("Watson is running (free mode, long polling)."))
  .catch((err) => console.error("Failed to launch Watson:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
