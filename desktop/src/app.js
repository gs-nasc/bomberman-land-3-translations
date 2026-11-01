// Glifo desktop: pick a game, a language and your own disc; the bundled engine (engine/glifo_patcher.py,
// run as a Tauri sidecar) builds the translated disc and reports progress as JSON lines.
// Opened in a plain browser (no Tauri) it runs against a demo engine, to work on the interface.

const T = window.__TAURI__;
const DEFAULT_SERVER = 'https://games.gabirel.dev';

const DICT = {
  pt: {
    settings: 'Configurações', server: 'Endereço do servidor', uiLang: 'Idioma do aplicativo', cancel: 'Cancelar', save: 'Salvar',
    lead: 'Escolha o jogo, o idioma e a sua cópia do disco. O app gera um disco novo, traduzido; o original não é alterado.',
    step1: 'Jogo', step2: 'Idioma', step3: 'Seu disco', loading: 'Carregando os jogos…', noGames: 'Nenhum jogo disponível ainda.',
    offline: 'Não foi possível falar com o servidor ({url}).', retry: 'Tentar de novo', needsUpdate: 'Precisa de uma versão mais nova do app',
    stable: 'Estável', stableHint: 'só traduções revisadas', preview: 'Prévia', previewHint: 'tudo, inclusive rascunhos',
    pctReady: '{p}% pronto', pick: 'Escolher arquivo…', change: 'Trocar', accepts: 'Aceita {ext}', checking: 'Conferindo o disco…',
    discOk: 'Disco reconhecido', generate: 'Gerar disco traduzido', nothing: 'Ainda não há texto neste idioma e canal.',
    saveTitle: 'Salvar o disco traduzido', working: 'Gerando…', stop: 'Cancelar', stopped: 'Cancelado. Nenhum arquivo foi criado.',
    done: 'Pronto!', doneLead: 'O disco traduzido foi salvo em:', openFolder: 'Abrir pasta', again: 'Gerar outro',
    skipped: '{n} tabelas de texto não puderam ser trocadas e ficaram no original.', failed: 'Não deu certo', back: 'Voltar',
    details: 'Detalhes', download: 'Baixando a tradução', starting: 'Iniciando',
  },
  en: {
    settings: 'Settings', server: 'Server address', uiLang: 'App language', cancel: 'Cancel', save: 'Save',
    lead: 'Pick the game, the language and your copy of the disc. The app builds a new, translated disc; the original is left untouched.',
    step1: 'Game', step2: 'Language', step3: 'Your disc', loading: 'Loading games…', noGames: 'No games available yet.',
    offline: 'Could not reach the server ({url}).', retry: 'Try again', needsUpdate: 'Needs a newer version of the app',
    stable: 'Stable', stableHint: 'reviewed translations only', preview: 'Preview', previewHint: 'everything, drafts included',
    pctReady: '{p}% done', pick: 'Choose file…', change: 'Change', accepts: 'Accepts {ext}', checking: 'Checking the disc…',
    discOk: 'Disc recognized', generate: 'Build translated disc', nothing: 'There is no text in this language and channel yet.',
    saveTitle: 'Save the translated disc', working: 'Building…', stop: 'Cancel', stopped: 'Cancelled. No file was created.',
    done: 'Done!', doneLead: 'The translated disc was saved to:', openFolder: 'Open folder', again: 'Build another',
    skipped: '{n} text tables could not be replaced and stay in the original language.', failed: 'Something went wrong', back: 'Back',
    details: 'Details', download: 'Downloading the translation', starting: 'Starting',
  },
  es: {
    settings: 'Ajustes', server: 'Dirección del servidor', uiLang: 'Idioma de la aplicación', cancel: 'Cancelar', save: 'Guardar',
    lead: 'Elige el juego, el idioma y tu copia del disco. La app genera un disco nuevo, traducido; el original no se modifica.',
    step1: 'Juego', step2: 'Idioma', step3: 'Tu disco', loading: 'Cargando los juegos…', noGames: 'Todavía no hay juegos disponibles.',
    offline: 'No se pudo conectar con el servidor ({url}).', retry: 'Reintentar', needsUpdate: 'Necesita una versión más nueva de la app',
    stable: 'Estable', stableHint: 'solo traducciones revisadas', preview: 'Vista previa', previewHint: 'todo, incluidos borradores',
    pctReady: '{p}% listo', pick: 'Elegir archivo…', change: 'Cambiar', accepts: 'Acepta {ext}', checking: 'Comprobando el disco…',
    discOk: 'Disco reconocido', generate: 'Generar disco traducido', nothing: 'Todavía no hay texto en este idioma y canal.',
    saveTitle: 'Guardar el disco traducido', working: 'Generando…', stop: 'Cancelar', stopped: 'Cancelado. No se creó ningún archivo.',
    done: '¡Listo!', doneLead: 'El disco traducido se guardó en:', openFolder: 'Abrir carpeta', again: 'Generar otro',
    skipped: '{n} tablas de texto no se pudieron cambiar y quedan en el original.', failed: 'Algo salió mal', back: 'Volver',
    details: 'Detalles', download: 'Descargando la traducción', starting: 'Iniciando',
  },
};
// the engine reports its stages in Portuguese; these map them for the other interface languages
const STAGES = {
  'Baixando a tradução': 'download', 'Copiando o disco': { en: 'Copying the disc', es: 'Copiando el disco' },
  'Lendo os arquivos do jogo': { en: 'Reading the game files', es: 'Leyendo los archivos del juego' },
  'Abrindo as cenas': { en: 'Opening the scenes', es: 'Abriendo las escenas' },
  'Desenhando as fontes': { en: 'Drawing the fonts', es: 'Dibujando las fuentes' },
  'Recompactando': { en: 'Recompressing', es: 'Recomprimiendo' },
  'Gravando o disco traduzido': { en: 'Writing the translated disc', es: 'Grabando el disco traducido' },
};

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private storage off: settings last for this run */ } },
};
let ui = store.get('ui', (navigator.language || 'pt').slice(0, 2));
if (!DICT[ui]) ui = 'pt';
const t = (k, v = {}) => (DICT[ui][k] ?? DICT.pt[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const stageText = (label) => { const s = STAGES[label]; return !s || ui === 'pt' ? label : s === 'download' ? t('download') : s[ui] || label; };
const langName = (code) => {
  let n = code;
  try { n = new Intl.DisplayNames([ui], { type: 'language' }).of(code) || code; } catch { /* unknown code: show it as is */ }
  return n.charAt(0).toLocaleUpperCase(ui) + n.slice(1);
};
const server = () => store.get('server', DEFAULT_SERVER).replace(/\/$/, '');

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

// ---------------------------------------------------------------- engine (sidecar or demo)

const SIDECAR = 'binaries/glifo-patcher';
const engine = T ? {
  async releases() {
    const r = await fetch(`${server()}/api/releases`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).games;
  },
  async call(args) {
    const r = await T.shell.Command.sidecar(SIDECAR, args).execute();
    const line = r.stdout.trim().split('\n').pop();
    try { return JSON.parse(line); } catch { throw new Error(r.stderr.trim().split('\n').pop() || `engine exited with ${r.code}`); }
  },
  async run(args, onEvent) {
    const cmd = T.shell.Command.sidecar(SIDECAR, args);
    let buf = '';
    const err = [];
    cmd.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) if (l.trim()) { try { onEvent(JSON.parse(l)); } catch { /* not ours */ } }
    });
    cmd.stderr.on('data', (l) => { err.push(l); if (err.length > 40) err.shift(); });
    const closed = new Promise((resolve) => cmd.on('close', ({ code }) => resolve({ code, stderr: err.join('\n') })));
    const child = await cmd.spawn();
    return { closed, kill: () => child.kill() };
  },
  pickInput: (accept) => T.dialog.open({ multiple: false, directory: false, filters: [{ name: accept.map((x) => `.${x}`).join(', '), extensions: accept }] }),
  pickOutput: (defaultPath) => T.dialog.save({ title: t('saveTitle'), defaultPath, filters: [{ name: 'ISO', extensions: ['iso'] }] }),
  reveal: (p) => T.opener.revealItemInDir(p),
  discard: (output) => T.core.invoke('discard_partial', { output }),
} : demoEngine();

function demoEngine() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async releases() {
      await sleep(300);
      return [{ slug: 'bomberman-land-3', name: 'Bomberman Land 3', platform: 'PlayStation 2', source_lang: 'ja', patcher: { id: 'bml3', kind: 'ps2-iso' }, total: 12413,
        langs: [{ lang: 'en', done: 140, reviewed: 0 }, { lang: 'es', done: 2210, reviewed: 830 }, { lang: 'pt', done: 12349, reviewed: 9120 }] },
      { slug: 'outro-jogo', name: 'Outro jogo', platform: 'PSP', source_lang: 'ja', patcher: { id: 'psp-x', kind: 'psp-iso' }, total: 100, langs: [] }];
    },
    async call(args) {
      if (args[0] === 'patchers') return [{ id: 'bml3', name: 'Bomberman Land 3 (PS2, SLPM-62643)', kind: 'ps2-iso', accept: ['iso', 'bin', 'cue'] }];
      await sleep(500);
      return { ok: true, name: 'Bomberman Land 3 (PS2, SLPM-62643)' };
    },
    async run(args, onEvent) {
      let stop = false;
      const labels = ['Baixando a tradução', 'Copiando o disco', 'Lendo os arquivos do jogo', 'Abrindo as cenas', 'Desenhando as fontes', 'Recompactando', 'Gravando o disco traduzido'];
      const closed = (async () => {
        for (let p = 0; p <= 100 && !stop; p += 1) { onEvent({ event: 'progress', pct: p, label: labels[Math.min(labels.length - 1, Math.floor(p / 15))] }); if (p % 10 === 0) onEvent({ event: 'log', text: `etapa ${p}` }); await sleep(40); }
        if (!stop) onEvent({ event: 'done', output: args[args.indexOf('--output') + 1], skipped: 0 });
        return { code: stop ? 1 : 0, stderr: '' };
      })();
      return { closed, kill: () => { stop = true; } };
    },
    pickInput: async () => 'C:\\Jogos\\Bomberman Land 3 (Japan).cue',
    pickOutput: async (p) => p,
    reveal: async () => {},
    discard: async () => {},
  };
}

// ---------------------------------------------------------------- state

const S = {
  view: 'pick',          // pick | run | done | error
  games: null, error: null, local: [],
  game: null, lang: null, channel: store.get('channel', 'estavel'),
  input: null, check: null, // check: null | 'busy' | { ok, message }
  pct: 0, label: '', log: [], output: null, skipped: 0, failure: '', job: null, cancelled: false,
};

async function loadGames() {
  S.games = null; S.error = null; render();
  try {
    if (!S.local.length) S.local = await engine.call(['patchers']);
    S.games = await engine.releases();
    const last = store.get('game', '');
    selectGame(S.games.find((g) => g.slug === last && patcherOf(g)) || S.games.find(patcherOf) || null);
  } catch (e) {
    S.error = e; S.games = null;
  }
  render();
}

const patcherOf = (g) => g && S.local.find((p) => p.id === g.patcher.id);
const pctOf = (g, l, channel = S.channel) => (g.total ? Math.floor((100 * (channel === 'previa' ? l.done : l.reviewed)) / g.total) : 0);

function selectGame(g) {
  if (S.game?.slug !== g?.slug) { S.input = null; S.check = null; }
  S.game = g;
  if (!g) { S.lang = null; return; }
  store.set('game', g.slug);
  const last = store.get(`lang:${g.slug}`, '');
  S.lang = g.langs.find((l) => l.lang === last)?.lang || [...g.langs].sort((a, b) => b.done - a.done)[0]?.lang || null;
  const saved = store.get(`input:${g.slug}`, '');
  if (saved && !S.input) checkInput(saved);
}

async function checkInput(path) {
  S.input = path; S.check = 'busy'; render();
  try { S.check = await engine.call(['detect', '--patcher', S.game.patcher.id, path]); }
  catch (e) { S.check = { ok: false, message: e.message }; }
  if (S.check.ok) store.set(`input:${S.game.slug}`, path);
  render();
}

const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const safeName = (s) => s.replace(/[<>:"/\\|?*]+/g, ' ').trim();

async function generate() {
  const g = S.game;
  const output = await engine.pickOutput(`${dirOf(S.input)}${sep(S.input)}${safeName(g.name)} (${S.lang}).iso`);
  if (!output) return;
  Object.assign(S, { view: 'run', pct: 0, label: t('starting'), log: [], output, skipped: 0, failure: '', cancelled: false });
  render();
  const url = `${server()}/api/releases/${encodeURIComponent(g.slug)}/${encodeURIComponent(S.lang)}?canal=${S.channel}`;
  let finished = false;
  try {
    S.job = await engine.run(['apply', '--patcher', g.patcher.id, '--input', S.input, '--lang', S.lang, '--output', output, '--url', url], (ev) => {
      if (ev.event === 'progress') { S.pct = ev.pct; S.label = stageText(ev.label); paintProgress(); }
      else if (ev.event === 'log') { S.log.push(ev.text); if (S.log.length > 400) S.log.shift(); paintLog(); }
      else if (ev.event === 'done') { finished = true; S.skipped = ev.skipped; S.output = ev.output; }
      else if (ev.event === 'error') { S.failure = ev.message; }
    });
    const { code, stderr } = await S.job.closed;
    if (S.cancelled) {
      await engine.discard(output);
      engine.call(['cleanup']).catch(() => {}); // the killed run's temporary folder
      S.view = 'pick'; render(); toast(t('stopped')); return;
    }
    if (finished) S.view = 'done';
    else { S.view = 'error'; S.failure ||= stderr.trim().split('\n').pop() || `código ${code}`; }
  } catch (e) {
    S.view = 'error'; S.failure = e.message || String(e);
  }
  S.job = null;
  render();
}

function cancel() {
  if (!S.job) return;
  S.cancelled = true;
  S.job.kill();
}

// ---------------------------------------------------------------- views

const app = document.getElementById('app');

function render() {
  document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[ui];
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  app.replaceChildren(S.view === 'pick' ? pickView() : S.view === 'run' ? runView() : S.view === 'done' ? doneView() : errorView());
}

function step(n, title, body, enabled = true) {
  return h('section', { class: `step${enabled ? '' : ' off'}` }, h('div', { class: 'step-head' }, h('span', { class: 'num', text: n }), h('h2', { text: title })), body);
}

function pickView() {
  const intro = h('p', { class: 'lead', text: t('lead') });
  if (S.error) {
    return h('div', { class: 'stack' }, intro, h('div', { class: 'notice bad' }, h('p', { text: t('offline', { url: server() }) }),
      h('button', { class: 'btn', type: 'button', text: t('retry'), onclick: loadGames })));
  }
  if (!S.games) return h('div', { class: 'stack' }, intro, h('p', { class: 'muted', text: t('loading') }));
  if (!S.games.length) return h('div', { class: 'stack' }, intro, h('p', { class: 'muted', text: t('noGames') }));

  const games = h('div', { class: 'cards', role: 'radiogroup', 'aria-label': t('step1') }, S.games.map((g) => {
    const ok = !!patcherOf(g);
    return h('button', { type: 'button', role: 'radio', class: 'card', 'aria-checked': String(S.game?.slug === g.slug), disabled: !ok,
      onclick: () => { selectGame(g); render(); } },
    h('strong', { text: g.name }), h('span', { class: 'muted small', text: ok ? g.platform : t('needsUpdate') }));
  }));

  const g = S.game;
  const channel = h('div', { class: 'seg', role: 'radiogroup' }, ['estavel', 'previa'].map((c) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(S.channel === c),
    onclick: () => { S.channel = c; store.set('channel', c); render(); },
  }, h('strong', { text: t(c === 'estavel' ? 'stable' : 'preview') }), h('span', { text: t(c === 'estavel' ? 'stableHint' : 'previewHint') }))));
  const langs = g ? h('div', { class: 'langs', role: 'radiogroup', 'aria-label': t('step2') }, g.langs.map((l) => {
    const p = pctOf(g, l);
    return h('button', { type: 'button', role: 'radio', class: 'lang', 'aria-checked': String(S.lang === l.lang),
      onclick: () => { S.lang = l.lang; store.set(`lang:${g.slug}`, l.lang); render(); } },
    h('span', { class: 'lang-name' }, langName(l.lang), h('code', { text: l.lang })),
    h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${p}%` })),
    h('span', { class: 'pct', text: t('pctReady', { p }) }));
  })) : null;

  const accept = patcherOf(g)?.accept || [];
  let disc;
  if (!S.input) disc = h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: t('pick'), onclick: pickInput }), h('span', { class: 'muted small', text: t('accepts', { ext: accept.map((x) => `.${x}`).join(' ') }) }));
  else {
    const st = S.check === 'busy' ? h('span', { class: 'muted small', text: t('checking') })
      : S.check?.ok ? h('span', { class: 'ok small', text: `✓ ${t('discOk')}` })
        : h('span', { class: 'bad small', text: S.check?.message || '' });
    disc = h('div', { class: 'file' }, h('div', { class: 'file-path' }, h('span', { class: 'path', title: S.input, text: S.input }), st),
      h('button', { class: 'btn', type: 'button', text: t('change'), onclick: pickInput }));
  }

  const lang = g?.langs.find((l) => l.lang === S.lang);
  const empty = !!lang && (S.channel === 'previa' ? lang.done : lang.reviewed) === 0;
  const ready = g && lang && S.check?.ok && !empty;
  return h('div', { class: 'stack' }, intro,
    step(1, t('step1'), games),
    step(2, t('step2'), h('div', { class: 'stack sm' }, channel, langs), !!g),
    step(3, t('step3'), disc, !!g),
    h('div', { class: 'actions' }, empty ? h('span', { class: 'muted small', text: t('nothing') }) : null,
      h('button', { class: 'btn primary big', type: 'button', disabled: !ready, text: t('generate'), onclick: generate })));
}

async function pickInput() {
  const p = await engine.pickInput(patcherOf(S.game)?.accept || ['iso']);
  if (p) checkInput(Array.isArray(p) ? p[0] : p);
}

function runView() {
  return h('div', { class: 'stack center' },
    h('h1', { text: t('working') }),
    h('p', { class: 'muted', text: `${S.game.name} · ${langName(S.lang)} · ${t(S.channel === 'estavel' ? 'stable' : 'preview')}` }),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(S.pct)), id: 'pbar' }, h('span', { id: 'pfill', style: `width:${S.pct}%` })),
    h('div', { class: 'row between' }, h('span', { id: 'plabel', text: S.label }), h('span', { id: 'ppct', class: 'mono', text: `${Math.floor(S.pct)}%` })),
    logBox(),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: t('stop'), onclick: cancel })));
}

function logBox() {
  return h('details', { class: 'log' }, h('summary', { text: t('details') }), h('pre', { id: 'plog', text: S.log.join('\n') }));
}

function paintProgress() {
  const f = document.getElementById('pfill'); if (!f) return;
  f.style.width = `${S.pct}%`;
  document.getElementById('pbar').setAttribute('aria-valuenow', String(Math.round(S.pct)));
  document.getElementById('plabel').textContent = S.label;
  document.getElementById('ppct').textContent = `${Math.floor(S.pct)}%`;
}
function paintLog() {
  const pre = document.getElementById('plog'); if (!pre) return;
  pre.textContent = S.log.join('\n');
  pre.scrollTop = pre.scrollHeight;
}

function doneView() {
  return h('div', { class: 'stack center' },
    h('div', { class: 'badge ok', 'aria-hidden': 'true', text: '✓' }),
    h('h1', { text: t('done') }),
    h('p', { class: 'muted', text: t('doneLead') }), h('p', { class: 'path block', text: S.output }),
    S.skipped ? h('p', { class: 'notice warn', text: t('skipped', { n: S.skipped }) }) : null,
    logBox(),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: t('again'), onclick: () => { S.view = 'pick'; render(); } }),
      h('button', { class: 'btn primary', type: 'button', text: t('openFolder'), onclick: () => engine.reveal(S.output) })));
}

function errorView() {
  return h('div', { class: 'stack center' },
    h('div', { class: 'badge bad', 'aria-hidden': 'true', text: '!' }),
    h('h1', { text: t('failed') }), h('p', { class: 'notice bad', text: S.failure }),
    logBox(),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', text: t('back'), onclick: () => { S.view = 'pick'; render(); } })));
}

function toast(msg) {
  const el = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------------------------------------------------------------- settings

const dlg = document.getElementById('settings');
const uiSel = document.getElementById('ui-lang');
for (const [k, v] of Object.entries({ pt: 'Português', en: 'English', es: 'Español' })) uiSel.append(h('option', { value: k, text: v }));
document.getElementById('settings-btn').addEventListener('click', () => {
  if (S.view === 'run') return;
  document.getElementById('server-url').value = server();
  uiSel.value = ui;
  dlg.showModal();
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  const url = document.getElementById('server-url').value.trim() || DEFAULT_SERVER;
  const changed = url.replace(/\/$/, '') !== server();
  store.set('server', url);
  ui = uiSel.value; store.set('ui', ui);
  if (changed) loadGames(); else render();
});

loadGames();
