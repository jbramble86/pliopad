// Discovered links for PlioSphere: connections PlioPad finds on its own, beside the links people make with [[.
// Three signals, strongest first: one note mentions another's title; notes share tags; notes use the same
// distinctive words (TF-IDF cosine similarity). No AI service involved, so it's free and works offline.
// The same algorithm runs in the Android (Related.kt) and Windows (Related.cs) apps; keep them in step.

const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can '
  + 'could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself '
  + 'just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their '
  + 'them then there these they this those through to too under until up very was we were what when where which while who whom why will with would '
  + 'you your yours new note notes page pages todo done get got make made use used one two also via per etc yes okay ok').split(' '));

const MAX_TERMS = 30; // distinctive words kept per note
const PER_NOTE = 3; // discovered links kept per note
const MIN_SCORE = 0.22;

function tokens(text) {
  return (text.toLowerCase().match(/[a-zÀ-ɏ][a-zÀ-ɏ0-9'-]{2,}/g) || []).map((w) => w.replace(/'s$/, '')).filter((w) => !STOP.has(w));
}

/**
 * notes: [{ id, title, text, tags: [ids] }]; linked: Set of "a|b" pairs already connected by hand (either order).
 * Returns [{ a, b, score, why }] where why is a short human reason ("Mentions …", "#tag", "Similar: x, y").
 */
export function related(notes, linked = new Set(), tagNames = {}) {
  const N = notes.length;
  if (N < 2) return [];
  // ---- Distinctive words per note (TF-IDF), title words weighted up ----
  const df = new Map();
  const tfs = notes.map((n) => {
    const tf = new Map();
    for (const w of tokens(n.title || '')) tf.set(w, (tf.get(w) || 0) + 3);
    for (const w of tokens((n.text || '').slice(0, 20000))) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    return tf;
  });
  const vecs = tfs.map((tf) => {
    const v = [...tf].map(([w, c]) => [w, (1 + Math.log(c)) * Math.log((N + 1) / ((df.get(w) || 1) + 0.5))])
      .filter(([w, x]) => x > 0 && (df.get(w) || 0) < Math.max(3, N * 0.5)).sort((p, q) => q[1] - p[1]).slice(0, MAX_TERMS);
    const norm = Math.hypot(...v.map(([, x]) => x)) || 1;
    return new Map(v.map(([w, x]) => [w, x / norm]));
  });
  // Inverted index, so only notes that share a word are compared.
  const postings = new Map();
  vecs.forEach((v, i) => { for (const w of v.keys()) (postings.get(w) || postings.set(w, []).get(w)).push(i); });

  const pairs = new Map(); // "i|j" (i<j) -> { score, shared: [words], why }
  const at = (i, j) => { const k = i < j ? `${i}|${j}` : `${j}|${i}`; return pairs.get(k) || pairs.set(k, { i: Math.min(i, j), j: Math.max(i, j), score: 0, words: [], why: [] }).get(k); };
  for (const [w, list] of postings) {
    if (list.length > 60) continue; // too common to say anything
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const p = at(list[x], list[y]);
      p.score += vecs[list[x]].get(w) * vecs[list[y]].get(w);
      p.words.push(w);
    }
  }
  // ---- Shared tags ----
  const byTag = new Map();
  notes.forEach((n, i) => (n.tags || []).forEach((t) => (byTag.get(t) || byTag.set(t, []).get(t)).push(i)));
  for (const [t, list] of byTag) {
    if (list.length > 40) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const p = at(list[x], list[y]);
      p.score += 0.35;
      p.why.push('#' + (tagNames[t] || 'tag'));
    }
  }
  // ---- Mentions of another note's title ----
  const titles = notes.map((n, i) => ({ i, t: (n.title || '').trim().toLowerCase() })).filter(({ t }) => t.length >= 4 && tokens(t).length);
  notes.forEach((n, i) => {
    const text = (n.text || '').toLowerCase();
    if (!text) return;
    for (const { i: j, t } of titles) {
      if (j === i || !text.includes(t)) continue;
      const before = text[text.indexOf(t) - 1], after = text[text.indexOf(t) + t.length];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) continue; // whole words only
      const p = at(i, j);
      p.score += 1;
      p.why.unshift('Mentions “' + notes[j].title + '”');
    }
  });

  // ---- Keep each note's strongest few, skipping pairs already linked by hand ----
  const best = new Map();
  for (const p of pairs.values()) {
    if (p.score < MIN_SCORE) continue;
    const a = notes[p.i].id, b = notes[p.j].id;
    if (linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`)) continue;
    for (const k of [p.i, p.j]) (best.get(k) || best.set(k, []).get(k)).push(p);
  }
  const keep = new Set();
  for (const list of best.values()) list.sort((p, q) => q.score - p.score).slice(0, PER_NOTE).forEach((p) => keep.add(p));
  return [...keep].sort((p, q) => q.score - p.score).map((p) => {
    const words = p.words.sort((x, y) => (vecs[p.i].get(y) || 0) - (vecs[p.i].get(x) || 0)).slice(0, 3);
    const why = p.why.length ? p.why.slice(0, 2).join(' · ') : 'Similar: ' + words.join(', ');
    return { a: notes[p.i].id, b: notes[p.j].id, score: Math.round(p.score * 100) / 100, why };
  });
}
