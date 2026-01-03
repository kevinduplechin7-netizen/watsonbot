import fs from 'fs';
import path from 'path';
import readline from 'readline';

const DATA_DIR = path.join(process.cwd(), 'data');
const CHATS_DIR = path.join(DATA_DIR, 'chats');

function ensureChatsDir() {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}

function logPath(chatId) {
  ensureChatsDir();
  return path.join(CHATS_DIR, `${String(chatId)}.jsonl`);
}

export async function appendMessage({ chatId, ts, text, userId = null, isCommand = false }) {
  const file = logPath(chatId);
  const rec = {
    ts: Number(ts) || 0,
    text: String(text || ''),
    userId: userId === undefined ? null : userId,
    isCommand: Boolean(isCommand),
  };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
}

export async function readMessagesSince(chatId, sinceTs, { limit = 2000, includeCommands = false } = {}) {
  const file = logPath(chatId);
  if (!fs.existsSync(file)) return [];

  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const out = [];
  for await (const line of rl) {
    const s = (line || '').trim();
    if (!s) continue;
    try {
      const rec = JSON.parse(s);
      if (!includeCommands && rec.isCommand) continue;
      if (Number(rec.ts) > Number(sinceTs || 0)) {
        out.push(rec);
        if (out.length > limit) out.shift();
      }
    } catch {
      // ignore
    }
  }

  return out;
}

export async function readRecent(chatId, limit = 200, { includeCommands = false } = {}) {
  // We read with a higher limit and then slice, so very active chats still get the last 'limit'.
  const msgs = await readMessagesSince(chatId, 0, { limit: Math.max(limit * 10, 500), includeCommands });
  return msgs.slice(-limit);
}
