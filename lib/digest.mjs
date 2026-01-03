/**
 * Watson Constitution
 * - Observant archivist: labels, counts, exhibits. No diagnosing people.
 * - Funny via understatement. No sarcasm. No shaming. No names.
 * - Topics are buckets, not judgments.
 *
 * NOTE: index.mjs expects named exports:
 *   buildSummaryDigest, buildCatchupDigest
 */

const STOP = new Set([
  "a","an","and","are","as","at","be","but","by","can","could","did","do","does","for","from",
  "had","has","have","he","her","hers","him","his","i","if","in","into","is","it","its",
  "just","like","me","more","most","my","no","not","of","on","or","our","ours","please",
  "she","so","some","than","that","the","their","them","then","there","these","they","this",
  "to","too","up","us","was","we","were","what","when","where","which","who","why","will",
  "with","would","you","your","yours"
]);

// Premium topic buckets (group-aware)
const BUCKETS = [
  // core ops
  { name: "setup", keys: ["install","npm","node","pm2","script","cmd","bat","powershell","terminal","console"] },
  { name: "deploy", keys: ["railway","netlify","deploy","build","prod","host","server","webhook"] },
  { name: "git", keys: ["git","commit","push","pull","branch","repo","github"] },
  { name: "files", keys: ["path","folder","file","zip","unzip","copy","move","rename",".env","env","package.json"] },
  { name: "planning", keys: ["next","later","roadmap","plan","idea","feature","premium","pro","pricing","positioning"] },
  { name: "time", keys: ["today","tomorrow","week","month","hour","minute","schedule","meet","call"] },
  { name: "money", keys: ["$","dollar","price","pay","cost","budget","free","trial","credit"] },

  // group topics
  { name: "theology", keys: ["bible","scripture","gospel","church","pastor","sermon","theology","doctrine","jesus","christ","prayer","pray","sin","salvation","grace","faith","holy","spirit","discipleship","worship","baptism","communion","eucharist","trinity","apologetics","missions","missionary"] },
  { name: "politics", keys: ["election","vote","senate","congress","president","policy","democrat","republican","campaign","legislation","bill","law","court","supreme","administration","governor","mayor"] },
  { name: "geopolitics", keys: ["nato","un","ukraine","russia","china","taiwan","iran","israel","gaza","hamas","hezbollah","sanctions","border","coup","embassy","proxy","pipeline","intelligence","defense","military","war","ceasefire","missile","missiles","drone","drones"] },
  { name: "technology", keys: ["ai","gpt","llm","model","api","code","coding","javascript","node","python","react","github","server","cloud","security","database","bug","feature","update","version","prompt"] },
  { name: "finance", keys: ["stock","stocks","etf","bond","bonds","yield","inflation","rates","fed","earnings","revenue","profit","loss","bitcoin","crypto","wallet","taxes","budget","invest","investing","portfolio","market","recession"] },

  // life topics
  { name: "relationships", keys: ["relationship","relationships","dating","marriage","married","spouse","husband","wife","partner","boyfriend","girlfriend","fiancé","fiance","fiancée","engagement","breakup","divorce","argument","apology","forgiveness","conflict","communication","boundaries","boundary","counseling","therapist","therapy","intimacy","trust","respect","parenting","co-parenting","family","family dynamics"] },
  { name: "aging_and_aches", keys: ["40s","forties","middle age","aging","getting old","older","tired","fatigue","sore","aches","aching","pain","chronic","back","neck","knee","joint","joints","inflammation","stiffness","stiff","sciatica","disc","migraine","headache","sleep","insomnia","recovery","physical therapy","chiropractor","ibuprofen","naproxen"] },
  { name: "venting", keys: ["ugh","annoyed","frustrated","irritated","fed up","tired of","sick of","can't believe","cannot believe","unbelievable","complaining","rant","vent","venting","rough day","stressed","burnout","overwhelmed","done","i swear"] },

  { name: "sports", keys: ["nfl","nba","mlb","nhl","ncaa","football","basketball","baseball","hockey","soccer","match","game","score","playoffs","playoff","draft","season","coach","team","quarterback","touchdown"] },
  { name: "tv_movies", keys: ["movie","film","show","series","episode","season","actor","actress","director","trailer","netflix","hbo","disney","prime","cinema"] },
  { name: "fitness", keys: ["workout","gym","lift","lifting","run","running","cardio","strength","reps","rep","set","sets","squat","bench","deadlift","training","mobility"] },
  { name: "diet", keys: ["diet","calories","protein","carbs","fat","fasting","keto","paleo","vegan","vegetarian","macros","supplement","supplements","nutrition","meal","meals"] },

  { name: "places", keys: ["texas","tx","dfw","dallas","fort worth","fw","austin","houston","san antonio","washington dc","dc","d.c.","capitol","ohio","cleveland","columbus","cincinnati"] },
  { name: "memories", keys: ["remember","memories","memory","nostalgia","back in the day","when we were kids","childhood","old friends","childhood friends","high school","growing up"] },

  { name: "humor", keys: ["lol","haha","meme","joke","funny","deadpan","smirk","pun"] }
];

// Template pools (bigger = less repetition)
const SUMMARY_OPENERS = [
  "Watson observes:",
  "Watson records:",
  "Watson files the following:",
  "Watson submits a brief report:",
  "Watson notes, without enthusiasm:",
  "Watson provides a minimal ledger:"
];

const CATCHUP_OPENERS = [
  "Activity occurred. Clarity attended intermittently.",
  "Momentum was present. Direction remained optional.",
  "Multiple threads were started. Few were finished.",
  "The room stayed active. Conclusions did not.",
  "Progress was mentioned. Evidence was modest.",
  "A discussion unfolded. A destination did not.",
  "Time was spent. Outcomes were selective.",
  "Several points were made. Most remained unclaimed.",
  "The chat remained lively. Specifics remained shy.",
  "Plans appeared briefly, then changed their names.",
  "Confidence increased. Details did not.",
  "The situation evolved. The summary will now try."
];

const CATCHUP_CLOSERS = [
  "Next steps were implied, not assigned.",
  "Consensus remained theoretical.",
  "Acknowledgement pending.",
  "Documentation exceeded follow-through.",
  "Resolution remained aspirational.",
  "Ownership was distributed. Accountability was not detected.",
  "This concludes the exhibit.",
  "Implementation remained politely out of frame.",
  "The timeline remained interpretive.",
  "Further clarity is available upon request.",
  "The record is complete. The situation is not.",
  "No individuals were harmed in the making of this report."
];

function safeText(x) {
  if (!x) return "";
  let s = String(x);
  s = s.replace(/@\w+/g, "@…");
  s = s.replace(/\b\d{7,}\b/g, "…");
  s = s.replace(/https?:\/\/\S+/gi, "[link]");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 120) s = s.slice(0, 117) + "…";
  return s;
}

function getText(msg) {
  const t =
    msg?.text ??
    msg?.message?.text ??
    msg?.caption ??
    msg?.message?.caption ??
    msg?.raw?.text ??
    "";
  return safeText(t);
}

function isCommandText(t) {
  return typeof t === "string" && t.trim().startsWith("/");
}

function spellSmall(n) {
  const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
  if (Number.isInteger(n) && n >= 0 && n <= 12) return words[n];
  return String(n);
}

function tokenize(allText) {
  return allText
    .toLowerCase()
    .replace(/[^a-z0-9$ ]+/g, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(Boolean)
    .filter(w => !STOP.has(w));
}

function pickThemes(messages) {
  const texts = messages.map(getText).filter(Boolean);
  const joined = texts.join(" ");
  if (!joined) return ["general discourse"];

  const toks = tokenize(joined);

  // bucket scoring
  const scores = new Map();
  for (const b of BUCKETS) scores.set(b.name, 0);

  for (const tok of toks) {
    for (const b of BUCKETS) {
      if (b.keys.some(k => tok.includes(k))) {
        scores.set(b.name, scores.get(b.name) + 1);
      }
    }
  }

  // premium: require stronger signal for venting (reduce false positives)
  if ((scores.get("venting") || 0) === 1) scores.set("venting", 0);

  const topBuckets = [...scores.entries()]
    .filter(([,v]) => v > 0)
    .sort((a,b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 4);

  if (topBuckets.length > 0) return topBuckets;

  // fallback: top tokens
  const freq = new Map();
  for (const tok of toks) freq.set(tok, (freq.get(tok) || 0) + 1);

  const top = [...freq.entries()]
    .sort((a,b) => b[1] - a[1])
    .map(([k]) => k)
    .filter(k => k.length >= 3 && k !== "watson")
    .slice(0, 3);

  return top.length ? top : ["general discourse"];
}

function detectDecisions(messages) {
  const joined = messages.map(getText).join(" ").toLowerCase();
  const hard = /(decided|locked in|confirmed|we will|we're going to|ship it|done deal)/i.test(joined);
  const soft = /(let's|we should|plan to|next step|i will|we need to)/i.test(joined);
  if (hard) return "one was recorded.";
  if (soft) return "tentative, with confidence.";
  return "none confirmed.";
}

function countLinks(messages) {
  const joined = messages.map(getText).join(" ");
  const m = joined.match(/\[link\]/g);
  return m ? m.length : 0;
}

function pickExhibit(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = getText(messages[i]);
    if (!t) continue;
    if (isCommandText(t)) continue;
    return t;
  }
  return "";
}

// anti-repeat: caller can pass a mutable templateState object (per chat)
function pickWithMemory(list, key, templateState) {
  const last = templateState?.[key];
  if (!templateState) return list[Math.floor(Math.random() * list.length)];

  // try a few times to avoid immediate repeat
  let idx = Math.floor(Math.random() * list.length);
  for (let i = 0; i < 6; i++) {
    if (idx !== last) break;
    idx = Math.floor(Math.random() * list.length);
  }
  templateState[key] = idx;
  return list[idx];
}

function makeSummary(messages, opts = {}) {
  const templateState = opts.templateState;
  const head = pickWithMemory(SUMMARY_OPENERS, "summaryOpener", templateState);

  const msgTexts = messages.map(getText).filter(Boolean);
  const nonCommandCount = msgTexts.filter(t => !isCommandText(t)).length;

  const themes = pickThemes(messages);
  const decisions = detectDecisions(messages);
  const links = countLinks(messages);
  const ex = pickExhibit(messages);

  const lines = [];
  lines.push(head);
  lines.push(`- Themes: ${themes.join(", ")}.`);
  lines.push(`- Decisions: ${decisions}`);
  if (links > 0) lines.push(`- Links: ${spellSmall(links)} observed. Context remained brave.`);
  if (ex) lines.push(`- Final entry logged: "${ex}"`);
  if (nonCommandCount === 0) lines.push("- Content: none observed.");
  return lines.join("\n").trim();
}

function makeCatchup(messages, opts = {}) {
  const templateState = opts.templateState;
  const head = pickWithMemory(CATCHUP_OPENERS, "catchupOpener", templateState);
  const tail = pickWithMemory(CATCHUP_CLOSERS, "catchupCloser", templateState);

  const msgTexts = messages.map(getText).filter(Boolean);
  const nonCommandCount = msgTexts.filter(t => !isCommandText(t)).length;

  const themes = pickThemes(messages);
  const decisions = detectDecisions(messages);
  const links = countLinks(messages);
  const ex = pickExhibit(messages);

  const lines = [];
  lines.push(head);
  lines.push("");
  lines.push(`- Volume: ${spellSmall(nonCommandCount)} messages.`);
  lines.push(`- Themes: ${themes.join(", ")}.`);
  lines.push(`- Decisions: ${decisions}`);
  if (links > 0) lines.push(`- Links: ${spellSmall(links)} observed. Purpose unverified.`);
  if (ex) lines.push(`- Exhibit A: "${ex}"`);
  lines.push("");
  lines.push(tail);

  return lines.join("\n").trim();
}

// Primary export used by older code
export function makeDigest(messages = [], opts = {}) {
  const mode = opts.mode === "catchup" ? "catchup" : "summary";
  return mode === "catchup" ? makeCatchup(messages, opts) : makeSummary(messages, opts);
}

// Compatibility exports (keep existing callers working)
export function buildSummaryDigest(messages = [], opts = {}) {
  return makeSummary(messages, opts);
}
export function buildCatchupDigest(messages = [], opts = {}) {
  return makeCatchup(messages, opts);
}

export default makeDigest;
