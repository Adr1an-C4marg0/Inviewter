'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  guild_id TEXT NOT NULL,
  chave    TEXT NOT NULL,
  valor    TEXT,
  PRIMARY KEY (guild_id, chave)
);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  codigo     TEXT    NOT NULL,
  nome       TEXT    NOT NULL,
  fonte      TEXT,
  canal_id   TEXT,
  criado_por TEXT,
  expira_em  INTEGER,
  max_usos   INTEGER NOT NULL DEFAULT 0,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  INTEGER NOT NULL,
  excluido_em INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_links_codigo ON links (guild_id, codigo);

CREATE TABLE IF NOT EXISTS entradas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  user_tag         TEXT,
  entrou_em        INTEGER NOT NULL,
  entrou_dia       TEXT    NOT NULL,
  saiu_em          INTEGER,
  saiu_dia         TEXT,
  retornos         INTEGER NOT NULL DEFAULT 0,
  tipo_origem      TEXT    NOT NULL,
  link_id          INTEGER REFERENCES links (id),
  convidador_id    TEXT,
  codigo           TEXT,
  conta_criada_em  INTEGER,
  fake             INTEGER NOT NULL DEFAULT 0,
  motivo_fake      TEXT,
  fake_manual      INTEGER NOT NULL DEFAULT 0,
  revisar          INTEGER NOT NULL DEFAULT 0,
  conta_convidador INTEGER NOT NULL DEFAULT 1,
  conta_metricas   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_entradas_link ON entradas (guild_id, link_id, entrou_em);
CREATE INDEX IF NOT EXISTS ix_entradas_convidador ON entradas (guild_id, convidador_id);
CREATE INDEX IF NOT EXISTS ix_entradas_codigo ON entradas (guild_id, codigo, entrou_em);

CREATE TABLE IF NOT EXISTS atividade_diaria (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  dia         TEXT    NOT NULL,
  mensagens   INTEGER NOT NULL DEFAULT 0,
  minutos_voz INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, dia)
);
CREATE INDEX IF NOT EXISTS ix_atividade_dia ON atividade_diaria (guild_id, dia);

CREATE TABLE IF NOT EXISTS permissoes (
  guild_id          TEXT    NOT NULL,
  cargo_id          TEXT    NOT NULL,
  ver_stats         INTEGER NOT NULL DEFAULT 0,
  gerir_links       INTEGER NOT NULL DEFAULT 0,
  gerir_recompensas INTEGER NOT NULL DEFAULT 0,
  exportar          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, cargo_id)
);

CREATE TABLE IF NOT EXISTS recompensa_concedida (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  concedida_em INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT    NOT NULL,
  user_id  TEXT,
  acao     TEXT    NOT NULL,
  detalhes TEXT,
  quando   INTEGER NOT NULL
);
`;

function iniciar(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function abrir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  return iniciar(new Database(path.join(dataDir, 'inviewte.db')));
}

function abrirMemoria() {
  return iniciar(new Database(':memory:'));
}

module.exports = { abrir, abrirMemoria, SCHEMA };
