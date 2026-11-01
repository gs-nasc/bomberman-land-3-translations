// Glifo: machine translation with Gemini. Pure helpers (prompt, batching, code check) plus the one
// HTTP call; the job loop that reads and writes the database lives in server.js.

const API = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
export const DEFAULT_MODEL = 'gemini-flash-latest';
export const BATCH_STRINGS = 40;
export const BATCH_CHARS = 5000;

// Editable by the coordination (Settings). The fixed rules below always go along with it.
export const DEFAULT_PROMPT = `Você está traduzindo os diálogos de Bomberman Land 3 (PlayStation 2), um jogo infantil e bem-humorado.
- Escreva como um diálogo natural de jogo, não uma tradução literal.
- Mantenha os nomes de personagens, lugares e itens sempre iguais entre as frases.
- As frases vêm na ordem em que aparecem no jogo; use as vizinhas como contexto.
- Use o número de linhas do original como referência. Se o texto ficar longo, quebre com \\n e divida em mais páginas com {PAG}.`;

const RULES = (langName) => `Translate each string from Japanese into ${langName}.

Input: a JSON array of {"id", "text"}. Output: a JSON array with exactly one {"id", "text"} per input id, same ids.

Text format rules (the game engine depends on them):
- "\\n" (a backslash followed by n) is a line break. Keep it as those two characters, never a real newline.
- Everything between curly braces is a control code: {PAG}, {NOME}, {VAR}, {COR:vermelho}, {CONTORNO}, {TAM:1.5}, {ONDA}, {ESP:1/2}, {?12}, {801F}...
  Copy every code exactly as written, the same number of times, never translated, never respelled, and put each one around the equivalent words of your translation.
  {NOME} is the player's name and {VAR}/{VAR2} are values inserted by the game: place them where they fit grammatically.
  Only {PAG} (new page) and \\n may be added or removed to fit the longer text.
- Do not add quotes, notes or explanations. If a string has nothing to translate (only codes, symbols or numbers), return it unchanged.`;

const langNames = new Intl.DisplayNames(['en'], { type: 'language' });
export const languageName = (code) => { try { return langNames.of(code) || code; } catch { return code; } };

// Codes that must survive the translation: every {...} except {PAG}, as a sorted list.
const codes = (s) => (String(s).match(/\{[^}]*\}/g) || []).filter((c) => c !== '{PAG}').sort();
export function codeProblem(source, text) {
  if (!text.trim()) return 'vazia';
  const a = codes(source), b = codes(text);
  if (a.length === b.length && a.every((c, i) => c === b[i])) return null;
  const minus = (x, y) => { const left = [...y]; return x.filter((c) => { const i = left.indexOf(c); if (i < 0) return true; left.splice(i, 1); return false; }); };
  const missing = minus(a, b), extra = minus(b, a);
  return `códigos diferentes do original${missing.length ? ` (faltando ${[...new Set(missing)].join(' ')})` : ''}${extra.length ? ` (sobrando ${[...new Set(extra)].join(' ')})` : ''}`;
}

// Stored text keeps line breaks as a literal \n; a model sometimes answers with a real one.
export const normalizeText = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '\\n').trim().slice(0, 4000);

// items: [{ id, source }] in game order -> consecutive batches small enough for one request.
export function batches(items, maxStrings = BATCH_STRINGS, maxChars = BATCH_CHARS) {
  const out = []; let cur = [], size = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= maxStrings || size + it.source.length > maxChars)) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += it.source.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function buildRequest(prompt, lang, batch) {
  return {
    systemInstruction: { parts: [{ text: `${RULES(languageName(lang))}\n\nInstructions from the translation team:\n${prompt || DEFAULT_PROMPT}` }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(batch.map((it, i) => ({ id: i + 1, text: it.source }))) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, text: { type: 'STRING' } }, required: ['id', 'text'] } },
    },
  };
}

// Gemini answer -> Map(batch index -> text). Throws when the answer is not the expected JSON.
export function parseResponse(data, size) {
  const cand = data?.candidates?.[0];
  const raw = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!raw) throw new AiError(`resposta vazia${cand?.finishReason ? ` (${cand.finishReason})` : data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}`);
  let list;
  try { list = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new AiError('resposta não é JSON'); }
  if (!Array.isArray(list)) throw new AiError('resposta não é uma lista');
  const out = new Map();
  for (const r of list) {
    const i = Number(r?.id) - 1;
    if (Number.isInteger(i) && i >= 0 && i < size && typeof r.text === 'string' && !out.has(i)) out.set(i, normalizeText(r.text));
  }
  return out;
}

export class AiError extends Error {
  constructor(message, { fatal = false, retryAfter = 0 } = {}) { super(message); this.fatal = fatal; this.retryAfter = retryAfter; }
}

// One generateContent call. Quota and overload errors are retryable; a bad key or model is fatal.
export async function generate({ key, model, body, signal }) {
  let res;
  try {
    res = await fetch(`${API}/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(`sem conexão com o Gemini (${e.message})`, { retryAfter: 10 });
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const msg = data?.error?.message || `HTTP ${res.status}`;
  const delay = (data?.error?.details || []).map((d) => parseFloat(d.retryDelay)).find((n) => n > 0);
  if (res.status === 429 || res.status >= 500) throw new AiError(`Gemini ocupado ou sem cota: ${msg}`, { retryAfter: delay || 20 });
  throw new AiError(`Gemini recusou o pedido: ${msg}`, { fatal: true });
}
