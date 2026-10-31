// Server messages in the interface languages. Keyed by the Portuguese text the code uses, so every
// fail() keeps reading naturally; {name} marks a value filled in at run time.
const M = {
  'Arquivo grande demais.': { en: 'File too large.', es: 'Archivo demasiado grande.', ja: 'ファイルが大きすぎます。' },
  'Envie JSON.': { en: 'Send JSON.', es: 'Envía JSON.', ja: 'JSON を送信してください。' },
  'JSON inválido.': { en: 'Invalid JSON.', es: 'JSON no válido.', ja: 'JSON が不正です。' },
  'Login com GitHub ainda não configurado (GITHUB_CLIENT_ID).': { en: 'GitHub sign-in is not configured yet (GITHUB_CLIENT_ID).', es: 'El inicio de sesión con GitHub aún no está configurado (GITHUB_CLIENT_ID).', ja: 'GitHub ログインはまだ設定されていません (GITHUB_CLIENT_ID)。' },
  'Login expirou. Tente de novo.': { en: 'Sign-in expired. Please try again.', es: 'El inicio de sesión expiró. Inténtalo de nuevo.', ja: 'ログインの有効期限が切れました。もう一度お試しください。' },
  'O GitHub recusou o login. Tente de novo.': { en: 'GitHub declined the sign-in. Please try again.', es: 'GitHub rechazó el inicio de sesión. Inténtalo de nuevo.', ja: 'GitHub がログインを拒否しました。もう一度お試しください。' },
  'Não foi possível ler a conta do GitHub.': { en: 'Could not read the GitHub account.', es: 'No se pudo leer la cuenta de GitHub.', ja: 'GitHub アカウントを読み取れませんでした。' },
  'Projeto não encontrado.': { en: 'Project not found.', es: 'Proyecto no encontrado.', ja: 'プロジェクトが見つかりません。' },
  'Entre com sua conta do GitHub.': { en: 'Sign in with your GitHub account.', es: 'Entra con tu cuenta de GitHub.', ja: 'GitHub アカウントでログインしてください。' },
  'Só administradores criam projetos.': { en: 'Only admins can create projects.', es: 'Solo los administradores crean proyectos.', ja: 'プロジェクトを作成できるのは管理者のみです。' },
  'Informe o nome do jogo.': { en: 'Enter the game title.', es: 'Indica el nombre del juego.', ja: 'ゲーム名を入力してください。' },
  'Já existe um projeto com esse endereço.': { en: 'A project with this address already exists.', es: 'Ya existe un proyecto con esa dirección.', ja: 'このアドレスのプロジェクトは既に存在します。' },
  'Só a coordenação adiciona idiomas.': { en: 'Only coordinators can add languages.', es: 'Solo la coordinación añade idiomas.', ja: '言語を追加できるのはコーディネーターのみです。' },
  'Informe o código do idioma (ex.: pt, es, en).': { en: 'Enter the language code (e.g. pt, es, en).', es: 'Indica el código del idioma (ej.: pt, es, en).', ja: '言語コードを入力してください（例: pt, es, en）。' },
  'Só a coordenação remove idiomas.': { en: 'Only coordinators can remove languages.', es: 'Solo la coordinación quita idiomas.', ja: '言語を削除できるのはコーディネーターのみです。' },
  'O texto é visível para a equipe deste jogo. Peça para entrar na aba Equipe.': { en: 'The text is visible to this game\'s team. Ask to join in the Team tab.', es: 'El texto es visible para el equipo de este juego. Pide unirte en la pestaña Equipo.', ja: 'テキストはこのゲームのチームのみ閲覧できます。「チーム」タブで参加を申請してください。' },
  'Entre com o GitHub para ver o texto.': { en: 'Sign in with GitHub to see the text.', es: 'Entra con GitHub para ver el texto.', ja: 'テキストを見るには GitHub でログインしてください。' },
  'Você não traduz este idioma neste jogo.': { en: 'You do not translate this language in this game.', es: 'No traduces este idioma en este juego.', ja: 'このゲームではこの言語の翻訳権限がありません。' },
  'String não encontrada.': { en: 'String not found.', es: 'Cadena no encontrada.', ja: '文字列が見つかりません。' },
  'Idioma não existe neste projeto.': { en: 'This language is not part of the project.', es: 'Este idioma no existe en el proyecto.', ja: 'この言語はプロジェクトにありません。' },
  '{who} alterou esta string enquanto você editava.': { en: '{who} changed this string while you were editing.', es: '{who} cambió esta cadena mientras editabas.', ja: '編集中に {who} がこの文字列を変更しました。' },
  'Outra pessoa': { en: 'Someone else', es: 'Otra persona', ja: '別の人' },
  'Só revisores deste idioma aprovam traduções.': { en: 'Only this language\'s reviewers can approve translations.', es: 'Solo los revisores de este idioma aprueban traducciones.', ja: '翻訳を承認できるのはこの言語のレビュアーのみです。' },
  'Não há tradução para revisar.': { en: 'There is no translation to review.', es: 'No hay traducción para revisar.', ja: 'レビューする翻訳がありません。' },
  'Só a equipe vê o histórico.': { en: 'Only the team can see the history.', es: 'Solo el equipo ve el historial.', ja: '履歴を見られるのはチームのみです。' },
  'Só a coordenação importa texto.': { en: 'Only coordinators can import text.', es: 'Solo la coordinación importa texto.', ja: 'テキストを取り込めるのはコーディネーターのみです。' },
  'Só a coordenação exporta.': { en: 'Only coordinators can export.', es: 'Solo la coordinación exporta.', ja: '書き出しできるのはコーディネーターのみです。' },
  'Escolha pelo menos um idioma.': { en: 'Choose at least one language.', es: 'Elige al menos un idioma.', ja: '言語を1つ以上選んでください。' },
  'Você já tem um pedido aguardando resposta.': { en: 'You already have a request waiting for an answer.', es: 'Ya tienes una solicitud esperando respuesta.', ja: '返答待ちの申請が既にあります。' },
  'Só a coordenação responde pedidos.': { en: 'Only coordinators can answer requests.', es: 'Solo la coordinación responde solicitudes.', ja: '申請に返答できるのはコーディネーターのみです。' },
  'Pedido não encontrado.': { en: 'Request not found.', es: 'Solicitud no encontrada.', ja: '申請が見つかりません。' },
  'Só a coordenação muda a equipe.': { en: 'Only coordinators can change the team.', es: 'Solo la coordinación cambia el equipo.', ja: 'チームを変更できるのはコーディネーターのみです。' },
  'Essa pessoa ainda não entrou no site. Peça para ela entrar com o GitHub uma vez.': { en: 'This person has not signed in yet. Ask them to sign in with GitHub once.', es: 'Esta persona todavía no entró al sitio. Pídele que entre con GitHub una vez.', ja: 'この人はまだログインしていません。一度 GitHub でログインしてもらってください。' },
  'Papel inválido.': { en: 'Invalid role.', es: 'Rol no válido.', ja: '役割が不正です。' },
  'Só administradores nomeiam coordenadores.': { en: 'Only admins can appoint coordinators.', es: 'Solo los administradores nombran coordinadores.', ja: 'コーディネーターを任命できるのは管理者のみです。' },
  'Só administradores tiram coordenadores.': { en: 'Only admins can remove coordinators.', es: 'Solo los administradores quitan coordinadores.', ja: 'コーディネーターを外せるのは管理者のみです。' },
  'Só administradores.': { en: 'Admins only.', es: 'Solo administradores.', ja: '管理者のみ。' },
  'Você não pode tirar seu próprio acesso de administrador.': { en: 'You cannot remove your own admin access.', es: 'No puedes quitar tu propio acceso de administrador.', ja: '自分自身の管理者権限は外せません。' },
  'Rota não encontrada.': { en: 'Route not found.', es: 'Ruta no encontrada.', ja: 'ルートが見つかりません。' },
  'Pedido recusado.': { en: 'Request refused.', es: 'Solicitud rechazada.', ja: 'リクエストが拒否されました。' },
  'Erro no servidor. Tente de novo.': { en: 'Server error. Please try again.', es: 'Error del servidor. Inténtalo de nuevo.', ja: 'サーバーエラーです。もう一度お試しください。' },
  'Não encontrado.': { en: 'Not found.', es: 'No encontrado.', ja: '見つかりません。' },
  'Arquivo sem a coluna "{col}". Use o TSV gerado pelo textscan.py.': { en: 'File has no "{col}" column. Use the TSV made by textscan.py.', es: 'El archivo no tiene la columna "{col}". Usa el TSV generado por textscan.py.', ja: 'ファイルに「{col}」列がありません。textscan.py が出力した TSV を使ってください。' },
};

export const SUPPORTED = ['pt', 'en', 'es', 'ja'];

export function langOf(req) {
  const wanted = [req.headers['x-lang'], ...String(req.headers['accept-language'] || '').split(',').map((p) => p.split(';')[0])];
  for (const w of wanted) { const base = String(w || '').trim().slice(0, 2).toLowerCase(); if (SUPPORTED.includes(base)) return base; }
  return 'pt';
}

export function tr(lang, text, vars = {}) {
  const s = (lang !== 'pt' && M[text]?.[lang]) || text;
  return s.replace(/\{(\w+)\}/g, (_, v) => (v in vars ? String(vars[v]) : `{${v}}`));
}
