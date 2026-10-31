// Oficina de Tradução — single-page frontend (hash routes, no build step).
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
const fmt = new Intl.NumberFormat('pt-BR');
const LANG = (() => { try { return new Intl.DisplayNames(['pt-BR'], { type: 'language' }); } catch { return null; } })();
const langName = (c) => { try { const n = LANG?.of(c); return n && n !== c ? n[0].toUpperCase() + n.slice(1) : c.toUpperCase(); } catch { return c.toUpperCase(); } };
const pct = (n, t) => (t ? Math.floor((1000 * n) / t) / 10 : 0);
const pctText = (p) => `${String(p).replace('.', ',')}%`;
const ago = (iso) => {
  if (!iso) return '';
  const m = (Date.now() - new Date(iso)) / 60000;
  if (m < 1) return 'agora';
  if (m < 60) return `${Math.floor(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  if (m < 10080) return `${Math.floor(m / 1440)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};
const who = (u) => (u && (u.name || u.login)) || 'Alguém';
function avatar(u, cls = 'avatar') {
  const img = h('img', { class: cls, alt: '', loading: 'lazy' });
  if (u?.avatar_url) img.src = u.avatar_url;
  return img;
}
function bar(total, done, reviewed, cls = 'bar') {
  const r = h('i', { class: 'rev' }); r.style.width = `${total ? (100 * reviewed) / total : 0}%`;
  const t = h('i', { class: 'tr' }); t.style.width = `${total ? (100 * Math.max(0, done - reviewed)) / total : 0}%`;
  return h('div', { class: cls, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct(done, total) }, r, t);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

async function api(method, path, body, raw = false) {
  const opts = { method, headers: { 'X-Requested-With': 'oficina' }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (raw) { opts.body = body; opts.headers['Content-Type'] = 'text/plain; charset=utf-8'; }
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Algo deu errado. Tente de novo.'); e.status = res.status; throw e; }
  return data;
}

const GH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const loginButton = (label = 'Entrar com GitHub') => h('a', { class: 'btn primary btn-github', href: '/auth/github', html: `${GH_ICON}<span>${label}</span>` });

// ---------------------------------------------------------------- session + chrome
const S = { me: null, auth: { github: false, dev: false }, stream: null, streamSlug: null, cleanup: [] };

function renderChrome(route) {
  const nav = $('#nav'); nav.replaceChildren(
    h('a', { href: '#/', 'aria-current': route.name === 'home' ? 'page' : null, text: 'Projetos' }),
    S.me?.is_admin ? h('a', { href: '#/admin', 'aria-current': route.name === 'admin' ? 'page' : null, text: 'Administração' }) : null);
  const acc = $('#account'); acc.replaceChildren();
  if (S.me) {
    acc.append(h('span', { class: 'small muted login-name', text: S.me.login }), avatar(S.me),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Sair', onclick: async () => { await api('POST', '/auth/logout').catch(() => {}); location.hash = '#/'; location.reload(); } }));
  } else if (S.auth.github) acc.append(loginButton('Entrar'));
  else if (S.auth.dev) acc.append(h('a', { class: 'btn sm', href: `/auth/dev?login=dev&to=${encodeURIComponent(location.hash || '#/')}`, text: 'Entrar (dev)' }));
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
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

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
    app.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: e.status === 404 ? 'Não encontrado' : 'Não foi possível carregar' }), h('p', { text: e.message }), h('a', { class: 'btn', href: '#/', text: 'Voltar aos projetos' })));
  }
}
window.addEventListener('hashchange', router);

// ---------------------------------------------------------------- home
async function viewHome() {
  const { games } = await api('GET', '/api/games');
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'lead' }, h('h1', { text: 'Projetos' }), h('p', { class: 'muted', text: 'Jogos em tradução, com o progresso de cada idioma.' })),
    S.me?.is_admin ? h('button', { class: 'btn', type: 'button', text: 'Novo projeto', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); } }) : null);
  const status = h('p', { class: 'status', role: 'status' });
  const form = h('div', { class: 'panel', hidden: true }, h('div', { class: 'panel-body' }, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('POST', '/api/games', { name: f.name.value, platform: f.platform.value, slug: f.slug.value, source_lang: f.source.value });
      location.hash = `#/g/${r.slug}/configuracoes`;
    } catch (err) { status.textContent = err.message; status.className = 'status bad'; }
  } },
    h('h2', { text: 'Novo projeto' }),
    h('div', { class: 'grid' },
      h('label', { class: 'field' }, h('span', { text: 'Nome do jogo' }), h('input', { type: 'text', name: 'name', required: true, placeholder: 'Bomberman Land 3' })),
      h('label', { class: 'field' }, h('span', { text: 'Plataforma' }), h('input', { type: 'text', name: 'platform', placeholder: 'PlayStation 2' })),
      h('label', { class: 'field' }, h('span', {}, 'Endereço ', h('small', { text: 'opcional' })), h('input', { type: 'text', name: 'slug', placeholder: 'bomberman-land-3' })),
      h('label', { class: 'field' }, h('span', { text: 'Idioma original' }), h('input', { type: 'text', name: 'source', value: 'ja' }))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Criar projeto' }), status))));

  const list = h('div', { class: 'grid' });
  if (!games.length) {
    list.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', { text: 'Nenhum projeto ainda' }), h('p', { text: S.me?.is_admin ? 'Crie o primeiro em "Novo projeto".' : 'Os jogos em tradução aparecem aqui.' }))));
  }
  for (const g of games) {
    const langs = [...g.langs].sort((a, b) => b.done - a.done);
    list.append(h('a', { class: 'card', href: `#/g/${g.slug}` },
      h('div', { class: 'card-title' }, h('h2', { text: g.name }), g.mine ? h('span', { class: 'chip accent', text: 'Sua equipe' }) : null),
      h('div', { class: 'meta-row' }, g.platform ? h('span', { text: g.platform }) : null, h('span', { class: 'num', text: g.total ? `${fmt.format(g.total)} strings` : 'sem texto importado' })),
      h('div', { class: 'card-langs' }, langs.length ? langs.slice(0, 6).map((l) => h('div', { class: 'card-lang' },
        h('span', { class: 'code', text: l.lang }), bar(g.total, l.done, l.reviewed, 'bar thin'), h('span', { class: 'pct', text: pctText(pct(l.done, g.total)) })))
        : h('p', { class: 'small muted', text: 'Nenhum idioma de destino ainda.' }))));
  }
  const intro = !S.me ? h('section', { class: 'hero' },
    h('h1', { text: 'Tradução colaborativa de jogos' }),
    h('p', { text: 'Escolha um projeto, veja o progresso de cada idioma e, se fizer parte da equipe, traduza direto no navegador.' }),
    S.auth.github ? h('div', {}, loginButton()) : null) : null;
  app.replaceChildren(...[intro, head, form, list].filter(Boolean));
}

// ---------------------------------------------------------------- game
async function viewGame(route) {
  const data = await api('GET', `/api/games/${encodeURIComponent(route.slug)}`);
  const { game, access: a } = data;
  const tabs = [['idiomas', 'Idiomas'], ['equipe', 'Equipe'], ['atividade', 'Atividade']];
  if (a.manage) tabs.push(['configuracoes', 'Configurações']);
  const tab = tabs.some(([k]) => k === route.tab) ? route.tab : 'idiomas';
  const body = h('div', { style: 'display:grid;gap:20px' });
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'lead' },
      h('span', { class: 'eyebrow', text: game.platform || 'Projeto' }), h('h1', { text: game.name }),
      h('div', { class: 'meta-row' }, h('span', { text: `Original em ${langName(game.source_lang)}` }),
        h('span', { class: 'num', text: data.total ? `${fmt.format(data.total)} strings · ${fmt.format(data.blocks)} blocos` : 'texto ainda não importado' }),
        a.manage ? h('span', { class: 'chip', text: a.admin ? 'Administração' : 'Coordenação' }) : Object.keys(a.langs).length ? h('span', { class: 'chip accent', text: `Você: ${Object.entries(a.langs).map(([l, r]) => `${l.toUpperCase()} ${r}`).join(', ')}` }) : null))),
    h('nav', { class: 'tabs', 'aria-label': 'Seções do projeto' }, tabs.map(([k, label]) => h('a', { href: `#/g/${game.slug}/${k}`, 'aria-current': k === tab ? 'page' : null, text: label }))),
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
  if (!rows.length) panel.append(h('div', { class: 'empty' }, h('h3', { text: 'Nenhum idioma de destino' }), h('p', { text: a.manage ? 'Adicione idiomas em Configurações.' : 'A coordenação ainda não abriu idiomas para este jogo.' })));
  else {
    panel.append(h('div', { class: 'panel-head' }, h('h2', { text: 'Idiomas' }),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--good)' }), 'Revisado'), h('span', {}, h('i', { style: 'background:var(--accent)' }), 'Traduzido'))));
    const tb = h('tbody');
    for (const l of rows) {
      const can = a.manage || !!a.langs[l.lang];
      const go = () => { if (total) location.hash = `#/g/${game.slug}/t/${l.lang}`; };
      tb.append(h('tr', { class: total ? 'link' : '', tabindex: total ? 0 : null, onclick: go, onkeydown: (e) => { if (e.key === 'Enter') go(); } },
        h('td', {}, h('div', { class: 'lang-cell' }, h('b', { text: langName(l.lang) }), h('span', { class: 'code-tag', text: l.lang }))),
        h('td', {}, h('div', { class: 'progress-cell' }, bar(total, l.done, l.reviewed), h('span', { class: 'pct', text: pctText(pct(l.done, total)) }))),
        h('td', { class: 'num muted', text: `${fmt.format(l.done)} / ${fmt.format(total)}` }),
        h('td', { class: 'num muted', text: `${fmt.format(l.reviewed)} revisadas` }),
        h('td', { style: 'text-align:right' }, total ? h('span', { class: `btn sm ${can ? 'primary' : ''}`, text: can ? 'Traduzir' : 'Ver' }) : null)));
    }
    panel.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Idioma' }), h('th', { text: 'Progresso' }), h('th', { text: 'Traduzidas' }), h('th', { text: 'Revisão' }), h('th', {}))), tb)));
  }
  const extra = [];
  if (!S.me && rows.length) extra.push(h('div', { class: 'notice' }, h('p', { text: 'Entre com o GitHub para ver o texto e pedir para participar.' }), S.auth.github ? loginButton() : null));
  else if (S.me && !a.seeText) extra.push(h('div', { class: 'notice' }, h('p', { text: 'Para traduzir, peça para entrar na equipe deste jogo.' }), h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: 'Pedir para participar' })));
  body.replaceChildren(panel, ...extra);
}

async function tabTeam(body, data) {
  const { game, access: a } = data;
  const t = await api('GET', `/api/games/${encodeURIComponent(game.slug)}/team`);
  const byUser = new Map();
  for (const m of t.members) {
    if (!byUser.has(m.id)) byUser.set(m.id, { ...m, roles: [] });
    byUser.get(m.id).roles.push({ lang: m.lang, role: m.role });
  }
  const members = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Equipe' }), h('span', { class: 'muted small num', text: `${byUser.size} ${byUser.size === 1 ? 'pessoa' : 'pessoas'}` })));
  const list = h('div', { class: 'people' });
  if (!byUser.size) list.append(h('div', { class: 'empty' }, h('p', { text: 'Ninguém na equipe ainda.' })));
  for (const u of byUser.values()) {
    list.append(h('div', { class: 'person' }, avatar(u, 'avatar lg'),
      h('div', { class: 'who' }, h('b', { text: who(u) }), h('span', { class: 'mono', text: `@${u.login}` })),
      h('div', { class: 'side' }, u.roles.map((r) => h('span', { class: `chip ${r.role === 'coordenador' ? 'accent' : r.role === 'revisor' ? 'good' : ''}` },
        r.role === 'coordenador' ? 'Coordenação' : `${r.lang.toUpperCase()} · ${r.role}`,
        a.manage && (r.role !== 'coordenador' || a.admin) ? h('button', { type: 'button', 'aria-label': `Remover ${r.role} ${r.lang}`, text: '×', onclick: async () => {
          try { await api('DELETE', `/api/games/${encodeURIComponent(game.slug)}/members/${u.id}/${encodeURIComponent(r.lang)}`); await tabTeam(body, data); } catch (e) { toast(e.message); }
        } }) : null)))));
  }
  members.append(list);

  const side = [];
  if (a.manage) {
    const reqs = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Pedidos' }), h('span', { class: 'muted small num', text: String(t.requests.length) })));
    if (!t.requests.length) reqs.append(h('div', { class: 'empty' }, h('p', { text: 'Nenhum pedido aguardando.' })));
    for (const r of t.requests) {
      const role = h('select', { 'aria-label': 'Papel' }, h('option', { value: 'tradutor', text: 'Tradutor' }), h('option', { value: 'revisor', text: 'Revisor' }));
      role.style.width = 'auto';
      const decide = async (approve) => { try { await api('POST', `/api/games/${encodeURIComponent(game.slug)}/requests/${r.id}`, { approve, role: role.value }); toast(approve ? 'Pedido aprovado.' : 'Pedido recusado.'); await tabTeam(body, data); } catch (e) { toast(e.message); } };
      reqs.append(h('div', { class: 'request' },
        h('div', { class: 'row' }, avatar(r), h('div', { class: 'grow' }, h('b', { text: who(r) }), ' ', h('span', { class: 'muted small mono', text: `@${r.login} · ${ago(r.created_at)}` }))),
        h('div', { class: 'chips' }, r.langs.map((l) => h('span', { class: 'chip', text: langName(l) })), r.level ? h('span', { class: 'chip', text: r.level }) : null),
        r.note ? h('p', { text: r.note }) : null,
        r.contact ? h('p', { class: 'mono small', text: `Contato: ${r.contact}` }) : null,
        h('div', { class: 'row' }, role, h('button', { class: 'btn primary sm', type: 'button', text: 'Aprovar', onclick: () => decide(true) }), h('button', { class: 'btn sm', type: 'button', text: 'Recusar', onclick: () => decide(false) }))));
    }
    side.push(reqs);
    const st = h('p', { class: 'status', role: 'status' });
    const langOpts = data.langs.map((l) => h('option', { value: l.lang, text: langName(l.lang) }));
    side.push(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Adicionar pessoa' })), h('div', { class: 'panel-body' }, h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api('PUT', `/api/games/${encodeURIComponent(game.slug)}/members`, { login: f.login.value.trim().replace(/^@/, ''), role: f.role.value, lang: f.lang.value }); f.reset(); toast('Equipe atualizada.'); await tabTeam(body, data); }
      catch (err) { st.textContent = err.message; st.className = 'status bad'; }
    } },
      h('label', { class: 'field' }, h('span', {}, 'Usuário do GitHub ', h('small', { text: 'a pessoa precisa ter entrado no site uma vez' })), h('input', { type: 'text', name: 'login', required: true, placeholder: '@usuario' })),
      h('div', { class: 'row' },
        h('select', { name: 'role', 'aria-label': 'Papel', class: 'grow' }, h('option', { value: 'tradutor', text: 'Tradutor' }), h('option', { value: 'revisor', text: 'Revisor' }), a.admin ? h('option', { value: 'coordenador', text: 'Coordenação (todos os idiomas)' }) : null),
        h('select', { name: 'lang', 'aria-label': 'Idioma', class: 'grow' }, langOpts)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', text: 'Adicionar' }), st)))));
  } else if (S.me) side.push(joinPanel(game, data, t.mine, () => tabTeam(body, data)));
  else side.push(h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', { text: 'Quer ajudar a traduzir?' }), h('p', { text: 'Entre com o GitHub e peça para participar.' }), S.auth.github ? loginButton() : null)));
  body.replaceChildren(h('div', { class: 'split' }, members, h('div', { style: 'display:grid;gap:20px;min-width:0' }, side)));
}

function joinPanel(game, data, mine, refresh) {
  const panel = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Participar' })));
  if (mine?.status === 'pendente') { panel.append(h('div', { class: 'empty' }, h('h3', { text: 'Pedido enviado' }), h('p', { text: `Você pediu para traduzir ${mine.langs.map(langName).join(', ')}. A coordenação responde por aqui.` }))); return panel; }
  if (!data.langs.length) { panel.append(h('div', { class: 'empty' }, h('p', { text: 'Este jogo ainda não tem idiomas abertos.' }))); return panel; }
  const st = h('p', { class: 'status', role: 'status' });
  panel.append(h('div', { class: 'panel-body' },
    mine?.status === 'recusado' ? h('p', { class: 'status bad', text: 'Seu pedido anterior não foi aceito. Você pode enviar outro.' }) : null,
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); const f = e.target;
      const langs = [...f.querySelectorAll('input[name=lang]:checked')].map((i) => i.value);
      try { await api('POST', `/api/games/${encodeURIComponent(game.slug)}/requests`, { langs, level: f.level.value, note: f.note.value, contact: f.contact.value }); toast('Pedido enviado.'); await refresh(); }
      catch (err) { st.textContent = err.message; st.className = 'status bad'; }
    } },
      h('div', { class: 'field' }, h('span', { text: 'Idiomas' }), h('div', { class: 'checks' }, data.langs.map((l) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'lang', value: l.lang }), langName(l.lang))))),
      h('label', { class: 'field' }, h('span', { text: `Seu nível em ${langName(game.source_lang)}` }), h('select', { name: 'level' },
        h('option', { value: 'fluente', text: 'Fluente ou nativo' }), h('option', { value: 'intermediário', text: 'Intermediário' }), h('option', { value: 'básico', text: 'Básico' }), h('option', { value: 'revisão', text: 'Não leio: quero revisar' }))),
      h('label', { class: 'field' }, h('span', {}, 'Sobre você ', h('small', { text: 'experiência, outros projetos' })), h('textarea', { name: 'note', rows: 3, maxlength: 800 })),
      h('label', { class: 'field' }, h('span', {}, 'Contato ', h('small', { text: 'Discord ou e-mail; só a coordenação vê' })), h('input', { type: 'text', name: 'contact', maxlength: 160 })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Enviar pedido' }), st))));
  return panel;
}

async function tabActivity(body, data) {
  const { game } = data;
  const r = await api('GET', `/api/games/${encodeURIComponent(game.slug)}/activity`);
  const KIND = {
    projeto_criado: 'criou o projeto', idioma_adicionado: 'abriu o idioma', idioma_removido: 'fechou o idioma', texto_importado: 'importou o texto original',
    exportado: 'exportou as traduções', pedido_enviado: 'pediu para participar', pedido_aprovado: 'aprovou um pedido', pedido_recusado: 'recusou um pedido', equipe_alterada: 'alterou a equipe',
  };
  const recent = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Últimas traduções' })));
  const rf = h('div', { class: 'feed' });
  if (!r.recent.length) rf.append(h('div', { class: 'empty' }, h('p', { text: 'Nenhuma tradução ainda.' })));
  for (const e of r.recent) rf.append(h('div', { class: 'feed-item' }, avatar(e, 'avatar sm'),
    h('span', {}, h('b', { text: who(e) }), ` ${e.status === 'revisada' ? 'revisou' : e.status === 'apagada' ? 'apagou' : 'traduziu'} #${e.idx} de `, h('span', { class: 'mono', text: e.label }), ` em ${e.lang.toUpperCase()}`),
    h('time', { datetime: e.created_at, text: ago(e.created_at) })));
  recent.append(rf);
  const top = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Quem mais traduziu' })));
  const tf = h('div', { class: 'feed' });
  if (!r.top.length) tf.append(h('div', { class: 'empty' }, h('p', { text: 'Ainda sem números.' })));
  for (const p of r.top) tf.append(h('div', { class: 'feed-item' }, avatar(p, 'avatar sm'), h('span', {}, h('b', { text: who(p) }), ` · ${p.lang.toUpperCase()}`), h('span', { class: 'num muted', text: fmt.format(p.n) })));
  top.append(tf);
  const ev = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Projeto' })));
  const ef = h('div', { class: 'feed' });
  if (!r.events.length) ef.append(h('div', { class: 'empty' }, h('p', { text: 'Nada por aqui ainda.' })));
  for (const e of r.events) ef.append(h('div', { class: 'feed-item' }, avatar(e, 'avatar sm'),
    h('span', {}, h('b', { text: who(e) }), ` ${KIND[e.kind] || e.kind}${e.lang ? ` ${e.lang.toUpperCase()}` : ''}`),
    h('time', { datetime: e.created_at, text: ago(e.created_at) })));
  ev.append(ef);
  body.replaceChildren(h('div', { class: 'split' }, recent, h('div', { style: 'display:grid;gap:20px;min-width:0' }, top, ev)));
}

async function tabSettings(body, data) {
  const { game } = data;
  const slug = encodeURIComponent(game.slug);
  const lst = h('p', { class: 'status', role: 'status' });
  const langs = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Idiomas de destino' })), h('div', { class: 'panel-body' },
    h('div', { class: 'chips' }, data.langs.length ? data.langs.map((l) => h('span', { class: 'chip' }, `${langName(l.lang)} · ${l.lang}`,
      h('button', { type: 'button', 'aria-label': `Remover ${l.lang}`, text: '×', onclick: (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'remover?'; setTimeout(() => { b.textContent = '×'; delete b.dataset.armed; }, 3000); return; }
        api('DELETE', `/api/games/${slug}/langs/${encodeURIComponent(l.lang)}`).then(() => router()).catch((err) => toast(err.message));
      } }))) : h('span', { class: 'muted', text: 'Nenhum ainda.' })),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', `/api/games/${slug}/langs`, { lang: e.target.lang.value.trim() }); toast('Idioma adicionado.'); router(); }
      catch (err) { lst.textContent = err.message; lst.className = 'status bad'; }
    } }, h('div', { class: 'row' }, h('input', { type: 'text', name: 'lang', class: 'grow', placeholder: 'pt, es, en, fr, pl…', 'aria-label': 'Código do idioma', required: true }), h('button', { class: 'btn', type: 'submit', text: 'Adicionar' })), lst)));

  const ist = h('p', { class: 'status', role: 'status' });
  const file = h('input', { type: 'file', accept: '.tsv,.txt,text/tab-separated-values,text/plain', 'aria-label': 'Arquivo TSV' });
  const imp = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Texto original' })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: 'Envie o TSV gerado pelo textscan.py (dialogos_jp.tsv). Tabelas repetidas entre cenas entram uma vez só. Reenviar o arquivo atualiza o texto e mantém as traduções.' }),
    file, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Importar', onclick: async () => {
      const f = file.files?.[0]; if (!f) { ist.textContent = 'Escolha o arquivo primeiro.'; ist.className = 'status bad'; return; }
      ist.textContent = 'Importando…'; ist.className = 'status';
      try { const r = await api('POST', `/api/games/${slug}/import`, await f.text(), true); ist.textContent = `${fmt.format(r.strings)} strings em ${fmt.format(r.blocks)} blocos.`; ist.className = 'status ok'; }
      catch (err) { ist.textContent = err.message; ist.className = 'status bad'; }
    } }), ist)));

  const exp = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Exportar' })), h('div', { class: 'panel-body' },
    h('p', { class: 'muted small', text: 'O TSV completo, com uma coluna por idioma, pronto para o encode.py --lang.' }),
    h('div', {}, h('a', { class: 'btn', href: `/api/games/${slug}/export`, download: `${game.slug}-traducoes.tsv`, text: 'Baixar TSV' }))));
  body.replaceChildren(h('div', { class: 'grid' }, langs, imp, exp));
}

// ---------------------------------------------------------------- editor
const SPLIT = /(\\n|\{[^}]*\})/;
const IS_TAG = /^\{[^}]*\}$/;
const toField = (t) => (t || '').replace(/\\n/g, '\n');
function sourceNode(text) {
  const box = h('div', { class: 'src', lang: 'ja' });
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
  for (const t of want) { const i = have.indexOf(t); if (i < 0) out.push(t); else have.splice(i, 1); }
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
  const current = route.block && blocks.some((b) => b.id === route.block) ? route.block : blocks[0]?.id;
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'lead' }, h('a', { class: 'eyebrow', href: `#/g/${game.slug}`, text: `← ${game.name}` }), h('h1', { text: langName(route.lang) }),
      h('div', { class: 'meta-row' }, h('span', { text: can ? (review ? 'Você traduz e revisa este idioma' : 'Você traduz este idioma') : 'Somente leitura' }), h('span', {}, h('span', { class: 'kbd', text: 'Ctrl' }), ' + ', h('span', { class: 'kbd', text: 'Enter' }), ' salva e vai para a próxima'))),
    h('div', { style: 'min-width:240px;display:grid;gap:6px' }, h('div', { class: 'progress-cell', id: 'lang-progress' }, bar(data.total, L.done, L.reviewed), h('span', { class: 'pct', text: pctText(pct(L.done, data.total)) })),
      h('span', { class: 'small muted num', id: 'lang-count', text: `${fmt.format(L.done)} de ${fmt.format(data.total)} · ${fmt.format(L.reviewed)} revisadas` })));

  const filterInput = h('input', { type: 'search', placeholder: 'Filtrar blocos', 'aria-label': 'Filtrar blocos' });
  const blockList = h('div', { class: 'sidebar-list' });
  const sidebar = h('aside', { class: 'sidebar' }, h('div', { class: 'sidebar-head' }, filterInput), blockList);
  const workspace = h('section', { class: 'workspace' });
  app.replaceChildren(head, h('div', { class: 'editor' }, sidebar, workspace));
  if (!a.seeText) {
    workspace.append(h('div', { class: 'empty' }, h('h3', { text: S.me ? 'Texto visível só para a equipe' : 'Entre para ver o texto' }),
      h('p', { text: S.me ? 'Peça para participar na aba Equipe do projeto.' : 'O texto original fica restrito a quem participa da tradução.' }),
      S.me ? h('a', { class: 'btn', href: `#/g/${game.slug}/equipe`, text: 'Ir para Equipe' }) : (S.auth.github ? loginButton() : null)));
  }

  const paintBlocks = () => {
    const f = filterInput.value.trim().toLowerCase();
    blockList.replaceChildren(...blocks.filter((b) => !f || b.label.toLowerCase().includes(f)).map((b) => h('button', {
      class: 'block', type: 'button', 'aria-current': b.id === current ? 'true' : 'false',
      onclick: () => { location.hash = `#/g/${game.slug}/t/${route.lang}/${b.id}`; },
    }, h('span', { class: 'lbl', text: b.label }), h('span', { class: 'cnt', text: `${b.done}/${b.n}` }), bar(b.n, b.done, b.reviewed, 'bar thin'))));
  };
  filterInput.addEventListener('input', paintBlocks);
  paintBlocks();
  blockList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  if (!a.seeText || !current) { if (a.seeText) workspace.append(h('div', { class: 'empty' }, h('p', { text: 'Este projeto ainda não tem texto importado.' }))); return; }

  // workspace for the current block
  const blockInfo = blocks.find((b) => b.id === current);
  const { strings } = await api('GET', `/api/games/${slug}/blocks/${current}?lang=${encodeURIComponent(route.lang)}`);
  let mode = 'todas', search = '';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mostrar' });
  for (const [k, label] of [['todas', 'Todas'], ['faltando', 'Faltando'], ['revisar', 'Para revisar']]) {
    seg.append(h('button', { type: 'button', 'aria-pressed': k === mode ? 'true' : 'false', text: label, onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false')); applyFilter(); } }));
  }
  const searchBox = h('input', { type: 'search', class: 'grow', placeholder: 'Buscar no original ou na tradução', 'aria-label': 'Buscar' });
  searchBox.addEventListener('input', () => { search = searchBox.value.trim().toLowerCase(); applyFilter(); });
  const list = h('div');
  workspace.append(h('div', { class: 'toolbar' }, h('h2', { class: 'mono', text: blockInfo.label }), seg, searchBox), list);

  const rows = new Map();
  const updateBlockCount = () => {
    const done = [...rows.values()].filter((r) => r.s.text).length, rev = [...rows.values()].filter((r) => r.s.status === 'revisada').length;
    blockInfo.done = done; blockInfo.reviewed = rev; paintBlocks();
  };

  for (const s of strings) {
    const row = { s, dirty: false };
    const field = can ? h('textarea', { rows: Math.min(8, 2 + (s.source.match(/\\n/g) || []).length), 'aria-label': `Tradução da string ${s.idx}`, spellcheck: 'true', lang: route.lang }) : h('div', { class: 'readonly' });
    const foot = h('div', { class: 'str-foot' });
    const node = h('div', { class: 'str' }, h('div', { class: 'str-key' }, h('span', { text: `#${s.idx}` })), sourceNode(s.source), h('div', { class: 'tr-col' }, field, foot));
    Object.assign(row, { field, foot, node });
    if (can) {
      field.addEventListener('focus', () => node.classList.add('active'));
      field.addEventListener('blur', () => { node.classList.remove('active'); if (row.dirty) save(row); });
      field.addEventListener('input', () => { row.dirty = true; paintFoot(row); });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (row.dirty) save(row);
          const next = [...rows.values()].find((r) => r.s.idx > s.idx && !r.node.hidden);
          next?.field.focus();
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
    else row.field.textContent = row.s.text ? toField(row.s.text) : '—';
  }
  function paintFoot(row) {
    const s = row.s;
    const current = can ? row.field.value : toField(s.text);
    const miss = current ? missingTags(s.source, current.replace(/\n/g, '\\n')) : [];
    const left = h('span', { class: 'by' });
    if (row.saving) left.append('Salvando…');
    else if (row.error) left.append(h('span', { style: 'color:var(--bad)', text: row.error }), row.conflict ? h('button', { class: 'btn ghost sm', type: 'button', text: 'Manter a minha', onclick: () => save(row, true) }) : null);
    else if (row.dirty) left.append('Não salvo');
    else if (s.text) left.append(avatar(s.by, 'avatar sm'), `${who(s.by)} · ${ago(s.updated_at)}`);
    const acts = h('span', { class: 'acts' });
    if (miss.length) acts.append(h('span', { class: 'chip warn', text: `falta ${miss.join(' ')}` }));
    if (s.status === 'revisada') acts.append(h('span', { class: 'chip good', text: 'Revisada' }));
    if (review && s.text && !row.dirty) acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: s.status === 'revisada' ? 'Desfazer revisão' : 'Aprovar', onclick: () => setReview(row, s.status !== 'revisada') }));
    if (s.text) acts.append(h('button', { class: 'btn ghost sm', type: 'button', text: 'Histórico', onclick: () => toggleHistory(row) }));
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
    const box = h('div', { class: 'history' }, h('span', { class: 'muted small', text: 'Carregando…' }));
    row.node.append(box);
    try {
      const { history } = await api('GET', `/api/games/${slug}/strings/${row.s.id}/${encodeURIComponent(route.lang)}/history`);
      box.replaceChildren(...(history.length ? history : []).map((x) => h('div', { class: 'history-item' }, avatar(x, 'avatar sm'),
        h('div', {}, h('div', { class: 'small muted', text: `${who(x)} · ${x.status}` }), h('div', { class: 't', text: x.text ? toField(x.text) : '(apagada)' })),
        h('time', { class: 'small muted', datetime: x.created_at, text: ago(x.created_at) }))));
      if (!history.length) box.replaceChildren(h('span', { class: 'muted small', text: 'Sem histórico.' }));
    } catch (e) { box.replaceChildren(h('span', { class: 'status bad', text: e.message })); }
  }

  useStream(game.slug, async (ev) => {
    if (ev.type === 'translation' && ev.lang === route.lang && rows.has(ev.id)) {
      const row = rows.get(ev.id);
      const mine = ev.by && S.me && ev.by.login === S.me.login;
      Object.assign(row.s, { text: ev.text, status: ev.status, updated_at: ev.updated_at || row.s.updated_at, ...(ev.by ? { by: ev.by } : {}) });
      if (row.dirty && !mine && ev.by) row.error = `${who(ev.by)} acabou de alterar esta string`;
      paintValue(row); paintFoot(row); updateBlockCount();
    }
    if (ev.type === 'progress') refreshLangProgress();
  });
  const refreshLangProgress = debounce(async () => {
    try {
      const d = await api('GET', `/api/games/${slug}`);
      const l = d.langs.find((x) => x.lang === route.lang); if (!l) return;
      $('#lang-progress')?.replaceChildren(bar(d.total, l.done, l.reviewed), h('span', { class: 'pct', text: pctText(pct(l.done, d.total)) }));
      const c = $('#lang-count'); if (c) c.textContent = `${fmt.format(l.done)} de ${fmt.format(d.total)} · ${fmt.format(l.reviewed)} revisadas`;
    } catch { /* keep the last numbers */ }
  }, 800);
  S.cleanup.push(() => { for (const row of rows.values()) if (row.dirty && can) save(row); });
}

// ---------------------------------------------------------------- admin
async function viewAdmin() {
  if (!S.me?.is_admin) { app.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: 'Só administradores' }), h('a', { class: 'btn', href: '#/', text: 'Voltar' }))); return; }
  const { users, pending } = await api('GET', '/api/admin/users');
  const pend = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Pedidos aguardando' }), h('span', { class: 'muted small num', text: String(pending.length) })));
  const pf = h('div', { class: 'feed' });
  if (!pending.length) pf.append(h('div', { class: 'empty' }, h('p', { text: 'Nenhum pedido em nenhum projeto.' })));
  for (const r of pending) pf.append(h('div', { class: 'feed-item' }, avatar(r, 'avatar sm'),
    h('span', {}, h('b', { text: who(r) }), ` quer traduzir ${r.langs.map((l) => l.toUpperCase()).join(', ')} em `, h('a', { href: `#/g/${r.slug}/equipe`, text: r.game })),
    h('time', { datetime: r.created_at, text: ago(r.created_at) })));
  pend.append(pf);
  const tb = h('tbody');
  for (const u of users) {
    tb.append(h('tr', {},
      h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, avatar(u), h('div', {}, h('div', { text: who(u) }), h('div', { class: 'small muted mono', text: `@${u.login}` })))),
      h('td', {}, h('div', { class: 'chips' }, u.memberships.length ? u.memberships.map((m) => h('span', { class: 'chip', text: `${m.game} · ${m.lang === '*' ? 'coordenação' : `${m.lang.toUpperCase()} ${m.role}`}` })) : h('span', { class: 'muted small', text: '—' }))),
      h('td', { class: 'num muted', text: fmt.format(u.edits) }),
      h('td', { class: 'small muted', text: ago(u.last_seen) }),
      h('td', { style: 'text-align:right' }, h('div', { class: 'row', style: 'justify-content:flex-end;flex-wrap:nowrap' },
        u.id === S.me.id ? h('span', { class: 'chip accent', text: 'Você' }) :
          h('button', { class: `btn sm ${u.is_admin ? '' : 'ghost'}`, type: 'button', text: u.is_admin ? 'Administrador' : 'Tornar admin', onclick: async () => {
            try { await api('PUT', `/api/admin/users/${u.id}`, { is_admin: !u.is_admin }); viewAdmin(); } catch (e) { toast(e.message); }
          } }),
        u.id === S.me.id ? null : h('button', { class: 'btn ghost sm danger', type: 'button', text: 'Desconectar', onclick: async () => { try { await api('DELETE', `/api/admin/users/${u.id}/sessions`); toast('Sessões encerradas.'); } catch (e) { toast(e.message); } } })))));
  }
  const people = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Pessoas' }), h('span', { class: 'muted small num', text: String(users.length) })),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Pessoa' }), h('th', { text: 'Projetos' }), h('th', { text: 'Edições' }), h('th', { text: 'Visto' }), h('th', {}))), tb)));
  app.replaceChildren(h('div', { class: 'page-head' }, h('div', { class: 'lead' }, h('h1', { text: 'Administração' }), h('p', { class: 'muted', text: 'Pessoas, permissões e pedidos de todos os projetos.' }))), pend, people);
}

// ---------------------------------------------------------------- boot
(async () => {
  try { const r = await api('GET', '/api/me'); S.me = r.user; S.auth = { github: r.github, dev: r.dev }; } catch { /* signed out */ }
  router();
})();
