-- Glifo: schema (applied on every start; every statement is idempotent).

create table if not exists users (
  id          serial primary key,
  github_id   bigint unique not null,
  login       text not null,
  name        text not null default '',
  avatar_url  text not null default '',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create table if not exists sessions (
  token_hash  text primary key,
  user_id     int not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user on sessions(user_id);

create table if not exists games (
  id          serial primary key,
  slug        text unique not null,
  name        text not null,
  platform    text not null default '',
  source_lang text not null default 'ja',
  created_at  timestamptz not null default now()
);
-- which desktop-app patcher builds this game (server.js PATCHERS); null = not offered in the app
alter table games add column if not exists patcher text;

create table if not exists game_langs (
  game_id     int not null references games(id) on delete cascade,
  lang        text not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, lang)
);

-- A block is one unique string table of the TSV (split in parts of 200); identical tables in other
-- scenes are aliases, so a translation fills every copy on export.
create table if not exists blocks (
  id          serial primary key,
  game_id     int not null references games(id) on delete cascade,
  key         text not null,
  label       text not null,
  scene       text not null default '',
  position    int not null default 0,
  unique (game_id, key)
);

create table if not exists block_aliases (
  block_id    int not null references blocks(id) on delete cascade,
  sid         text not null,
  archive     text not null default '',
  entry       text not null default '',
  file        text not null default '',
  font_res    text not null default '',
  method      text not null default '',
  margin      text not null default '',
  primary key (block_id, sid)
);

create table if not exists strings (
  id          serial primary key,
  game_id     int not null references games(id) on delete cascade,
  block_id    int not null references blocks(id) on delete cascade,
  key         text not null,          -- "<string_res>#<id>" of the canonical table
  idx         int not null,           -- id inside the table (TSV column `id`)
  source      text not null,
  unique (game_id, key)
);
create index if not exists strings_block on strings(block_id, idx);

-- status: 'traduzida' (has text) or 'revisada' (approved by a reviewer)
create table if not exists translations (
  string_id   int not null references strings(id) on delete cascade,
  lang        text not null,
  text        text not null,
  status      text not null default 'traduzida',
  updated_by  int references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (string_id, lang)
);
create index if not exists translations_lang on translations(lang);

create table if not exists translation_history (
  id          bigserial primary key,
  string_id   int not null references strings(id) on delete cascade,
  lang        text not null,
  text        text not null,
  status      text not null,
  user_id     int references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists history_string on translation_history(string_id, lang, created_at desc);

-- role: 'coordenador' (lang '*', whole game), 'tradutor' or 'revisor' (one language)
create table if not exists members (
  game_id     int not null references games(id) on delete cascade,
  user_id     int not null references users(id) on delete cascade,
  lang        text not null,
  role        text not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, user_id, lang)
);

create table if not exists join_requests (
  id          serial primary key,
  game_id     int not null references games(id) on delete cascade,
  user_id     int not null references users(id) on delete cascade,
  langs       text[] not null,
  level       text not null default '',
  note        text not null default '',
  contact     text not null default '',
  status      text not null default 'pendente',
  created_at  timestamptz not null default now(),
  decided_by  int references users(id) on delete set null,
  decided_at  timestamptz
);
create index if not exists join_requests_game on join_requests(game_id, status);

create table if not exists activity (
  id          bigserial primary key,
  game_id     int references games(id) on delete cascade,
  user_id     int references users(id) on delete set null,
  kind        text not null,
  lang        text,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists activity_game on activity(game_id, created_at desc);

-- Optional grouping of scenes for the editor sidebar. scene = "<archive>/<entry>", like blocks.scene;
-- position keeps the order of the uploaded file (categories are listed by their first scene).
create table if not exists scene_categories (
  game_id     int not null references games(id) on delete cascade,
  scene       text not null,
  category    text not null,
  position    int not null default 0,
  primary key (game_id, scene)
);

-- Machine translation settings per game (Settings → Gemini). The key never leaves the server.
create table if not exists game_ai (
  game_id     int primary key references games(id) on delete cascade,
  api_key     text not null default '',
  model       text not null default '',
  prompt      text not null default '',
  updated_by  int references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
