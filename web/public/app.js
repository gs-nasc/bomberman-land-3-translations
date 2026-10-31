// Glifo — single-page frontend (hash routes, no build step). Every visible text goes through t().
import { LANGS, lang, locale, setLang, t } from './i18n.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');

// ---------------------------------------------------------------- utils
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v; // only for static, trusted markup (icons)
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const fmt = (n) => new Intl.NumberFormat(locale()).format(n);
const langName = (c) => {
  try {
    const n = new Intl.DisplayNames([locale()], { type: 'language' }).of(c);
    return n && n !== c ? n[0].toLocaleUpperCase(locale()) + n.slice(1) : c.toUpperCase();
  } catch { return c.toUpperCase(); }
};
const pct = (n, total) => (total ? Math.floor((1000 * n) / total) / 10 : 0);
const pctText = (p) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(p)}%`;
const ago = (iso) => {
  if (!iso) return '';
  const m = (Date.now() - new Date(iso)) / 60000;
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.min', { n: Math.floor(m) });
  if (m < 1440) return t('time.hour', { n: Math.floor(m / 60) });
  if (m < 10080) return t('time.day', { n: Math.floor(m / 1440) });
  return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });
};
const who = (u) => (u && (u.name || u.login)) || t('someone');
const roleLabel = (r) => t(`role.${r}`);
const LEVELS = ['fluent', 'intermediate', 'basic', 'reviewer'];
const LEGACY_LEVEL = { fluente: 'fluent', 'intermediário': 'intermediate', 'básico': 'basic', 'revisão': 'reviewer', revisor: 'reviewer' };
const levelLabel = (v) => { const k = LEGACY_LEVEL[v] || v; return LEVELS.includes(k) ? t(`level.${k}`) : v; };
function avatar(u, cls = 'avatar') {
  const img = h('img', { class: cls, alt: '', loading: 'lazy' });
  if (u?.avatar_url) img.src = u.avatar_url;
  return img;
}
function bar(total, done, reviewed, cls = 'bar') {
  const r = h('i', { class: 'rev' }); r.style.width = `${total ? (100 * reviewed) / total : 0}%`;
  const tr = h('i', { class: 'tr' }); tr.style.width = `${total ? (100 * Math.max(0, done - reviewed)) / total : 0}%`;
  return h('div', { class: cls, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct(done, total) }, r, tr);
}
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(method, path, body, raw = false) {
  const opts = { method, headers: { 'X-Requested-With': 'glifo', 'X-Lang': lang }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (raw) { opts.body = body; opts.headers['Content-Type'] = 'text/plain; charset=utf-8'; }
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || t('err.generic')); e.status = res.status; throw e; }
  return data;
}

const GH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
function loginButton(label = t('auth.github')) {
  const a = h('a', { class: 'btn primary btn-github', href: '/auth/github', html: GH_ICON });
  a.append(h('span', { text: label }));
  return a;
}

// ---------------------------------------------------------------- session + chrome
const S = { me: null, auth: { github: false, dev: false }, stream: null, streamSlug: null, cleanup: [] };

function langSwitch() {
  const sel = h('select', { class: 'lang-switch', 'aria-label': t('nav.language'), onchange: (e) => { setLang(e.target.value); router(); } },
    Object.entries(LANGS).map(([k, label]) => h('option', { value: k, text: label, selected: k === lang })));
  return sel;
}

function renderChrome(route) {
  document.title = 'Glifo';
  $('#nav').replaceChildren(
    h('a', { href: '#/', 'aria-current': route.name === 'home' ? 'page' : null, text: t('nav.projects') }),
    S.me?.is_admin ? h('a', { href: '#/admin', 'aria-current': route.name === 'admin' ? 'page' : null, text: t('nav.admin') }) : null);
  const acc = $('#account'); acc.replaceChildren(langSwitch());
  if (S.me) {
    acc.append(h('span', { class: 'small muted login-name', text: S.me.login }), avatar(S.me),
      h('button', { class: 'btn ghost sm', type: 'button', text: t('nav.signout'), onclick: async () => { await api('POST', '/auth/logout').catch(() => {}); location.hash = '#/'; location.reload(); } }));
  } else if (S.auth.github) acc.append(loginButton(t('auth.signin')));
  else if (S.auth.dev) acc.append(h('a', { class: 'btn sm', href: `/auth/dev?login=dev&to=${encodeURIComponent(location.hash || '#/')}`, text: t('auth.dev') }));
}

// live updates for the game being viewed
function useStream(slug, onEvent) {
  if (S.streamSlug !== slug) {
    S.stream?.close();
    S.stream = new EventSource(`/api/games/${encodeURIComponent(slug)}/stream`);
    S.streamSlug = slug;
  }
  const handler = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
  S.stream.addEventListener('message', handler);
  S.cleanup.push(() => S.stream?.removeEventListener('message', handler));
}
function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }

// ---------------------------------------------------------------- router
function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'admin') return { name: 'admin' };
  if (parts[0] === 'g' && parts[1]) {
    if (parts[2] === 't' && parts[3]) return { name: 'editor', slug: parts[1], lang: parts[3], block: parts[4] ? +parts[4] : null };
    return { name: 'game', slug: parts[1], tab: parts[2] || 'idiomas' };
  }
  return { name: 'home' };
}
let lastKey = '';
async function router() {
  const route = parseRoute();
  const key = `${route.name}|${route.slug || ''}|${route.tab || ''}|${route.lang || ''}`;
  S.cleanup.forEach((f) => f()); S.cleanup = [];
  if (route.name !== 'game' && route.name !== 'editor') { S.stream?.close(); S.stream = null; S.streamSlug = null; }
  renderChrome(route);
  if (key !== lastKey) window.scrollTo(0, 0);
  lastKey = key;
  try {
    if (route.name === 'home') await viewHome();
    else if (route.name === 'admin') await viewAdmin();
    else if (route.name === 'game') await viewGame(route);
    else if (route.name === 'editor') await viewEditor(route);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: e.status === 404 ? t('err.notFound') : t('err.load') }), h('p', { text: e.message }), h('a', { class: 'btn', href: '#/', text: t('err.backHome') })));
  }
}
window.addEventListener('hashchange', router);

// ---------------------------------------------------------------- home
async function viewHome() {
  const { games } = await api('GET', '/api/games');
  const status = h('p', { class: 'status', role: 'status' });
  const form = h('div', { class: 'panel', hidden: true }, h('div', { class: 'panel-body' }, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('POST', '/api/games', { name: f.name.value, platform: f.platform.value, slug: f.slug.value, source_lang: f.source.value });
      location.hash = `#/g/${r.slug}/configuracoes`;
    } catch (err) { status.textContent = err.message; status.className = 'status bad'; }
  } },
    h('h2', { text: t('home.new') }),
    h('div', { class: 'grid' },
      h('label', { class: 'field' }, h('span', { text: t('home.form.name') }), h('input', { type: 'text', name: 'name', required: true, placeholder: 'Bomberman Land 3' })),
      h('label', { class: 'field' }, h('span', { text: t('home.form.platform') }), h('input', { type: 'text', name: 'platform', placeholder: 'PlayStation 2' })),
      h('label', { class: 'field' }, h('span', {}, `${t('home.form.slug')} `, h('small', { text: t('home.form.optional') })), h('input', { type: 'text', name: 'slug', placeholder: 'bomberman-land-3' })),
      h('label', { class: 'field' }, h('span', { text: t('home.form.source') }), h('input', { type: 'text', name: 'source', value: 'ja' }))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: t('home.form.create') }), status))));
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'lead' }, h('h1', { text: t('home.title') }), h('p', { class: 'muted', text: t('home.lead') })),
    S.me?.is_admin ? h('button', { class: 'btn', type: 'button', text: t('home.new'), onclick: () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); } }) : null);

  const list = h('div', { class: 'grid' });
  if (!games.length) {
    list.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', { text: t('home.empty') }), h('p', { text: S.me?.is_admin ? t('home.emptyAdmin') : t('home.emptyAll') }))));
  }
  for (const g of games) {
    const langs = [...g.langs].sort((a, b) => b.done - a.done);
    list.append(h('a', { class: 'card', href: `#/g/${g.slug}` },
      h('div', { class: 'card-title' }, h('h2', { text: g.name }), g.mine ? h('span', { class: 'chip accent', text: t('home.yourTeam') }) : null),
      h('div', { class: 'meta-row' }, g.platform ? h('span', { text: g.platform }) : null, h('span', { class: 'num', text: g.total ? t('home.strings', { n: g.total }) : t('home.noText') })),
      h('div', { class: 'card-langs' }, langs.length ? langs.slice(0, 6).map((l) => h('div', { class: 'card-lang' },
        h('span', { class: 'code', text: l.lang }), bar(g.total, l.done, l.reviewed, 'bar thin'), h('span', { class: 'pct', text: pctText(pct(l.done, g.total)) })))
        : h('p', { class: 'small muted', text: t('home.noLangs') }))));
  }
  const intro = !S.me ? h('section', { class: 'hero' },
    h('h1', { text: t('hero.title') }), h('p', { text: t('hero.lead') }),
    S.auth.github ? h('div', {}, loginButton()) : null) : null;
  app.replaceChildren(...[intro, head, form, list].filter(Boolean));
}

// ---------------------------------------------------------------- game
async function viewGame(route) {
  const data = await api('GET', `/api/games/${encodeURIComponent(route.slug)}`);
  const { game, access: a } = data;
  const tabs = [['idiomas', t('tab.langs')], ['equipe', t('tab.team')], ['atividade', t('tab.activity')]];
  if (a.manage) tabs.push(['configuracoes', t('tab.settings')]);
  const tab = tabs.some(([k]) => k === route.tab) ? route.tab : 'idiomas';
  const myRoles = Object.entries(a.langs).map(([l, r]) => `${l.toUpperCase()} ${roleLabel(r)}`).join(', ');
  const body = h('div', { style: 'display:grid;gap:20px' });
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'lead' },
      h('span', { class: 'eyebrow', text: game.platform || t('game.project') }), h('h1', { text: game.name }),
      h('div', { class: 'meta-row' }, h('span', { text: t('game.original', { lang: langName(game.source_lang) }) }),
        h('span', { class: 'num', text: data.total ? t('game.size', { s: data.total, b: data.blocks }) : t('game.notImported') }),
        a.manage ? h('span', { class: 'chip', text: a.admin ? t('game.admin') : t('game.coord') }) : myRoles ? h('span', { class: 'chip accent', text: t('game.you', { roles: myRoles }) }) : null))),
    h('nav', { class: 'tabs', 'aria-label': t('tab.sections') }, tabs.map(([k, label]) => h('a', { href: `#/g/${game.slug}/${k}`, 'aria-current': k === tab ? 'page' : null, text: label }))),
    body);
  const paint = { idiomas: tabLangs, equipe: tabTeam, atividade: tabActivity, configuracoes: tabSettings }[tab];
  await paint(body, data);
  useStream(game.slug, debounce(async (ev) => {
    if (parseRoute().name !== 'game') return;
    if (tab === 'idiomas' && ev.type === 'progress') await tabLangs(body, await api('GET', `/api/games/${encodeURIComponent(game.slug)}`));
    if (tab === 'equipe' && ev.type === 'team') await tabTeam(body, data);
    if (tab === 'atividade' && (ev.type === 'activity' || ev.type === 'translation')) await tabActivity(body, data);
  }, 400));
}

async function tabLangs(body, data) {
  const { game, access: a, total } = data;
  const rows = [...data.langs].sort((x, y) => y.done - x.done);
  const panel = h('div', { class: 'panel' });
  if (!rows.length) panel.append(h('div', { class: 'empty' }, h('h3', { text: t('langs.none') }), h('p', { text: a.manage ? t('langs.noneAdmin') : t('langs.noneAll') })));
  else {
    panel.append(h('div', { class: 'panel-head' }, h('h2', { text: t('langs.title') }),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--good)' }), t('langs.reviewed')), h('span', {}, h('i', { style: 'background:var(--accent)' }), t('langs.translated')))));
    const tb = h('tbody');
    for (const l of rows) {
      const can = a.manage || !!a.langs[l.lang];
      const go = () => { if (total) location.hash = `#/g/${game.slug}/t/${l.lang}`; };
      tb.append(h('tr', { class: total ? 'link' : '', tabindex: total ? 0 : null, onclick: go, onkeydown: (e) => { if (e.key === 'Enter') go(); } },
        h('td', {}, h('div', { class: 'lang-cell' }, h('b', { text: langName(l.lang) }), h('span', { class: 'code-tag', text: l.lang }))),
        h('td', {}, h('div', { class: 'progress-cell' }, bar(total, l.done, l.reviewed), h('span', { class: 'pct', text: pctText(pct(l.done, total)) }))),
        h('td', { class: 'num muted', text: `${fmt(l.done)} / ${fmt(total)}` }),
        h('td', { class: 'num muted', text: t('langs.reviewedCount', { n: l.reviewed }) }),
        h('td', { style: 'text-align:right' }, total ? h('span', { class: `btn sm ${can ? 'primary' : ''}`, text: can ? t('langs.translate') : t('langs.view') }) : null)));
    }
    panel.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: t('langs.col.lang') }), h('th', { text: t('langs.col.progress') }), h('th', { text: t('langs.col.done') }), h('th', { text: t('langs.col.review') }), h('th', {}))), tb)));
  }
  const extra = [];
  if (!S.me && rows.length) extra.push(h('div', { class: 'notice' }, h('p', { text: t('langs.signinNotice') }), S.auth.github ? loginButton() : null));
  else if (S.me && !a.seeText) extra.push(h('div', { class: 'notice' }, h('p', { text: t('langs.joinNotice') }), h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: t('langs.join') })));
  body.replaceChildren(panel, ...extra);
}

async function tabTeam(body, data) {
  const { game, access: a } = data;
  const slug = encodeURIComponent(game.slug);
  const team = await api('GET', `/api/games/${slug}/team`);
  const byUser = new Map();
  for (const m of team.members) {
    if (!byUser.has(m.id)) byUser.set(m.id, { ...m, roles: [] });
    byUser.get(m.id).roles.push({ lang: m.lang, role: m.role });
  }
  const members = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('team.title') }), h('span', { class: 'muted small num', text: t('team.people', { n: byUser.size }) })));
  const list = h('div', { class: 'people' });
  if (!byUser.size) list.append(h('div', { class: 'empty' }, h('p', { text: t('team.empty') })));
  for (const u of byUser.values()) {
    list.append(h('div', { class: 'person' }, avatar(u, 'avatar lg'),
      h('div', { class: 'who' }, h('b', { text: who(u) }), h('span', { class: 'mono', text: `@${u.login}` })),
      h('div', { class: 'side' }, u.roles.map((r) => h('span', { class: `chip ${r.role === 'coordenador' ? 'accent' : r.role === 'revisor' ? 'good' : ''}` },
        r.role === 'coordenador' ? roleLabel('coordenador') : `${r.lang.toUpperCase()} · ${roleLabel(r.role)}`,
        a.manage && (r.role !== 'coordenador' || a.admin) ? h('button', { type: 'button', 'aria-label': `${t('team.remove')} ${r.lang}`, text: '×', onclick: async () => {
          try { await api('DELETE', `/api/games/${slug}/members/${u.id}/${encodeURIComponent(r.lang)}`); await tabTeam(body, data); } catch (e) { toast(e.message); }
        } }) : null)))));
  }
  members.append(list);

  const side = [];
  if (a.manage) {
    const reqs = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('team.requests') }), h('span', { class: 'muted small num', text: fmt(team.requests.length) })));
    if (!team.requests.length) reqs.append(h('div', { class: 'empty' }, h('p', { text: t('team.noRequests') })));
    for (const r of team.requests) {
      const role = h('select', { 'aria-label': t('team.role') }, h('option', { value: 'tradutor', text: t('role.translator') }), h('option', { value: 'revisor', text: t('role.reviewer') }));
      role.style.width = 'auto';
      const decide = async (approve) => { try { await api('POST', `/api/games/${slug}/requests/${r.id}`, { approve, role: role.value }); toast(approve ? t('team.approved') : t('team.rejected')); await tabTeam(body, data); } catch (e) { toast(e.message); } };
      reqs.append(h('div', { class: 'request' },
        h('div', { class: 'row' }, avatar(r), h('div', { class: 'grow' }, h('b', { text: who(r) }), ' ', h('span', { class: 'muted small mono', text: `@${r.login} · ${ago(r.created_at)}` }))),
        h('div', { class: 'chips' }, r.langs.map((l) => h('span', { class: 'chip', text: langName(l) })), r.level ? h('span', { class: 'chip', text: levelLabel(r.level) }) : null),
        r.note ? h('p', { text: r.note }) : null,
        r.contact ? h('p', { class: 'mono small', text: t('team.contact', { c: r.contact }) }) : null,
        h('div', { class: 'row' }, role, h('button', { class: 'btn primary sm', type: 'button', text: t('team.approve'), onclick: () => decide(true) }), h('button', { class: 'btn sm', type: 'button', text: t('team.reject'), onclick: () => decide(false) }))));
    }
    side.push(reqs);
    const st = h('p', { class: 'status', role: 'status' });
    side.push(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('team.add') })), h('div', { class: 'panel-body' }, h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api('PUT', `/api/games/${slug}/members`, { login: f.login.value.trim().replace(/^@/, ''), role: f.role.value, lang: f.lang.value }); f.reset(); toast(t('team.updated')); await tabTeam(body, data); }
      catch (err) { st.textContent = err.message; st.className = 'status bad'; }
    } },
      h('label', { class: 'field' }, h('span', {}, `${t('team.addUser')} `, h('small', { text: t('team.addHint') })), h('input', { type: 'text', name: 'login', required: true, placeholder: t('team.addUserPh') })),
      h('div', { class: 'row' },
        h('select', { name: 'role', 'aria-label': t('team.role'), class: 'grow' }, h('option', { value: 'tradutor', text: t('role.translator') }), h('option', { value: 'revisor', text: t('role.reviewer') }), a.admin ? h('option', { value: 'coordenador', text: t('role.coordAll') }) : null),
        h('select', { name: 'lang', 'aria-label': t('langs.col.lang'), class: 'grow' }, data.langs.map((l) => h('option', { value: l.lang, text: langName(l.lang) })))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', text: t('team.addBtn') }), st)))));
  } else if (S.me) side.push(joinPanel(game, data, team.mine, () => tabTeam(body, data)));
  else side.push(h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', { text: t('team.helpTitle') }), h('p', { text: t('team.helpLead') }), S.auth.github ? loginButton() : null)));
  body.replaceChildren(h('div', { class: 'split' }, members, h('div', { style: 'display:grid;gap:20px;min-width:0' }, side)));
}

function joinPanel(game, data, mine, refresh) {
  const panel = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('join.title') })));
  if (mine?.status === 'pendente') {
    panel.append(h('div', { class: 'empty' }, h('h3', { text: t('join.sent') }), h('p', { text: t('join.sentLead', { langs: mine.langs.map(langName).join(', ') }) })));
    return panel;
  }
  if (!data.langs.length) { panel.append(h('div', { class: 'empty' }, h('p', { text: t('join.noLangs') }))); return panel; }
  const st = h('p', { class: 'status', role: 'status' });
  panel.append(h('div', { class: 'panel-body' },
    mine?.status === 'recusado' ? h('p', { class: 'status bad', text: t('join.rejected') }) : null,
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = e.target;
      const langs = [...f.querySelectorAll('input[name=lang]:checked')].map((i) => i.value);
      try { await api('POST', `/api/games/${encodeURIComponent(game.slug)}/requests`, { langs, level: f.level.value, note: f.note.value, contact: f.contact.value }); toast(t('join.sentToast')); await refresh(); }
      catch (err) { st.textContent = err.message; st.className = 'status bad'; }
    } },
      h('div', { class: 'field' }, h('span', { text: t('join.langs') }), h('div', { class: 'checks' }, data.langs.map((l) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'lang', value: l.lang }), langName(l.lang))))),
      h('label', { class: 'field' }, h('span', { text: t('join.level', { lang: langName(game.source_lang) }) }), h('select', { name: 'level' }, LEVELS.map((k) => h('option', { value: k, text: t(`level.${k}`) })))),
      h('label', { class: 'field' }, h('span', {}, `${t('join.about')} `, h('small', { text: t('join.aboutHint') })), h('textarea', { name: 'note', rows: 3, maxlength: 800 })),
      h('label', { class: 'field' }, h('span', {}, `${t('join.contact')} `, h('small', { text: t('join.contactHint') })), h('input', { type: 'text', name: 'contact', maxlength: 160 })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: t('join.send') }), st))));
  return panel;
}

async function tabActivity(body, data) {
  const { game } = data;
  const r = await api('GET', `/api/games/${encodeURIComponent(game.slug)}/activity`);
  const panel = (title, items, empty) => {
    const feed = h('div', { class: 'feed' });
    if (!items.length) feed.append(h('div', { class: 'empty' }, h('p', { text: empty })));
    feed.append(...items);
    return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: title })), feed);
  };
  const recent = r.recent.map((e) => h('div', { class: 'feed-item' }, avatar(e, 'avatar sm'),
    h('span', { text: t(`act.${e.status === 'revisada' || e.status === 'apagada' ? e.status : 'traduzida'}`, { who: who(e), idx: `${e.idx}`, label: e.label, lang: e.lang.toUpperCase() }) }),
    h('time', { datetime: e.created_at, text: ago(e.created_at) })));
  const top = r.top.map((p) => h('div', { class: 'feed-item' }, avatar(p, 'avatar sm'), h('span', {}, h('b', { text: who(p) }), ` · ${p.lang.toUpperCase()}`), h('span', { class: 'num muted', text: fmt(p.n) })));
  const events = r.events.map((e) => h('div', { class: 'feed-item' }, avatar(e, 'avatar sm'),
    h('span', { text: t(`kind.${e.kind}`, { who: who(e), lang: e.lang ? e.lang.toUpperCase() : '' }) }),
    h('time', { datetime: e.created_at, text: ago(e.created_at) })));
  body.replaceChildren(h('div', { class: 'split' }, panel(t('act.recent'), recent, t('act.noRecent')),
    h('div', { style: 'display:grid;gap:20px;min-width:0' }, panel(t('act.top'), top, t('act.noTop')), panel(t('act.project'), events, t('act.noEvents')))));
}

async function tabSettings(body, data) {
  const { game } = data;
  const slug = encodeURIComponent(game.slug);
  const lst = h('p', { class: 'status', role: 'status' });
  const langs = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('set.langs') })), h('div', { class: 'panel-body' },
    h('div', { class: 'chips' }, data.langs.length ? data.langs.map((l) => h('span', { class: 'chip' }, `${langName(l.lang)} · ${l.lang}`,
      h('button', { type: 'button', 'aria-label': `${t('team.remove')} ${l.lang}`, text: '×', onclick: (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('set.removeConfirm'); setTimeout(() => { b.textContent = '×'; delete b.dataset.armed; }, 3000); return; }
        api('DELETE', `/api/games/${slug}/langs/${encodeURIComponent(l.lang)}`).then(() => router()).catch((err) => toast(err.message));
      } }))) : h('span', { class: 'muted', text: t('set.noneYet') })),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', `/api/games/${slug}/langs`, { lang: e.target.lang.value.trim() }); toast(t('set.added')); router(); }
      catch (err) { lst.textContent = err.message; lst.className = 'status bad'; }
    } }, h('div', { class: 'row' }, h('input', { type: 'text', name: 'lang', class: 'grow', placeholder: t('set.langPh'), 'aria-label': t('set.langCode'), required: true }), h('button', { class: 'btn', type: 'submit', text: t('set.add') })), lst)));

  const ist = h('p', { class: 'status', role: 'status' });
  const file = h('input', { type: 'file', accept: '.tsv,.txt,text/tab-separated-values,text/plain', 'aria-label': t('set.file') });
  const imp = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('set.source') })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: t('set.sourceLead') }),
    file, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: t('set.import'), onclick: async () => {
      const f = file.files?.[0]; if (!f) { ist.textContent = t('set.pickFile'); ist.className = 'status bad'; return; }
      ist.textContent = t('set.importing'); ist.className = 'status';
      try { const r = await api('POST', `/api/games/${slug}/import`, await f.text(), true); ist.textContent = t('set.imported', { s: r.strings, b: r.blocks }); ist.className = 'status ok'; }
      catch (err) { ist.textContent = err.message; ist.className = 'status bad'; }
    } }), ist)));

  const exp = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('set.export') })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: t('set.exportLead') }),
    h('div', {}, h('a', { class: 'btn', href: `/api/games/${slug}/export`, download: `${game.slug}-traducoes.tsv`, text: t('set.download') }))));
  body.replaceChildren(h('div', { class: 'grid' }, langs, imp, exp));
}

// ---------------------------------------------------------------- editor
const SPLIT = /(\\n|\{[^}]*\})/;
const IS_TAG = /^\{[^}]*\}$/;
const toField = (s) => (s || '').replace(/\\n/g, '\n');
function sourceNode(text, sourceLang) {
  const box = h('div', { class: 'src', lang: sourceLang });
  for (const part of text.split(SPLIT)) {
    if (!part) continue;
    if (part === '\\n') box.append(h('span', { class: 'br', text: '↵' }), '\n');
    else if (IS_TAG.test(part)) box.append(h('span', { class: 'tok', text: part }));
    else box.append(part);
  }
  return box;
}
function missingTags(src, tr) {
  const want = (src.match(/\{[^}]*\}/g) || []), have = (tr.match(/\{[^}]*\}/g) || []);
  const out = [];
  for (const tag of want) { const i = have.indexOf(tag); if (i < 0) out.push(tag); else have.splice(i, 1); }
  return out;
}

async function viewEditor(route) {
  const slug = encodeURIComponent(route.slug);
  const [data, bl] = await Promise.all([api('GET', `/api/games/${slug}`), api('GET', `/api/games/${slug}/blocks?lang=${encodeURIComponent(route.lang)}`)]);
  const { game, access: a } = data;
  const L = data.langs.find((l) => l.lang === route.lang) || { lang: route.lang, done: 0, reviewed: 0 };
  const can = a.manage || !!a.langs[route.lang];
  const review = a.manage || a.langs[route.lang] === 'revisor';
  const blocks = bl.blocks;
  const currentId = route.block && blocks.some((b) => b.id === route.block) ? route.block : blocks[0]?.id;
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'lead' }, h('a', { class: 'eyebrow', href: `#/g/${game.slug}`, text: t('ed.back', { game: game.name }) }), h('h1', { text: langName(route.lang) }),
      h('div', { class: 'meta-row' }, h('span', { text: can ? (review ? t('ed.canReview') : t('ed.canTranslate')) : t('ed.readOnly') }),
        h('span', {}, h('span', { class: 'kbd', text: 'Ctrl' }), ' + ', h('span', { class: 'kbd', text: 'Enter' }), ` ${t('ed.shortcut')}`))),
    h('div', { style: 'min-width:240px;display:grid;gap:6px' }, h('div', { class: 'progress-cell', id: 'lang-progress' }, bar(data.total, L.done, L.reviewed), h('span', { class: 'pct', text: pctText(pct(L.done, data.total)) })),
      h('span', { class: 'small muted num', id: 'lang-count', text: t('ed.count', { d: L.done, t: data.total, r: L.reviewed }) })));

  const filterInput = h('input', { type: 'search', placeholder: t('ed.filterBlocks'), 'aria-label': t('ed.filterBlocks') });
  const blockList = h('div', { class: 'sidebar-list' });
  const sidebar = h('aside', { class: 'sidebar' }, h('div', { class: 'sidebar-head' }, filterInput), blockList);
  const workspace = h('section', { class: 'workspace' });
  app.replaceChildren(head, h('div', { class: 'editor' }, sidebar, workspace));
  if (!a.seeText) {
    workspace.append(h('div', { class: 'empty' }, h('h3', { text: S.me ? t('ed.teamOnly') : t('ed.signinToSee') }),
      h('p', { text: S.me ? t('ed.askTeam') : t('ed.restricted') }),
      S.me ? h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: t('ed.goTeam') }) : (S.auth.github ? loginButton() : null)));
  }

  const paintBlocks = () => {
    const f = filterInput.value.trim().toLowerCase();
    blockList.replaceChildren(...blocks.filter((b) => !f || b.label.toLowerCase().includes(f)).map((b) => h('button', {
      class: 'block', type: 'button', 'aria-current': b.id === currentId ? 'true' : 'false',
      onclick: () => { location.hash = `#/g/${game.slug}/t/${route.lang}/${b.id}`; },
    }, h('span', { class: 'lbl', text: b.label }), h('span', { class: 'cnt', text: `${fmt(b.done)}/${fmt(b.n)}` }), bar(b.n, b.done, b.reviewed, 'bar thin'))));
  };
  filterInput.addEventListener('input', paintBlocks);
  paintBlocks();
  blockList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  if (!a.seeText || !currentId) { if (a.seeText) workspace.append(h('div', { class: 'empty' }, h('p', { text: t('ed.noText') }))); return; }

  const blockInfo = blocks.find((b) => b.id === currentId);
  const { strings } = await api('GET', `/api/games/${slug}/blocks/${currentId}?lang=${encodeURIComponent(route.lang)}`);
  let mode = 'todas', search = '';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('ed.show') });
  for (const [k, label] of [['todas', t('ed.all')], ['faltando', t('ed.missing')], ['revisar', t('ed.toReview')]]) {
    seg.append(h('button', { type: 'button', 'aria-pressed': k === mode ? 'true' : 'false', text: label, onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false')); applyFilter(); } }));
  }
  const searchBox = h('input', { type: 'search', class: 'grow', placeholder: t('ed.search'), 'aria-label': t('ed.search') });
  searchBox.addEventListener('input', () => { search = searchBox.value.trim().toLowerCase(); applyFilter(); });
  const list = h('div');
  workspace.append(h('div', { class: 'toolbar' }, h('h2', { class: 'mono', text: blockInfo.label }), seg, searchBox), list);

  const rows = new Map();
  const updateBlockCount = () => {
    blockInfo.done = [...rows.values()].filter((r) => r.s.text).length;
    blockInfo.reviewed = [...rows.values()].filter((r) => r.s.status === 'revisada').length;
    paintBlocks();
  };

  for (const s of strings) {
    const row = { s, dirty: false };
    const field = can ? h('textarea', { rows: Math.min(8, 2 + (s.source.match(/\\n/g) || []).length), 'aria-label': t('ed.fieldLabel', { n: `${s.idx}` }), spellcheck: 'true', lang: route.lang }) : h('div', { class: 'readonly', lang: route.lang });
    const foot = h('div', { class: 'str-foot' });
    const node = h('div', { class: 'str' }, h('div', { class: 'str-key' }, h('span', { text: `#${s.idx}` })), sourceNode(s.source, game.source_lang), h('div', { class: 'tr-col' }, field, foot));
    Object.assign(row, { field, foot, node });
    if (can) {
      field.addEventListener('focus', () => node.classList.add('active'));
      field.addEventListener('blur', () => { node.classList.remove('active'); if (row.dirty) save(row); });
      field.addEventListener('input', () => { row.dirty = true; paintFoot(row); });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (row.dirty) save(row);
          [...rows.values()].find((r) => r.s.idx > s.idx && !r.node.hidden)?.field.focus();
        }
      });
    }
    rows.set(s.id, row);
    list.append(node);
    paintValue(row); paintFoot(row);
  }
  applyFilter();

  function paintValue(row) {
    if (can) { if (!row.dirty && document.activeElement !== row.field) row.field.value = toField(row.s.text); }
    else row.field.textContent = row.s.text ? toField(row.s.text) : t('dash');
  }
  function paintFoot(row) {
    const s = row.s;
    const value = can ? row.field.value : toField(s.text);
    const miss = value ? missingTags(s.source, value.replace(/\n/g, '\\n')) : [];
    const left = h('span', { class: 'by' });
    if (row.saving) left.append(t('ed.saving'));
    else if (row.error) left.append(h('span', { style: 'color:var(--bad)', text: row.error }), row.conflict ? h('button', { class: 'btn ghost sm', type: 'button', text: t('ed.keepMine'), onclick: () => save(row, true) }) : null);
    else if (row.dirty) left.append(t('ed.unsaved'));
    else if (s.text) left.append(avatar(s.by, 'avatar sm'), `${who(s.by)} · ${ago(s.updated_at)}`);
    const acts = h('span', { class: 'acts' });
    if (miss.length) acts.append(h('span', { class: 'chip warn', text: t('ed.missingTags', { tags: miss.join(' ') }) }));
    if (s.status === 'revisada') acts.append(h('span', { class: 'chip good', text: t('ed.reviewed') }));
    if (review && s.text && !row.dirty) acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: s.status === 'revisada' ? t('ed.unreview') : t('ed.approve'), onclick: () => setReview(row, s.status !== 'revisada') }));
    if (s.text) acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: t('ed.history'), onclick: () => toggleHistory(row) }));
    row.foot.replaceChildren(left, acts);
  }
  function applyFilter() {
    for (const row of rows.values()) {
      const s = row.s, text = toField(s.text).toLowerCase();
      let hide = mode === 'faltando' ? !!s.text && document.activeElement !== row.field : mode === 'revisar' ? !(s.text && s.status !== 'revisada') : false;
      if (search && !s.source.toLowerCase().includes(search) && !text.includes(search)) hide = true;
      row.node.hidden = hide;
    }
  }
  async function save(row, force = false) {
    row.dirty = false; row.saving = true; row.error = null; row.conflict = false; paintFoot(row);
    const text = row.field.value;
    try {
      const r = await api('PUT', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}`, force ? { text } : { text, base: row.s.updated_at || null });
      Object.assign(row.s, { text: r.text, status: r.status, updated_at: r.updated_at, by: r.by });
    } catch (e) {
      row.dirty = true; row.error = e.message; row.conflict = e.status === 409;
    } finally { row.saving = false; paintFoot(row); updateBlockCount(); }
  }
  async function setReview(row, approved) {
    try { const r = await api('POST', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/review`, { approved }); row.s.status = r.status; paintFoot(row); updateBlockCount(); }
    catch (e) { toast(e.message); }
  }
  async function toggleHistory(row) {
    const open = row.node.querySelector('.history');
    if (open) { open.remove(); return; }
    const box = h('div', { class: 'history' }, h('span', { class: 'muted small', text: t('ed.loading') }));
    row.node.append(box);
    try {
      const { history } = await api('GET', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/history`);
      if (!history.length) { box.replaceChildren(h('span', { class: 'muted small', text: t('ed.noHistory') })); return; }
      box.replaceChildren(...history.map((x) => h('div', { class: 'history-item' }, avatar(x, 'avatar sm'),
        h('div', {}, h('div', { class: 'small muted', text: `${who(x)} · ${t(`status.${x.status}`)}` }), h('div', { class: 't', lang: route.lang, text: x.text ? toField(x.text) : t('ed.deleted') })),
        h('time', { class: 'small muted', datetime: x.created_at, text: ago(x.created_at) }))));
    } catch (e) { box.replaceChildren(h('span', { class: 'status bad', text: e.message })); }
  }

  const refreshLangProgress = debounce(async () => {
    try {
      const d = await api('GET', `/api/games/${slug}`);
      const l = d.langs.find((x) => x.lang === route.lang); if (!l) return;
      $('#lang-progress')?.replaceChildren(bar(d.total, l.done, l.reviewed), h('span', { class: 'pct', text: pctText(pct(l.done, d.total)) }));
      const c = $('#lang-count'); if (c) c.textContent = t('ed.count', { d: l.done, t: d.total, r: l.reviewed });
    } catch { /* keep the last numbers */ }
  }, 800);
  useStream(game.slug, async (ev) => {
    if (ev.type === 'translation' && ev.lang === route.lang && rows.has(ev.id)) {
      const row = rows.get(ev.id);
      const mine = ev.by && S.me && ev.by.login === S.me.login;
      Object.assign(row.s, { text: ev.text, status: ev.status, updated_at: ev.updated_at || row.s.updated_at, ...(ev.by ? { by: ev.by } : {}) });
      if (row.dirty && !mine && ev.by) row.error = t('ed.changedBy', { who: who(ev.by) });
      paintValue(row); paintFoot(row); updateBlockCount();
    }
    if (ev.type === 'progress') refreshLangProgress();
  });
  S.cleanup.push(() => { for (const row of rows.values()) if (row.dirty && can) save(row); });
}

// ---------------------------------------------------------------- admin
async function viewAdmin() {
  if (!S.me?.is_admin) { app.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: t('adm.only') }), h('a', { class: 'btn', href: '#/', text: t('adm.back') }))); return; }
  const { users, pending } = await api('GET', '/api/admin/users');
  const pend = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('adm.pending') }), h('span', { class: 'muted small num', text: fmt(pending.length) })));
  const pf = h('div', { class: 'feed' });
  if (!pending.length) pf.append(h('div', { class: 'empty' }, h('p', { text: t('adm.noPending') })));
  for (const r of pending) pf.append(h('div', { class: 'feed-item' }, avatar(r, 'avatar sm'),
    h('span', {}, `${t('adm.wants', { who: who(r), langs: r.langs.map((l) => l.toUpperCase()).join(', ') })} `, h('a', { href: `#/g/${r.slug}/equipe`, text: r.game })),
    h('time', { datetime: r.created_at, text: ago(r.created_at) })));
  pend.append(pf);
  const tb = h('tbody');
  for (const u of users) {
    tb.append(h('tr', {},
      h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, avatar(u), h('div', {}, h('div', { text: who(u) }), h('div', { class: 'small muted mono', text: `@${u.login}` })))),
      h('td', {}, h('div', { class: 'chips' }, u.memberships.length ? u.memberships.map((m) => h('span', { class: 'chip', text: `${m.game} · ${m.lang === '*' ? t('adm.coord') : `${m.lang.toUpperCase()} ${roleLabel(m.role)}`}` })) : h('span', { class: 'muted small', text: t('dash') }))),
      h('td', { class: 'num muted', text: fmt(u.edits) }),
      h('td', { class: 'small muted', text: ago(u.last_seen) }),
      h('td', { style: 'text-align:right' }, h('div', { class: 'row', style: 'justify-content:flex-end;flex-wrap:nowrap' },
        u.id === S.me.id ? h('span', { class: 'chip accent', text: t('adm.you') }) :
          h('button', { class: `btn sm ${u.is_admin ? '' : 'ghost'}`, type: 'button', text: u.is_admin ? t('adm.isAdmin') : t('adm.makeAdmin'), onclick: async () => {
            try { await api('PUT', `/api/admin/users/${u.id}`, { is_admin: !u.is_admin }); viewAdmin(); } catch (e) { toast(e.message); }
          } }),
        u.id === S.me.id ? null : h('button', { class: 'btn ghost sm danger', type: 'button', text: t('adm.signOut'), onclick: async () => { try { await api('DELETE', `/api/admin/users/${u.id}/sessions`); toast(t('adm.signedOut')); } catch (e) { toast(e.message); } } })))));
  }
  const people = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('adm.people') }), h('span', { class: 'muted small num', text: fmt(users.length) })),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: t('adm.col.person') }), h('th', { text: t('adm.col.projects') }), h('th', { text: t('adm.col.edits') }), h('th', { text: t('adm.col.seen') }), h('th', {}))), tb)));
  app.replaceChildren(h('div', { class: 'page-head' }, h('div', { class: 'lead' }, h('h1', { text: t('adm.title') }), h('p', { class: 'muted', text: t('adm.lead') }))), pend, people);
}

// ---------------------------------------------------------------- boot
(async () => {
  try { const r = await api('GET', '/api/me'); S.me = r.user; S.auth = { github: r.github, dev: r.dev }; } catch { /* signed out */ }
  router();
})();
