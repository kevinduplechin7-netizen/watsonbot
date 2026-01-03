function normalize(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function clip(s, maxLen) {
  const t = normalize(s);
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '…';
}

function looksLikeQuestion(text) {
  const t = normalize(text).toLowerCase();
  return t.includes('?') || /^(who|what|when|where|why|how|anyone|can we|should we|are we|did we)\b/.test(t);
}

function findLastQuestion(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const txt = messages[i]?.text || '';
    if (!looksLikeQuestion(txt)) continue;
    const after = messages.slice(i + 1);
    const responded = after.some(m => {
      const t = m?.text || '';
      return t && !looksLikeQuestion(t);
    });
    return { questionText: txt, responded };
  }
  return null;
}

function detectThemes(texts) {
  const t = texts.join(' \n ').toLowerCase();
  const themes = [];

  const has = (re) => re.test(t);

  if (has(/\b(time|when|where|schedule|tonight|tomorrow|today|meet|meeting|dinner|plans)\b/)) themes.push('scheduling');
  if (has(/\b(price|cost|money|dollar|pay|venmo|cash|subscription|trial|credit)\b/)) themes.push('money');
  if (has(/\b(link|url|github|repo|deploy|railway|netlify|server|host|token|env)\b/)) themes.push('ops');
  if (has(/\b(ok|lol|haha|wild|bro|rip)\b|[\u{1F300}-\u{1FAFF}]/u)) themes.push('vibes');
  if (themes.length === 0) themes.push('general discourse');

  return themes.slice(0, 4);
}

function detectDecisions(texts) {
  const t = texts.join(' ').toLowerCase();
  const decided = /\b(decided|confirmed|locked|done|final|we will|we're going to|lets do|let's do)\b/.test(t);
  return decided;
}

const OPENERS = [
  'Watson caught up. The chat did not slow down.',
  'Messages accrued. Resolution remained optional.',
  'Activity occurred. Clarity attended intermittently.',
  'Backlog processed. Confidence varied.',
];

const CLOSERS = [
  'Consensus remained theoretical.',
  'Next steps were implied, not assigned.',
  'Follow-through is expected to arrive later.',
  'Accountability is currently in transit.',
];

export function buildCatchupDigest(messages) {
  const msgs = (messages || []).filter(m => normalize(m.text));
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];

  if (msgs.length === 0) {
    return `${opener}\n\n- Nothing was logged.`;
  }

  const texts = msgs.map(m => m.text);
  const themes = detectThemes(texts);
  const decisions = detectDecisions(texts);
  const q = findLastQuestion(msgs);

  const lines = [];
  lines.push(opener);
  lines.push('');
  lines.push(`- Volume: ${msgs.length} messages.`);
  lines.push(`- Themes: ${themes.join(', ')}.`);
  lines.push(decisions ? '- Decisions: at least one.' : '- Decisions: none confirmed.');
  if (q) lines.push(q.responded ? '- Questions: answered eventually.' : '- Questions: acknowledgement pending.');

  // quote: pick last non-trivial line
  const quote = msgs.slice().reverse().find(m => normalize(m.text).length >= 12)?.text || msgs[msgs.length - 1].text;
  if (quote) lines.push(`- Exhibit A: "${clip(quote, 140)}"`);

  lines.push('');
  lines.push(CLOSERS[Math.floor(Math.random() * CLOSERS.length)]);

  return lines.join('\n');
}

export function buildSummaryDigest(messages) {
  // Slightly tighter than catchup, same voice.
  const msgs = (messages || []).filter(m => normalize(m.text));
  if (msgs.length === 0) return 'Watson observes:\n- Nothing of note.';

  const texts = msgs.map(m => m.text);
  const themes = detectThemes(texts);
  const decisions = detectDecisions(texts);
  const q = findLastQuestion(msgs);

  const lines = [];
  lines.push('Watson observes:');
  lines.push(`- Themes: ${themes.join(', ')}.`);
  lines.push(decisions ? '- A conclusion was recorded.' : '- No conclusion was recorded.');
  if (q) lines.push(q.responded ? '- A question was filed. Response recorded.' : '- A question was filed. Acknowledgement pending.');
  const last = msgs[msgs.length - 1]?.text;
  if (last) lines.push(`- Final entry logged: "${clip(last, 120)}"`);
  return lines.join('\n');
}
