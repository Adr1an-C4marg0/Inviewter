'use strict';

const link = require('./commands/link');
const stats = require('./commands/stats');
const { invites, top } = require('./commands/invites');
const recompensa = require('./commands/recompensa');
const resetar = require('./commands/resetar');
const config = require('./commands/config');
const exportar = require('./commands/exportar');
const painel = require('./commands/painel');

/** Todos os comandos, indexados pelo nome. Cada um tem `data`, `execute` e, opcionalmente, `autocomplete`. */
const todos = [link, stats, invites, top, recompensa, resetar, config, exportar, painel];

const porNome = new Map(todos.map((c) => [c.data.name, c]));

function json() {
  return todos.map((c) => c.data.toJSON());
}

module.exports = { porNome, json };
