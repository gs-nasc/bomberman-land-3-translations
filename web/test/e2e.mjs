// End-to-end check against a running server started with DEV_LOGIN=1 and ADMIN_GITHUB_LOGINS=admin.
// Usage: node test/e2e.mjs http://localhost:3999 ../dialogos_jp.tsv
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3999';
const TSV = readFileSync(process.argv[3] || '../dialogos_jp.tsv', 'utf8');
const SLUG = `teste-${Date.now()}`;
let passed = 0;
const ok = (name) => { passed++; console.log(`  ok  ${name}`); };

async function login(name) {
  const r = await fetch(`${BASE}/auth/dev?login=${name}`, { redirect: 'manual' });
  const sid = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).join(';').match(/sid=([^;]+)/)[1];
  return `sid=${sid}`;
}
async function call(cookie, method, path, body, { raw = false, header = true } = {}) {
  const headers = { Cookie: cookie || '' };
  if (header) headers['X-Requested-With'] = 'glifo';
  let payload;
  if (body !== undefined) { payload = raw ? body : JSON.stringify(body); headers['Content-Type'] = raw ? 'text/plain' : 'application/json'; }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

const admin = await login('admin');
const alice = await login('alice');
const bob = await login('bob');

// projects and languages
assert.equal((await call(alice, 'POST', '/api/games', { name: 'x' })).status, 403); ok('only admins create projects');
assert.equal((await call(admin, 'POST', '/api/games', { name: 'Bomberman Land 3', platform: 'PS2', slug: SLUG })).status, 200); ok('admin creates a project');
for (const lang of ['pt', 'es']) assert.equal((await call(admin, 'POST', `/api/games/${SLUG}/langs`, { lang })).status, 200);
ok('admin opens pt and es');

// import
const imp = await call(admin, 'POST', `/api/games/${SLUG}/import`, TSV, { raw: true });
assert.equal(imp.status, 200);
assert.equal(imp.data.strings, 8231); assert.equal(imp.data.blocks, 162); ok('import: 8231 unique strings in 162 blocks');
const again = await call(admin, 'POST', `/api/games/${SLUG}/import`, TSV, { raw: true });
assert.equal(again.data.strings, 8231); ok('re-import is idempotent');

const { data: { blocks } } = await call(admin, 'GET', `/api/games/${SLUG}/blocks?lang=pt`);
const block = blocks.find((b) => b.n > 5);
const { data: { strings } } = await call(admin, 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`);
const s = strings[0];

// access to the text
assert.equal((await call('', 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`)).status, 401); ok('signed-out visitors cannot read the source text');
assert.equal((await call(alice, 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`)).status, 403); ok('non-members cannot read the source text');
assert.equal((await call(alice, 'PUT', `/api/games/${SLUG}/strings/${s.id}/pt`, { text: 'x' })).status, 403); ok('non-members cannot translate');
assert.equal((await call(admin, 'PUT', `/api/games/${SLUG}/strings/${s.id}/pt`, { text: 'x' }, { header: false })).status, 403); ok('writes without the page header are refused (CSRF)');

// live updates
const ctrl = new AbortController();
const sse = await fetch(`${BASE}/api/games/${SLUG}/stream`, { signal: ctrl.signal });
const reader = sse.body.getReader();
const events = [];
const pump = (async () => { const dec = new TextDecoder(); try { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(dec.decode(value)); } } catch { /* aborted */ } })();

// admin translates and reviews
const t1 = await call(admin, 'PUT', `/api/games/${SLUG}/strings/${s.id}/pt`, { text: 'Olá!\nTudo bem?{PAG}' });
assert.equal(t1.status, 200); assert.equal(t1.data.text, 'Olá!\\nTudo bem?{PAG}'); ok('translation saved; line breaks stored in game format (\\n)');
assert.equal((await call(admin, 'POST', `/api/games/${SLUG}/strings/${s.id}/pt/review`, { approved: true })).data.status, 'revisada'); ok('admin approves (revisada)');
await new Promise((r) => setTimeout(r, 300));
assert.ok(events.join('').includes('"type":"translation"')); ok('live update reaches open pages (SSE)');
ctrl.abort(); await pump;

// join request -> approval -> per-language permission
assert.equal((await call(alice, 'POST', `/api/games/${SLUG}/requests`, { langs: ['pt'], level: 'fluente', note: 'oi', contact: '@alice' })).status, 200); ok('alice asks to join (pt)');
assert.equal((await call(alice, 'POST', `/api/games/${SLUG}/requests`, { langs: ['pt'] })).status, 409); ok('a second pending request is refused');
const team = await call(admin, 'GET', `/api/games/${SLUG}/team`);
const req = team.data.requests.find((r) => r.login === 'alice');
assert.ok(req); assert.equal((await call(bob, 'GET', `/api/games/${SLUG}/team`)).data.requests.length, 0); ok('requests are visible only to coordination');
assert.equal((await call(admin, 'POST', `/api/games/${SLUG}/requests/${req.id}`, { approve: true, role: 'tradutor' })).status, 200); ok('admin approves alice as translator');
const s2 = strings[1];
assert.equal((await call(alice, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/pt`, { text: 'Tradução da Alice' })).status, 200); ok('alice translates pt');
assert.equal((await call(alice, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/es`, { text: 'no' })).status, 403); ok('alice cannot translate es');
assert.equal((await call(alice, 'POST', `/api/games/${SLUG}/strings/${s2.id}/pt/review`, { approved: true })).status, 403); ok('a translator cannot review');
assert.equal((await call(alice, 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`)).status, 200); ok('members read the source text');

// edit conflict
const before = (await call(alice, 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`)).data.strings[1];
await call(admin, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/pt`, { text: 'Versão do admin' });
const conflict = await call(alice, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/pt`, { text: 'Versão da Alice', base: before.updated_at });
assert.equal(conflict.status, 409); ok('stale edit is refused with 409 and who changed it');
assert.equal((await call(alice, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/pt`, { text: 'Versão da Alice' })).status, 200); ok('saving without base overwrites on purpose');
const hist = await call(alice, 'GET', `/api/games/${SLUG}/strings/${s2.id}/pt/history`);
assert.ok(hist.data.history.length >= 3); ok('history keeps every version');

// progress and coordinator-only routes
const g = await call(bob, 'GET', `/api/games/${SLUG}`);
const pt = g.data.langs.find((l) => l.lang === 'pt');
assert.equal(pt.done, 2); assert.equal(pt.reviewed, 1); ok('progress counts translated and reviewed');
assert.equal((await call(alice, 'GET', `/api/games/${SLUG}/export`)).status, 403); ok('only coordination exports');
assert.equal((await call(bob, 'GET', '/api/admin/users')).status, 403); ok('admin panel refuses non-admins');
assert.equal((await call(admin, 'GET', '/api/admin/users')).status, 200); ok('admin panel lists people');

// export reproduces every original row (all copies of each table) plus the language columns
const exp = await call(admin, 'GET', `/api/games/${SLUG}/export`);
const lines = exp.data.trim().split('\n');
assert.deepEqual(lines[0].split('\t'), ['archive', 'entry', 'file', 'id', 'string_res', 'font_res', 'method', 'margin', 'text', 'es', 'pt']);
const orig = TSV.trim().split('\n').slice(1).map((l) => l.split('\t').slice(0, 9).join('\t'));
const got = lines.slice(1).map((l) => l.split('\t').slice(0, 9).join('\t'));
assert.equal(got.length, orig.length);
const set = new Set(got); assert.ok(orig.every((r) => set.has(r))); ok(`export has the ${orig.length} original rows unchanged`);
const translated = lines.filter((l) => l.split('\t')[10] === 'Olá!\\nTudo bem?{PAG}');
assert.ok(translated.length >= 1); ok(`translation exported to ${translated.length} row(s), every copy of its table`);

// server messages follow the interface language (X-Lang, then Accept-Language)
const errIn = async (headers) => (await (await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: bob, ...headers } })).json()).error;
assert.equal(await errIn({}), 'Só administradores.');
assert.equal(await errIn({ 'X-Lang': 'en' }), 'Admins only.');
assert.equal(await errIn({ 'X-Lang': 'ja' }), '管理者のみ。');
assert.equal(await errIn({ 'Accept-Language': 'es-AR,es;q=0.9' }), 'Solo administradores.');
ok('errors come back in pt, en, ja and es');
const fresh = (await call(alice, 'GET', `/api/games/${SLUG}/blocks/${block.id}?lang=pt`)).data.strings[1];
await call(admin, 'PUT', `/api/games/${SLUG}/strings/${s2.id}/pt`, { text: 'Outra versão' });
const c2 = await fetch(`${BASE}/api/games/${SLUG}/strings/${s2.id}/pt`, { method: 'PUT', headers: { Cookie: alice, 'X-Requested-With': 'glifo', 'X-Lang': 'en', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', base: fresh.updated_at }) });
assert.equal((await c2.json()).error, 'admin changed this string while you were editing.'); ok('message templates fill in who changed the string');

console.log(`\n${passed} checks passed`);
