// Glifo: HTTP server (Node 22, no framework). Postgres via `pg`, GitHub login,
// JSON API under /api, live updates over Server-Sent Events, static frontend from ./public.
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { langOf, tr } from './messages.js';

const env = (k, d) => process.env[k] ?? d;
const PORT = +env('PORT', 3000);
const PUBLIC_URL = env('PUBLIC_URL', `http://localhost:${PORT}`).replace(/\/$/, '');
const GITHUB_ID = env('GITHUB_CLIENT_ID', '');
const GITHUB_SECRET = env('GITHUB_CLIENT_SECRET', '');
const ADMIN_LOGINS = env('ADMIN_GITHUB_LOGINS', '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const DEV_LOGIN = env('DEV_LOGIN', '') === '1';          // local testing only: /auth/dev?login=x
const SECURE_COOKIE = PUBLIC_URL.startsWith('https://');
const SESSION_DAYS = 30;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const BASE_COLS = ['archive', 'entry', 'file', 'id', 'string_res', 'font_res', 'method', 'margin', 'text'];
const CHUNK = 200;
const ROLES = ['coordenador', 'tradutor', 'revisor'];

const pool = new pg.Pool({ connectionString: env('DATABASE_URL', 'postgres://games:games@localhost:5432/games'), max: 10 });
const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0] || null;

// ---------------------------------------------------------------- http helpers

class HttpError extends Error { constructor(status, message, vars = {}) { super(message); this.status = status; this.vars = vars; } }
const fail = (status, message, vars) => { throw new HttpError(status, message, vars); };

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) fail(413, 'Arquivo grande demais.'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req) {
  if (!(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Envie JSON.');
  try { return JSON.parse((await readBody(req, 1024 * 1024)) || '{}'); } catch { fail(400, 'JSON inválido.'); }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- auth

async function currentUser(req) {
  const token = cookies(req).sid;
  if (!token) return null;
  const u = await one(`select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, [sha(token)]);
  if (u) q('update users set last_seen = now() where id = $1 and last_seen < now() - interval \'5 minutes\'', [u.id]).catch(() => {});
  return u;
}

async function startSession(res, userId, redirectTo = '/') {
  const token = randomBytes(32).toString('base64url');
  await q(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  res.writeHead(302, { Location: redirectTo, 'Set-Cookie': [cookie('sid', token, SESSION_DAYS * 86400), cookie('oauth_state', '', 0)] });
  res.end();
}

async function upsertUser({ github_id, login, name, avatar_url }) {
  const admin = ADMIN_LOGINS.includes(login.toLowerCase());
  return one(`insert into users (github_id, login, name, avatar_url, is_admin) values ($1, $2, $3, $4, $5)
              on conflict (github_id) do update set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url,
                is_admin = users.is_admin or excluded.is_admin, last_seen = now()
              returning *`, [github_id, login, name || '', avatar_url || '', admin]);
}

async function githubStart(req, res) {
  if (!GITHUB_ID) return send(res, 503, tr(langOf(req), 'Login com GitHub ainda não configurado (GITHUB_CLIENT_ID).'));
  const state = randomBytes(16).toString('base64url');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: GITHUB_ID, redirect_uri: `${PUBLIC_URL}/auth/github/callback`, scope: 'read:user', state, allow_signup: 'true' });
  res.writeHead(302, { Location: url.toString(), 'Set-Cookie': cookie('oauth_state', state, 600) });
  res.end();
}

async function githubCallback(req, res, url) {
  const state = url.searchParams.get('state') || '';
  const expected = cookies(req).oauth_state || '';
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return send(res, 400, tr(langOf(req), 'Login expirou. Tente de novo.'));
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_ID, client_secret: GITHUB_SECRET, code: url.searchParams.get('code'), redirect_uri: `${PUBLIC_URL}/auth/github/callback` }),
  });
  const tok = await tokenRes.json();
  if (!tok.access_token) return send(res, 400, tr(langOf(req), 'O GitHub recusou o login. Tente de novo.'));
  const gh = await (await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'glifo' } })).json();
  if (!gh.id) return send(res, 502, tr(langOf(req), 'Não foi possível ler a conta do GitHub.'));
  const user = await upsertUser({ github_id: gh.id, login: gh.login, name: gh.name, avatar_url: gh.avatar_url });
  await startSession(res, user.id);
}

async function devLogin(req, res, url) {
  const login = (url.searchParams.get('login') || 'dev').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 39) || 'dev';
  const user = await upsertUser({ github_id: 9e9 + [...login].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1e9, login, name: login, avatar_url: '' });
  const to = url.searchParams.get('to') || '/';
  await startSession(res, user.id, to.startsWith('#') ? `/${to}` : to.startsWith('/') && !to.startsWith('//') ? to : '/');
}

async function logout(req, res) {
  const token = cookies(req).sid;
  if (token) await q('delete from sessions where token_hash = $1', [sha(token)]);
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie('sid', '', 0) });
}

// ---------------------------------------------------------------- permissions

async function access(user, game) {
  const a = { admin: !!user?.is_admin, coordinator: false, langs: {}, member: false };
  if (!user) return a;
  for (const m of (await q('select lang, role from members where game_id = $1 and user_id = $2', [game.id, user.id])).rows) {
    a.member = true;
    if (m.role === 'coordenador') a.coordinator = true; else a.langs[m.lang] = m.role;
  }
  a.manage = a.admin || a.coordinator;
  a.seeText = a.manage || a.member;
  return a;
}
const canTranslate = (a, lang) => a.manage || !!a.langs[lang];
const canReview = (a, lang) => a.manage || a.langs[lang] === 'revisor';

async function gameBySlug(slug) { return (await one('select * from games where slug = $1', [slug])) || fail(404, 'Projeto não encontrado.'); }
const requireUser = (user) => user || fail(401, 'Entre com sua conta do GitHub.');

async function log(game, user, kind, lang = null, detail = {}) {
  await q('insert into activity (game_id, user_id, kind, lang, detail) values ($1, $2, $3, $4, $5)', [game?.id ?? null, user?.id ?? null, kind, lang, detail]);
  if (game) broadcast(game.slug, { type: 'activity' });
}

// ---------------------------------------------------------------- live updates (SSE)

const streams = new Map(); // slug -> Set(res)
function broadcast(slug, event) {
  const set = streams.get(slug); if (!set) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) res.write(line);
}
function openStream(req, res, slug) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (!streams.has(slug)) streams.set(slug, new Set());
  streams.get(slug).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); streams.get(slug)?.delete(res); });
}

// ---------------------------------------------------------------- queries

async function langStats(gameId) {
  const total = +(await one('select count(*) n from strings where game_id = $1', [gameId])).n;
  const langs = (await q(`select gl.lang,
      count(t.string_id) filter (where t.text <> '') as done,
      count(t.string_id) filter (where t.status = 'revisada') as reviewed
    from game_langs gl
    left join translations t on t.lang = gl.lang and t.string_id in (select id from strings where game_id = gl.game_id)
    where gl.game_id = $1 group by gl.lang order by gl.lang`, [gameId])).rows.map((r) => ({ lang: r.lang, done: +r.done, reviewed: +r.reviewed }));
  return { total, langs };
}

async function publicUser(u) { return u && { id: u.id, login: u.login, name: u.name, avatar_url: u.avatar_url, is_admin: u.is_admin }; }

// ---------------------------------------------------------------- import / export

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const head = lines[0].split('\t');
  const col = Object.fromEntries(head.map((k, i) => [k, i]));
  for (const k of BASE_COLS) if (!(k in col)) fail(400, 'Arquivo sem a coluna "{col}". Use o TSV gerado pelo textscan.py.', { col: k });
  const tables = new Map();
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    const sid = f[col.string_res];
    if (!tables.has(sid)) tables.set(sid, { meta: Object.fromEntries(['archive', 'entry', 'file', 'font_res', 'method', 'margin'].map((k) => [k, f[col[k]] || ''])), rows: [] });
    tables.get(sid).rows.push({ i: +f[col.id], t: f[col.text] || '' });
  }
  const canon = new Map(); const groups = [];
  for (const [sid, t] of tables) {
    t.rows.sort((a, b) => a.i - b.i);
    const key = t.rows.map((r) => r.t).join('\u0001');
    if (canon.has(key)) { groups[canon.get(key)].aliases.push({ sid, ...t.meta }); continue; }
    canon.set(key, groups.length);
    groups.push({ sid, meta: t.meta, rows: t.rows, aliases: [{ sid, ...t.meta }] });
  }
  groups.sort((a, b) => `${a.meta.archive}/${a.meta.entry}/${a.sid}`.localeCompare(`${b.meta.archive}/${b.meta.entry}/${b.sid}`));
  const blocks = [];
  for (const g of groups) {
    const parts = Math.ceil(g.rows.length / CHUNK);
    for (let p = 0; p < parts; p++) {
      blocks.push({
        key: parts > 1 ? `${g.sid}-${p + 1}` : g.sid,
        label: `${g.meta.entry} · ${g.sid}${parts > 1 ? ` (${p + 1}/${parts})` : ''}`,
        scene: `${g.meta.archive}/${g.meta.entry}`,
        aliases: g.aliases,
        rows: g.rows.slice(p * CHUNK, (p + 1) * CHUNK).map((r) => ({ ...r, key: `${g.sid}#${r.i}` })),
      });
    }
  }
  return blocks;
}

async function importTsv(game, text) {
  const blocks = parseTsv(text);
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (let pos = 0; pos < blocks.length; pos++) {
      const b = blocks[pos];
      const { id: blockId } = (await client.query(`insert into blocks (game_id, key, label, scene, position) values ($1, $2, $3, $4, $5)
        on conflict (game_id, key) do update set label = excluded.label, scene = excluded.scene, position = excluded.position returning id`,
      [game.id, b.key, b.label, b.scene, pos])).rows[0];
      await client.query('delete from block_aliases where block_id = $1', [blockId]);
      for (const a of b.aliases) {
        await client.query(`insert into block_aliases (block_id, sid, archive, entry, file, font_res, method, margin) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [blockId, a.sid, a.archive, a.entry, a.file, a.font_res, a.method, a.margin]);
      }
      await client.query(`insert into strings (game_id, block_id, key, idx, source)
        select $1, $2, k, i, s from unnest($3::text[], $4::int[], $5::text[]) as u(k, i, s)
        on conflict (game_id, key) do update set block_id = excluded.block_id, idx = excluded.idx, source = excluded.source`,
      [game.id, blockId, b.rows.map((r) => r.key), b.rows.map((r) => r.i), b.rows.map((r) => r.t)]);
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  return { blocks: blocks.length, strings: blocks.reduce((a, b) => a + b.rows.length, 0) };
}

async function exportTsv(game) {
  const langs = (await q('select lang from game_langs where game_id = $1 order by lang', [game.id])).rows.map((r) => r.lang);
  const rows = (await q(`select s.id, s.idx, s.source, a.sid, a.archive, a.entry, a.file, a.font_res, a.method, a.margin
    from strings s join blocks b on b.id = s.block_id join block_aliases a on a.block_id = b.id
    where s.game_id = $1 order by b.position, a.sid, s.idx`, [game.id])).rows;
  const tr = new Map();
  for (const t of (await q(`select t.string_id, t.lang, t.text from translations t join strings s on s.id = t.string_id where s.game_id = $1 and t.text <> ''`, [game.id])).rows) tr.set(`${t.string_id}|${t.lang}`, t.text);
  const clean = (s) => s.replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
  const out = [[...BASE_COLS, ...langs].join('\t')];
  for (const r of rows) out.push([r.archive, r.entry, r.file, r.idx, r.sid, r.font_res, r.method, r.margin, r.source, ...langs.map((l) => clean(tr.get(`${r.id}|${l}`) || ''))].join('\t'));
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- API routes

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/me', async ({ user }) => ({ user: await publicUser(user), github: !!GITHUB_ID, dev: DEV_LOGIN }));

route('GET', '/api/games', async ({ user }) => {
  const games = (await q('select * from games order by name')).rows;
  const out = [];
  for (const g of games) {
    const s = await langStats(g.id);
    out.push({ slug: g.slug, name: g.name, platform: g.platform, source_lang: g.source_lang, ...s, mine: user ? (await access(user, g)).member : false });
  }
  return { games: out };
});

route('POST', '/api/games', async ({ user, req }) => {
  if (!requireUser(user).is_admin) fail(403, 'Só administradores criam projetos.');
  const b = await readJson(req);
  const name = String(b.name || '').trim().slice(0, 120);
  const slug = String(b.slug || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  if (!name || !slug) fail(400, 'Informe o nome do jogo.');
  if (await one('select 1 from games where slug = $1', [slug])) fail(409, 'Já existe um projeto com esse endereço.');
  const g = await one('insert into games (slug, name, platform, source_lang) values ($1, $2, $3, $4) returning *', [slug, name, String(b.platform || '').slice(0, 60), String(b.source_lang || 'ja').slice(0, 12)]);
  await log(g, user, 'projeto_criado');
  return { slug: g.slug };
});

route('GET', '/api/games/:slug', async ({ user, p }) => {
  const g = await gameBySlug(p.slug);
  const a = await access(user, g);
  const s = await langStats(g.id);
  return { game: { slug: g.slug, name: g.name, platform: g.platform, source_lang: g.source_lang }, ...s, access: a,
    blocks: +(await one('select count(*) n from blocks where game_id = $1', [g.id])).n };
});

route('POST', '/api/games/:slug/langs', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação adiciona idiomas.');
  const lang = String((await readJson(req)).lang || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 12);
  if (!lang) fail(400, 'Informe o código do idioma (ex.: pt, es, en).');
  await q('insert into game_langs (game_id, lang) values ($1, $2) on conflict do nothing', [g.id, lang]);
  await log(g, user, 'idioma_adicionado', lang);
  broadcast(g.slug, { type: 'progress' });
  return { ok: true };
});

route('DELETE', '/api/games/:slug/langs/:lang', async ({ user, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação remove idiomas.');
  await q('delete from game_langs where game_id = $1 and lang = $2', [g.id, p.lang]);
  await log(g, user, 'idioma_removido', p.lang);
  broadcast(g.slug, { type: 'progress' });
  return { ok: true };
});

route('GET', '/api/games/:slug/blocks', async ({ user, url, p }) => {
  const g = await gameBySlug(p.slug); const lang = url.searchParams.get('lang') || '';
  const rows = (await q(`select b.id, b.label, b.scene, count(s.id) n,
      count(t.string_id) filter (where t.text <> '') done, count(t.string_id) filter (where t.status = 'revisada') reviewed
    from blocks b join strings s on s.block_id = b.id left join translations t on t.string_id = s.id and t.lang = $2
    where b.game_id = $1 group by b.id order by b.position`, [g.id, lang])).rows;
  return { blocks: rows.map((r) => ({ id: r.id, label: r.label, scene: r.scene, n: +r.n, done: +r.done, reviewed: +r.reviewed })) };
});

route('GET', '/api/games/:slug/blocks/:id', async ({ user, url, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(user, g);
  if (!a.seeText) fail(user ? 403 : 401, user ? 'O texto é visível para a equipe deste jogo. Peça para entrar na aba Equipe.' : 'Entre com o GitHub para ver o texto.');
  const lang = url.searchParams.get('lang') || '';
  const rows = (await q(`select s.id, s.idx, s.source, t.text, t.status, t.updated_at, u.login, u.name, u.avatar_url
    from strings s left join translations t on t.string_id = s.id and t.lang = $3 left join users u on u.id = t.updated_by
    where s.game_id = $1 and s.block_id = $2 order by s.idx`, [g.id, +p.id, lang])).rows;
  return { strings: rows.map((r) => ({ id: r.id, idx: r.idx, source: r.source, text: r.text || '', status: r.text ? r.status : null, updated_at: r.updated_at, by: r.login ? { login: r.login, name: r.name, avatar_url: r.avatar_url } : null })) };
});

route('PUT', '/api/games/:slug/strings/:id/:lang', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!canTranslate(a, p.lang)) fail(403, 'Você não traduz este idioma neste jogo.');
  const b = await readJson(req);
  const text = String(b.text ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '\\n').slice(0, 4000);
  const s = await one('select id from strings where id = $1 and game_id = $2', [+p.id, g.id]) || fail(404, 'String não encontrada.');
  if (!(await one('select 1 from game_langs where game_id = $1 and lang = $2', [g.id, p.lang]))) fail(404, 'Idioma não existe neste projeto.');
  const cur = await one('select text, updated_at from translations where string_id = $1 and lang = $2', [s.id, p.lang]);
  if (b.base !== undefined && cur && String(cur.updated_at?.toISOString?.() || '') !== String(b.base || '') && cur.text !== text) {
    const by = await one('select u.login, u.name from translations t join users u on u.id = t.updated_by where t.string_id = $1 and t.lang = $2', [s.id, p.lang]);
    fail(409, '{who} alterou esta string enquanto você editava.', { who: by?.name || by?.login || null });
  }
  let row = null;
  if (!text) await q('delete from translations where string_id = $1 and lang = $2', [s.id, p.lang]);
  else row = await one(`insert into translations (string_id, lang, text, status, updated_by, updated_at) values ($1, $2, $3, 'traduzida', $4, now())
    on conflict (string_id, lang) do update set text = excluded.text, status = case when translations.text = excluded.text then translations.status else 'traduzida' end,
      updated_by = excluded.updated_by, updated_at = now() returning *`, [s.id, p.lang, text, user.id]);
  await q('insert into translation_history (string_id, lang, text, status, user_id) values ($1, $2, $3, $4, $5)', [s.id, p.lang, text, row?.status || 'apagada', user.id]);
  const event = { type: 'translation', id: s.id, lang: p.lang, text, status: row?.status || null, updated_at: row?.updated_at || null, by: { login: user.login, name: user.name, avatar_url: user.avatar_url } };
  broadcast(g.slug, event);
  broadcast(g.slug, { type: 'progress' });
  return event;
});

route('POST', '/api/games/:slug/strings/:id/:lang/review', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!canReview(a, p.lang)) fail(403, 'Só revisores deste idioma aprovam traduções.');
  const approved = !!(await readJson(req)).approved;
  const row = await one(`update translations t set status = $3, updated_at = now() from strings s
    where t.string_id = s.id and s.game_id = $4 and t.string_id = $1 and t.lang = $2 and t.text <> '' returning t.*`, [+p.id, p.lang, approved ? 'revisada' : 'traduzida', g.id]) || fail(404, 'Não há tradução para revisar.');
  await q('insert into translation_history (string_id, lang, text, status, user_id) values ($1, $2, $3, $4, $5)', [row.string_id, p.lang, row.text, row.status, user.id]);
  broadcast(g.slug, { type: 'translation', id: row.string_id, lang: p.lang, text: row.text, status: row.status, updated_at: row.updated_at, by: null });
  broadcast(g.slug, { type: 'progress' });
  return { status: row.status };
});

route('GET', '/api/games/:slug/strings/:id/:lang/history', async ({ user, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(user, g);
  if (!a.seeText) fail(403, 'Só a equipe vê o histórico.');
  return { history: (await q(`select h.text, h.status, h.created_at, u.login, u.name, u.avatar_url from translation_history h
    join strings s on s.id = h.string_id left join users u on u.id = h.user_id
    where h.string_id = $1 and h.lang = $2 and s.game_id = $3 order by h.created_at desc limit 30`, [+p.id, p.lang, g.id])).rows };
});

route('POST', '/api/games/:slug/import', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação importa texto.');
  const r = await importTsv(g, await readBody(req));
  await log(g, user, 'texto_importado', null, r);
  broadcast(g.slug, { type: 'progress' });
  return r;
});

route('GET', '/api/games/:slug/export', async ({ user, p, res }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação exporta.');
  const body = await exportTsv(g);
  await log(g, user, 'exportado');
  res.writeHead(200, { 'Content-Type': 'text/tab-separated-values; charset=utf-8', 'Content-Disposition': `attachment; filename="${g.slug}-traducoes.tsv"` });
  res.end(body);
  return undefined;
});

route('GET', '/api/games/:slug/team', async ({ user, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(user, g);
  const members = (await q(`select u.id, u.login, u.name, u.avatar_url, m.lang, m.role from members m join users u on u.id = m.user_id
    where m.game_id = $1 order by u.login, m.lang`, [g.id])).rows;
  const requests = a.manage ? (await q(`select r.*, u.login, u.name, u.avatar_url from join_requests r join users u on u.id = r.user_id
    where r.game_id = $1 and r.status = 'pendente' order by r.created_at`, [g.id])).rows : [];
  const mine = user ? await one(`select status, langs, created_at from join_requests where game_id = $1 and user_id = $2 order by created_at desc limit 1`, [g.id, user.id]) : null;
  return { members, requests, mine };
});

route('POST', '/api/games/:slug/requests', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); requireUser(user);
  const b = await readJson(req);
  const valid = new Set((await q('select lang from game_langs where game_id = $1', [g.id])).rows.map((r) => r.lang));
  const langs = [...new Set((b.langs || []).map(String))].filter((l) => valid.has(l));
  if (!langs.length) fail(400, 'Escolha pelo menos um idioma.');
  if (await one(`select 1 from join_requests where game_id = $1 and user_id = $2 and status = 'pendente'`, [g.id, user.id])) fail(409, 'Você já tem um pedido aguardando resposta.');
  await q('insert into join_requests (game_id, user_id, langs, level, note, contact) values ($1, $2, $3, $4, $5, $6)',
    [g.id, user.id, langs, String(b.level || '').slice(0, 40), String(b.note || '').slice(0, 800), String(b.contact || '').slice(0, 160)]);
  await log(g, user, 'pedido_enviado', null, { langs });
  broadcast(g.slug, { type: 'team' });
  return { ok: true };
});

route('POST', '/api/games/:slug/requests/:id', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação responde pedidos.');
  const b = await readJson(req);
  const r = await one(`select * from join_requests where id = $1 and game_id = $2 and status = 'pendente'`, [+p.id, g.id]) || fail(404, 'Pedido não encontrado.');
  const role = b.role === 'revisor' ? 'revisor' : 'tradutor';
  if (b.approve) for (const l of r.langs) await q(`insert into members (game_id, user_id, lang, role) values ($1, $2, $3, $4) on conflict (game_id, user_id, lang) do update set role = excluded.role`, [g.id, r.user_id, l, role]);
  await q('update join_requests set status = $2, decided_by = $3, decided_at = now() where id = $1', [r.id, b.approve ? 'aprovado' : 'recusado', user.id]);
  await log(g, user, b.approve ? 'pedido_aprovado' : 'pedido_recusado', null, { user_id: r.user_id });
  broadcast(g.slug, { type: 'team' });
  return { ok: true };
});

route('PUT', '/api/games/:slug/members', async ({ user, req, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação muda a equipe.');
  const b = await readJson(req);
  const target = await one('select id from users where id = $1 or lower(login) = lower($2)', [+b.user_id || 0, String(b.login || '')]) || fail(404, 'Essa pessoa ainda não entrou no site. Peça para ela entrar com o GitHub uma vez.');
  if (!ROLES.includes(b.role)) fail(400, 'Papel inválido.');
  if (b.role === 'coordenador' && !a.admin) fail(403, 'Só administradores nomeiam coordenadores.');
  const lang = b.role === 'coordenador' ? '*' : String(b.lang || '');
  if (lang !== '*' && !(await one('select 1 from game_langs where game_id = $1 and lang = $2', [g.id, lang]))) fail(400, 'Idioma não existe neste projeto.');
  await q(`insert into members (game_id, user_id, lang, role) values ($1, $2, $3, $4) on conflict (game_id, user_id, lang) do update set role = excluded.role`, [g.id, target.id, lang, b.role]);
  await log(g, user, 'equipe_alterada', lang === '*' ? null : lang, { user_id: target.id, role: b.role });
  broadcast(g.slug, { type: 'team' });
  return { ok: true };
});

route('DELETE', '/api/games/:slug/members/:uid/:lang', async ({ user, p }) => {
  const g = await gameBySlug(p.slug); const a = await access(requireUser(user), g);
  if (!a.manage) fail(403, 'Só a coordenação muda a equipe.');
  if (p.lang === '*' && !a.admin) fail(403, 'Só administradores tiram coordenadores.');
  await q('delete from members where game_id = $1 and user_id = $2 and lang = $3', [g.id, +p.uid, decodeURIComponent(p.lang)]);
  await log(g, user, 'equipe_alterada', null, { user_id: +p.uid, removed: true });
  broadcast(g.slug, { type: 'team' });
  return { ok: true };
});

route('GET', '/api/games/:slug/activity', async ({ p }) => {
  const g = await gameBySlug(p.slug);
  const events = (await q(`select a.kind, a.lang, a.detail, a.created_at, u.login, u.name, u.avatar_url from activity a left join users u on u.id = a.user_id
    where a.game_id = $1 order by a.created_at desc limit 40`, [g.id])).rows;
  const recent = (await q(`select h.lang, h.status, h.created_at, s.idx, b.label, u.login, u.name, u.avatar_url from translation_history h
    join strings s on s.id = h.string_id join blocks b on b.id = s.block_id left join users u on u.id = h.user_id
    where s.game_id = $1 order by h.created_at desc limit 30`, [g.id])).rows;
  const top = (await q(`select u.login, u.name, u.avatar_url, t.lang, count(*) n from translations t join strings s on s.id = t.string_id
    join users u on u.id = t.updated_by where s.game_id = $1 and t.text <> '' group by u.id, t.lang order by n desc limit 10`, [g.id])).rows;
  return { events, recent, top: top.map((r) => ({ ...r, n: +r.n })) };
});

route('GET', '/api/games/:slug/stream', async ({ req, res, p }) => { const g = await gameBySlug(p.slug); openStream(req, res, g.slug); return undefined; });

// admin
route('GET', '/api/admin/users', async ({ user }) => {
  if (!requireUser(user).is_admin) fail(403, 'Só administradores.');
  const users = (await q(`select u.id, u.login, u.name, u.avatar_url, u.is_admin, u.created_at, u.last_seen,
      coalesce(json_agg(json_build_object('game', g.slug, 'lang', m.lang, 'role', m.role)) filter (where m.game_id is not null), '[]') memberships,
      (select count(*) from translation_history h where h.user_id = u.id) edits
    from users u left join members m on m.user_id = u.id left join games g on g.id = m.game_id group by u.id order by u.last_seen desc`)).rows;
  const pending = (await q(`select r.id, r.langs, r.created_at, g.slug, g.name game, u.login, u.name, u.avatar_url from join_requests r
    join games g on g.id = r.game_id join users u on u.id = r.user_id where r.status = 'pendente' order by r.created_at`)).rows;
  return { users: users.map((u) => ({ ...u, edits: +u.edits })), pending };
});

route('PUT', '/api/admin/users/:id', async ({ user, req, p }) => {
  if (!requireUser(user).is_admin) fail(403, 'Só administradores.');
  const b = await readJson(req);
  if (+p.id === user.id && b.is_admin === false) fail(400, 'Você não pode tirar seu próprio acesso de administrador.');
  await q('update users set is_admin = $2 where id = $1', [+p.id, !!b.is_admin]);
  return { ok: true };
});

route('DELETE', '/api/admin/users/:id/sessions', async ({ user, p }) => {
  if (!requireUser(user).is_admin) fail(403, 'Só administradores.');
  await q('delete from sessions where user_id = $1', [+p.id]);
  return { ok: true };
});

// ---------------------------------------------------------------- static files

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function serveStatic(req, res, pathname) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, tr(langOf(req), 'Não encontrado.'));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(data);
  } catch {
    if (extname(pathname)) return send(res, 404, tr(langOf(req), 'Não encontrado.'));
    // app routes live in the hash, but any other path still gets the page (read first, then answer)
    const page = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    res.end(page);
  }
}

// ---------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (url.pathname === '/healthz') { await q('select 1'); return send(res, 200, 'ok'); }
    if (url.pathname === '/auth/github') return await githubStart(req, res);
    if (url.pathname === '/auth/github/callback') return await githubCallback(req, res, url);
    if (url.pathname === '/auth/dev' && DEV_LOGIN) return await devLogin(req, res, url);
    if (url.pathname === '/auth/logout' && req.method === 'POST') return await logout(req, res);
    if (url.pathname.startsWith('/api/')) {
      // state-changing calls must come from our own page (SameSite cookie + this header)
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'glifo') fail(403, 'Pedido recusado.');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const user = await currentUser(req);
        const out = await r.handler({ req, res, url, user, p: m.groups || {} });
        if (out !== undefined) send(res, 200, out);
        return;
      }
      fail(404, 'Rota não encontrada.');
    }
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) {
      const lang = langOf(req);
      const vars = { ...(e.vars || {}) };
      if ('who' in vars && !vars.who) vars.who = tr(lang, 'Outra pessoa');
      send(res, e.status || 500, { error: tr(lang, e instanceof HttpError ? e.message : 'Erro no servidor. Tente de novo.', vars) });
    }
  }
});

async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (let i = 0; ; i++) {
    try { await q(sql); break; } catch (e) { if (i >= 20) throw e; console.log('aguardando o banco…'); await new Promise((r) => setTimeout(r, 2000)); }
  }
}

await migrate();
server.listen(PORT, '0.0.0.0', () => console.log(`Glifo em ${PUBLIC_URL} (porta ${PORT})${DEV_LOGIN ? ' — DEV_LOGIN ligado' : ''}`));
