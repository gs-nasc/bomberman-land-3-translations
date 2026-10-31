// Glifo: repeated and similar source strings, and the scene -> category file.
// Pure functions (no database), so they can be unit tested on their own.

// Codes and line breaks don't count when comparing two sources: only the words do.
const CODES = /\{[^}]*\}|\\n/g;
export const normSource = (s) => String(s || '').replace(CODES, ' ').replace(/[\s　]+/g, ' ').trim();

export function bigrams(s) {
  const set = new Set();
  if (s.length === 1) set.add(s);
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// Sørensen–Dice over character bigrams: 1 = same letters in the same order, 0 = nothing in common.
export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let n = 0;
  for (const g of small) if (big.has(g)) n++;
  return (2 * n) / (a.size + b.size);
}

// rows: [{ id, block_id, source }]. Strings with the exact same source (codes included, so a copied
// translation keeps working) are grouped; blank sources or sources made only of codes are left out.
export function buildIndex(rows) {
  const byId = new Map(), bySource = new Map();
  for (const r of rows) {
    const norm = normSource(r.source);
    byId.set(r.id, { id: r.id, block_id: r.block_id, source: r.source, norm, grams: null });
    if (!norm) continue;
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r.id);
  }
  return { byId, bySource };
}

// Other strings with exactly the same source as `id`.
export function copiesOf(index, id) {
  const e = index.byId.get(id);
  if (!e || !e.norm) return [];
  return (index.bySource.get(e.source) || []).filter((x) => x !== id);
}

const gramsOf = (e) => (e.grams ??= bigrams(e.norm));

// The strings whose source looks most like the one of `id`, best first (identical ones included).
export function similarTo(index, id, { min = 0.4, limit = 300 } = {}) {
  const me = index.byId.get(id);
  if (!me || !me.norm) return [];
  const mine = gramsOf(me);
  const out = [];
  for (const e of index.byId.values()) {
    if (e.id === id || !e.norm) continue;
    // a quick length check skips most of the corpus before building any bigram set
    const la = me.norm.length, lb = e.norm.length;
    if ((2 * Math.min(la, lb)) / (la + lb) < min) continue;
    const score = e.source === me.source ? 1 : dice(mine, gramsOf(e));
    if (score >= min) out.push({ id: e.id, block_id: e.block_id, source: e.source, score });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit);
}

// Keep the best match of each distinct translation and say how many strings use it.
export function pickSuggestions(matches, translations, limit = 5) {
  const byText = new Map();
  for (const m of matches) {
    const t = translations.get(m.id);
    if (!t) continue;
    const cur = byText.get(t.text);
    if (cur) cur.uses++;
    else byText.set(t.text, { ...m, text: t.text, status: t.status, score: Math.round(m.score * 100) / 100, uses: 1 });
  }
  return [...byText.values()].slice(0, limit);
}

// TSV with a category column ("categoria" or "category") and either "scene" ("CDDATA/e0002") or
// "archive" + "entry". Returns [{ scene, category, position }]; the order of the file is the order
// of the categories in the editor. Returns null when the needed columns are missing.
export function parseCategories(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const head = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const col = (k) => head.indexOf(k);
  const cat = col('categoria') >= 0 ? col('categoria') : col('category');
  const scene = col('scene'), arc = col('archive'), entry = col('entry');
  if (cat < 0 || (scene < 0 && (arc < 0 || entry < 0))) return null;
  const out = new Map();
  lines.slice(1).forEach((line, i) => {
    const f = line.split('\t').map((v) => v.trim());
    const s = scene >= 0 ? f[scene] : f[arc] && f[entry] ? `${f[arc]}/${f[entry]}` : '';
    const c = (f[cat] || '').slice(0, 80);
    if (s && c) out.set(s, { scene: s, category: c, position: i });
  });
  return [...out.values()];
}
