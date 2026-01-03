import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadState() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { chats: {} };
    if (!parsed.chats || typeof parsed.chats !== 'object') parsed.chats = {};
    if (typeof parsed.lastBootTs !== 'number') parsed.lastBootTs = 0;
    if (typeof parsed.lastStopTs !== 'number') parsed.lastStopTs = 0;
    return parsed;
  } catch {
    return { chats: {}, lastBootTs: 0, lastStopTs: 0 };
  }
}

export function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getChatState(state, chatId) {
  const id = String(chatId);
  if (!state.chats[id]) state.chats[id] = {};
  const cs = state.chats[id];

  if (typeof cs.lastSummaryTs !== 'number') cs.lastSummaryTs = 0;
  if (typeof cs.lastCatchupTs !== 'number') cs.lastCatchupTs = 0;
  return cs;
}
