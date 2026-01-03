function safeText(x) {
  if (!x) return "";
  let s = String(x);
  s = s.replace(/@\w+/g, "@…");
  s = s.replace(/\b\d{7,}\b/g, "…");
  s = s.replace(/https?:\/\/\S+/gi, "[link]");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function isCommand(t) {
  return typeof t === "string" && t.trim().startsWith("/");
}

function clip(s, n = 180) {
  const t = safeText(s);
  return t.length > n ? (t.slice(0, n - 1) + "…") : t;
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function extractLooseEnds(messages) {
  const patterns = [
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
  for (const m of messages) {
    const t = safeText(m?.text ?? "");
    if (!t || isCommand(t)) continue;
    if (patterns.some(r => r.test(t))) hits.push(clip(t, 180));
  }
  return uniq(hits).slice(0, 7);
}

function extractDecisions(messages) {
  const patterns = [
    /\bdecided\b/i,
    /\bconfirmed\b/i,
    /\blocked in\b/i,
    /\bwe will\b/i,
    /\bwe're going to\b/i,
    /\bship it\b/i,
    /\bdone deal\b/i,
    /\bfinal\b/i,
    /\bagreed\b/i,
  ];

  const hits = [];
  for (const m of messages) {
    const t = safeText(m?.text ?? "");
    if (!t || isCommand(t)) continue;
    if (patterns.some(r => r.test(t))) hits.push(clip(t, 180));
  }
  return uniq(hits).slice(0, 7);
}

export function buildLooseEndsDigest(messages = []) {
  const items = extractLooseEnds(messages);
  if (!items.length) {
    return [
      "Watson observes:",
      "- Loose ends were referenced.",
      "- None successfully attached."
    ].join("\n");
  }

  const lines = ["Watson observes:", "- Loose ends detected:"];
  for (const it of items) lines.push(`- "${it}"`);
  lines.push("- Ownership remained interpretive.");
  return lines.join("\n");
}

export function buildDecisionsDigest(messages = []) {
  const items = extractDecisions(messages);
  if (!items.length) {
    return [
      "Watson observes:",
      "- Decisions were discussed.",
      "- They did not attach."
    ].join("\n");
  }

  const lines = ["Watson observes:", "- Decisions recorded:"];
  for (const it of items) lines.push(`- "${it}"`);
  lines.push("- Documentation thanks you for your cooperation.");
  return lines.join("\n");
}
