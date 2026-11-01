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
  // replaceChildren() would print a null as the text "null", so leave it out instead
  $('#nav').replaceChildren(...[
    h('a', { href: '#/', 'aria-current': route.name === 'home' ? 'page' : null, text: t('nav.projects') }),
    S.me?.is_admin ? h('a', { href: '#/admin', 'aria-current': route.name === 'admin' ? 'page' : null, text: t('nav.admin') }) : null].filter(Boolean));
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
    if (parts[2] === 't' && parts[3]) {
      // #/g/<slug>/t/<lang>[/<block>[/<string>]] or #/g/<slug>/t/<lang>/busca/<term>
      const r = { name: 'editor', slug: parts[1], lang: parts[3], block: null, focus: null, search: null };
      if (parts[4] === 'busca') r.search = parts[5] || '';
      else if (parts[4]) { r.block = +parts[4]; r.focus = parts[5] ? +parts[5] : null; }
      return r;
    }
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
  else if (S.me && !a.manage && !a.member) extra.push(h('div', { class: 'notice' }, h('p', { text: t('langs.joinNotice') }), h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: t('langs.join') })));
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

  const cst = h('p', { class: 'status', role: 'status' });
  const cfile = h('input', { type: 'file', accept: '.tsv,.txt,text/tab-separated-values,text/plain', 'aria-label': t('set.file') });
  const catPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('set.categories') })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: t('set.categoriesLead') }),
    cfile, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: t('set.import'), onclick: async () => {
      const f = cfile.files?.[0]; if (!f) { cst.textContent = t('set.pickFile'); cst.className = 'status bad'; return; }
      cst.textContent = t('set.importing'); cst.className = 'status';
      try { const r = await api('PUT', `/api/games/${slug}/categories`, await f.text(), true); cst.textContent = t('set.categoriesImported', { n: r.scenes, c: r.categories, k: r.known }); cst.className = 'status ok'; }
      catch (err) { cst.textContent = err.message; cst.className = 'status bad'; }
    } }), cst)));

  const exp = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('set.export') })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: t('set.exportLead') }),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: `/api/games/${slug}/export`, download: `${game.slug}-traducoes.tsv`, text: t('set.downloadAll') }),
      h('a', { class: 'btn', href: `/api/games/${slug}/export?only=revisadas`, download: `${game.slug}-traducoes-revisadas.tsv`, text: t('set.downloadReviewed') }))));
  body.replaceChildren(h('div', { class: 'grid' }, langs, imp, catPanel, exp, await aiPanel(data)));
}

// Machine translation (Gemini): the coordination's key, model and instructions, plus a run over the
// empty strings of one language. Results are saved as "Gemini", unreviewed.
// The run's HTTP answer can arrive after the live updates of a short job: never paint an older state.
function aiNewer(prev, next) {
  if (!prev) return true;
  if (next.started_at !== prev.started_at) return next.started_at > prev.started_at;
  if (prev.status !== 'rodando') return false; // a finished run does not change any more
  return next.status !== 'rodando' || next.done >= prev.done;
}
function aiStatusText(job) {
  if (!job) return '';
  const v = { done: fmt(job.done), total: fmt(job.total), w: fmt(job.written), r: fmt(job.rejected), err: job.error || '' };
  return t(`ai.st.${job.status}`, v);
}
async function aiPanel(data) {
  const { game } = data;
  const slug = encodeURIComponent(game.slug);
  const cfg = await api('GET', `/api/games/${slug}/ai`);
  const sst = h('p', { class: 'status', role: 'status' });
  const keyInput = h('input', { type: 'password', name: 'key', autocomplete: 'off', 'aria-label': t('ai.key') });
  const paintKey = (has, tail) => { keyInput.value = ''; keyInput.placeholder = has ? t('ai.keySaved', { tail }) : t('ai.keyPh'); };
  paintKey(cfg.has_key, cfg.key_tail);
  const model = h('input', { type: 'text', value: cfg.model, 'aria-label': t('ai.model'), spellcheck: 'false' });
  const prompt = h('textarea', { rows: 9, 'aria-label': t('ai.prompt') }); prompt.value = cfg.prompt;
  const save = async (extra = {}) => {
    try {
      const r = await api('PUT', `/api/games/${slug}/ai`, { api_key: keyInput.value.trim(), model: model.value.trim(), prompt: prompt.value, ...extra });
      paintKey(r.has_key, r.key_tail); cfg.has_key = r.has_key; sst.textContent = t('ai.saved'); sst.className = 'status ok';
    } catch (err) { sst.textContent = err.message; sst.className = 'status bad'; }
  };

  const rst = h('p', { class: 'status', role: 'status' });
  const problems = h('ul', { class: 'small muted ai-problems' });
  const langSel = h('select', { 'aria-label': t('ai.lang') }, data.langs.map((l) => h('option', { value: l.lang, text: `${langName(l.lang)} · ${l.lang}` })));
  const limit = h('input', { type: 'number', min: '0', step: '10', value: '50', 'aria-label': t('ai.limit'), style: 'width:110px' });
  const runBtn = h('button', { class: 'btn primary', type: 'button', text: t('ai.run'), onclick: async () => {
    try { paintJob((await api('POST', `/api/games/${slug}/ai/run`, { lang: langSel.value, limit: +limit.value || 0 })).job); }
    catch (err) { rst.textContent = err.message; rst.className = 'status bad'; }
  } });
  const stopBtn = h('button', { class: 'btn', type: 'button', text: t('ai.stop'), onclick: () => api('POST', `/api/games/${slug}/ai/stop`).catch((err) => toast(err.message)) });
  let shown = null;
  function paintJob(job) {
    if (job && !aiNewer(shown, job)) return;
    job = shown = job || shown;
    const running = job?.status === 'rodando';
    runBtn.disabled = running || !data.langs.length; stopBtn.hidden = !running;
    rst.textContent = job ? `${job.lang.toUpperCase()} · ${aiStatusText(job)}` : ''; rst.className = `status${job?.status === 'erro' ? ' bad' : job?.status === 'concluido' ? ' ok' : ''}`;
    problems.replaceChildren(...(job?.problems || []).map((p) => h('li', { text: p })));
  }
  paintJob(cfg.job);
  useStream(game.slug, (ev) => { if (ev.type === 'ai' && rst.isConnected) paintJob(ev.job); });

  return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('ai.title') })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: t('ai.lead') }),
    h('label', { class: 'field' }, h('span', { text: t('ai.key') }), keyInput,
      h('small', {}, t('ai.keyHint'), ' ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', text: 'aistudio.google.com/apikey' }))),
    h('label', { class: 'field' }, h('span', { text: t('ai.model') }), model),
    h('label', { class: 'field' }, h('span', { text: t('ai.prompt') }), prompt, h('small', { text: t('ai.promptHint') })),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: t('ai.save'), onclick: () => save() }),
      h('button', { class: 'btn ghost', type: 'button', text: t('ai.resetPrompt'), onclick: () => { prompt.value = cfg.default_prompt; model.value = cfg.default_model; } }),
      cfg.has_key ? h('button', { class: 'btn ghost', type: 'button', text: t('ai.clearKey'), onclick: () => save({ clear_key: true }) }) : null),
    sst,
    h('div', { class: 'row' }, langSel, h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small muted', text: t('ai.limit') }), limit), runBtn, stopBtn),
    h('p', { class: 'small muted', text: t('ai.runHint') }),
    rst, problems));
}

// ---------------------------------------------------------------- editor
const SPLIT = /(\\n|\{[^}]*\})/;
const IS_TAG = /^\{[^}]*\}$/;
const toField = (s) => (s || '').replace(/\\n/g, '\n');
// Codes the encoder understands (tools/textscan.py CONTROL), plus raw {XXXX} codes and {?n} glyphs.
const COLORS = ['preto', 'vermelho', 'verde', 'azul', 'amarelo', 'rosa', 'laranja', 'branco'];
const KNOWN_TAGS = new Set(['{PAG}', '{NOME}', '{VAR}', '{VAR2}', '{FONTE1}', '{FONTE2}', '{X8021}', '{COR}', '{CONTORNO}', '{CONTORNO:off}',
  '{CONTORNO:2}', '{CONTORNO:3}', '{ONDA}', '{ONDA:off}', '{ESP:1/2}', '{ESP:1/4}', '{ESP:1}',
  ...['1', '0.8', '1.5', '0.6', '2'].map((v) => `{TAM:${v}}`), ...COLORS.map((c) => `{COR:${c}}`)]);
const isKnownTag = (tag) => KNOWN_TAGS.has(tag) || /^\{[0-9A-Fa-f]{4}\}$/.test(tag) || /^\{\?\d+\}$/.test(tag);
const ALIASES = { page: '{PAG}', pag: '{PAG}', name: '{NOME}', nome: '{NOME}', color: '{COR}', colour: '{COR}', cor: '{COR}', outline: '{CONTORNO}', wave: '{ONDA}', onda: '{ONDA}' };
function suggestTag(tag) {
  const up = tag.toUpperCase().replace(/:(.*)\}$/, (m, v) => `:${/^(OFF|[A-ZÇÃÁÉ]+)$/.test(v) ? v.toLowerCase() : v}}`);
  if (isKnownTag(up)) return up;
  const bare = tag.slice(1, -1).toLowerCase().split(':')[0];
  return ALIASES[bare] || null;
}
function tagInfo(tag) {
  const [name, v] = tag.slice(1, -1).split(':');
  if (name === 'TAM') return v === '1' ? t('tag.TAM1') : t('tag.TAM', { v });
  if (name === 'COR') return v ? t('tag.COR', { v }) : t('tag.CORreset');
  if (name === 'CONTORNO') return v === 'off' ? t('tag.CONTORNOoff') : t('tag.CONTORNO');
  if (name === 'ONDA') return v === 'off' ? t('tag.ONDAoff') : t('tag.ONDA');
  if (name === 'ESP') return t('tag.ESP', { v });
  if (name === 'FONTE1' || name === 'FONTE2') return t('tag.FONTE');
  if (['PAG', 'NOME', 'VAR', 'VAR2'].includes(name)) return t(`tag.${name}`);
  return t('tag.raw');
}
// Insert text at the cursor of a textarea and let the row react as if the person had typed it.
function insertAt(field, text) {
  field.focus();
  const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
  field.setRangeText(text, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function sourceNode(text, sourceLang, field) {
  const box = h('div', { class: 'src', lang: sourceLang });
  for (const part of text.split(SPLIT)) {
    if (!part) continue;
    if (part === '\\n') {
      box.append(field ? h('button', { class: 'br', type: 'button', text: '↵', title: `${t('tag.newline')} · ${t('tag.clickToInsert')}`, 'aria-label': t('tag.newline'), onmousedown: (e) => e.preventDefault(), onclick: () => insertAt(field, '\n') })
        : h('span', { class: 'br', text: '↵', title: t('tag.newline') }), '\n');
    } else if (IS_TAG.test(part)) {
      const info = tagInfo(part);
      box.append(field ? h('button', { class: 'tok', type: 'button', text: part, title: `${info} · ${t('tag.clickToInsert')}`, 'aria-label': `${part}: ${info}`, onmousedown: (e) => e.preventDefault(), onclick: () => insertAt(field, part) })
        : h('span', { class: 'tok', text: part, title: info }));
    } else box.append(part);
  }
  return box;
}
function missingTags(src, tr) {
  const want = (src.match(/\{[^}]*\}/g) || []), have = (tr.match(/\{[^}]*\}/g) || []);
  const out = [];
  for (const tag of want) { const i = have.indexOf(tag); if (i < 0) out.push(tag); else have.splice(i, 1); }
  return out;
}
const unknownTags = (tr) => [...new Set((tr.match(/\{[^}]*\}/g) || []).filter((tag) => !isKnownTag(tag)))];
function codesPanel() {
  const rows = ['{PAG}', '{NOME}', '{VAR}', '{TAM:2}', '{TAM:1}', '{COR:vermelho}', '{COR}', '{CONTORNO}', '{CONTORNO:off}', '{ONDA}', '{ONDA:off}', '{ESP:1/2}']
    .map((tag) => h('div', { class: 'code-row' }, h('span', { class: 'tok', text: tag }), h('span', { text: tagInfo(tag) })));
  return h('div', { class: 'codes-panel' }, h('p', { text: t('ed.codesLead') }),
    h('div', { class: 'code-row' }, h('span', { class: 'br', text: '↵' }), h('span', { text: t('tag.newline') })), rows,
    h('p', { class: 'muted small', text: t('ed.codesPairs') }));
}

async function viewEditor(route) {
  const slug = encodeURIComponent(route.slug);
  const [data, bl] = await Promise.all([api('GET', `/api/games/${slug}`), api('GET', `/api/games/${slug}/blocks?lang=${encodeURIComponent(route.lang)}`)]);
  const { game, access: a } = data;
  const L = data.langs.find((l) => l.lang === route.lang) || { lang: route.lang, done: 0, reviewed: 0 };
  const can = a.manage || !!a.langs[route.lang];
  const review = a.manage || a.langs[route.lang] === 'revisor';
  const blocks = bl.blocks;
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const searching = route.search !== null;
  const currentId = searching ? null : route.block && blockById.has(route.block) ? route.block : blocks[0]?.id;
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'lead' }, h('a', { class: 'eyebrow', href: `#/g/${game.slug}`, text: t('ed.back', { game: game.name }) }), h('h1', { text: langName(route.lang) }),
      h('div', { class: 'meta-row' }, h('span', { text: can ? (review ? t('ed.canReview') : t('ed.canTranslate')) : t('ed.readOnly') }),
        can ? h('span', {}, h('span', { class: 'kbd', text: 'Ctrl' }), ' + ', h('span', { class: 'kbd', text: 'Enter' }), ` ${t('ed.shortcut')}`) : null)),
    h('div', { style: 'min-width:240px;display:grid;gap:6px' }, h('div', { class: 'progress-cell', id: 'lang-progress' }, bar(data.total, L.done, L.reviewed), h('span', { class: 'pct', text: pctText(pct(L.done, data.total)) })),
      h('span', { class: 'small muted num', id: 'lang-count', text: t('ed.count', { d: L.done, t: data.total, r: L.reviewed }) })));

  const filterInput = h('input', { type: 'search', placeholder: t('ed.filterBlocks'), 'aria-label': t('ed.filterBlocks') });
  const blockList = h('div', { class: 'sidebar-list' });
  const globalInput = h('input', { type: 'search', value: route.search || '', placeholder: t('ed.globalSearch'), 'aria-label': t('ed.globalSearch') });
  const globalForm = h('form', { role: 'search', onsubmit: (e) => {
    e.preventDefault();
    const term = globalInput.value.trim();
    location.hash = term ? `#/g/${game.slug}/t/${route.lang}/busca/${encodeURIComponent(term)}` : `#/g/${game.slug}/t/${route.lang}`;
  } }, globalInput);
  // categories (optional, per scene): a filter plus group headers in the list
  const cats = bl.categories || [];
  const NONE = '-';
  const catOf = (b) => b.category || NONE;
  const catName = (c) => (c === NONE ? t('ed.noCategory') : c);
  const catKey = `glifo.cat.${route.slug}`;
  let category = '';
  try { category = sessionStorage.getItem(catKey) || ''; } catch { /* storage may be blocked */ }
  const catList = [...cats, ...(blocks.some((b) => !b.category) ? [NONE] : [])];
  if (!catList.includes(category)) category = '';
  const catTotals = (c) => blocks.filter((b) => catOf(b) === c).reduce((a, b) => ({ n: a.n + b.n, done: a.done + b.done }), { n: 0, done: 0 });
  const catOptions = new Map(catList.map((c) => [c, h('option', { value: c, selected: c === category })]));
  const catSelect = cats.length ? h('select', { 'aria-label': t('ed.category'), onchange: (e) => {
    category = e.target.value;
    try { sessionStorage.setItem(catKey, category); } catch { /* storage may be blocked */ }
    paintBlocks();
  } }, h('option', { value: '', text: t('ed.allCategories'), selected: !category }), [...catOptions.values()]) : null;
  const sidebar = h('aside', { class: 'sidebar' }, h('div', { class: 'sidebar-head' }, globalForm, catSelect, filterInput), blockList);
  const workspace = h('section', { class: 'workspace' });
  app.replaceChildren(head, h('div', { class: 'editor' }, sidebar, workspace));
  // anyone can read; people without permission get an invitation to help instead of edit controls
  if (!can) {
    workspace.append(h('div', { class: 'notice' }, h('p', { text: S.me ? t('ed.askTeam') : t('ed.signinToHelp') }),
      S.me ? h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: t('ed.goTeam') }) : (S.auth.github ? loginButton() : null)));
  }

  const paintBlocks = () => {
    const f = filterInput.value.trim().toLowerCase();
    for (const [c, opt] of catOptions) { const s = catTotals(c); opt.textContent = `${catName(c)} · ${pctText(pct(s.done, s.n))}`; }
    let shown = blocks.filter((b) => (!f || b.label.toLowerCase().includes(f) || b.category.toLowerCase().includes(f)) && (!category || catOf(b) === category));
    // with every category on screen, group the blocks under a header per category (file order)
    const grouped = cats.length && !category;
    if (grouped) shown = catList.flatMap((c) => shown.filter((b) => catOf(b) === c));
    const items = [];
    let last = null;
    for (const b of shown) {
      if (grouped && catOf(b) !== last) {
        last = catOf(b);
        const s = catTotals(last);
        items.push(h('div', { class: 'cat-head' }, h('span', { text: catName(last) }), h('span', { class: 'cnt', text: pctText(pct(s.done, s.n)) })));
      }
      items.push(h('button', {
        class: 'block', type: 'button', 'aria-current': b.id === currentId ? 'true' : 'false',
        onclick: () => { location.hash = `#/g/${game.slug}/t/${route.lang}/${b.id}`; },
      }, h('span', { class: 'lbl', text: b.label }), h('span', { class: 'cnt', text: `${fmt(b.done)}/${fmt(b.n)}` }), bar(b.n, b.done, b.reviewed, 'bar thin')));
    }
    blockList.replaceChildren(...items);
  };
  filterInput.addEventListener('input', paintBlocks);
  paintBlocks();
  blockList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  if (!blocks.length) { workspace.append(h('div', { class: 'empty' }, h('p', { text: t('ed.noText') }))); return; }

  let strings, title, summary = null;
  if (searching) {
    const r = route.search ? await api('GET', `/api/games/${slug}/search?lang=${encodeURIComponent(route.lang)}&q=${encodeURIComponent(route.search)}`) : { strings: [], truncated: false };
    strings = r.strings;
    title = t('ed.searchTitle', { q: route.search });
    summary = h('p', { class: 'muted small search-summary', role: 'status',
      text: !strings.length ? t('ed.searchNone') : r.truncated ? t('ed.searchTruncated', { n: strings.length }) : t('ed.searchCount', { n: strings.length }) });
  } else {
    strings = (await api('GET', `/api/games/${slug}/blocks/${currentId}?lang=${encodeURIComponent(route.lang)}`)).strings;
    title = blockById.get(currentId).label;
  }
  let mode = 'todas', search = '';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('ed.show') });
  for (const [k, label] of [['todas', t('ed.all')], ['faltando', t('ed.missing')], ['revisar', t('ed.toReview')]]) {
    seg.append(h('button', { type: 'button', 'aria-pressed': k === mode ? 'true' : 'false', text: label, onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false')); applyFilter(); } }));
  }
  const searchBox = h('input', { type: 'search', class: 'grow', placeholder: t('ed.search'), 'aria-label': t('ed.search') });
  searchBox.addEventListener('input', () => { search = searchBox.value.trim().toLowerCase(); applyFilter(); });
  const list = h('div');
  const codes = codesPanel(); codes.hidden = true;
  const codesBtn = h('button', { class: 'btn sm', type: 'button', 'aria-expanded': 'false', text: t('ed.codes'), onclick: () => {
    codes.hidden = !codes.hidden; codesBtn.setAttribute('aria-expanded', codes.hidden ? 'false' : 'true');
  } });
  // coordination with a Gemini key: translate this block's empty strings in one click
  const aiState = h('span', { class: 'small muted', role: 'status' });
  const aiBtn = data.ai?.ready && !searching ? h('button', { class: 'btn sm', type: 'button', title: t('ai.blockHint'), text: t('ai.block'), onclick: async () => {
    try { paintAi((await api('POST', `/api/games/${slug}/ai/run`, { lang: route.lang, block_id: currentId, limit: 0 })).job); } catch (err) { toast(err.message); }
  } }) : null;
  let aiShown = null;
  const paintAi = (job) => {
    if (!aiBtn || (job && !aiNewer(aiShown, job))) return;
    job = aiShown = job || aiShown;
    aiBtn.disabled = job?.status === 'rodando';
    aiState.textContent = job && job.lang === route.lang && (job.status === 'rodando' || job.block_id === currentId) ? aiStatusText(job) : '';
  };
  paintAi(data.ai?.job);
  workspace.append(h('div', { class: 'toolbar' }, h('h2', { class: searching ? '' : 'mono', text: title }), seg, searchBox, codesBtn, aiBtn, aiBtn ? aiState : null), ...[summary, codes, list].filter(Boolean));

  const rows = new Map();
  // Apply a change to a string and move the sidebar counters of its block by the difference
  // (search results come from many blocks, so counting the visible rows is not enough).
  const counted = (s) => [s.text ? 1 : 0, s.status === 'revisada' ? 1 : 0];
  const change = (row, fn) => {
    const [d0, r0] = counted(row.s); fn(); const [d1, r1] = counted(row.s);
    const b = blockById.get(row.s.block_id);
    if (b && (d0 !== d1 || r0 !== r1)) { b.done += d1 - d0; b.reviewed += r1 - r0; paintBlocks(); }
  };

  for (const s of strings) {
    const row = { s, dirty: false };
    const field = can ? h('textarea', { rows: Math.min(8, 2 + (s.source.match(/\\n/g) || []).length), 'aria-label': t('ed.fieldLabel', { n: `${s.idx}` }), spellcheck: 'true', lang: route.lang }) : h('div', { class: 'readonly', lang: route.lang });
    const foot = h('div', { class: 'str-foot' });
    const key = h('div', { class: 'str-key' }, h('span', { text: `#${s.idx}` }),
      searching ? h('a', { href: `#/g/${game.slug}/t/${route.lang}/${s.block_id}/${s.id}`, text: blockById.get(s.block_id)?.label || '' }) : null,
      s.copies ? h('a', { class: 'copies', href: `#/g/${game.slug}/t/${route.lang}/busca/${encodeURIComponent(s.source)}`, title: t('ed.copiesHint'), text: t('ed.copies', { n: s.copies }) }) : null);
    const node = h('div', { class: 'str' }, key, sourceNode(s.source, game.source_lang, can ? field : null), h('div', { class: 'tr-col' }, field, foot));
    Object.assign(row, { field, foot, node });
    if (can) {
      field.addEventListener('focus', () => { node.classList.add('active'); showSuggestions(row); });
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
  const target = route.focus && rows.get(route.focus);
  if (target) {
    target.node.scrollIntoView({ block: 'center' });
    if (can) target.field.focus({ preventScroll: true });
    else { target.node.classList.add('active'); setTimeout(() => target.node.classList.remove('active'), 2000); }
  }

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
    else if (row.error) left.append(h('span', { style: 'color:var(--bad)', text: row.error }), ...(row.conflict ? [h('button', { class: 'btn ghost sm', type: 'button', text: t('ed.keepMine'), onclick: () => save(row, true) })] : []));
    else if (row.dirty) left.append(t('ed.unsaved'));
    else if (s.text) left.append(avatar(s.by, 'avatar sm'), `${who(s.by)} · ${ago(s.updated_at)}`);
    const acts = h('span', { class: 'acts' });
    for (const tag of miss) {
      acts.append(can
        ? h('button', { class: 'chip warn', type: 'button', title: `${tagInfo(tag)} · ${t('tag.clickToInsert')}`, text: t('ed.missingTags', { tags: tag }), onmousedown: (e) => e.preventDefault(), onclick: () => insertAt(row.field, tag) })
        : h('span', { class: 'chip warn', text: t('ed.missingTags', { tags: tag }) }));
    }
    for (const tag of value ? unknownTags(value) : []) {
      const fix = suggestTag(tag);
      acts.append(can && fix
        ? h('button', { class: 'chip bad', type: 'button', title: tagInfo(fix), text: `${t('ed.unknownTag', { tag })} · ${t('ed.useTag', { tag: fix })}`, onmousedown: (e) => e.preventDefault(), onclick: () => {
          row.field.value = row.field.value.split(tag).join(fix);
          row.field.dispatchEvent(new Event('input', { bubbles: true }));
          row.field.focus();
        } })
        : h('span', { class: 'chip bad', text: t('ed.unknownTag', { tag }) }));
    }
    if (can && row.differ && s.text && !row.dirty) {
      acts.append(h('button', { class: 'chip warn', type: 'button', title: t('ed.applyAllHint'), text: `${t('ed.differ', { n: row.differ })} · ${t('ed.applyAll')}`, onclick: () => applyToCopies(row) }));
    }
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
      change(row, () => Object.assign(row.s, { text: r.text, status: r.status, updated_at: r.updated_at, by: r.by }));
      row.differ = r.differ || 0;
      if (r.filled) toast(t('ed.filled', { n: r.filled }));
    } catch (e) {
      row.dirty = true; row.error = e.message; row.conflict = e.status === 409;
    } finally { row.saving = false; paintFoot(row); }
  }
  async function setReview(row, approved) {
    try { const r = await api('POST', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/review`, { approved }); change(row, () => { row.s.status = r.status; }); paintFoot(row); }
    catch (e) { toast(e.message); }
  }
  async function applyToCopies(row) {
    try {
      const r = await api('POST', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/copies`);
      row.differ = 0; paintFoot(row);
      toast(t('ed.applied', { n: r.written }));
    } catch (e) { toast(e.message); }
  }
  // Translations already made for similar sources, under the string being edited.
  let suggesting = null;
  async function showSuggestions(row) {
    if (suggesting === row) return;
    suggesting?.suggest?.remove();
    suggesting = row;
    if (!row.similar) {
      try { row.similar = (await api('GET', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/similar`)).similar; } catch { row.similar = []; }
    }
    const items = row.similar.filter((x) => x.text !== row.s.text);
    if (suggesting !== row || !items.length) return;
    row.suggest = h('div', { class: 'suggest' }, h('div', { class: 'small muted', text: t('ed.similar') }),
      items.map((x) => h('div', { class: 'suggest-item' },
        h('span', { class: `chip ${x.score === 1 ? 'accent' : ''}`, title: t('ed.similarScore'), text: pctText(Math.round(x.score * 100)) }),
        h('div', { class: 'suggest-text' }, h('div', { class: 'src-mini', lang: game.source_lang, text: toField(x.source) }), h('div', { lang: route.lang, text: toField(x.text) })),
        h('button', { class: 'btn ghost sm', type: 'button', text: t('ed.use'), onmousedown: (e) => e.preventDefault(), onclick: () => {
          row.field.value = toField(x.text);
          row.field.dispatchEvent(new Event('input', { bubbles: true }));
          row.field.focus();
        } }))));
    row.node.append(row.suggest);
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

  const repaintBlocks = debounce(paintBlocks, 200);
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
      change(row, () => Object.assign(row.s, { text: ev.text, status: ev.status, updated_at: ev.updated_at || row.s.updated_at, ...(ev.by ? { by: ev.by } : {}) }));
      if (row.dirty && !mine && ev.by) row.error = t('ed.changedBy', { who: who(ev.by) });
      paintValue(row); paintFoot(row);
    } else if (ev.type === 'translation' && ev.lang === route.lang && ev.fresh && blockById.has(ev.block_id)) {
      // a copy in a block that is not open was just filled: move that block's counter
      blockById.get(ev.block_id).done += 1;
      repaintBlocks();
    }
    if (ev.type === 'progress') refreshLangProgress();
    if (ev.type === 'ai') paintAi(ev.job);
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
